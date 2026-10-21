# Couch Coach Camera Phone

Vite + TypeScript, no UI framework. The phone runs MediaPipe Pose Landmarker (lite, VIDEO mode, GPU delegate with CPU fallback) on-device, counts reps with `pose-reps`, and publishes only keypoints and events over AppSync Events. Video never leaves the phone.

```
npm install          # needs ../../../pose-reps built (npm run build there)
npm run dev          # copies infra/client-config.json to public/config.json when present
npm run build        # -> dist/ (WASM + model self-hosted, no config.json: CDK writes it at the bucket root)
npm run preview
npm test             # vitest: batching, set summary, auto-end, frame ring, URL params, set runner
npm run typecheck
```

URL: `/?s=<sessionId>&t=<phoneToken>&m=<memberId>` (`m` optional, defaults to `unknown`).

`prepare-assets` (runs before dev/build) copies the MediaPipe WASM into `public/mediapipe/wasm` and downloads `pose_landmarker_lite.task` into `public/models` (the app falls back to Google's public URL if the file is missing).

Camera needs HTTPS (or localhost). Production builds inject a CSP meta tag (see `vite.config.ts`).
