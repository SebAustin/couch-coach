/**
 * Turns `cdk deploy --outputs-file infra/cdk-outputs.json` into infra/client-config.json (the shared
 * ClientConfig shape). The values are public client settings, so the file may be committed:
 * the Events API key is scoped to /cc/* and expires 2026-12-15.
 *
 *   npm run write-client-config [-- <outputs.json> <client-config.json>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ClientConfig } from '@couch-coach/protocol';

const STACK = 'CouchCoachStack';

export function toClientConfig(outputs: unknown): ClientConfig {
  const stackOutputs = (outputs as Record<string, Record<string, string> | undefined>)?.[STACK];
  if (!stackOutputs) throw new Error(`No "${STACK}" key in the CDK outputs file`);
  const { apiBaseUrl, eventsHttpHost, eventsRealtimeHost, eventsApiKey, phoneUrl } = stackOutputs;
  return ClientConfig.parse({ apiBaseUrl, eventsHttpHost, eventsRealtimeHost, eventsApiKey, phoneUrl });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const [inPath = 'cdk-outputs.json', outPath = 'client-config.json'] = process.argv.slice(2);
  const config = toClientConfig(JSON.parse(readFileSync(inPath, 'utf8')));
  writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`wrote ${outPath}`);
}
