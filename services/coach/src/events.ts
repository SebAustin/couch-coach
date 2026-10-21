import { Hash } from '@smithy/hash-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';
import type { CoachMessage } from '@couch-coach/protocol';
import { errorFields, log } from '../../shared/logger';
import { config } from './config';

const PUBLISH_TIMEOUT_MS = 3_000;

/**
 * Coach messages live in their own AppSync namespace, `coach`, which only IAM may publish to.
 * (Phones and TVs hold the public API key, so they can subscribe but never forge a Cue.)
 */
export const coachChannel = (sessionId: string): string => `/coach/${sessionId}`;

/** SigV4 signing with the Lambda's own role credentials, which Lambda exposes as environment variables. */
function signer(): SignatureV4 {
  return new SignatureV4({
    service: 'appsync',
    region: process.env.AWS_REGION!,
    sha256: Hash.bind(null, 'sha256'),
    credentials: async () => ({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    }),
  });
}

async function publishOnce(sessionId: string, message: CoachMessage): Promise<void> {
  const { eventsHost } = config();
  const body = JSON.stringify({ channel: coachChannel(sessionId), events: [JSON.stringify(message)] });
  const signed = await signer().sign(
    new HttpRequest({
      method: 'POST',
      protocol: 'https:',
      hostname: eventsHost,
      path: '/event',
      headers: { 'content-type': 'application/json', host: eventsHost },
      body,
    }),
  );
  // fetch derives Host from the URL; the signature already covers it.
  const { host: _host, ...headers } = signed.headers;

  const res = await fetch(`https://${eventsHost}/event`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AppSync Events publish HTTP ${res.status}`);
  const result = (await res.json().catch(() => ({}))) as { failed?: unknown[] };
  if (result.failed && result.failed.length > 0) {
    throw new Error(`AppSync Events rejected the event: ${JSON.stringify(result.failed[0])}`);
  }
}

/** Publishes to /coach/<sessionId> with one retry. Never throws: a lost publish must not fail the job. */
export async function publishCoachMessage(sessionId: string, message: CoachMessage): Promise<boolean> {
  for (const attempt of [1, 2]) {
    try {
      await publishOnce(sessionId, message);
      return true;
    } catch (err) {
      log('warn', 'publish failed', { sessionId, type: message.type, attempt, ...errorFields(err) });
    }
  }
  return false;
}
