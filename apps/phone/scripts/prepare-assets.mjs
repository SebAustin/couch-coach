// Prepares files that Vite serves from public/:
//  - self-hosted MediaPipe WASM (no CDN at runtime)
//  - the Pose Landmarker lite model (best effort download; the app falls back to Google's URL)
//  - config.json: `dev` copies infra/client-config.json, any other run removes it, because in
//    production CDK writes config.json at the root of the web bucket.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDest = join(pub, 'mediapipe', 'wasm');
const modelDest = join(pub, 'models', 'pose_landmarker_lite.task');
const modelUrl =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
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

if (!existsSync(modelDest)) {
  try {
    const res = await fetch(modelUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(dirname(modelDest), { recursive: true });
    writeFileSync(modelDest, Buffer.from(await res.arrayBuffer()));
    console.log('prepare-assets: downloaded pose model ->', modelDest);
  } catch (err) {
    console.warn(`prepare-assets: could not download model (${err.message}); the app will fall back to Google's URL`);
  }
}

if (isDev && existsSync(configSrc)) {
  copyFileSync(configSrc, configDest);
  console.log('prepare-assets: dev config.json copied from infra/client-config.json');
} else if (!isDev) {
  rmSync(configDest, { force: true });
}
