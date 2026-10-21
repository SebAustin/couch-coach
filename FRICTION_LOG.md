# Couch Coach: friction log

Draft for the optional Devpost friction log. Every entry comes from real friction recorded in `docs/friction-notes.md`, from the git history of `couch-coach` and `pose-reps`, or from `SECURITY.md` and the READMEs. Nothing is invented. Where the exact error text was not recorded, the entry says so. We did not track time lost, so no entry claims a duration.

Severity scale: **Blocker** (stops the build or the feature until worked around), **High**, **Medium**, **Low**.

Entries F1 to F8 are the ones most useful to Amazon and AWS teams; paste those first.

---

## F1. Bedrock: an account-level Anthropic form blocks every Claude model, and the error does not say so

- **Tool:** Amazon Bedrock (Converse, Claude Haiku 4.5)
- **Task attempted:** call Claude Haiku 4.5 from the coach Lambda to write a spoken Cue.
- **Steps:** invoke `Converse` against the Haiku 4.5 inference profile from the AWS account used for the build.
- **Expected:** a response, or an access error that names the missing step.
- **Actual:** `ResourceNotFoundException: Model use case details have not been submitted for this account. Fill out the Anthropic use case details form before using the model.` The exception type says "not found", the gate is an account-level form, and it blocks every Anthropic model, not just this one.
- **Severity:** Blocker (until the form is filled).
- **Workaround:** complete the Anthropic use-case details form for the account; Haiku 4.5 then worked.
- **Actionable suggestion:** return `AccessDeniedException` (or a dedicated exception) with a link to the form; show an account-level banner in the Bedrock console and a field on `list-foundation-models` that says the form is outstanding; mention it at the top of the Converse quickstart.
- **Source:** `docs/friction-notes.md`, "AWS backend".

## F2. Bedrock: an inference profile listed ACTIVE cannot be invoked

- **Tool:** Amazon Bedrock inference profiles
- **Task attempted:** use the newest Haiku profile for the coach, as PLAN r4 intended.
- **Steps:** `aws bedrock list-inference-profiles`, then `Converse` with the listed profile `us.anthropic.claude-haiku-5-5`.
- **Expected:** an ACTIVE profile can be invoked.
- **Actual:** the profile showed as ACTIVE, but `Converse` returned `AccessDeniedException: anthropic.claude-haiku-5-5 is not available for this account.`
- **Severity:** Medium.
- **Workaround:** fall back to `us.anthropic.claude-haiku-4-5-20251001-v1:0`, which worked.
- **Actionable suggestion:** make the listing reflect what the caller can invoke (for example a per-account `invokable` or entitlement status), or add a lightweight "check access" call. At minimum, document that ACTIVE means "exists", not "available to you".
- **Source:** `docs/friction-notes.md`, "AWS backend"; `docs/adr/0004`; `services/coach/eval/README.md` (default `MODEL_ID`).

## F3. CDK `NodejsFunction` cannot find esbuild in a repo with standalone packages

- **Tool:** AWS CDK (`aws-lambda-nodejs` `NodejsFunction`)
- **Task attempted:** bundle the `session` and `coach` Lambdas from TypeScript.
- **Steps:** `NodejsFunction` with entries in `services/*`, packages linked by `file:` paths, no npm workspaces.
- **Expected:** the construct bundles with the esbuild already installed in the CDK app.
- **Actual:** it runs `npx --no-install esbuild` from `projectRoot` and fails: `npx canceled due to missing packages and no YES option: ["esbuild@0.28.2"]`. Setting `projectRoot` to `infra` gives `PathNotUnderRoot`.
- **Severity:** High (blocks synth and deploy).
- **Workaround:** one-line entry stubs in `infra/lambda/*.ts` that re-export the real handlers, so entries live under `infra`.
- **Actionable suggestion:** resolve the esbuild binary from the CDK app's own dependencies (for example via `require.resolve`) rather than from `projectRoot`; allow entries outside `projectRoot` when a lockfile directory is given explicitly; make the error say which directory was searched.
- **Source:** `docs/friction-notes.md`, "AWS backend".

## F4. CDK app command: `ts-node` does not work with TypeScript 7

- **Tool:** AWS CDK CLI, TypeScript 7
- **Task attempted:** run the CDK app (`cdk synth`, `cdk deploy`).
- **Steps:** the usual `cdk.json` app command based on `ts-node`.
- **Expected:** the app runs.
- **Actual:** `ts-node` does not work with TypeScript 7. The fix was to switch the app command to `tsx`; the notes record `/bin/sh: tsx: command not found` when it is invoked as a bare command instead of through `node --import tsx`. Separately, `npx tsc` inside a package printed `This is not the tsc command you are looking for`.
- **Severity:** Medium.
- **Workaround:** `cdk.json` app set to `node --import tsx bin/app.ts` with `tsx` as a dev dependency; use `npm run typecheck` instead of `npx tsc`.
- **Actionable suggestion:** `cdk init` templates and the getting-started docs should recommend a TypeScript 7 compatible runner (`tsx` or Node's native TypeScript support) instead of `ts-node`.
- **Source:** `docs/friction-notes.md`, "AWS backend".

## F5. `cdk bootstrap` needs the app's required context

- **Tool:** AWS CDK CLI
- **Task attempted:** bootstrap the account and Region before the first deploy.
- **Steps:** `cdk bootstrap` in an app that requires context (`-c budgetEmail`).
- **Expected:** bootstrap needs only the account and Region.
- **Actual:** bootstrap synthesises the app, so the required context must be passed to it too.
- **Severity:** Low.
- **Workaround:** pass the same `-c` flags to `cdk bootstrap`.
- **Actionable suggestion:** let `cdk bootstrap aws://ACCOUNT/REGION` skip app synthesis, or print which context is missing and why bootstrap needs it.
- **Source:** `docs/friction-notes.md`, "AWS backend".

## F6. AppSync Events: the public API key could subscribe to every session and forge messages

- **Tool:** AWS AppSync Events (API key auth, channel namespaces)
- **Task attempted:** a private realtime channel per Session, using an unguessable 128-bit channel name and a public client API key.
- **Steps:** the security review opened a WebSocket subscription to `/cc/*` with the committed client key, and published over HTTP to a fresh random channel with the same key.
- **Expected:** a client key limited to a channel cannot read other channels; the channel name is the secret.
- **Actual:** the wildcard subscribe returned `subscribe_success`, and the wildcard subscriber received the event from the HTTP publish. One subscriber could read every live Session's landmark stream and then publish forged Cues, reps and control events into any of them.
- **Severity:** High (design-level).
- **Workaround:** `onSubscribe` handlers (APPSYNC_JS) that accept only exact `/cc/<32-hex>/<segment>` and `/coach/<32-hex>` channels and reject anything containing `*`; Coach messages moved to a second namespace with API-key subscribe and IAM-only publish (the key now gets 401 there); the key removed from the coach Lambda. A residual risk remains: anyone who sees a Session's QR can publish noise into that Session's `pose` and `events` channels for 2 hours.
- **Actionable suggestion:** a namespace setting that disallows wildcard subscriptions; channel-scoped API keys or a built-in per-channel authorisation rule; and a documented pattern for "one private channel per session" that does not require a custom authorizer.
- **Source:** `SECURITY.md` (finding H1 and the remediation table); `infra/lib/event-handlers.ts`. The key is public by design and expires 2026-12-15.

## F7. iOS Safari returns a landscape camera frame to an upright phone

- **Tool:** `getUserMedia` on iOS Safari with MediaPipe Pose Landmarker (web pose apps)
- **Task attempted:** a phone propped upright as the camera, getting a portrait frame with the whole body in view.
- **Steps:** an iPhone in portrait, page requested `width: {ideal: 720}, height: {ideal: 1280}`.
- **Expected:** a portrait frame.
- **Actual:** a landscape 16:9 frame. The body filled about 33% of the frame height, landmarks collapsed (knee angles of 0 to 40 degrees), reps were over-counted (12 against a true 9 to 10) and every fault was a false positive.
- **Severity:** High for any pose app, because the symptom is wrong geometry, not an error.
- **Workaround:** retry with `aspectRatio: {exact: 9/16}` when the screen is portrait (`fix(phone)` commit `2668039` in `couch-coach`); a "Step back" framing banner; a frame gate in `pose-reps` that rejects collapsed skeletons and, in `pose-reps` v0.1.1, a real phone recording as a regression test. When the note was written, whether iOS honours `exact` aspectRatio was not yet verified on the device.
- **Actionable suggestion:** MediaPipe web docs and any "phone as camera" companion guidance for TV apps should tell developers to read `videoWidth` and `videoHeight` after `getUserMedia` and not trust the constraints, and should show the exact-aspect retry.
- **Source:** `docs/friction-notes.md`, "Second live test"; `couch-coach` commit `2668039`; `pose-reps` commits `1c28415` and `0c3a8eb`.

## F8. Fire TV multi-TV sample: a release candidate and mismatched Expo packages

- **Tool:** `AmazonAppDev/react-native-multi-tv-app-sample` (Expo, `react-native-tvos`)
- **Task attempted:** start the Fire OS TV app from the sample.
- **Steps:** import the sample at its default state and inspect its dependencies before building.
- **Expected:** a stable, internally consistent Expo SDK 54 dependency set.
- **Actual:** the app depends on `react-native: npm:react-native-tvos@~0.81.0-0`, which its lockfile resolved to `0.81.0-0rc5` (a release candidate), and `react-tv-space-navigation 6.0.0-beta1`. Its `expo ~54.0.0` sat next to SDK 52-era packages (`@expo/metro-runtime ~4.0.0`, `expo-constants ~17.0.0`, `expo-font ~13.0.0`, `expo-build-properties ~0.13.0`), and the lockfile held both `expo-constants` 17.0.8 and 18.0.13. We did not record the exact runtime or build error this caused, so we cannot name a symptom.
- **Severity:** Medium.
- **Workaround:** pinned `react-native-tvos` to `0.81.5-2` and moved the Expo packages to their SDK 54 versions (`@expo/metro-runtime ~6.1.2`, `expo-constants ~18.0.14`, `expo-font ~14.0.12`, `expo-build-properties ~1.0.10`) in commit `5c9b541`.
- **Actionable suggestion:** pin a stable `react-native-tvos` release, run `expo install --check` or `expo-doctor` in the sample's CI so SDK drift fails the build, and move off pre-release ranges.
- **Source:** git history, `apps/tv/package.json` and `yarn.lock` at `4da0a15` versus `5c9b541`.

## F9. Fire TV sample: Vega-only prerequisites, no sideload path for a Fire OS TV

- **Tool:** the same sample, Fire TV docs, Vega SDK (not used)
- **Task attempted:** work out the right path to a real Fire TV and install our app on it.
- **Steps:** read the sample's README prerequisites and quick start.
- **Expected:** a clear way to tell which Fire TV path applies and how to install on a physical device.
- **Actual:** the prerequisites list the Vega SDK as the Fire TV requirement; the Fire OS path is folded into the Android TV quick start (`yarn dev:android`) with no steps for enabling ADB on a physical Fire TV, connecting and installing. Our own assumptions file recorded that the TV's OS (Fire OS or Vega OS) was still to be confirmed. No Vega build was attempted: the SDK was not installed and we chose the Fire OS route for lack of time.
- **Severity:** Medium.
- **Workaround:** a Fire OS APK, and our own guided script `apps/tv/scripts/fire-tv-wizard.sh` plus `install-apk.sh` (commit `9eb3d96`).
- **Actionable suggestion:** a short "which Fire TV do you have?" guide at the top of the sample, and a Fire OS sideload section (ADB debugging, `adb connect`, `adb install -r`, uninstall).
- **Source:** the sample README at `4da0a15`; `ASSUMPTIONS.md` item 6; `PLAN.md` r4.

## F10. Fire TV APK carried x86 libraries it can never use

- **Tool:** Expo prebuild / Android Gradle build for a Fire TV APK
- **Task attempted:** build a sideloadable release APK.
- **Steps:** `expo prebuild`, then `./gradlew assembleRelease`.
- **Expected:** a lean APK for ARM Fire TV devices.
- **Actual:** the APK was 57 MB because prebuilt dependencies (Hermes and others) ship x86 and x86_64 libraries too.
- **Severity:** Low.
- **Workaround:** a config plugin (`withAbiFilters.js`) adds `ndk.abiFilters` for `armeabi-v7a` and `arm64-v8a`, re-applied on every prebuild: 57 MB down to 33 MB (commit `1ba1726`).
- **Actionable suggestion:** a Fire OS profile or documented ABI filter in the sample, since Fire TV hardware is ARM.
- **Source:** commit `1ba1726`; `plugins/withAbiFilters.js`.

## F11. CloudFront: a 338 s first deploy and a warning that names no fix

- **Tool:** Amazon CloudFront via AWS CDK
- **Task attempted:** serve the phone web app over HTTPS.
- **Steps:** first `cdk deploy` of the distribution.
- **Expected:** a deploy without warnings.
- **Actual:** the first deploy took 338 s, and CDK warned `minimumProtocolVersion ... has no effect without a custom 'certificate'`.
- **Severity:** Low.
- **Workaround:** none needed; deployed as is.
- **Actionable suggestion:** make the warning say how to resolve it (add a certificate and alias, or remove the property), and note typical first-deploy time in the construct docs.
- **Source:** `docs/friction-notes.md`, "AWS backend".

## F12. Lambda JSON log format double-encodes stringified objects

- **Tool:** AWS Lambda advanced logging (JSON format)
- **Task attempted:** structured logs from the coach Lambda.
- **Steps:** `console.log(JSON.stringify(obj))`.
- **Expected:** the object appears as structured fields.
- **Actual:** the JSON string is double-encoded into the `message` field.
- **Severity:** Low.
- **Workaround:** log the object itself, not a string.
- **Actionable suggestion:** a callout in the JSON log-format docs, or detect a stringified JSON message and parse it.
- **Source:** `docs/friction-notes.md`, "AWS backend".

## F13. MediaPipe Tasks Vision: docs and samples lag the package

- **Tool:** `@mediapipe/tasks-vision`
- **Task attempted:** set up the Pose Landmarker in the browser.
- **Steps:** follow the docs and samples, install the package.
- **Expected:** the version in the docs matches npm.
- **Actual:** npm is at 1.1.1 while docs and samples still show 0.10.x. `FilesetResolver` and `PoseLandmarker.createFromOptions` worked unchanged.
- **Severity:** Low.
- **Workaround:** none needed.
- **Actionable suggestion:** update the snippets and CDN URLs to 1.1.x, or state that 0.10.x snippets are compatible.
- **Source:** `docs/friction-notes.md`, "Phone / MediaPipe".

## F14. Self-hosted MediaPipe WASM makes the phone bundle 45 MB

- **Tool:** `@mediapipe/tasks-vision` (WASM runtime)
- **Task attempted:** serve the phone app from our own CloudFront without a runtime dependency on a third-party CDN.
- **Steps:** self-host the WASM files and the model.
- **Expected:** a modest bundle.
- **Actual:** 45 MB, of which 39 MB is WASM.
- **Severity:** Medium (first load on a phone).
- **Workaround:** long cache lifetimes on hashed assets; the CDN-hosted alternative trades size for a runtime dependency.
- **Actionable suggestion:** publish smaller or lazily loaded WASM variants, or document a subresource-integrity pattern for CDN-hosted files.
- **Source:** `docs/friction-notes.md`, "Phone / MediaPipe".

## F15. `react-tv-space-navigation`: a missing root crashes the app

- **Tool:** `react-tv-space-navigation` (used by the sample for D-pad focus)
- **Task attempted:** add a new TV screen with focusable controls.
- **Steps:** render focusable components on a screen without a `SpatialNavigationRoot` of its own.
- **Expected:** a clear development warning.
- **Actual:** the app crashes with `No registered spatial navigator on this page`.
- **Severity:** Medium.
- **Workaround:** every screen with focusables gets its own `SpatialNavigationRoot` (written into `apps/tv/README.md`).
- **Actionable suggestion:** the sample README and library docs should state the rule next to the first example, and the error should name the screen.
- **Source:** `apps/tv/README.md`, "Design notes" and "Troubleshooting".

## F16. Jest coverage reports 0% in an Expo monorepo

- **Tool:** `jest-expo` in the TV monorepo
- **Task attempted:** measure coverage of shared UI code.
- **Steps:** `yarn test --coverage` with shared code under `packages/shared-ui`.
- **Expected:** real coverage figures.
- **Actual:** 0%, because jest does not instrument files outside the app's `rootDir`, even with `rootDir` moved. The tests themselves run and pass.
- **Severity:** Low.
- **Workaround:** none; we do not quote a TV coverage figure.
- **Actionable suggestion:** a documented jest config for Expo monorepos that instruments shared packages.
- **Source:** `apps/tv/README.md`, "Troubleshooting".

---

## Not Amazon-facing (left out of the submission list on purpose)

These are real but concern other ecosystems, so we would not use up friction-log entries on them: a Vite and vitest config typing error (`TS2769: 'test' does not exist in type 'UserConfigExport'`, fixed by importing `defineConfig` from `vitest/config`); a Playwright `EvalError` under a strict content security policy; an npm `ERESOLVE` between `vite@8.3.5` and `esbuild ^0.25`; the missing `timeout` command on macOS; and the GitHub Actions Node 20 deprecation warning. All are in `docs/friction-notes.md`.
