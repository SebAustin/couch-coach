# Couch Coach: Devpost submission (paste-ready draft)

Hackathon: **Build, Ship, Shape: Amazon Developer Hackathon**. Submissions close **Fri Oct 23, 12:00 PT**.

Status: DRAFT. Nothing here has been submitted, posted or uploaded. The owner pastes each block into Devpost by hand.

How to use this file: every `###` block below maps to one Devpost field. Text inside the fenced blocks or marked "paste" is final copy. Tokens in `UPPER_CASE` are placeholders the owner must replace (list in section 12).

Companion files: `DEMO.md` (video shot list), `PRODUCT_FEEDBACK.md` (per-tool feedback), `FRICTION_LOG.md` (friction entries for the bonus).

---

## 0. One source for every number

Every figure in the description, the video narration and the feedback comes from this table. If something is re-run and changes, update this table and every place it is used in the same pass.

| Figure | Value | Canonical source |
|---|---|---|
| pose-reps tests and coverage | 92 tests; 97.79% statements, 94.64% branches, 100% lines | `npm run test:coverage` in `pose-reps` at commit `9070139` (v0.1.2), run while drafting. `STATUS.md` still says 55 tests / 97.6%: that is the v0.1.0 figure and is stale |
| pose-reps releases | tags v0.1.0, v0.1.1, v0.1.2 (all Oct 21) | `git tag` in `pose-reps`, and `gh api repos/SebAustin/pose-reps/tags` |
| Couch Coach automated tests | more than 400 (protocol 13, events-client 52, session 31, coach 108, infra 50, phone 43, TV 130 = 427) | vitest / jest runs while drafting. The TV tree had uncommitted edits at that time, so say "more than 400", not 427 |
| Coach Cue eval | baseline **8 of 24 (33%)** pass, current **24 of 24 (100%)**; Bedrock call p50 1.14 s, p95 1.48 s | `services/coach/eval/results/baseline.json` and `latest.json`. The commit message of `1f52e24` says "29%": use the JSON, which says 33% |
| Set end to Cue on the TV | 1.9 to 2.5 s in the end-to-end replay (target under 5 s) | commit message of `1f52e24` (`scripts/e2e-replay.ts` against the deployed stack). No report file is committed. [Re-run before submit and update] |
| Phone to TV pose latency | p95 369 to 397 ms in the same replay; **misses** the 300 ms target | same as above |
| Phone pose rate | 7.5 to 15 fps measured on the test phone (target 15) | `STATUS.md`, first live test |
| TV APK | about 33 MB, ARM only | `apps/tv/dist/couch-coach.apk`, 34,935,074 bytes |
| Phone web bundle | 45 MB, of which 39 MB is MediaPipe WASM | `docs/friction-notes.md` |
| Security review | 0 critical; 2 high found and fixed the same day; 1 medium accepted | `SECURITY.md`, "Remediation status" table |

Not measured yet: TV draw rate and latency on the real Fire TV. The debug overlay (Menu button on Live) shows them; see `DEMO.md` for when to read it. Do not state a Fire TV frame rate until it has been read off the device.

---

## 1. Project name

```
Couch Coach
```

## 2. Tagline (158 characters, limit 200)

```
Your phone is the camera, your Fire TV is the mirror: it counts reps, scores your form, and an AI coach on AWS that remembers you talks you through every set.
```

## 3. Long description (paste into "About the project", Devpost markdown)

```markdown
## Inspiration

The biggest screen in the house is the best place to watch yourself move, but a Fire TV has no built-in camera, and a phone screen is too small to read from three metres away. Couch Coach splits the job. Your phone is the camera. Your Fire TV is the mirror and the scoreboard. A coach in the cloud talks to you after every set, and it remembers how you did last time.

## What it does

1. **Pick a Member with the remote.** The Fire TV app lists the people in the household. D-pad to a name, press Select.
2. **Pair by QR.** The TV shows a QR code. Scan it with any phone, allow the camera, and you are paired. No account, no app install on the phone.
3. **Work out.** Prop the phone up two to three metres away. The phone runs pose estimation on the device and sends only body landmarks, never video. The TV draws your live skeleton, counts squats and jumping jacks, keeps a running Form Score, and highlights the limb and names the fault (for example "Knees caving") when a rep goes wrong.
4. **End the set on the phone.** An AI coach (Claude Haiku on Amazon Bedrock) reads this set plus that Member's recent history and writes a short Cue. Amazon Polly speaks it on the TV, and the same text stays on screen as a caption.
5. **Recap.** End the session from the remote and the TV shows sets, reps, Form Score per set and the Coach's note.

The Coach "remembers" because every set is saved per Member in DynamoDB and the next Cue is written against the previous set of the same exercise (improved, same or worse). The trend is computed in code, not left to the model.

### Why it fits the Fire TV track

The brief's own "creative" examples are a computer-vision fitness app that uses a camera, and multi-modal UX. Couch Coach is both:

- **Computer vision with a camera:** MediaPipe Pose Landmarker on the phone camera, plus our own open-source rep counter and form scorer (`pose-reps`).
- **Multi-modal on a TV:** the phone camera sees you, the phone doubles as a controller (pick the exercise, start and end the set), the Fire TV remote D-pad drives the TV UI (member list, pairing, dialogs), and the Coach speaks back with Amazon Polly. Spoken *input* (voice commands) is not built; see What's next.
- **Designed for the 10-foot screen:** a "Lamplight" design system specified for large type (26 px minimum), WCAG AA contrast targets, a visible D-pad focus treatment on every control, no colour-only signals, and the spoken Cue always captioned on screen.

## How we built it

**Phone (web app, Vite + TypeScript, served by CloudFront over HTTPS):**
MediaPipe Pose Landmarker (lite model, GPU delegate with CPU fallback) runs in the browser. `pose-reps` counts reps and scores form on the phone. Landmarks are batched (3 frames per publish) and sent over a WebSocket to AWS AppSync Events. Video never leaves the device.

**Fire TV app (Fire OS, sideloaded APK):**
React Native for TV (`react-native-tvos` 0.81 on Expo 54), forked from Amazon's `react-native-multi-tv-app-sample` and reduced to four screens: Members, Pair, Live, Recap. A jitter buffer plays the 15 fps landmark stream back smoothly and an imperative SVG loop draws the skeleton without re-rendering React per frame. It is a 33 MB ARM-only APK.

**Cloud (one AWS CDK stack, us-east-1):**
- **AWS AppSync Events** carries pose frames, rep and set events and the Coach channel between phone and TV. We wrote a small shared WebSocket client (no Amplify).
- **Amazon API Gateway (HTTP API) + AWS Lambda (Node.js 24, arm64):** a `session` function creates a Session and a signed phone token (HMAC key in AWS Secrets Manager); a `coach` function validates the token, enforces a per-session cap and a global daily ceiling, loads the Member's last five sets, calls **Amazon Bedrock Converse** (Claude Haiku 4.5), synthesises the Cue with **Amazon Polly** (neural), stores the MP3 in **Amazon S3** behind a 15-minute presigned URL, saves the set, and publishes the Cue back over AppSync Events.
- **Amazon DynamoDB** (one table, on demand, 90-day TTL) holds Members, Sessions and Sets: this is the Coach's memory.
- **Amazon CloudFront + S3** serve the phone web app.
- **Amazon CloudWatch, SNS and AWS Budgets** raise alarms on Bedrock invocations, Polly characters, Lambda errors and spend.

**Open source:** the rep counting and form scoring live in a separate MIT library, [pose-reps](https://github.com/SebAustin/pose-reps).

**Quality:** more than 400 automated tests across the monorepo, a 24-call Bedrock eval for the Coach's Cues, and a STRIDE security review (`SECURITY.md`) that found two high-severity issues, both fixed and deployed before submission (the wildcard-subscribe fix was checked live).

## Challenges we ran into

- **The phone gave us the wrong picture.** On an iPhone held upright, Safari returned a landscape 16:9 camera frame even though the page asked for portrait. The body filled a third of the frame, landmarks collapsed, reps were over-counted (12 against a true 9 to 10) and every fault was a false positive. We added a retry with an exact 9:16 aspect ratio, a "Step back" framing banner, and a frame gate in `pose-reps` that rejects collapsed skeletons.
- **Noisy real data versus clean synthetic tests.** Version 0.1.0 passed its synthetic tests and then failed on a real recording. v0.1.1 and v0.1.2 made the squat faults deliberately conservative (a wrong accusation costs more than a missed fault), and a real phone recording is now a regression test.
- **The Coach contradicted the data.** One Cue praised "feet staying wider" while the app had flagged narrow feet on 8 of 10 reps. We moved the decisions (main fault, trend, when to use the name) into code, kept the model for wording only, and built a 12-case eval. On the same checks the pass rate went from 8 of 24 to 24 of 24. The checks are keyword rules we wrote ourselves, so this guards regressions rather than proving the Cues are good.
- **A public realtime channel is not private.** Our security review showed that the public AppSync API key could subscribe to every Session with a wildcard and forge Cues. We added subscribe handlers that reject wildcards, moved Coach messages to a namespace only the Lambda can publish to, made the TV play audio only from our S3 bucket, and capped spend.
- **We missed one latency target.** Phone-to-TV p95 latency was 369 to 397 ms against our 300 ms goal. The skeleton still looks live because the TV buffers and interpolates, at the cost of showing you slightly behind real time.
- **Scope cuts, stated plainly.** AgentCore Runtime and Memory were planned and cut with about 52 hours left (ADR 0004); the Coach uses Bedrock Converse plus DynamoDB history instead. The Vega SDK was not used for lack of time; the TV app is a Fire OS APK.

## Accomplishments that we're proud of

- A complete loop that works end to end: TV, QR pairing, phone camera, live skeleton, reps and form score, spoken and captioned Cue, recap.
- Pose estimation stays on the phone, so the privacy story is simple: only body landmarks leave the device.
- A reusable open-source library with zero runtime dependencies, tests, CI and a real-data regression fixture.
- A Coach that is checked, not just prompted: deterministic checks, a committed eval report, and code that owns the facts.
- Security reviewed and hardened before submission, with the findings, fixes and the residual risks published in the repo.
- On the Fire TV: FIRE_TV_MODEL running Fire OS FIRE_OS_VERSION, shown in the demo video.

## What we learned

- On a phone, the camera frame you get is not the frame you asked for. Check `videoWidth` and `videoHeight` before trusting any geometry.
- With an LLM in the loop, put facts in code and wording in the model, then write an eval that fails.
- A listed model or an "ACTIVE" inference profile is not the same as one you can invoke. Probe before you build on it.
- Realtime pub/sub needs per-channel authorisation designed in from the start; unguessable channel names are not enough.

## What's next

- Real per-Session authorisation on AppSync Events (an `AWS_LAMBDA` authorizer on the HMAC phone token), so the public key can go away.
- Voice commands on the remote and Alexa ("start squats", "end set"). Today the Coach speaks but does not listen.
- More exercises (lunge first), calibrated on labelled real footage instead of mostly synthetic poses.
- Households with login, so Members are not shared across installs.
- An AgentCore-backed Coach, if long-term memory proves worth the extra moving parts.
- Publish `pose-reps` to the npm registry (today it installs from the git tag).
```

## 4. "Built with" tags (paste as comma-separated)

```
Fire TV, Fire OS, React Native, react-native-tvos, Expo, TypeScript, MediaPipe, pose-reps, Amazon Bedrock, Claude Haiku, Amazon Polly, AWS AppSync Events, AWS Lambda, Amazon API Gateway, Amazon DynamoDB, Amazon S3, Amazon CloudFront, AWS Secrets Manager, Amazon CloudWatch, AWS CDK, Vite, zod, Vitest, Jest, GitHub Actions
```

## 5. Tracks and mini challenges

- **Primary track:** Fire TV.
- **Mini challenge:** AWS Builder.
- **Mini challenge:** Open Source.

## 6. AWS Builder mini challenge fields

**Which AWS services did you use, and how?** (paste)

```
Everything runs in one AWS CDK stack in us-east-1.

- AWS AppSync Events: the realtime bus. The phone publishes pose-landmark batches (about 15 fps) and rep/set events; the Fire TV subscribes and draws them; the Coach publishes Cues. Two namespaces: "cc" (API key) and "coach" (subscribe with the key, publish only with IAM/SigV4 by our Lambda). onSubscribe handlers reject wildcard subscriptions.
- Amazon Bedrock (Converse API, Claude Haiku 4.5 through a US inference profile): writes the spoken Cue from the set summary and the Member's recent history. maxTokens 80, temperature 0.4. IAM is scoped to the profile and the underlying model in the Regions it routes to.
- Amazon Polly (neural voice): turns the Cue into an MP3 that the TV plays.
- AWS Lambda (Node.js 24, arm64): "session" (creates sessions, members, signed phone tokens) and "coach" (token check, per-session cap of 30 calls, global daily ceiling, history lookup, Bedrock, Polly, publish). Reserved concurrency on the coach function.
- Amazon API Gateway (HTTP API): POST /session, GET and POST /members, POST /coach, with per-route throttling.
- Amazon DynamoDB: one on-demand table (Members, Sessions, Sets), 90-day TTL on sets. The saved sets are the Coach's memory. Atomic conditional updates implement the call cap and the daily ceiling.
- Amazon S3: Cue audio (1-day lifecycle, 15-minute presigned URLs) and the phone web app.
- Amazon CloudFront: serves the phone web app over HTTPS (needed for camera access), origin access control to a private bucket.
- AWS Secrets Manager: the HMAC key that signs the phone token.
- Amazon CloudWatch, Amazon SNS and AWS Budgets: alarms on Bedrock invocations, Polly characters, Lambda errors and API 5xx; a monthly budget alert.
- AWS CDK (TypeScript): the whole stack, with assertion tests on the synthesised template.

Not used: Amazon Bedrock AgentCore (planned, then cut; see docs/adr/0004). Details and per-service feedback: PRODUCT_FEEDBACK.md.
```

## 7. Open Source mini challenge fields

| Field | Value |
|---|---|
| Contribution URL | https://github.com/SebAustin/pose-reps |
| Project repo URL | https://github.com/SebAustin/couch-coach |
| GitHub username | SebAustin |
| License | MIT (both repos) |

**Description of what was done, how it works, why it matters** (paste)

```
What was done: we wrote and released pose-reps, a new MIT-licensed TypeScript library that counts exercise reps and scores form from MediaPipe pose landmarks. It supports squats and jumping jacks. Each completed rep comes back with the form faults found during that rep (shallow depth, knees caving, torso lean, heels rising, arms not overhead, feet not wide) and a 0 to 100 score. It has zero runtime dependencies, ships ESM, CommonJS and type declarations, and has tags v0.1.0, v0.1.1 and v0.1.2, a CI workflow, 92 tests with 97.8% statement coverage, and a regression test built from a real phone recording (landmarks only, no video). It is the engine behind Couch Coach, which uses it unchanged on the phone.

How it works: each frame goes through a gate that drops unseen landmarks and rejects "collapsed" skeletons (pose models sometimes return a confident but wrong skeleton in which a leg shrinks to a few pixels). The knee angle is smoothed with a sliding median over wall-clock time, so 12 fps and 30 fps give the same answer. A two-threshold state machine counts a rep only when the movement gets deep enough and returns past a separate resting threshold within a plausible time. Faults are decided over the whole rep on medians and against the person's own standing baseline, and only when the needed landmarks were clearly seen. Everything is a ratio or an angle, so it does not depend on distance from the camera.

Why it matters: rep counters usually ship inside apps. This one is a small, dependency-free library that runs on-device in a browser, React Native or Node, so no video or landmarks have to leave the device. It is deliberately conservative: a false accusation of bad form costs more than a missed fault. It is tested on noisy real data, not only synthetic poses, and its README states its limits (2D heuristics; squats work best with the camera about 45 degrees in front, jumping jacks need a frontal view). Anyone building a fitness, physio or TV experience on MediaPipe can reuse it. Install today with: npm i github:SebAustin/pose-reps#v0.1.2 (an npm registry release is pending).
```

## 8. "Did this project exist before the hackathon?" (paste)

```
No. The project was built during the hackathon window.

For transparency: a plan (and a glossary and assumptions file) was written on Oct 3. At that point neither repository had any code or commits, and the plan was rescoped on Oct 21 (Fire OS APK instead of Vega, Bedrock Converse plus DynamoDB instead of AgentCore). Nearly all of the code was written on Oct 21 and 22: the pose-reps library, the AWS stack, the phone web app, the Fire TV app, the tests and the security hardening. The git history of both repositories shows this. The TV app started from Amazon's open-source react-native-multi-tv-app-sample (MIT-0), which is credited in the README; its Vega app and video screens were removed and the four Couch Coach screens were written new.
```

## 9. Links

| Field | Value |
|---|---|
| Demo video (YouTube, public) | `VIDEO_URL` |
| Code repository | https://github.com/SebAustin/couch-coach |
| Open-source library | https://github.com/SebAustin/pose-reps |
| Fire TV APK (for judges) | https://github.com/SebAustin/couch-coach/releases/download/v1.0/couch-coach-v1.0.apk (release page: https://github.com/SebAustin/couch-coach/releases/tag/v1.0) |
| Phone web app | https://d36nqce57j19po.cloudfront.net (needs the pairing link from the TV; it is not a standalone page) |
| Product feedback | `PRODUCT_FEEDBACK.md` in the repo |
| Friction log | `FRICTION_LOG.md` in the repo |
| Security review | `SECURITY.md` in the repo |

**Testing instructions for judges** (paste; adjust once `README.md` is final)

```
Needs: a Fire TV running Fire OS (or the Android TV emulator), and any phone with a camera and a browser.

1. Download the APK from https://github.com/SebAustin/couch-coach/releases/download/v1.0/couch-coach-v1.0.apk. Enable ADB debugging on the Fire TV (Settings > My Fire TV > Developer Options), then: adb connect <fire-tv-ip>:5555 and adb install -r couch-coach.apk. apps/tv/README.md has a guided script (bash apps/tv/scripts/fire-tv-wizard.sh).
2. Open Couch Coach from the Fire TV apps row, pick a Member (or add one), and scan the QR code with the phone.
3. Allow the camera, prop the phone upright 2 to 3 m away so your whole body is in frame, pick Squat (45 degrees to the phone works best) or Jumping jack (face the phone), start the set, do a few reps, then press End set.
4. The Cue appears and is spoken on the TV about two seconds later.

No Fire TV? The TV app also runs in a browser (yarn dev:web in apps/tv), and apps/tv/scripts/publish-synthetic.mjs plays a fake phone into a real Session. The video shows the real-device run.

The backend stays deployed through judging. It is a hackathon stack: the coach has a daily call ceiling, and the AppSync client key expires on 2026-12-15.
```

## 10. Optional: feature requests (with priority)

Paste one per entry. Each is grounded in `FRICTION_LOG.md`.

| Priority | Product | Request |
|---|---|---|
| Critical | Amazon Bedrock | Make the account-level Anthropic use-case form visible before first invoke (console banner, a field on `list-foundation-models`, and an `AccessDeniedException` whose message links to the form). Today it surfaces as `ResourceNotFoundException`. (F1) |
| Critical | Amazon Bedrock | Do not list an inference profile as `ACTIVE` if the account cannot invoke it, or add an explicit entitlement status. (F2) |
| Important | AWS AppSync Events | A namespace option to disallow wildcard subscriptions, and channel-scoped API keys or a built-in per-channel authorisation rule, so per-session channels are private by default. (F6) |
| Important | AWS CDK | Make `NodejsFunction` resolve esbuild from the CDK app's own dependencies, and fix `PathNotUnderRoot` for entries outside `projectRoot`. (F3) |
| Important | Fire TV / Amazon developer docs | A Fire OS (non-Vega) path in the multi-TV sample: stable dependency pins, `expo-doctor` in its CI, and an ADB sideload walkthrough for a physical Fire TV. (F8, F9) |
| Nice-to-have | Fire TV | Official guidance for a "phone as camera" companion pattern: pairing, and a reference QR-pair flow for TV apps that need a camera. |
| Nice-to-have | AWS CDK | `cdk init` and docs should recommend a TypeScript 7 compatible runner instead of `ts-node`. (F4) |
| Nice-to-have | Amazon CloudFront | Say in the warning which setting to change when `minimumProtocolVersion` has no effect without a custom certificate. (F11) |

## 11. Optional: friction log entries

Use the entries in `FRICTION_LOG.md` (F1 to F16). The ones to paste first, in order of value to Amazon and AWS teams:

1. F1 Bedrock Anthropic use-case form gate
2. F2 Bedrock inference profile listed ACTIVE but not invokable
3. F3 CDK `NodejsFunction` and esbuild
4. F6 AppSync Events public key allows wildcard subscribe and cross-session publish
5. F8 Fire TV sample: release-candidate and mismatched Expo dependencies
6. F7 iOS Safari returns a landscape camera frame to an upright phone

## 12. Placeholders the owner must fill

| Placeholder | Where | What to put |
|---|---|---|
| `VIDEO_URL` | section 9 | the public YouTube URL after upload |
| `APK_URL` | filled | GitHub Release v1.0 asset; live once the draft release is **published** |
| `FIRE_TV_MODEL` | section 3, Accomplishments | the exact Fire TV device you filmed (read it from Settings > My Fire TV > About) |
| `FIRE_OS_VERSION` | section 3, Accomplishments | the Fire OS version shown on the same screen. If the first on-device test (checkpoint 1) has not passed, delete that bullet |
| Final numbers | section 0 | re-run `npx tsx scripts/e2e-replay.ts` and the test suites; update the table and anything that quotes it |

## 13. Pre-submit checklist

Video
- [ ] Uploaded to YouTube as **Public** (not Unlisted, not Private). Open the URL in a private window, logged out, to confirm.
- [ ] Final cut is under 3:00 (target 2:45). Check the YouTube duration, not the editor.
- [ ] English narration or English burned-in captions.
- [ ] Shows the app running on the real Fire TV (remote in hand, app launched from the Fire TV home screen).
- [ ] No copyrighted music, no third-party logos on screen, no real people other than consenting participants.
- [ ] The best material (live skeleton on the TV) is in the first 10 seconds.
- [ ] The description and chapters on YouTube match the final cut.

Repositories
- [ ] `couch-coach` and `pose-reps` are both **public**. Verified while drafting: both public, GitHub detects MIT.
- [ ] LICENSE visible in each repo's About sidebar (verified: MIT shows). Add a short description and topics (both repos have **no topics** today): suggested `fire-tv`, `react-native`, `mediapipe`, `pose-estimation`, `aws`, `bedrock`.
- [ ] Tags v0.1.0, v0.1.1 and v0.1.2 are pushed on `pose-reps` (verified). Optionally create GitHub Releases from them.
- [ ] Everything intended for the judges is committed and pushed. While drafting, `couch-coach` had uncommitted edits under `apps/tv`.
- [ ] CI is green on both repos. **At drafting time the `couch-coach` CI was failing** on `main` (the per-package jobs cannot resolve `zod` for the `file:` protocol package, and some TypeScript errors follow). `pose-reps` CI was green. Fix it, or do not claim green CI on `couch-coach`.
- [ ] No secrets committed. The AppSync client key in `infra/client-config.json` is public by design and expires 2026-12-15; `SECURITY.md` records a gitleaks pass. No collaborator invites are needed because both repos are public.
- [ ] `README.md` has fresh-clone setup and credits the sample it was forked from (written by another agent: skim it once).

AWS and operations
- [ ] The stack is up and a full phone-to-TV set works on the day of submission.
- [ ] Keep it up through the judging period (`ASSUMPTIONS.md` says judging ends 2026-11-20 [confirm the date on the Devpost page]).
- [ ] Confirm the SNS subscription email for the alarms (`STATUS.md` lists it as waiting on you).
- [ ] The coach has a global ceiling of 300 calls per UTC day and 3 reserved concurrent executions. If many judges may test at once, decide whether to raise it before judging. That is an AWS change and yours to approve.
- [ ] After judging: revoke the AppSync API key and `cdk destroy` if you no longer need it.

Devpost form
- [ ] Title, tagline, description, Built with, tracks, both mini challenges, links.
- [ ] Open Source fields: contribution URL, project repo URL, username `SebAustin`, description.
- [ ] "Existed before?" answered with the text in section 8.
- [ ] Product feedback entered for every tool listed in `PRODUCT_FEEDBACK.md`. Kiro Crew is listed there as not used; do not claim it.
- [ ] Optional feature requests and friction log entries added.
- [ ] Add 1 to 2 sentences of your own motivation to Inspiration if you have one. This draft cannot know it.
- [ ] Gallery images: the TV screenshots in `apps/tv/docs/screenshots/` come from the Android TV emulator and the Member names (Smoke, Debug) come from synthetic test data. Either caption them "emulator capture" or replace them with stills from the real Fire TV video.
- [ ] Submit with margin. The deadline is Fri Oct 23, 12:00 PT. Confirm the project shows **Submitted**, not Draft.

## 14. Gated actions the owner runs (none were run for you)

1. Upload the video to YouTube as Public.
2. Publish the draft GitHub Release v1.0 (the APK is attached; the link in section 9 works only after publishing).
3. Decide on `npm publish` for `pose-reps` (not required; the description says "pending").
4. Paste this file into Devpost and press Submit.
