import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Template synthesis bundles both Lambdas with esbuild, which takes a few seconds.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    server: { deps: { inline: [/@couch-coach\/protocol/] } },
  },
});
