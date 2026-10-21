# Raw friction notes (input for FRICTION_LOG.md)

Collected from the build agents with exact error text. Only real friction hit during the build goes here.

## Phone / MediaPipe (Oct 21)
- `@mediapipe/tasks-vision` is now 1.1.1 on npm (docs and samples still show 0.10.x). `FilesetResolver` / `PoseLandmarker.createFromOptions` worked unchanged.
- Vite + vitest config typing: `vite.config.ts(37,3): error TS2769 ... 'test' does not exist in type 'UserConfigExport'`. Fix: import `defineConfig` from `vitest/config`.
- Self-hosted MediaPipe WASM makes the phone bundle 45 MB (39 MB WASM); the CDN-hosted alternative trades size for a runtime dependency.
- Playwright: `EvalError: Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval'...` when using string `wait_for_function` against a strict CSP.
