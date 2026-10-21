# Raw friction notes (input for FRICTION_LOG.md)

Collected from the build agents with exact error text. Only real friction hit during the build goes here.

## Phone / MediaPipe (Oct 21)
- `@mediapipe/tasks-vision` is now 1.1.1 on npm (docs and samples still show 0.10.x). `FilesetResolver` / `PoseLandmarker.createFromOptions` worked unchanged.
- Vite + vitest config typing: `vite.config.ts(37,3): error TS2769 ... 'test' does not exist in type 'UserConfigExport'`. Fix: import `defineConfig` from `vitest/config`.
- Self-hosted MediaPipe WASM makes the phone bundle 45 MB (39 MB WASM); the CDN-hosted alternative trades size for a runtime dependency.
- Playwright: `EvalError: Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval'...` when using string `wait_for_function` against a strict CSP.

## pose-reps (Oct 21)
- No `timeout` on macOS: `(eval):1: command not found: timeout` when wrapping `gh run watch`.
- `npm warn install-scripts 1 package has install scripts not yet covered by allowScripts: esbuild@0.28.2 (postinstall: node install.js)`; non-blocking.
- GitHub Actions warning: `actions/checkout@v4` and `setup-node@v4` target Node 20 and are being forced to Node 24.
- Calibration is synthetic-only: 2D heuristics depend on camera angle (squat best at ~45° front, jumping jack frontal). No public, labelled MediaPipe-format exercise fixtures were at hand to calibrate against.

## AWS backend (Oct 21)
- Bedrock: `ResourceNotFoundException: Model use case details have not been submitted for this account. Fill out the Anthropic use case details form before using the model.` for Haiku 4.5, which blocks every Anthropic model until an account-level form is filled. `list-inference-profiles` shows `us.anthropic.claude-haiku-5-5` ACTIVE, yet Converse returns `AccessDeniedException: anthropic.claude-haiku-5-5 is not available for this account.` A listed-as-ACTIVE profile that can't be invoked is misleading.
- npm ERESOLVE: `peerOptional esbuild@"^0.27.0 || ^0.28.0" from vite@8.3.5` vs esbuild ^0.25; fixed with esbuild ^0.28.2.
- CDK `NodejsFunction` runs `npx --no-install esbuild` from `projectRoot`: `npx canceled due to missing packages and no YES option: ["esbuild@0.28.2"]`; setting `projectRoot` to infra gives `PathNotUnderRoot`. Workaround: one-line entry stubs in `infra/lambda/*.ts`.
- ts-node doesn't work with TypeScript 7; `cdk.json` app switched to `node --import tsx bin/app.ts` (`/bin/sh: tsx: command not found` otherwise).
- `npx tsc` in a package prints `This is not the tsc command you are looking for`; use `npm run typecheck`.
- `cdk bootstrap` synthesizes the app, so required context (`-c budgetEmail`) must also be passed to bootstrap.
- Lambda JSON log format double-encodes `JSON.stringify(obj)` into `message`; log the object instead.
- CloudFront first deploy took 338 s; `minimumProtocolVersion ... has no effect without a custom 'certificate'` warning.
- `aws-sdk-client-mock`: `DynamoDBDocumentClient.from({})` throws `Cannot destructure property 'protocol' of 'config'`.
- Positive: `aws-cdk-lib/aws-appsync` `EventApi` L2 (2.274) worked with no Cfn fallback.

## First live phone test (Oct 21, iPhone/desktop camera, user)
- Root cause of "camera doesn't seem to work": only the upper body was in frame (shoulders 100%, hips/knees/ankles 0%), so pose-reps ignored every frame and the phone gave no feedback. Fixed with a debounced "Step back" framing banner. Product lesson, not platform friction.
- Live results once framed: squats counted (10/10), jumping jacks counted (10), Haiku Cue arrived after set end. heels_rising flagged on every squat rep, a likely false positive from 2D heel tracking.
- Coach quality: one Cue praised "feet staying wider today" while feet_not_wide was flagged 8 times; needs an eval or stricter prompt.

## Second live test: recorded set (Oct 21, iPhone + Safari)
- iPhone Safari held in portrait returned a **landscape 16:9** camera frame although the page asked for `width: {ideal: 720}, height: {ideal: 1280}`. The body filled ~33% of frame height → noisy landmarks (knee angles of 0–40° on collapsed frames), reps over-counted (12 vs a true 9–10), and every fault was a false positive. Mitigation: retry with `aspectRatio: {exact: 9/16}` when the screen is portrait; whether iOS honors `exact` aspectRatio is still unverified on device.
- Tuning workflow that worked: a cloud-side listener records the Set straight from AppSync Events, so no file has to travel off the phone. A replay harness then prints per-rep measurements, and the owner supplies ground truth.

## Security round (Oct 21)
- AppSync Events namespace handler propagation: right after `cdk deploy` added an `onSubscribe` handler rejecting wildcard channels, the first probe subscribing to `/cc/*` still returned `subscribe_success`; every later probe returned `Unauthorized`. No documented propagation window, so the deploy pipeline can't assert the rule right away.
- With Cues moved to an IAM-publish-only namespace, the TV screenshot tooling can no longer fake a Cue with the API key (by design), so Cue-card screenshots need a real coach call.

## CI (Oct 21)
- `file:`-linked TypeScript source packages: consumers resolve the linked package's imports (`zod`) from the package's real folder, so CI must `npm ci` the linked package too (`error TS2307: Cannot find module 'zod'` in every consumer job; green locally because the folder had node_modules).
