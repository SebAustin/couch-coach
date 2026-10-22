"""
Unit tests for blur-face.py's pure logic (head box, tracker hold/growth, margin, obscure, coverage stats).

  cd scripts/video && uv run --with opencv-python-headless python -m unittest discover -s test -p "test_*.py"
"""
import importlib.util
import os
import sys
import unittest
from types import SimpleNamespace

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("blur_face", os.path.join(HERE, "..", "blur-face.py"))
bf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bf)


def lm(x, y, v=0.99):
    return SimpleNamespace(x=x, y=y, visibility=v)


def pose(head=(0.5, 0.2), shoulder_half=0.08, head_vis=0.99):
    hx, hy = head
    lms = [lm(0.5, 0.9, 0.1) for _ in range(33)]
    for i, (dx, dy) in enumerate([(0, 0), (-0.01, -0.01), (-0.015, -0.01), (-0.02, -0.01), (0.01, -0.01), (0.015, -0.01),
                                  (0.02, -0.01), (-0.03, 0), (0.03, 0), (-0.01, 0.015), (0.01, 0.015)]):
        lms[i] = lm(hx + dx, hy + dy, head_vis)
    lms[11] = lm(hx + shoulder_half, hy + 0.1)
    lms[12] = lm(hx - shoulder_half, hy + 0.1)
    return lms


def contains(outer, inner):
    return (outer[0] <= inner[0] and outer[1] <= inner[1]
            and outer[0] + outer[2] >= inner[0] + inner[2] and outer[1] + outer[3] >= inner[1] + inner[3])


class HeadBoxTest(unittest.TestCase):
    def test_box_covers_every_head_landmark(self):
        W, H = 1170, 2532
        lms = pose()
        box = bf.head_box(lms, W, H)
        for i in range(11):
            x, y = lms[i].x * W, lms[i].y * H
            self.assertTrue(box[0] <= x <= box[0] + box[2] and box[1] <= y <= box[1] + box[3], i)

    def test_box_is_sized_from_the_shoulders_when_the_face_points_are_bunched(self):
        W, H = 1170, 2532
        box = bf.head_box(pose(shoulder_half=0.1), W, H)
        shoulder_px = 0.2 * W
        self.assertGreaterEqual(box[2], 0.55 * shoulder_px * 1.4 - 1e-6)
        self.assertAlmostEqual(box[3], box[2] * 1.35)

    def test_no_box_without_two_visible_head_points(self):
        self.assertIsNone(bf.head_box(pose(head_vis=0.05), 1170, 2532))


class TrackerTest(unittest.TestCase):
    def test_fresh_box_always_contains_the_raw_detection(self):
        t = bf.Tracker(hold_frames=30, alpha=0.5)
        t.update(0, [(100, 100, 50, 60)])
        out = t.update(1, [(130, 100, 50, 60)])  # head moved right; smoothing alone would lag
        self.assertEqual(out[0][1], "fresh")
        self.assertTrue(contains(out[0][0], (130, 100, 50, 60)))

    def test_box_is_held_and_grows_after_a_miss_then_dropped(self):
        t = bf.Tracker(hold_frames=30, alpha=0.5)
        t.update(0, [(100, 100, 50, 60)])
        held = t.update(15, [])
        self.assertEqual(held[0][1], "held")
        self.assertGreater(held[0][0][2], 50)
        self.assertTrue(contains(held[0][0], (100, 100, 50, 60)))
        self.assertEqual(t.update(30, [])[0][1], "held")
        self.assertEqual(t.update(31, []), [])

    def test_two_detectors_on_one_head_merge_into_one_box(self):
        t = bf.Tracker(hold_frames=30, alpha=0.5)
        out = t.update(0, [(100, 100, 50, 60), (95, 110, 60, 50)])
        self.assertEqual(len(out), 1)
        self.assertTrue(contains(out[0][0], (95, 110, 60, 50)) and contains(out[0][0], (100, 100, 50, 60)))

    def test_two_people_get_two_boxes(self):
        t = bf.Tracker(hold_frames=30, alpha=0.5)
        self.assertEqual(len(t.update(0, [(100, 100, 50, 60), (600, 120, 50, 60)])), 2)


class BlurTest(unittest.TestCase):
    def test_margin_grows_the_box_on_every_side(self):
        for got, want in zip(bf.expand((100, 100, 50, 100), 0.6), (70.0, 40.0, 110.0, 220.0)):
            self.assertAlmostEqual(got, want)

    def test_obscure_wipes_detail_inside_and_leaves_outside_alone(self):
        rng = np.random.default_rng(1)
        frame = rng.integers(0, 255, (400, 400, 3), dtype=np.uint8)
        before = frame.copy()
        bf.obscure(frame, (100, 100, 300, 300), 7)
        self.assertLess(frame[100:300, 100:300].std(), before[100:300, 100:300].std() / 4)
        self.assertTrue(np.array_equal(frame[:100], before[:100]))

    def test_clip_drops_boxes_outside_the_frame(self):
        self.assertIsNone(bf.clip((-500, -500, 100, 100), 400, 400))
        self.assertEqual(bf.clip((-10, 390, 50, 50), 400, 400), (0, 390, 40, 400))


class StatsTest(unittest.TestCase):
    def test_coverage_and_segments(self):
        s = ["fresh"] * 30 + ["held"] * 10 + ["none"] * 20 + ["fresh"] * 30
        c = bf.coverage(s, 30, True)
        self.assertEqual((c["fresh"], c["held"], c["none"]), (60, 10, 20))
        self.assertEqual(c["longestNoBoxFrames"], 20)
        self.assertAlmostEqual(c["coveredPct"], 77.78)
        segs = bf.segments(s, 30)
        self.assertEqual([x["status"] for x in segs], ["fresh", "held", "none", "fresh"])
        self.assertEqual((segs[2]["fromS"], segs[2]["toS"]), (1.333, 2.0))

    def test_margin_below_60_percent_is_refused(self):
        argv = sys.argv
        sys.argv = ["blur-face.py", "in.mov", "out.blurred.mp4", "--margin", "0.3"]
        try:
            with self.assertRaises(SystemExit):
                bf.parse_args()
        finally:
            sys.argv = argv


if __name__ == "__main__":
    unittest.main()
