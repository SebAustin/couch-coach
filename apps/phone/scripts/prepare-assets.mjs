// Prepares files that Vite serves from public/:
//  - self-hosted MediaPipe WASM (no CDN at runtime)
//  - the Pose Landmarker lite and full models (best effort download; the app falls back to Google's URL).
//    lite is the default; full is opt-in with `?model=full`.
//  - config.json: `dev` copies infra/client-config.json, any other run removes it, because in
//    production CDK writes config.json at the root of the web bucket.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDest = join(pub, 'mediapipe', 'wasm');
const MODEL_VARIANTS = ['lite', 'full'];
const modelDest = (variant) => join(pub, 'models', `pose_landmarker_${variant}.task`);
const modelUrl = (variant) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/latest/pose_landmarker_${variant}.task`;
const configSrc = join(root, '..', '..', 'infra', 'client-config.json');
const configDest = join(pub, 'config.json');
const isDev = process.argv.includes('dev');

if (!existsSync(wasmSrc)) {
  console.error('prepare-assets: @mediapipe/tasks-vision is not installed; run npm install');
  process.exit(1);
}
mkdirSync(wasmDest, { recursive: true });
cpSync(wasmSrc, wasmDest, { recursive: true });
console.log('prepare-assets: copied MediaPipe WASM ->', wasmDest);

for (const variant of MODEL_VARIANTS) {
  const dest = modelDest(variant);
  if (existsSync(dest)) continue;
  try {
    const res = await fetch(modelUrl(variant), { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`prepare-assets: downloaded ${variant} pose model ->`, dest);
  } catch (err) {
    console.warn(`prepare-assets: could not download the ${variant} model (${err.message}); the app will fall back to Google's URL`);
  }
}

if (isDev && existsSync(configSrc)) {
  copyFileSync(configSrc, configDest);
  console.log('prepare-assets: dev config.json copied from infra/client-config.json');
} else if (!isDev) {
  rmSync(configDest, { force: true });
}
