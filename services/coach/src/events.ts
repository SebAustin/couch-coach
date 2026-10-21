import { channels, type CoachMessage } from '@couch-coach/protocol';
import { errorFields, log } from '../../shared/logger';
import { config } from './config';

const PUBLISH_TIMEOUT_MS = 3_000;

async function publishOnce(sessionId: string, message: CoachMessage): Promise<void> {
  const { eventsHost, eventsApiKey } = config();
  const res = await fetch(`https://${eventsHost}/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': eventsApiKey },
    body: JSON.stringify({ channel: channels(sessionId).coach, events: [JSON.stringify(message)] }),
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AppSync Events publish HTTP ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { failed?: unknown[] };
  if (body.failed && body.failed.length > 0) {
    throw new Error(`AppSync Events rejected the event: ${JSON.stringify(body.failed[0])}`);
  }
}

/** Publishes to /cc/<sessionId>/coach with one retry. Never throws: a lost publish must not fail the job. */
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
