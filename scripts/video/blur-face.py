#!/usr/bin/env python3
"""
Blurs the owner's face in EVERY frame of the phone screen recording, before the footage goes anywhere else.

  uv run --with mediapipe --with opencv-python-headless python blur-face.py in.MOV out.blurred.mp4
      [--fps 30] [--margin 0.6] [--hold 1.0] [--smooth 0.5] [--cells 7]
      [--region x,y,w,h]... [--no-detect] [--debug] [--min-coverage PCT]
      [--pose-model PATH] [--face-model PATH] [--detect-height 960] [--crf 18]

Pipeline: ffmpeg decodes to constant-fps raw frames (iOS screen recordings are variable frame rate; resampling
here keeps every timestamp exact for sync.mjs), MediaPipe finds heads, OpenCV pixelates + blurs them, ffmpeg
encodes H.264 with NO audio and the source creation date copied over.

Detection (MediaPipe Tasks, CPU, every frame):
  * PoseLandmarker with the app's own model (apps/phone/public/models/pose_landmarker_lite.task): the head box
    comes from the nose/eye/ear/mouth landmarks and is sized from the shoulders. It is the detector the app
    relies on, so it finds the person whenever the app does, at 2-3 m, face-on or side-on.
  * FaceDetector as well when --face-model points at a BlazeFace .tflite (optional, not bundled).
Never-show-the-face rules: each box grows by --margin of its size on every side (default 0.6 -> 2.2x); boxes
are smoothed AND unioned with the raw detection, so smoothing never lags a moving head; after a miss the last
box is held, growing, for --hold seconds. --region x,y,w,h (output-frame pixels, repeatable) is always blurred:
the manual fallback. --debug draws the boxes (green fresh, yellow held, magenta region) over the blurred frame.

Prints coverage stats (fresh / held / no box, longest run without a box) and writes <out>.json with them, the
per-frame status as segments, and the source's creation tags (sync.mjs reads them from there).
"""
import argparse
import json
import math
import os
import subprocess
import sys
import time
from dataclasses import dataclass

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_POSE_MODEL = os.path.normpath(os.path.join(HERE, "..", "..", "apps", "phone", "public", "models", "pose_landmarker_lite.task"))
HEAD_POINTS = range(0, 11)  # MediaPipe pose: nose, eyes, ears, mouth corners
L_SHOULDER, R_SHOULDER = 11, 12
VISIBLE = 0.3  # low on purpose: recall matters more than precision here
HELD_GROWTH = 0.5  # a held box grows up to +50% by the end of the hold


def parse_args():
    p = argparse.ArgumentParser(description="Blur faces in a phone screen recording.")
    p.add_argument("input")
    p.add_argument("output")
    p.add_argument("--fps", type=float, default=30.0)
    p.add_argument("--margin", type=float, default=0.6, help="extra size on each side, as a fraction of the box (>= 0.6)")
    p.add_argument("--hold", type=float, default=1.0, help="seconds to keep blurring the last box after a miss")
    p.add_argument("--smooth", type=float, default=0.5, help="EMA weight of the previous box, 0..0.9")
    p.add_argument("--cells", type=int, default=7, help="pixelation cells across a blurred box")
    p.add_argument("--region", action="append", default=[], help="x,y,w,h always blurred (output pixels)")
    p.add_argument("--no-detect", action="store_true", help="only blur --region boxes")
    p.add_argument("--debug", action="store_true", help="draw boxes over the blurred output")
    p.add_argument("--min-coverage", type=float, default=0.0, help="exit 3 when fresh+held coverage %% is below this")
    p.add_argument("--pose-model", default=DEFAULT_POSE_MODEL)
    p.add_argument("--face-model", default=None, help="optional BlazeFace .tflite for MediaPipe FaceDetector")
    p.add_argument("--detect-height", type=int, default=960)
    p.add_argument("--crf", type=int, default=18)
    a = p.parse_args()
    if a.margin < 0.6:
        p.error("--margin must be >= 0.6")
    if not 0 <= a.smooth <= 0.9:
        p.error("--smooth must be within 0..0.9")
    a.regions = [parse_region(r, p) for r in a.region]
    if a.no_detect and not a.regions:
        p.error("--no-detect needs at least one --region")
    return a


def parse_region(text, parser):
    try:
        x, y, w, h = (int(v) for v in text.split(","))
    except ValueError:
        parser.error(f"--region must be x,y,w,h integers, got {text!r}")
    if w <= 0 or h <= 0:
        parser.error(f"--region needs a positive size, got {text!r}")
    return (x, y, w, h)


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        check=True, capture_output=True, text=True,
    ).stdout
    j = json.loads(out)
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    rotation = 0
    for d in v.get("side_data_list", []):
        rotation = int(d.get("rotation", rotation))
    w, h = v["width"], v["height"]
    if abs(rotation) % 180 == 90:
        w, h = h, w
    tags = {**j.get("format", {}).get("tags", {}), **v.get("tags", {})}
    return {"width": w, "height": h, "duration": float(j["format"].get("duration", 0) or 0), "tags": tags}


# --- boxes (x, y, w, h) in output pixels ------------------------------------------------------------------
def union(a, b):
    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
    x1, y1 = max(a[0] + a[2], b[0] + b[2]), max(a[1] + a[3], b[1] + b[3])
    return (x0, y0, x1 - x0, y1 - y0)


def scale(box, f):
    cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
    return (cx - box[2] * f / 2, cy - box[3] * f / 2, box[2] * f, box[3] * f)


def expand(box, margin):
    return (box[0] - margin * box[2], box[1] - margin * box[3], box[2] * (1 + 2 * margin), box[3] * (1 + 2 * margin))


def ema(prev, new, alpha):
    return tuple(alpha * p + (1 - alpha) * n for p, n in zip(prev, new))


def center_dist(a, b):
    return math.hypot(a[0] + a[2] / 2 - b[0] - b[2] / 2, a[1] + a[3] / 2 - b[1] - b[3] / 2)


# --- detection ----------------------------------------------------------------------------------------------
class Detector:
    """MediaPipe PoseLandmarker head boxes (+ FaceDetector boxes when a face model is given)."""

    def __init__(self, pose_model, face_model):
        import mediapipe as mp
        from mediapipe.tasks.python import vision
        from mediapipe.tasks.python.core.base_options import BaseOptions

        if not os.path.exists(pose_model):
            sys.exit(f"pose model not found: {pose_model} (pass --pose-model, or --no-detect with --region)")
        self.mp = mp
        self.pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=pose_model), running_mode=vision.RunningMode.VIDEO, num_poses=2,
            min_pose_detection_confidence=0.3, min_pose_presence_confidence=0.3, min_tracking_confidence=0.3,
        ))
        self.face = None
        if face_model:
            if not os.path.exists(face_model):
                sys.exit(f"face model not found: {face_model}")
            self.face = vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(
                base_options=BaseOptions(model_asset_path=face_model), running_mode=vision.RunningMode.VIDEO,
                min_detection_confidence=0.3,
            ))

    def boxes(self, frame_bgr, ts_ms, detect_h):
        H, W = frame_bgr.shape[:2]
        dh = min(detect_h, H)
        dw = max(1, round(W * dh / H))
        small = cv2.resize(frame_bgr, (dw, dh), interpolation=cv2.INTER_AREA) if dh != H else frame_bgr
        image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=np.ascontiguousarray(small[:, :, ::-1]))
        found = [b for lms in self.pose.detect_for_video(image, ts_ms).pose_landmarks if (b := head_box(lms, W, H))]
        if self.face:
            sx = W / dw
            for d in self.face.detect_for_video(image, ts_ms).detections:
                bb = d.bounding_box
                found.append((bb.origin_x * sx, bb.origin_y * sx, bb.width * sx, bb.height * sx))
        return found


def head_box(lms, W, H):
    vis = lambda lm: lm.visibility if lm.visibility is not None else 1.0
    pts = [(lms[i].x * W, lms[i].y * H) for i in HEAD_POINTS if vis(lms[i]) >= VISIBLE]
    if len(pts) < 2:
        return None
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    ls, rs = lms[L_SHOULDER], lms[R_SHOULDER]
    if vis(ls) >= VISIBLE and vis(rs) >= VISIBLE:
        span = max(span, 0.55 * math.hypot((ls.x - rs.x) * W, (ls.y - rs.y) * H))
    w = max(span * 1.4, 12.0)  # ear-to-ear is about the head width; pad for hair and chin
    h = w * 1.35
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    return (cx - w / 2, cy - h * 0.55, w, h)  # eyes and ears sit a little above the head's middle


# --- temporal tracking ----------------------------------------------------------------------------------------
@dataclass
class Track:
    box: tuple
    raw: tuple
    last_seen: int


class Tracker:
    def __init__(self, hold_frames, alpha):
        self.hold = max(1, hold_frames)
        self.alpha = alpha
        self.tracks = []

    def update(self, idx, dets):
        updated = set()
        for d in dets:
            near = [t for t in self.tracks if center_dist(t.box, d) < max(t.box[2], t.box[3])]
            t = min(near, key=lambda t: center_dist(t.box, d)) if near else None
            if t is None:
                self.tracks.append(Track(d, d, idx))
                updated.add(id(self.tracks[-1]))
            elif id(t) in updated:  # second detector on the same head
                t.raw = union(t.raw, d)
                t.box = union(t.box, d)
            else:
                t.box, t.raw, t.last_seen = ema(t.box, d, self.alpha), d, idx
                updated.add(id(t))
        self.tracks = [t for t in self.tracks if idx - t.last_seen <= self.hold]
        out = []
        for t in self.tracks:
            age = idx - t.last_seen
            if age == 0:
                out.append((union(t.box, t.raw), "fresh"))
            else:
                out.append((scale(t.box, 1 + HELD_GROWTH * age / self.hold), "held"))
        return out


# --- drawing --------------------------------------------------------------------------------------------------
def clip(box, W, H):
    x0, y0 = max(0, int(math.floor(box[0]))), max(0, int(math.floor(box[1])))
    x1, y1 = min(W, int(math.ceil(box[0] + box[2]))), min(H, int(math.ceil(box[1] + box[3])))
    return (x0, y0, x1, y1) if x1 - x0 >= 2 and y1 - y0 >= 2 else None


def obscure(frame, rect, cells):
    """Pixelate to `cells` blocks across, then a heavy gaussian on top: not recoverable."""
    x0, y0, x1, y1 = rect
    roi = frame[y0:y1, x0:x1]
    h, w = roi.shape[:2]
    n = max(2, cells)
    sw, sh = max(1, round(w * n / max(w, h))), max(1, round(h * n / max(w, h)))
    blocky = cv2.resize(cv2.resize(roi, (sw, sh), interpolation=cv2.INTER_AREA), (w, h), interpolation=cv2.INTER_NEAREST)
    k = (max(w, h) // n) | 1
    frame[y0:y1, x0:x1] = cv2.GaussianBlur(blocky, (k, k), 0)


DEBUG_COLORS = {"fresh": (0, 220, 0), "held": (0, 220, 255), "region": (255, 0, 255)}


# --- main -----------------------------------------------------------------------------------------------------
def main():
    a = parse_args()
    if ".blurred" not in os.path.basename(a.output) and not a.debug:
        print(f"note: compose.mjs only accepts phone files named *.blurred.*; {a.output} is not", file=sys.stderr)
    info = probe(a.input)
    W, H = info["width"] + info["width"] % 2, info["height"] + info["height"] % 2
    expected = max(1, round(info["duration"] * a.fps))
    hold_frames = round(a.hold * a.fps)

    detector = None if a.no_detect else Detector(a.pose_model, a.face_model)
    tracker = Tracker(hold_frames, a.smooth)
    creation = info["tags"].get("creation_time")

    dec = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", a.input, "-an", "-vf", f"fps={a.fps},pad=ceil(iw/2)*2:ceil(ih/2)*2",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        stdout=subprocess.PIPE,
    )
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(a.fps),
         "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", str(a.crf), "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", *(["-metadata", f"creation_time={creation}"] if creation else []), a.output],
        stdin=subprocess.PIPE,
    )

    frame_bytes = W * H * 3
    statuses = []
    started = time.time()
    idx = 0
    try:
        while True:
            buf = dec.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            frame = np.frombuffer(buf, dtype=np.uint8).reshape(H, W, 3).copy()
            dets = detector.boxes(frame, round(idx * 1000 / a.fps), a.detect_height) if detector else []
            boxes = tracker.update(idx, dets) if detector else []
            status = "fresh" if any(s == "fresh" for _, s in boxes) else "held" if boxes else "none"
            statuses.append(status)
            drawn = [(expand(b, a.margin), s) for b, s in boxes] + [(r, "region") for r in a.regions]
            for box, _ in drawn:
                rect = clip(box, W, H)
                if rect:
                    obscure(frame, rect, a.cells)
            if a.debug:
                for box, s in drawn:
                    rect = clip(box, W, H)
                    if rect:
                        cv2.rectangle(frame, rect[:2], rect[2:], DEBUG_COLORS[s], 4)
                cv2.putText(frame, f"{idx} {status}", (24, 64), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (255, 255, 255), 4)
            enc.stdin.write(frame.tobytes())
            idx += 1
            if idx % 300 == 0:
                rate = idx / max(1e-6, time.time() - started)
                print(f"frame {idx}/{expected} ({rate:.1f} fps)", file=sys.stderr, flush=True)
    finally:
        enc.stdin.close()
        enc.wait()
        dec.stdout.close()
        dec.wait()
    if dec.returncode not in (0, None) or enc.returncode != 0:
        sys.exit(f"ffmpeg failed (decode {dec.returncode}, encode {enc.returncode})")
    if idx == 0:
        sys.exit("no frames decoded")

    stats = coverage(statuses, a.fps, bool(detector))
    report = {
        "source": os.path.abspath(a.input),
        "output": os.path.abspath(a.output),
        "sourceTags": {k: v for k, v in info["tags"].items() if "creation" in k},
        "fps": a.fps, "width": W, "height": H, "frames": idx,
        "settings": {"margin": a.margin, "holdS": a.hold, "smooth": a.smooth, "cells": a.cells, "regions": a.regions,
                     "detect": not a.no_detect, "poseModel": a.pose_model if detector else None, "faceModel": a.face_model},
        "stats": stats,
        "segments": segments(statuses, a.fps),
    }
    with open(f"{a.output}.json", "w") as f:
        json.dump(report, f, indent=2)
    print_stats(stats, a, time.time() - started)
    if stats["coveredPct"] < a.min_coverage:
        sys.exit(3)


def coverage(statuses, fps, detecting):
    n = len(statuses)
    count = lambda s: sum(1 for x in statuses if x == s)
    longest, run = 0, 0
    for s in statuses:
        run = run + 1 if s == "none" else 0
        longest = max(longest, run)
    fresh, held, none = count("fresh"), count("held"), count("none")
    return {
        "frames": n, "fresh": fresh, "held": held, "none": none, "detecting": detecting,
        "coveredPct": round(100 * (fresh + held) / n, 2),
        "longestNoBoxFrames": longest, "longestNoBoxS": round(longest / fps, 2),
    }


def segments(statuses, fps):
    out = []
    for i, s in enumerate(statuses):
        if out and out[-1]["status"] == s:
            out[-1]["toFrame"] = i
        else:
            out.append({"status": s, "fromFrame": i, "toFrame": i})
    for seg in out:
        seg["fromS"], seg["toS"] = round(seg["fromFrame"] / fps, 3), round((seg["toFrame"] + 1) / fps, 3)
    return out


def print_stats(s, a, elapsed):
    pct = lambda k: f"{100 * s[k] / s['frames']:.1f}%"
    print(f"{a.output}: {s['frames']} frames in {elapsed:.0f} s")
    if s["detecting"]:
        print(f"  face boxes: fresh {s['fresh']} ({pct('fresh')}), held {s['held']} ({pct('held')}), "
              f"no box {s['none']} ({pct('none')}); longest run without a box {s['longestNoBoxS']} s")
        print("  review every 'none' segment in the .json with --debug before using a stretch where the person is on screen")
    if a.regions:
        print(f"  fixed regions blurred on every frame: {len(a.regions)}")


if __name__ == "__main__":
    main()
