# Couch Coach — PLAN (source of truth)

## 1. Context
Couch Coach is the entry for **Build, Ship, Shape: Amazon Developer Hackathon**. Submissions close **Fri Oct 23, 2026, 12:00 PT**; the plan was set on Oct 3.

The `couch-coach/` and `pose-reps/` folders already exist with `git init` done (branch `main`). The GitHub remotes `SebAustin/couch-coach` and `SebAustin/pose-reps` are not created yet; both names and the npm name `pose-reps` were free on Oct 3.

**Decisions made with the user (grilling session):**

| Area | Decision |
|---|---|
| Tracks | Fire TV (primary, on the user's real device), AWS Builder, Open Source |
| Repos | Public, MIT |
| Effort | Solo, ~2 h/day (~40 h total) |
| AI coach | Strands agent on Bedrock AgentCore Runtime, with AgentCore Memory |
| Realtime | AppSync Events |
| Inputs | D-pad, phone as camera and remote, Polly voice |
| Spend | $50/mo budget alert |
| npm publish | Gated: the user confirms before publishing |

**Product.** You scan a QR code on the TV and your phone becomes the camera.
- Pose estimation runs **on the phone**. Video never leaves it; only keypoints are sent.
- The Fire TV draws your live skeleton, counts reps and scores your form.
- An AI coach remembers each household member (goals, history, injuries). It speaks feedback between sets and adapts the plan.
- It covers the judges' "creative" examples: CV fitness, multimodal UX (phone + D-pad + voice), and AI that adapts to the household.

**Environment (probed Oct 3):**
- Apple Silicon (arm64), macOS 27.
- Node 26 and npm 11. Yarn and corepack are missing; install with `npm i -g corepack` (or yarn 4 via npx).
- Docker 29 (arm64 daemon running); uv 0.12 and Python 3.13.
- aws CLI signed in as SebAustin, region us-east-1.
- Bedrock profiles `us.anthropic.claude-haiku-4-5-20251001-v1:0` and `us.anthropic.claude-sonnet-5-5` are available.
- AgentCore and AppSync are reachable with nothing deployed.
- `gh` is signed in. `npm whoami` returns ENEEDAUTH, so the user logs in at publish time.
- CDK runs via `npx aws-cdk`. The Vega SDK and adb are not installed.
- **Open question:** does Vega SDK / Metro (RN 0.72) work under Node 26? If not, pin Node 22 LTS for `apps/tv` via `.nvmrc` plus Homebrew `node@22` (checked in S0).

## 2. Success criteria (measurable)
| ID | Criterion | Target | How measured |
|---|---|---|---|
| SC1 | Keypoint latency, phone publish → TV receive | p95 < 300 ms on home Wi-Fi | `e2e-replay` timestamps, plus a TV debug overlay |
| SC2 | Phone pose throughput | ≥ 15 fps (lite model) on the demo phone | phone FPS overlay |
| SC3 | TV skeleton render rate | ≥ 15 fps on the real Fire TV | TV FPS overlay |
| SC4 | Rep accuracy | exact rep count on clean fixtures; ±1 per 20 reps on live tests | vitest fixtures + manual count |
| SC5 | Coach turnaround, set end → coach card + audio on TV | < 5 s p95 | `e2e-replay` |
| SC6 | Stability | 10-minute session with no stream drop; recovers automatically after a Wi-Fi drop within 5 s | device checklist |
| SC7 | Quality gate | CI green on both repos; `pose-reps` coverage ≥ 80%; `security-auditor` reports no CRITICAL/HIGH | GitHub Actions, `SECURITY.md` |
| SC8 | Submission completeness | every Devpost field filled, including the open-source fields and the friction log; video < 3 min on a real Fire TV | `SUBMISSION.md` checklist |

**Form score.** Each rep scores `100 − Σ(weight of each fault detected in that rep)`, floored at 0. The set score is the mean of its rep scores.

Fault weights, defined and tested in `pose-reps`:

| Exercise | Fault | Weight |
|---|---|---|
| Squat | shallow depth | 30 |
| Squat | knees caving | 25 |
| Squat | torso lean > 45° | 20 |
| Squat | heels rising | 15 |
| Jumping jack | arms not overhead | 30 |
| Jumping jack | feet not wide | 30 |
| Lunge | front knee past toe | 25 |
| Lunge | shallow | 30 |

## 3. Non-goals
- No user accounts or login. Household "profiles" are just names stored in AgentCore Memory.
- One person in frame at a time.
- No app-store submission (sideload or the Vega Virtual Device only).
- No video upload, storage or cloud vision.
- English only.
- No medical claims.

## 4. Architecture
```
TV app ──POST /session──► API GW HTTP API → Lambda session-svc → DynamoDB sessions {sessionId(128-bit), memberId, exp, coachCalls} + members {householdId, memberId(=Memory actorId), name}; fires async warm-up InvokeAgentRuntime
   │                       returns {sessionId, phoneToken (HMAC, 2h exp), channel}; TV shows QR = phoneUrl?s=<sessionId>&t=<token>
   │ subscribe /cc/<sessionId>/*            (AppSync Events, API key)
Phone (Vite web, CloudFront HTTPS)
  MediaPipe Pose Landmarker lite (VIDEO) → pose-reps (on-device reps/faults/score)
  ├─ publish /cc/<sessionId>/pose  (15 fps, 3 frames/publish = 5 Hz)  + /cc/<sessionId>/events (rep, fault, control)
  └─ POST /coach {sessionId, token, setSummary} ──► Lambda coach-proxy
         validates token (HMAC + DDB row + exp), enforces cap ≤ 30 coach calls/session (DDB atomic counter), API GW throttling 5 rps / burst 10
         ├─ SigV4 InvokeAgentRuntime → Strands agent (Python, arm64 container) on AgentCore Runtime
         │      Haiku 4.5 = between-set cues; Sonnet 5.5 = plan + recap; AgentCore Memory per memberId
         │      tools: get_session_stats, adjust_plan, log_workout
         ├─ Polly (neural) → MP3 → S3 (presigned GET, 15 min)
         └─ HTTP publish /cc/<sessionId>/coach {text, audioUrl}
TV: SVG skeleton, rep counter, form score, coach cards, w3cmedia audio, D-pad: Profiles → Workout → Pair → Live → Recap
```
**Why a Lambda proxy?** AgentCore inbound auth is either SigV4 or JWT, not both. JWT would force a Cognito login on the TV. The proxy keeps both clients free of AWS credentials, and it is the single place to swap the backend (fallback: Bedrock Converse plus DynamoDB history).

**IAM, least privilege (CDK):**
- `session-svc`: `dynamodb:PutItem` on the sessions table; `kms` not needed (HMAC secret in Secrets Manager → `secretsmanager:GetSecretValue`).
- `coach-proxy`: `dynamodb:GetItem`/`UpdateItem` on sessions; `bedrock-agentcore:InvokeAgentRuntime` on the runtime ARN; `polly:SynthesizeSpeech`; `s3:PutObject`/`GetObject` on `audio/*`; `appsync:EventPublish` on the Events API; `secretsmanager:GetSecretValue`.
- Agent runtime role: `bedrock:InvokeModel*` on the two inference profiles and their underlying models; `bedrock-agentcore:*Memory*Event*` / `RetrieveMemoryRecords` on the Memory ARN; ECR pull; CloudWatch logs.
- **AppSync API key:** expiry set to **2026-12-15** (past the end of judging on Nov 20). A reminder in `STATUS.md` says to revoke it afterwards. The key only grants subscribe/publish on `/cc/*`, and channels are unguessable 128-bit IDs.
- Credentials outside the repo: `gh` uses `repo` scope (already authenticated); the npm token comes from the user's `npm login` at publish time (gated).

**How couch-coach consumes pose-reps:** it depends on `"pose-reps": "github:SebAustin/pose-reps#v0.x"`, a git tag with a committed `dist/`, until the npm publish is approved; then it switches to `^1.0.0`. During development it can use a `file:../../pose-reps` link. The TV app never imports `pose-reps`; it only receives events.

## 5. Repos and layout
**`couch-coach/`** (npm workspaces):
- `packages/protocol` holds the zod event schemas.
- `packages/events-client` is a raw AppSync Events WebSocket client (`aws-appsync-event-ws` plus `header-<b64>` subprotocol, API key, jittered reconnect, no Amplify).
- `apps/phone` is Vite + TS.
- `apps/tv` is a fork of `amazonappdev/react-native-multi-tv-app-sample`. It stays a separate Yarn 4 project; `npm run sync:tv` copies the protocol and events-client into it.
- `agent/` is Python with uv: `app.py`, `tools.py`, `memory.py`, `Dockerfile`, `tests/`.
- `services/session-svc` and `services/coach-proxy` are TypeScript Lambdas.
- `infra/` is CDK TypeScript with stacks for realtime, data, agent, api, web and budget.
- `scripts/e2e-replay.ts` drives the end-to-end test.
- Also: `.github/workflows/ci.yml`, `docs/` (domain, architecture, ADRs), `FRICTION_LOG.md`, `PRODUCT_FEEDBACK.md`, `SUBMISSION.md`, `STATUS.md`, `ASSUMPTIONS.md`, `DEMO.md`.

**`pose-reps/`** (MIT):
- `src/{angles,hysteresis,score,types}.ts`
- `src/exercises/{squat,jumping-jack,lunge}.ts`
- `test/fixtures/*.json`, run with vitest
- `.github/workflows/ci.yml`

**Fixture source:**
1. **Synthetic first.** A deterministic keypoint generator in `test/helpers/synth.ts` produces parametric squats, jacks and lunges with injected faults. It unblocks test-first work on day 1.
2. **Real fixtures next.** From S1 on, the phone app has an "export last 30 s" button, and the recordings are added as regression fixtures.

## 6. Increments: vertical, demoable, tagged (each 1–2 sessions of ≈2 h)
Every increment ends with the CI gate green, a `DEMO.md` update, a commit and a tag. The build loop runs per increment.

| Tag | Date | Increment | Demo: done when… |
|---|---|---|---|
| **S0** `v0.0` | Oct 3–4 | **Day-1 checks plus CI.** Both repos get README, MIT license, CI (lint, tsc, vitest; pytest and `cdk synth` once present). The user installs the Vega SDK and checks the device OS. Prototype on the Vega VVD: WebSocket echo, SVG, MP3 through w3cmedia. Check Node 26 vs Metro. | CI is green on both repos on GitHub, and the VVD shows a WebSocket message, an SVG circle and plays a beep. |
| **pr-0.1** | Oct 4–5 | **pose-reps squat**, test-first, on synthetic fixtures, with the score formula. Runs alongside the S-track. | `npm test` shows squat reps and faults passing, with coverage ≥ 80%. |
| **S1** `v0.1` | Oct 5–6 | **Walking skeleton.** Gated `npx aws-cdk bootstrap aws://<acct>/us-east-1`, then CDK deploys Events, the web stack and budget (gated apply). Phone page: camera → MediaPipe → publishes keypoints to a hard-coded channel. TV: subscribes and draws the SVG skeleton. | You move in front of the phone and the skeleton moves on the VVD/Fire TV; p95 latency is shown in an overlay. |
| **S2a** `v0.2` | Oct 7 | **Pairing.** `session-svc` `POST /session` and `GET/POST /members`, QR code on the TV, phone joins via QR, channel = Session. | Scan the QR: the phone shows "Paired" and the skeleton streams on the Session channel. |
| **S2b** `v0.3` | Oct 8 | **Reps.** `pose-reps` runs on the phone, rep/fault events, TV rep counter and Form Score, phone remote (pause/next/end set), export button. | Do 5 squats: the TV counts 5 and shows a score. |
| **pr-0.2** | Oct 7–9 | **pose-reps jumping jack and lunge**, plus real exported fixtures. Runs alongside. | Fixture tests pass for all three exercises. |
| **S3** `v0.4` | Oct 9–10 | **Coach voice, stubbed.** `coach-proxy` validates the token and cap, Polly speaks a templated line, publishes a `coach_card`, TV shows the card and plays audio. | After a set, the TV speaks "Nice set, 5 reps at 82". |
| **S4** `v0.5` | Oct 11–13 | **Real agent.** Strands agent on AgentCore (CDK, Docker arm64) using Haiku cues and its tools; the proxy swaps the stub for `InvokeAgentRuntime`. | The coach references this set's actual faults within 5 s. |
| **S5** `v0.6` | Oct 14–15 | **Household memory.** Profiles screen, AgentCore Memory per member, Sonnet recap screen, adapted next workout. | Pick "Alex": the coach mentions last session's knee note, and a recap appears at the end. |
| **Freeze** | **Oct 16** | Ask the user before `npm publish` (or ship v1.0.0 git-tag-only). | — |
| **S6** `v0.7` | Oct 17–19 | **Hardening and docs.** Reconnects, `e2e-replay` with SC thresholds, `SECURITY.md`, README setup from a fresh clone, architecture diagram, AWS Builder write-up. Office hours #2 on Oct 19. | `solution-verifier` returns SOLID; all SC rows pass or are documented. |
| **S7** `v1.0` | Oct 20–23 | **Launch.** Demo script, the user films on the real Fire TV, Fire OS APK as backup, Devpost fields from `SUBMISSION.md`, `PRODUCT_FEEDBACK.md` and `FRICTION_LOG.md`; $150 credit form by Oct 21. Submit the morning of Oct 23. | Submitted. |

**Critical path:** S0 VVD WebSocket check → S1 → S2 → S3 → S4 → S6 → S7. `pose-reps` runs on a separate track.
**Cut order if behind:** lunge → S5 multiple profiles (keep one member's memory) → Sonnet recap → spoken commands (already a stretch goal).

## 7. Risks and fallbacks
1. **WebSocket on Vega isn't documented** (tested in S0). Fallback for the live skeleton: the Fire OS (Expo / react-native-tvos) APK on the real device. A polling fallback can only carry reps and coach cards, not the 15 fps skeleton.
2. **Device OS and Node compatibility.** A Vega device needs OS 1.2 for SDK 0.24. If the device runs Fire OS, the Expo app becomes the main path and the VVD remains the simulator evidence. If Node 26 breaks Metro, use Node 22 for `apps/tv`.
3. **Phone pose below SC2.** Use the lite model at lower input resolution, process every other frame, and record on Android Chrome if iOS is slow.
4. **AgentCore deploy or Memory friction** (time-boxed to 1 session). Cold start vs SC5: `POST /session` fires an async warm-up invoke. The proxy interface is fixed, so swap to Bedrock Converse plus DynamoDB history. The AWS Builder entry still includes Bedrock, Polly, AppSync and a documented AgentCore attempt in the friction log.
5. **API abuse or cost.** HMAC session tokens, a per-session cap, API Gateway throttling, the $50 budget, and the API key scoped to `/cc/*`.
6. **Scope versus ~2 h/day.** Use the cut order above, and the freeze is fixed.

## 8. Process: skills and agents
The **AI Project Agency** runs the loop: plan-critic → builder → robustness-reviewer → test-engineer → security-auditor → solution-verifier per increment; a full-rubric verify at S6; then doc-writer, launch-comms, retrospective. Specialists: `ux-designer` (TV/phone screens), `cloud-engineer` (CDK), `ai-pm` (coach quality and evals), `fde` (device packaging), `ai-video-producer` (demo edit).

Matt Pocock skills:

| Skill | Used for |
|---|---|
| `domain-modeling` | `docs/domain.md` before S1 |
| `prototype` | S0 checks |
| `tdd` | pose-reps, protocol, proxy |
| `codebase-design` | module boundaries |
| `writing-for-agents` | each repo's `CLAUDE.md` |
| `diagnosing-bugs` | device and realtime bugs |
| `code-review` | before every tag |

**Gated actions:**
- Each `cdk deploy` (first one in S1).
- `npm publish`.
- Vega SDK install, done by the user.
- GitHub repo creation and pushes, already approved for day 1.

## 9. Observability
Structured JSON logs keyed by `sessionId` in session-svc, coach-proxy and agent; CloudWatch alarm on coach-proxy 5xx/throttles; TV + phone debug overlays (fps, p95 latency).

## 10. Verification
- **pose-reps:** vitest on synthetic and real fixtures (SC4, coverage ≥ 80%).
- **protocol:** zod round-trip tests.
- **Services:** vitest with the AWS SDK mocked (token validation, cap, publish).
- **Agent:** pytest with Bedrock stubbed.
- **Infra:** CDK `Template` assertions in CI.
- **`scripts/e2e-replay.ts`** against the deployed stack: checks SC1 and SC5 and prints pass/fail.
- **Device checklist (SC3, SC6):** on the VVD and on the real Fire TV.
- **Before S7:** `security-auditor` returns no CRITICAL/HIGH, `solution-verifier` returns SOLID, and the README instructions are re-run from a fresh clone.

## Revision log
- **r1** (Oct 3): grilling outcome, approved by the user.
- **r3** (Oct 3): plan-critic r2 = 91 PASS. Folded nits: S2 split into S2a/S2b, `/members` store, AgentCore warm-up, cdk bootstrap, observability.
- **r2** (Oct 3): plan-critic scored 71 (REVISE). Changes: walking-skeleton increments, CI in S0, measurable SC1–SC8 with thresholds, form-score formula, session/token design, IAM scopes, how couch-coach consumes pose-reps, synthetic fixtures first, the polling-fallback limit, API key expiry past judging, non-goals, and updated environment probes.
