import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Production-only Content-Security-Policy. connect-src is limited to same-origin
 * plus AWS endpoints (API Gateway, AppSync Events) and Google's public model host
 * (fallback when the self-hosted model is missing). 'wasm-unsafe-eval' is required by
 * MediaPipe's WebAssembly. Not injected in dev because Vite's HMR needs inline scripts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://*.amazonaws.com wss://*.amazonaws.com https://storage.googleapis.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'couch-coach-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
  ],
});

export default defineConfig({
  // Relative base: works from a CloudFront root or any sub-path.
  base: './',
  plugins: [cspPlugin()],
  build: { outDir: 'dist', target: 'es2022', sourcemap: false },
  server: { host: true },
  test: { include: ['test/**/*.test.ts'] },
});
