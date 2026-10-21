# Couch Coach TV app (Fire OS / Android TV)

The living-room screen of Couch Coach: pick a Member, show a QR code for the Camera Phone, draw the live skeleton,
rep counter, Form Score and the Coach's Cue, then a Recap. Design spec: `../../docs/ux.md` ("Lamplight").
Contracts with the phone and cloud: `../../docs/CONTRACTS.md` and `../../packages/protocol/src/index.ts`.

It started as a fork of [AmazonAppDev/react-native-multi-tv-app-sample](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample)
(MIT-0, see `LICENSE`): Expo 54, `react-native-tvos` 0.81, `react-tv-space-navigation` for D-pad focus. The Vega app,
the video player and the sample screens were removed. We target Fire OS only (sideloaded Android TV APK).

| Members | Pair | Live | Recap |
|---|---|---|---|
| `docs/screenshots/tv-01-members.png` | `tv-04-pair.png` | `tv-07-live-fault.png`, `tv-10-live-cue.png` | `tv-13-recap.png` |

Screenshots named `tv-*` come from the Android TV emulator (real APK, real API). `web-*` come from the Expo web target.
`break-*` are worst-case states from the web target (see `scripts/break-screenshots.mjs`).

## Install on a real Fire TV (guided)

`bash scripts/fire-tv-wizard.sh` walks you through it step by step: turn on ADB debugging on the Fire TV, find its IP, accept the debugging prompt, install the APK, and run a first live Session with a short checklist. It remembers the TV's IP in `apps/tv/.env.local` (gitignored).

## Quick start

```bash
cd apps/tv
yarn install                 # Yarn 4.5 (see Toolchain)
yarn sync                    # copies protocol + events-client from ../../packages and writes config.generated.ts
yarn test && yarn typecheck
yarn dev:web                 # http://localhost:8082, handy for iteration and screenshots
```

### Build the sideloadable APK

```bash
source scripts/android-env.sh      # JAVA_HOME (JDK 17), ANDROID_HOME, PATH, EXPO_TV=1
yarn build:apk                     # sync -> expo prebuild (EXPO_TV=1) -> gradlew assembleRelease -> dist/couch-coach.apk
```

`dist/couch-coach.apk` (about 57 MB, gitignored) is a release build signed with the Expo debug keystore, which is
what makes it installable by sideload. Package `dev.sebaustin.couchcoach`, Leanback launcher, TV banner,
`INTERNET` only, `usesCleartextTraffic=false`, ABIs armeabi-v7a + arm64-v8a (older Fire sticks are 32-bit).

### Install on a Fire TV

On the TV: Settings > My Fire TV > Developer Options > ADB debugging ON (and "Apps from Unknown Sources" if listed),
then note the IP under About > Network.

```bash
source scripts/android-env.sh
adb connect <fire-tv-ip>:5555        # accept the RSA prompt on the TV
yarn install:apk <fire-tv-ip>        # adb install -r dist/couch-coach.apk, then launches it
```

Uninstall / roll back: `adb uninstall dev.sebaustin.couchcoach`, or `adb install -r` an older APK of the same
signature (`versionCode` in `apps/expo-multi-tv/app.json` must not go down).

### Emulator and screenshots

```bash
yarn emulator                                  # creates AVD "couchcoach_tv" (Android 14 TV, arm64) and boots it headless
bash scripts/emulator-screenshots.sh           # installs the APK, drives it with D-pad key events, saves docs/screenshots/tv-*.png
node scripts/web-screenshots.mjs               # same flow against `yarn dev:web` in headless Chrome -> web-*.png
node scripts/break-screenshots.mjs             # worst-case data (13 Members, 106 Reps, 6 Faults, 640-char Cue, 10 Sets) -> break-*.png
```

### Driving Live without a phone

`scripts/publish-synthetic.mjs` plays a fake Camera Phone (synthetic MediaPipe poses at 15 fps, reps, faults,
a Cue) into a real Session on the deployed AppSync Events API:

```bash
node scripts/publish-synthetic.mjs --wait 10 --reps 5 --faults knees_caving,torso_lean --end
# prints an adb deep link:  couchcoach://attach?s=<sessionId>&m=<memberId>&n=<name>   (and a web preview URL)
node scripts/publish-synthetic.mjs --session <32hex>        # or: pair by QR, then replay into that Session
node scripts/publish-synthetic.mjs --real-coach             # use POST /coach (Bedrock + Polly) instead of a canned Cue
node scripts/publish-synthetic.mjs --audio <https mp3 url> --stall 8   # test audio, or "Lost your phone"
```

The `attach` deep link opens the TV straight onto an existing Session (skips pairing). It carries no secret.

## Debug overlay

Press the remote's **Menu** (or Info) button on Live (**D** on web): draw fps, incoming frame fps, receive latency
(`now - frame.t`, only meaningful if the phone and TV clocks agree), playout delay, starved samples, socket state.

## Layout

```
apps/expo-multi-tv/        Expo app shell (App.tsx, app.json, plugins/, assets/brand, jest + tsconfig)
packages/shared-ui/src/
  vendor/                  protocol + events-client, copied by `yarn sync` (committed, do not edit)
  config.generated.ts      from ../../infra/client-config.json (committed; the AppSync key is a public client key)
  api/                     typed, zod-validated HTTP client (GET/POST /members, POST /session)
  hooks/                   useSessionStream (events client -> LiveState + FrameBuffer), useCueAudio, ...
  lib/                     pure logic: frameBuffer, liveState reducer, recap, skeletonPaths, connection, ...
  theme/                   Lamplight tokens, s() scaling, scoreBand
  components/ui/           Focusable (D-pad focus treatment), Button, Modal, Txt, icons
  screens/                 Members, Pair, Live (+ live/ HUD, CueCard, SkeletonStage), Recap
  navigation/              CouchCoachApp, SessionFlow (Pair -> Live -> Recap), back stack, attach link
scripts/                   android-env.sh, sync-shared.mjs, build-apk.sh, install-apk.sh, emulator*.sh, publish-synthetic.mjs
```

### Design notes worth knowing

- **Skeleton rendering is imperative.** `SkeletonStage` runs a `requestAnimationFrame` loop (about 30 fps) that samples
  the `FrameBuffer` and writes SVG path data with `setNativeProps`. React never re-renders per frame. On web the same
  call needs `{ style: props }` (react-native-svg web convention); native takes plain props.
- **FrameBuffer** is a jitter buffer: phone frames arrive in bursts of 3 about every 200 ms, so playback runs behind
  real time by an adaptive delay (p90 batch gap + 40 ms, 150-450 ms) and interpolates between frames at their capture
  timestamps. The phone/TV clock offset is the minimum of `arrival - t` over 5 s.
- **Focus.** `Focusable` wraps `react-tv-space-navigation`'s focusable view with the Lamplight ring/glow (opacity-only
  animation). On Live, focus stays hidden until the first D-pad press, as the spec asks. Every screen that uses a
  focusable needs its own `SpatialNavigationRoot` (a missing one crashes the app with "No registered spatial navigator").
- **Back.** A tiny stack (`navigation/backStack.ts`): the newest handler wins, so a dialog gets Back before the screen
  under it. Android uses `BackHandler`; on web Escape/Backspace. Keycode 67 (KEYCODE_DEL) is deliberately not mapped
  to Back, or deleting a letter in the TV keyboard would close the dialog.
- **Worst-case data.** Fit rules (long names, 8+ Members, 100+ Reps, 4+ Faults, long Cues, 10+ Sets) are pure functions in
  `lib/fit.ts`; decisions and measurements live in `.interface-design/system.md`.
- **Motion.** RN `Animated` with `useNativeDriver: true` only (Reanimated was deliberately dropped). Screens and dialogs fade
  (opacity only, so focusable nodes never move); reduced motion is one shared subscription (`hooks/useReducedMotion.ts`).
- **Events.** Delivery is at-least-once: `rep` is de-duplicated by index, `set_end` by `setIndex`, `hello` is idempotent.

## Toolchain (as built on 2026-10-21, macOS arm64)

| Tool | Version | Where |
|---|---|---|
| Node | 26.7.0 (Homebrew). Metro, Expo CLI, jest all work; no need for Node 22 | |
| Yarn | 4.5.0 via `npm i -g @yarnpkg/cli-dist@4.5.0` (corepack collides with the pnpm shim) | `/opt/homebrew/bin/yarn` |
| JDK | OpenJDK 17.0.21 (`brew install openjdk@17`) | `/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home` |
| Android SDK | `brew install --cask android-commandlinetools` | `/opt/homebrew/share/android-commandlinetools` |
| SDK packages | platform-tools 37.0.1, platforms android-35/36, build-tools 35.0.0/36.0.0, NDK 27.1.12297006, cmake 3.22.1, emulator 37.2.12, system image `android-34;android-tv;arm64-v8a` | |
| Gradle / AGP / Kotlin | 8.14.3 / 8.11.0 / 2.0.21 | |
| Expo / React Native | Expo 54.0.33, `react-native-tvos` 0.81.5-2, React 19.1 | |

All of this is wired by `scripts/android-env.sh` (no machine secrets in it). Disk: SDK 13 GB (incl. emulator image),
`~/.gradle` 3.4 GB.

## Troubleshooting

- `No registered spatial navigator on this page`: a screen renders focusables outside a `SpatialNavigationRoot`.
- `adb: device offline` right after the emulator boots: wait a few seconds; `adb kill-server && adb start-server`.
- Fonts missing: the app falls back to system fonts and keeps layout sizes.
- Placeholder config banner ("Setup needed: run yarn sync"): `infra/client-config.json` was absent when you ran `yarn sync`.
- `yarn test` coverage reporting shows 0% in this monorepo (jest does not instrument files outside the app's rootDir,
  even with rootDir moved); the tests themselves run and pass.
