# STATUS (resume point)

_Last updated: 2026-10-21 by the orchestrator._

Deadline: **Fri 2026-10-23 12:00 PT**. Plan of record: `PLAN.md` (r4).

## Done
- Skill plugins updated (mattpocock-skills 1.3.1, ai-project-agency 1.3.15).
- PLAN r4 written; ADR 0004 records the AgentCore → Bedrock Converse decision.

- Repos live; protocol (12 tests); UX spec `docs/ux.md`.
- pose-reps v0.1.0 tagged, CI green, 55 tests, 97.6% stmt / 92.9% branch coverage (synthetic fixtures only).
- events-client (36 tests) + phone app (23 tests), verified headless with mocked AppSync; not yet against real AppSync or a real phone.

- AWS stack `CouchCoachStack` deployed (us-east-1); phone app live at https://d36nqce57j19po.cloudfront.net; smoke test: POST /coach → Cue 0.9 s warm / 2.5 s cold (templated Cue).

- First live phone test (Oct 21 12:40): squats + jumping jacks counted on the real camera, real Haiku Cues with memory. Framing banner added after the "camera doesn't work" report (cause: legs out of frame).

- TV app built (Expo 54 / react-native-tvos 0.81): ARM-only APK of 33 MB, 100 jest tests, verified on the Android TV emulator against the live API.
- pose-reps v0.1.1: frame gate, smoothing, minRepMs, conservative faults; the real recorded set is a regression fixture (6 clean reps, 0 faults).

## Known issues
- heels_rising fires on every squat rep in live use; probably a 2D false positive. Tune with an exported real fixture.
- Pose rate on the phone varied 7.5–15 fps in the live test (SC2 target is ≥ 15).
- SC1 p95 ≈ 330–350 ms vs the 300 ms target (cloud round trip).
- Coach can contradict the fault data ("feet staying wider" with 8 feet_not_wide).

## In progress
- Android toolchain + TV app.

## Demo notes
- Place the phone about 45° in front for squats and straight on for jumping jacks (2D heuristics; see pose-reps README).
- Thresholds need one pass on real footage at checkpoint 1 (heel rise and knee cave are the most view-dependent).

## Next
- Step 1 parallel build: pose-reps, infra + services, protocol + events-client, Android toolchain.

## Waiting on the user
- Confirm the AWS SNS subscription email for the coach alarms.
- Checkpoint 1: run `bash apps/tv/scripts/fire-tv-wizard.sh` (mattpocock `wizard`) to sideload onto the Fire TV and do a first live Session.
- Checkpoint 2: film the video, upload to YouTube, submit on Devpost, decide on npm publish.

## After judging
- Revoke the AppSync API key (expires 2026-12-15 anyway) and `cdk destroy` if no longer needed.
