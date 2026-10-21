# Couch Coach — 52-hour rescue plan (PLAN r4)

## Context
The Oct 3 PLAN.md for **Couch Coach** (Fire TV + AWS Builder + Open Source) was approved, but none of it was built:
- `couch-coach` and `pose-reps` have no commits; `pose-reps` is empty.
- `apps/tv` is the unmodified `react-native-multi-tv-app-sample` (Expo 54, react-native-tvos 0.81). Its dependencies are not installed.
- Neither GitHub repo exists.
- No Vega SDK, adb or Android SDK is installed. AWS (account 430411150226, us-east-1) and `gh` are signed in.

The deadline is **Fri Oct 23, 12:00 PT** (≈52 h from now). The user has **3–4 h** in total, for the device test, filming and the Devpost submit. Everything else runs autonomously through the AI Project Agency and Matt Pocock skills.

Re-scope decisions (made today):

| Area | Decision |
|---|---|
| Device | Fire OS device; sideload an Android TV APK |
| Coach | Lean AWS: one Lambda calling Bedrock Converse (Haiku), Polly, AppSync Events, DynamoDB history as "memory". AgentCore is cut and logged honestly in the friction log. |
| Open source | `pose-reps`: squat and jumping jack only. MIT, tests, CI. npm publish stays gated. |

## Scope (MVP the video must show)
1. The TV shows a QR code, and the phone scans it to pair.
2. The phone runs MediaPipe Pose on-device and only keypoints leave it. The TV draws the live skeleton.
3. `pose-reps` counts squats and jacks on the phone. The TV shows the rep counter and the Form Score.
4. When a set ends, the coach Lambda calls Bedrock with this set plus the member's last 5 sets from DynamoDB. The TV shows a Cue card and plays the Polly voice.
5. A member list on the TV, chosen with the D-pad, shows that the coach remembers each person ("last time your knees caved").

Cut order if behind: member picker (one member) → Polly audio (text card only) → jumping jack → QR (fixed URL).
Fully cut: AgentCore Runtime/Memory, lunge, Sonnet recap, Vega build, spoken commands.

## Architecture (single CDK stack, `infra/`)
- **AppSync Events API** (API key, expires 2026-12-15), namespace `cc`:
  - `/cc/<sessionId>/pose`: 15 fps, batched 3 frames per publish.
  - `/cc/<sessionId>/events`: rep, fault, set_end and control events.
  - `/cc/<sessionId>/coach`
- **HTTP API + Lambdas (TS, arm64):**
  - `session` handles `POST /session` and `GET/POST /members`. It returns a 128-bit `sessionId` and an HMAC `phoneToken` (2 h) signed with a Secrets Manager secret.
  - `coach` handles `POST /coach`. It validates the token, enforces a cap of 30 calls per session with a DDB atomic counter, then calls Bedrock Converse (Haiku profile), Polly neural → S3 `audio/*` presigned URL (15 min), and publishes to AppSync over HTTP. It also stores the set summary for the member.
- **DynamoDB:** one table with `pk/sk`: SESSION#, MEMBER#, SET# items.
- **S3 + CloudFront** for the phone web app (HTTPS for the camera) and audio.
- **$50 budget alarm.** API throttling at 5 rps, burst 10. Least-privilege IAM as in PLAN.md §4.

Layout (npm workspaces):
- `packages/protocol`: zod schemas.
- `packages/events-client`: raw AppSync Events WebSocket client with jittered reconnect.
- `apps/phone`: Vite + TS + `@mediapipe/tasks-vision` + `pose-reps`.
- `services/{session,coach}`, `infra/`, `scripts/e2e-replay.ts`.
- `apps/tv` (Yarn 4) keeps `expo-multi-tv` and adds:
  - screens `Members → Pair (QR) → Live (SVG skeleton, reps, score) → Cue card`
  - `react-native-svg`, `react-native-qrcode-svg`, `expo-audio`
  - `scripts/sync-tv` copies protocol and events-client in.

Reuse from the sample: drawer/stack navigation, the D-pad focus components in `packages/shared-ui/src/components`, and the theme in `packages/shared-ui/src/theme`. The Vega app and the video screens are deleted (drop `PlayerScreen*`, `DetailsScreen`, `ExploreScreen`).

## Execution (agency loop, compressed; parallel where the files don't overlap)
**Step 0, housekeeping (me, ~10 min)**
- Update the skill plugins:
  - `claude plugin marketplace update claude-plugins-official`
  - `claude plugin update mattpocock-skills@claude-plugins-official`
  - `claude plugin update ai-project-agency@ai-agency`
- Fold this plan into `couch-coach/PLAN.md` as r4 and create `STATUS.md`.
- Update the memory file.
- Make the first commits, then `gh repo create SebAustin/couch-coach` and `SebAustin/pose-reps` (public, MIT) and push.

**Step 1, parallel build (Oct 21), each in its own folder:**
- A. `pose-reps`: builder + `mattpocock-skills:tdd`. Synthetic keypoint generator; squat and jack reps, faults and score; vitest coverage ≥ 80%; CI; tag `v0.1.0` with committed `dist/`.
- B. `infra` + `services`: cloud-engineer + builder + `tdd` for token, cap and prompt.
  - CDK stack with `Template` assertions.
  - **Deploy:** `cdk bootstrap` + `cdk deploy` to 430411150226 us-east-1. Approving this plan approves this stack.
  - Probe for the newest Haiku inference profile; fall back to `us.anthropic.claude-haiku-4-5-20251001-v1:0`.
- C. `packages/protocol` + `events-client` (`tdd`), then `apps/phone`, which also deploys to CloudFront.
- D. Android toolchain:
  - `brew install --cask temurin@17 android-commandlinetools`, then `sdkmanager` platform/build-tools and `platform-tools` (adb).
  - Corepack/yarn 4.
  - `yarn install`, then `expo prebuild -p android`, then `./gradlew assembleRelease`.
  - Use Node 22 for `apps/tv` if Node 26 breaks Metro.
- `ux-designer` writes short TV and phone screen specs (10-foot UI, focus states) before the TV screens are built.

**Step 2, integrate (Oct 21 night → Oct 22 AM):**
- TV screens in `expo-multi-tv`; iterate on the Expo web target and the Android TV emulator.
- `scripts/e2e-replay.ts` replays a fixture through AppSync and the coach, and checks SC1 (p95 < 300 ms) and SC5 (< 5 s).
- Use `mattpocock-skills:diagnosing-bugs` for realtime and device issues.

**User checkpoint 1 (~1 h, Oct 22):**
- Enable ADB debugging on the Fire TV.
- `adb connect <ip>`, then I sideload the APK.
- Do one live squat set with the phone. Fixes follow.

**Step 3, verify and docs (Oct 22):**
- robustness-reviewer → security-auditor (`SECURITY.md`, no CRITICAL/HIGH) → `mattpocock-skills:code-review` → solution-verifier (SOLID).
- doc-writer: README with fresh-clone setup, architecture diagram, `CLAUDE.md` via `writing-for-agents`.
- launch-comms:
  - `DEMO.md` with a 2:45 shot list that leads with the live skeleton on the TV.
  - `SUBMISSION.md` with every Devpost field drafted, including the AWS Builder services and the OSS contribution URL/username/description.
  - `PRODUCT_FEEDBACK.md`.
  - `FRICTION_LOG.md` (10% bonus): real entries only, e.g. no Vega SDK path in time, Node 26 vs Metro, AgentCore cut, Android toolchain friction.
- Tag `v1.0`.

**User checkpoint 2 (~1.5–2 h, Oct 22 night or Oct 23 AM):**
- Film on the real Fire TV and upload to YouTube as public.
- Paste `SUBMISSION.md` into Devpost and submit before 12:00 PT.
- Approve or decline `npm publish` of pose-reps.
- After that, the retrospective agent runs.

## Gated (I stop and ask)
- `npm publish`.
- Any AWS change beyond the stack described above.
- Anything on Devpost or YouTube (the user does these).
- Collaborator invites aren't needed: the repos are public with an MIT license.

## Verification
- `pose-reps`: `npm test -- --coverage` passes with ≥ 80% coverage on the squat and jack fixtures (SC4).
- protocol and services: vitest round-trip and token/cap tests; `cdk synth` with `Template` assertions; CI green on both GitHub repos (SC7).
- Deployed stack: `npx tsx scripts/e2e-replay.ts` prints PASS for SC1 latency and SC5 coach turnaround.
- TV: the APK runs on the emulator, then on the real Fire TV (checkpoint 1). The skeleton tracks live, 5 squats count as 5, and the Cue card and voice arrive.
- Final: the security-auditor report, a solution-verifier SOLID verdict, and the README re-run from a fresh clone in a temp dir.

## Revision log
- **r4** (Oct 21): rescue re-scope with ~52 h left and nothing built. Fire OS APK instead of Vega; Bedrock Converse + DynamoDB history instead of AgentCore Runtime/Memory (ADR 0004); pose-reps reduced to squat + jumping jack. The previous plan (r1–r3, Oct 3) is kept in `docs/archive/PLAN-r3.md`.
