import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** `npm run eval`: calls Bedrock for real. Kept separate from `npm test`, which never touches AWS. */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['eval/**/*.eval.ts'],
    testTimeout: 10 * 60 * 1000,
    env: {
      MODEL_ID: process.env.MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      AWS_REGION: process.env.AWS_REGION ?? 'us-east-1',
    },
    server: { deps: { inline: [/@couch-coach\/protocol/] } },
  },
});
