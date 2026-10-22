# Couch Coach Camera Phone

Vite + TypeScript, no UI framework. The phone runs MediaPipe Pose Landmarker (lite by default, VIDEO mode, GPU delegate with CPU fallback) on-device, counts reps with `pose-reps`, and publishes only keypoints, the counter's live motion (depth, phase, target, for the TV's depth gauge) and events over AppSync Events. Video never leaves the phone.

```
npm install          # needs ../../../pose-reps built (npm run build there)
npm run dev          # copies infra/client-config.json to public/config.json when present
npm run build        # -> dist/ (WASM + model self-hosted, no config.json: CDK writes it at the bucket root)
npm run preview
npm test             # vitest: batching, set summary, auto-end, frame ring, URL params, set runner, framing, live motion
npm run typecheck
```

URL: `/?s=<sessionId>&t=<phoneToken>&m=<memberId>` (`m` optional, defaults to `unknown`). Add `&model=full` to run the full Pose Landmarker instead of lite (more accurate, slower; check the FPS on the debug line, `&debug=1`).

`prepare-assets` (runs before dev/build) copies the MediaPipe WASM into `public/mediapipe/wasm` and downloads `pose_landmarker_lite.task` and `pose_landmarker_full.task` into `public/models` (the app falls back to Google's public URL if the file is missing).

Camera needs HTTPS (or localhost). Production builds inject a CSP meta tag (see `vite.config.ts`).

## iPhone Safari polish

`index.html` and `src/styles/app.css` carry the mobile-native layer: `viewport-fit=cover` plus `env(safe-area-inset-*)`, `theme-color` matching Lamplight, no tap highlight or long-press selection on controls, `touch-action: manipulation`, `overscroll-behavior: none`, a CSS-only "Rotate back to portrait" overlay in landscape, and in-flow (non-overlapping) notice and alert areas. Before/after screenshots at 390x844, 430x932 and 390x664 (Safari with toolbars) are in `docs/screenshots/`. The fake camera sees nobody, so the Rep count and Form Score in the Set screenshots are patched into the DOM for illustration only.
