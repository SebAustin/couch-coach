# Demo video tooling

Self-recording and composition for the Couch Coach demo video. The Fire TV records its own screen over adb, the
phone footage is an iOS Screen Recording, a listener stamps every Session event with the Mac clock, and the
footage is synced, face-blurred and cut into 1920x1080 clips for the Ultrademo project (Playwright capture ->
storyboard.json -> TTS -> Remotion render, in `../../../ultrademo-workspace`).

Everything a run produces goes in `scripts/video/runs/<runId>/` (gitignored: footage, Cue audio, the owner's face
before blurring). The tooling itself is committed.

| File | What it does |
|---|---|
| `tv-record.mjs` + `ccrec.sh` | `start` / `status` / `stop` / `pull` / `probe` the on-TV recording loop (170 s screenrecord chunks, TV clock stamp per chunk, filtered logcat, clock offset at start and stop) |
| `session-timeline.ts` | Attaches to a Session: `timeline.ndjson`, `cue-<set>.mp3` (downloaded the moment each Cue arrives), every Set saved as `couch-coach-landmarks/1` |
| `fetch-cues.mjs` | Fallback: `aws s3 cp s3://<bucket>/audio/<sid>/<call>.mp3` (read-only by construction; same day, objects expire) |
| `blur-face.py` | Blurs the owner's face in every phone frame (MediaPipe), drops the audio, resamples to constant 30 fps |
| `sync.mjs` | TV master on a 30 fps grid in Mac time, phone start refinement, sync checks, contact sheets -> `sync/sync.json` |
| `compose.mjs` | `beats.json` -> 1920x1080 30 fps H.264 clips (no audio) + end frames in `<project>/assets/captures/` |
| `verify-video.mjs` | Length, scene/Cue frames, 1 fps contact sheets, EBU R128, forbidden words, QR-token expiry, chapters |
| `templates/frame-split.html` | Lamplight background plate (#1b1420, #b9a2ff) for the split and TV-only layouts |
| `lib/*.mjs` | Pure logic (clock offset, TV master plan, phone sync, timeline, beats, layout, verify, S3 read-only guard) |

Requirements: Node 22+, `ffmpeg`/`ffprobe` (Homebrew), adb from `apps/tv/scripts/android-env.sh`, uv at
`/Users/sebastienhenry/.local/bin/uv`, Playwright + Chromium from the Ultrademo workspace (used by `compose.mjs`).
All paths in this repo contain spaces and a comma: always double-quote them. Commands below run from the
`couch-coach` folder unless they `cd`.

## Run of show

```bash
RUN=2026-10-22-1200        # one folder per filming run: scripts/video/runs/$RUN
```

### Pre-flight (Claude, TV awake, Screen Saver = Never)

```bash
node scripts/video/tv-record.mjs probe --run $RUN              # 5 s test clip pulled + probed, clock offset, model
node scripts/video/tv-record.mjs probe --run $RUN --bugreport  # once: start delay = TV time on frame 1 - tvStampBeforeMs (probe.json)
node scripts/video/tv-record.mjs status --run $RUN             # free space (needs 2 GB), clock offset
```

A/B the recording cost with the TV debug overlay ("Draw" fps). If Draw fps drops by more than 10%, record with
`--size 1280x720 --bit-rate 4000000`.

### Filming (owner ~25 min; Claude on the Mac)

```bash
node scripts/video/tv-record.mjs start --run $RUN               # prints "chunk 01 recording"
# session id: from the TV's QR (s=<sessionId>) or the "session created" log line
cd scripts && npx tsx video/session-timeline.ts <sessionId> --run $RUN --phone-url '<url from the QR>'
# ... owner films (spec section 2): About screen, pair, set 1, Cue, set 2, Cue, jacks, End session, Recap ...
node scripts/video/tv-record.mjs stop --run $RUN                # stop flag + SIGINT, clock offset again
node scripts/video/tv-record.mjs pull --run $RUN                # pull, ffprobe, then delete from the TV
```

The listener detaches 60 s after `end_session` (or Ctrl-C). If a `cue-<n>.mp3` is missing, the same day:

```bash
node scripts/video/fetch-cues.mjs --bucket <audio bucket> --session <sessionId> --run $RUN --dry-run   # shows the commands
node scripts/video/fetch-cues.mjs --bucket <audio bucket> --session <sessionId> --run $RUN [--profile <p>]
```

### After filming

1. AirDrop the iOS recording with "All Photos Data" (keeps the creation date) and move it to
   `scripts/video/runs/$RUN/phone/phone.mov`. Never put the unblurred file anywhere else.
2. Blur the face (about real time on an M-series Mac), check the coverage, and review a debug render of every
   `none` segment the `.json` lists where the person is on screen:

   ```bash
   cd scripts/video
   /Users/sebastienhenry/.local/bin/uv run --with mediapipe --with opencv-python-headless \
     python blur-face.py runs/$RUN/phone/phone.mov runs/$RUN/phone/phone.blurred.mp4
   /Users/sebastienhenry/.local/bin/uv run --with mediapipe --with opencv-python-headless \
     python blur-face.py runs/$RUN/phone/phone.mov runs/$RUN/phone/phone.debug.mp4 --debug
   # still exposed somewhere? add a fixed box (output pixels), repeatable:  --region 300,700,500,600
   ```

3. Sync, then look at `sync/events/*.png` (TV | phone at each set_start, set_end and Cue):

   ```bash
   node scripts/video/sync.mjs --run $RUN --phone scripts/video/runs/$RUN/phone/phone.blurred.mp4
   ```

   If a side is off, edit `nudge: { tvMs, phoneMs }` in `runs/$RUN/sync/sync.json` (kept across re-runs) and run
   sync again (the TV master is cached). Targets: rep delay +100..400 ms, Cue card within 150 ms of the listener.
4. Write `runs/$RUN/beats.json` (anchors in Mac time; see `lib/beats.mjs`):

   ```json
   { "beats": [
     { "id": "device", "layout": "tv", "in": "tv:21.5", "out": "tv:33" },
     { "id": "reps", "layout": "split", "in": "set_start#1-1.5", "out": "set_end#1+0.5" },
     { "id": "cue1", "layout": "split", "in": "set_end#1-1", "out": "cue#1+8", "cue": 1 },
     { "id": "cue2", "layout": "split", "in": "cue#2-0.5", "out": "cue#2+9", "cue": 2, "narrationAfterCue": true },
     { "id": "recap", "layout": "tv", "in": "tv:640", "out": "tv:650" }
   ] }
   ```

   `tv:<s>` / `phone:<s>` are master times read off the contact sheets (`sync/sheets.json` maps tiles to times).
   A `phoneCrop: { top, bottom, left, right }` (source pixels) overrides the default status bar / Safari crop.
   Per beat, `tvCrop: { x, y, w, h }` zooms into the TV frame, and `holdStartS` (0-5) shows the first composed
   frame that long before the footage plays (both devices frozen together, for a line that must land on a
   static page before something covers it; cue times include the hold).
5. Compose into the Ultrademo project (after `npm run tts` there, pass `--storyboard` so cue beats are trimmed
   so the narration ends 0.4 s before each Cue):

   ```bash
   node scripts/video/compose.mjs --run $RUN --project ../ultrademo-workspace/projects/<name> --dry-run
   node scripts/video/compose.mjs --run $RUN --project ../ultrademo-workspace/projects/<name> \
     --storyboard ../ultrademo-workspace/projects/<name>/assets/storyboard.json
   ```

   Output: `assets/captures/<id>.mp4` + `<id>.png`, `assets/cues/cue-<n>.mp3` and
   `assets/captures/compose-manifest.json` (clip durations and `extraAudio: [{ src, at, duration, caption }]`).
6. Render in the Ultrademo workspace, then verify (upload time = when the owner will publish):

   ```bash
   node scripts/video/verify-video.mjs --run $RUN --video ../ultrademo-workspace/projects/<name>/out/<name>.mp4 \
     --project ../ultrademo-workspace/projects/<name> --upload-at 2026-10-22T22:00:00Z
   ```

   Exit 1 on any FAIL. Then fill the evidence table from the PNGs and sweep the contact sheets for secrets.

## Rules this tooling enforces

- **The face is never in a clip.** `compose.mjs` and `sync.mjs` refuse a phone file without `.blurred` in its name
  (`--allow-unblurred` exists for tests only). `blur-face.py` refuses a margin under 60%.
- **The QR stays, its token must be dead.** `verify-video.mjs` fails unless the Session's `expiresAt` (from
  `--phone-url`, `--token`, `--expires-at` or the run's `session.json`) is before `--upload-at`.
- **No signed URLs on disk.** The listener stores each Cue's S3 key, never the signed URL.
- **Read-only AWS.** `fetch-cues.mjs` only builds `aws s3 ls` / `aws s3 cp s3://... <local>`; anything else throws.
- **No "Ultrademo" anywhere, no "AI" in the sign-off.** Checked by `verify-video.mjs`.
- **Captions own y > 870.** Both layouts keep the device panels above it (the TV-only panel is 1536x864, not
  1600x900, for that reason).

## Tests

```bash
cd scripts/video && node --test "test/*.test.mjs"                       # pure logic + the ccrec.sh loop with stubs
cd scripts/video && /Users/sebastienhenry/.local/bin/uv run --with opencv-python-headless \
  python -m unittest discover -s test -p "test_*.py"                    # blur-face tracker, margin, obscure
cd scripts && npx tsc --noEmit -p video/tsconfig.json                    # session-timeline.ts
```
