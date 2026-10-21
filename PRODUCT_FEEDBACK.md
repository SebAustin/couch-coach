# Couch Coach: product feedback, per tool

Draft for the Devpost product-feedback fields. One section per tool, API or SDK we used, with the five fields Devpost asks for: what we used it for, what worked, what needs work, onboarding, and whether we would build again.

Sources: `docs/friction-notes.md`, `FRICTION_LOG.md` (entries F1 to F16), `SECURITY.md`, `docs/adr/*`, `apps/tv/README.md`, the code, and the git history of `couch-coach` and `pose-reps`. Where we did not hit a problem we say so rather than invent one. "Would build again" verdicts are the drafter's reading of the evidence; the owner should confirm or edit them.

Not used, stated plainly:
- **Kiro Crew:** not used.
- **Amazon Bedrock AgentCore:** considered and cut (ADR 0002 planned a Lambda proxy in front of it; ADR 0004 replaced it with Bedrock Converse plus DynamoDB history). We never deployed it, so we have no hands-on feedback. One design note came from reading the docs, not from running it: AgentCore Runtime accepts either SigV4 or JWT inbound auth, not both, which would have forced either a login on the TV or AWS credentials in clients (ADR 0002).
- **Vega SDK:** not used (section 3).

---

## 1. Fire TV, Fire OS sideloading, and the AmazonAppDev multi-TV sample

**Used for.** The living-room screen. We forked `AmazonAppDev/react-native-multi-tv-app-sample`, deleted its Vega app and video screens, and built four screens on its Expo app (Members, Pair, Live, Recap). The result is a Fire OS APK (package `dev.sebaustin.couchcoach`, Leanback launcher, TV banner), sideloaded over ADB.

**What worked.**
- The sample's structure (Expo app shell, shared UI package, `react-tv-space-navigation` for D-pad focus) saved real time: we reused its focus handling and navigation and restyled the rest.
- Expo prebuild plus `./gradlew assembleRelease` produced an installable APK. We ran it on an Android TV emulator (Android 14 TV image) against the live backend.
- Sideloading is one `adb install -r`. We wrapped it in `apps/tv/scripts/fire-tv-wizard.sh`.

**What needs work.**
- The sample resolved `react-native-tvos` to a release candidate (`0.81.0-0rc5`, from the range `~0.81.0-0`) and a beta `react-tv-space-navigation` (`6.0.0-beta1`), and its Expo SDK 54 app sat beside SDK 52-era package versions (`@expo/metro-runtime ~4.0.0`, `expo-constants ~17.0.0`, `expo-font ~13.0.0`). We moved to `react-native-tvos 0.81.5-2` and aligned the Expo packages. See F8. We did not record the exact error text, so we cannot say what the mismatch broke.
- The README lists the Vega SDK as the only Fire TV prerequisite and has no sideload walkthrough for a physical Fire OS TV (F9).
- Prebuilt dependencies ship x86 and x86_64 libraries, so the first release APK was 57 MB; an ABI filter brought it to 33 MB (F10).

**Onboarding.** Smooth once the toolchain was in place, but the toolchain is heavy: JDK 17, Android command-line tools, platform-tools, NDK and CMake, about 13 GB including the emulator image, and Yarn 4.5 installed through `npm i -g @yarnpkg/cli-dist@4.5.0` because corepack collided with another shim on the machine. Node 26 worked with Metro, Expo CLI and jest, so no downgrade was needed.

**On the real Fire TV.** [OWNER: fill in after the first on-device test: device model, Fire OS version, what installed and ran cleanly, anything that differed from the emulator. Delete this paragraph if you have nothing to add.]

**Would we build on it again?** Yes, with caveats: pin stable versions on day one and expect to write your own sideload instructions.

---

## 2. react-native-tvos and Expo (TV)

**Used for.** The TV app runtime: `react-native-tvos` 0.81.5-2, Expo 54.0.33, React 19.1, `react-native-svg` for the skeleton, `react-native-qrcode-svg` for the pairing QR, `expo-audio` for the spoken Cue, `react-tv-space-navigation` for focus.

**What worked.**
- One codebase gave us an Android TV / Fire OS build and a browser target (`yarn dev:web`) that made iteration and screenshots fast.
- The skeleton is drawn imperatively: a `requestAnimationFrame` loop samples a jitter buffer and writes SVG path data with `setNativeProps`, so React never re-renders per frame.
- 130 jest tests ran under `jest-expo`.

**What needs work.**
- A screen that renders focusables without its own `SpatialNavigationRoot` crashes the app with "No registered spatial navigator on this page" (F15).
- On web, `setNativeProps` on `react-native-svg` needs `{ style: props }`, while native takes plain props. Easy to miss.
- `yarn test` coverage reports 0% in the monorepo, because jest does not instrument files outside the app's root directory even with `rootDir` moved (F16). The tests themselves run and pass.

**Onboarding.** Good Expo docs, but TV-specific details (focus, remote key codes, the `EXPO_TV=1` prebuild flag) are scattered. We deliberately do not map key code 67 (`KEYCODE_DEL`) to Back, or deleting a letter in the TV keyboard would close the dialog.

**Would we build again?** Yes. For a camera-free, display-heavy TV app it was the right tool.

---

## 3. Vega SDK

**Not used.** On Oct 21 the plan was cut to fit about 52 hours and a 3 to 4 hour human budget (PLAN r4). No Vega SDK was installed on the build machine, and the target was a Fire OS device that could take a sideloaded APK. We deleted the sample's Vega app from our fork rather than leave dead code.

We therefore cannot say whether the SDK is good or bad, and we are not going to guess. The only feedback we have is about the entry point: it was not clear from the sample's README which of its two Fire TV paths (Fire OS or Vega OS) applies to a given device, and our own assumptions file recorded that the OS was still to be confirmed (F9). A short "which Fire TV do you have?" decision guide at the top of the sample and the Vega install page would have saved us the question.

**Would we build again?** Not evaluated. We would try it if the target devices were Vega OS.

---

## 4. AWS AppSync Events

**Used for.** The realtime bus between phone, TV and the coach Lambda. The phone publishes pose-landmark batches (three frames per publish, about five publishes a second) and set events to `/cc/<sessionId>/pose` and `/events`; the TV subscribes; the coach Lambda publishes the Cue to `/coach/<sessionId>`. We wrote a small shared WebSocket client (about 150 lines, no Amplify; ADR 0003) with jittered reconnect and a presence heartbeat.

**What worked.**
- The `EventApi` L2 construct in `aws-cdk-lib` 2.274 worked with no `Cfn` fallback.
- The protocol is small and easy to implement by hand: `connection_init`, `subscribe`, `publish`.
- Namespace-level auth modes let us split trust: namespace `cc` (API key) and namespace `coach` (anyone can subscribe with the key; only IAM can publish, so the key returns 401). The Lambda signs its publishes with SigV4.
- `onSubscribe` handlers (APPSYNC_JS) let us reject wildcard and malformed channels, and we confirmed live that `/cc/*`, `/coach/*` and `/*` are rejected.
- Delivery is at-least-once, so we de-duplicate reps by index and set ends by set index.

**What needs work.**
- With the API key, a subscription to `/cc/*` returned `subscribe_success`, and an HTTP publish with the same key reached the wildcard subscriber. A per-session channel name is not a secret once wildcards work, and the default configuration does not stop that (F6). Everything we did about it (handlers, a second namespace, removing the key from the Lambda) was custom work. A namespace option to disallow wildcard subscriptions, or channel-scoped keys, would remove a whole class of mistakes.
- The remaining proper fix, an `AWS_LAMBDA` authorizer that checks our phone token against the channel, is not built (residual risk recorded in `SECURITY.md`).
- Latency: in our end-to-end replay, phone-to-TV p95 was 369 to 397 ms against our 300 ms target (see `SUBMISSION.md`, section 0). We hide the cost with a TV-side jitter buffer, so the skeleton plays smoothly but slightly behind real time. We did not isolate how much of that is AppSync and how much is the network.

**Onboarding.** Good. Documentation was enough to write a client in a few hours.

**Would we build again?** Yes, and it beat the alternative we rejected (API Gateway WebSocket plus Lambda plus a connection table). We would add per-session authorisation from the start.

---

## 5. Amazon Bedrock (Converse API, Claude Haiku 4.5)

**Used for.** Writing the spoken Cue after each set. One `Converse` call per set through the US inference profile `us.anthropic.claude-haiku-4-5-20251001-v1:0`, with `maxTokens` 80 and temperature 0.4. The prompt carries this set, the main fault, and a trend computed in code from the Member's last five sets in DynamoDB.

**What worked.**
- `Converse` is a clean, uniform API: one request shape, simple system and user messages.
- Haiku is fast enough for a living-room interaction. In our eval, Bedrock call latency was p50 1.14 s and p95 1.48 s (`services/coach/eval/results/latest.json`).
- Our 24-call eval (12 cases, 2 runs) went from 8 of 24 passing to 24 of 24 after we moved fault selection, trend and name policy into code and tightened the prompt. The checks are keyword rules we wrote, so this is a regression guard, not proof of quality.
- The end-to-end replay measured set end to Cue on the TV at 1.9 to 2.5 s, including history lookup, Polly and publish.

**What needs work.**
- **Access gate (F1).** Invoking Haiku 4.5 on our account returned `ResourceNotFoundException: Model use case details have not been submitted for this account. Fill out the Anthropic use case details form before using the model.` An account-level form blocks every Anthropic model, and the error type (not found) hides what is wrong.
- **ACTIVE but not invokable (F2).** `list-inference-profiles` showed `us.anthropic.claude-haiku-5-5` as ACTIVE, yet `Converse` returned `AccessDeniedException: anthropic.claude-haiku-5-5 is not available for this account.` We fell back to Haiku 4.5.
- **IAM for inference profiles.** Calling through a `us.` profile needs `bedrock:InvokeModel` on the profile and on the underlying foundation model in every Region the profile can route to (`infra/lib/bedrock-arns.ts`). We found the Regions with `aws bedrock get-inference-profile`. Easy to get wrong with least privilege.
- **Parameter rules.** Haiku 4.5 rejects `temperature` and `topP` together, so `topP` stays unset (comment in `services/coach/src/bedrock.ts`).
- **Model behaviour.** In the first live test the Coach praised "feet staying wider" when the app had flagged narrow feet on 8 of 10 reps. Prompting alone did not fix it; moving the facts into code did.

**Onboarding.** Fast once the use-case form was done, which is the part that needs fixing.

**Would we build again?** Yes. For a short, spoken, templated-fallback Cue, Haiku through `Converse` was a good fit.

---

## 6. Amazon Polly

**Used for.** The Coach's voice. One neural synthesis per Cue (`Engine: neural`, `en-US`, default voice Matthew, plain text, MP3). The MP3 goes to S3 (`audio/<sessionId>/<n>.mp3`, one-day lifecycle) and the TV plays it from a 15-minute presigned URL, only over HTTPS and only from our bucket.

**What worked.** It did what it says and we have no Polly-specific friction to report. The neural voice is clear enough for a TV across a room. Request, S3 write and presign all have explicit timeouts, and if audio fails the Cue card still shows the text, so the flow never blocks.

**What needs work.** Nothing we hit. Limits of our feedback: one voice, one language, no SSML, and we did not time Polly separately from the rest of the 1.9 to 2.5 s Cue path.

**Onboarding.** Trivial.

**Would we build again?** Yes.

---

## 7. AWS Lambda

**Used for.** Two Node.js 24 arm64 functions. `session` creates Members and Sessions and signs a 2-hour HMAC phone token. `coach` validates the token, enforces the caps, loads history, calls Bedrock and Polly, saves the set and publishes the Cue. `POST /coach` returns 202 and the function invokes itself asynchronously (`InvocationType: Event`) to do the work, with retries off and a 2-minute max event age.

**What worked.**
- Bundling through CDK, arm64 and the Node 24 runtime were straightforward once the build issue below was solved.
- Reserved concurrency (3 on `coach`) gives a hard spend ceiling.
- A smoke test measured a templated Cue at 0.9 s warm and 2.5 s cold.

**What needs work.**
- With the JSON log format, `JSON.stringify(obj)` is double-encoded into `message`; log the object itself instead (F12).
- Bundling inside CDK is where we lost the most time (see section 11).

**Onboarding.** Good.

**Would we build again?** Yes.

---

## 8. Amazon API Gateway (HTTP API)

**Used for.** `GET /members`, `POST /members`, `POST /session`, `POST /coach`, with CORS `*`.

**What worked.** Setup was quick and cheap, and per-route throttling is available.

**What needs work.** Our security review found that the stage-wide throttle (5 requests per second, burst 10) let one client starve everyone, and the routes have no caller authentication. We added per-route throttles (`POST /session` and `POST /members` at 1 rps burst 3, `POST /coach` at 3 rps burst 6, `GET /members` at 3 rps burst 6). Authenticating a TV install, rather than a person, is the open problem for a login-free household app; we accepted it for the hackathon (M1 in `SECURITY.md`).

**Onboarding.** Good.

**Would we build again?** Yes.

---

## 9. Amazon DynamoDB

**Used for.** One on-demand table with `pk`/`sk`: Member profiles, Sessions, and Sets with a 90-day TTL. The last five Sets per Member are the Coach's memory. Conditional atomic updates implement the 30-call per-session cap and the 300-call daily ceiling.

**What worked.** The access pattern (query newest five `SET#` items for a Member) is one `Query` with `ScanIndexForward: false` and `Limit: 5`. TTL and on-demand billing meant no capacity decisions. We hit no DynamoDB-specific friction.

**What needs work.** A test-tooling note rather than a service issue: with `aws-sdk-client-mock`, `DynamoDBDocumentClient.from({})` throws `Cannot destructure property 'protocol' of 'config'`, so the document client needs a real or fully shaped client in tests.

**Onboarding.** Easy.

**Would we build again?** Yes.

---

## 10. Amazon CloudFront and S3

**Used for.** Serving the phone web app over HTTPS (browsers require it for camera access) from a private S3 bucket through origin access control. S3 also holds the Cue audio.

**What worked.** It worked as documented. Hashed assets get long cache lifetimes while `index.html` and the runtime `config.json` are never stale.

**What needs work.**
- The first CloudFront deploy took 338 s, and CDK warned that `minimumProtocolVersion` "has no effect without a custom 'certificate'" without saying what to change (F11).
- Self-hosting MediaPipe makes the phone bundle 45 MB (39 MB WASM; F14), which makes the first load on a phone slow. Hosting the WASM on a CDN trades size for a runtime dependency.
- Security headers (HSTS, framing) are not set; we recorded that as a low finding.

**Onboarding.** Good.

**Would we build again?** Yes.

---

## 11. AWS CDK

**Used for.** The whole stack in one TypeScript app, with 50 infra tests, including assertions on the synthesised template.

**What worked.** `aws-cdk-lib/aws-appsync` `EventApi` worked with no `Cfn` fallback. Template assertions caught real mistakes (IAM scoping, throttles). The IAM, API Gateway, DynamoDB, S3, CloudFront and CloudWatch constructs were straightforward.

**What needs work.**
- **`NodejsFunction` and esbuild (F3).** It runs `npx --no-install esbuild` from `projectRoot`. In our repo (packages as standalone folders with `file:` dependencies, no workspaces) that failed with `npx canceled due to missing packages and no YES option: ["esbuild@0.28.2"]`, and setting `projectRoot` to `infra` gave `PathNotUnderRoot`. Workaround: one-line entry stubs in `infra/lambda/*.ts`.
- **`ts-node` and TypeScript 7 (F4).** `ts-node` does not work with TypeScript 7. We switched the `cdk.json` app command to `node --import tsx bin/app.ts`; before that we got `/bin/sh: tsx: command not found`.
- **Bootstrap needs app context (F5).** `cdk bootstrap` synthesises the app, so required context such as `-c budgetEmail` must be passed to bootstrap too.
- An npm `ERESOLVE` between `vite@8.3.5`'s optional peer `esbuild ^0.27 || ^0.28` and `esbuild ^0.25` was fixed by moving to `esbuild ^0.28.2`.

**Onboarding.** Fine for CDK users; the bundling and TypeScript-runtime issues are where new projects lose time.

**Would we build again?** Yes.

---

## 12. MediaPipe Tasks Vision (Pose Landmarker) on iOS Safari

**Used for.** On-device pose estimation in the phone browser: `@mediapipe/tasks-vision` 1.1.1, `pose_landmarker_lite`, VIDEO mode, GPU delegate with a CPU fallback. Its 33 landmarks feed our `pose-reps` library.

**What worked.** `FilesetResolver` and `PoseLandmarker.createFromOptions` worked unchanged although the package is now 1.1.1 and docs and samples still show 0.10.x. Running on the device means video never leaves the phone.

**What needs work.**
- **Camera frame on iOS Safari (F7).** An upright iPhone returned a landscape 16:9 frame although the page asked for `width: {ideal: 720}, height: {ideal: 1280}`. The body filled about a third of the frame height, landmarks collapsed (knee angles of 0 to 40 degrees), reps were over-counted (12 against a true 9 to 10) and every fault was a false positive. We retry with `aspectRatio: {exact: 9/16}` on a portrait screen; whether iOS honours `exact` was not yet verified on the device when we wrote the note.
- The measured pose rate on our test phone varied between 7.5 and 15 fps, below our 15 fps target.
- Documentation and samples show 0.10.x (F13).
- The 39 MB WASM dominates the bundle (F14).

**Onboarding.** Quick to first skeleton; hard to get clean angles. Guidance for the phone-held-upright case, and a recommendation to check `videoWidth`/`videoHeight` after `getUserMedia`, would help every web pose app.

**Would we build again?** Yes, with the framing banner and a frame gate in place from the start.

---

## 13. GitHub Actions

**Used for.** CI on both repositories. `pose-reps` runs lint, typecheck and coverage. `couch-coach` runs a per-package matrix and checks out `pose-reps` next to it, then links it, because the packages depend on it through a `file:` path.

**What worked.** Fast feedback (about 30 s for `pose-reps`). The sibling-checkout trick lets a monorepo test against an unpublished sibling library.

**What needs work.** Warnings that `actions/checkout@v4` and `actions/setup-node@v4` target Node 20 and are being forced to Node 24. We left actions unpinned (a low finding in `SECURITY.md`). The `file:` sibling dependency makes CI setup fragile: it depends on dependency installation order across packages.

**Onboarding.** Easy.

**Would we build again?** Yes.

---

## 14. Smaller services

- **AWS Secrets Manager.** Holds the HMAC key that signs the phone token (48 random characters). No friction.
- **Amazon CloudWatch, SNS and AWS Budgets.** Alarms on Bedrock invocations, Polly characters, coach invocations and errors, API 5xx, plus a monthly budget. Fast alarms matter because a budget email can lag by hours. We have not triggered the alarms, so we cannot say how they behave under real load.
- **Claude Code with agent workflows.** The build was done with Claude Code and a set of agent skills (planning, TDD, review, security audit). The repo records the result: tests, a committed eval, an ADR trail, and a STRIDE review whose findings were fixed. [OWNER: add your own view on what worked and what you had to correct.]
