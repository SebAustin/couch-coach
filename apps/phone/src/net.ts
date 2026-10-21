import { createEventsClient, type EventsClient } from '@couch-coach/events-client';
import {
  channels,
  CoachMessage,
  PhoneEvent,
  type ClientConfig,
  type CoachRequest,
  type PoseBatch,
} from '@couch-coach/protocol';

const COACH_TIMEOUT_MS = 10_000;

export interface SessionNet {
  client: EventsClient;
  channels: ReturnType<typeof channels>;
  publishEvent(event: PhoneEvent): Promise<void>;
  publishPose(batch: PoseBatch): Promise<void>;
  onCoach(cb: (msg: CoachMessage) => void): () => void;
  onRemoteEvent(cb: (event: PhoneEvent) => void): () => void;
  /** POST /coach. Resolves true when the API accepted the request (202). */
  requestCoach(body: CoachRequest): Promise<{ ok: true } | { ok: false; status: number | null }>;
}

/** Wire the events client and the HTTP API to one Session. */
export function createSessionNet(config: ClientConfig, sessionId: string): SessionNet {
  const client = createEventsClient({
    httpHost: config.eventsHttpHost,
    realtimeHost: config.eventsRealtimeHost,
    apiKey: config.eventsApiKey,
  });
  const ch = channels(sessionId);
  const apiBase = config.apiBaseUrl.replace(/\/+$/, '');

  return {
    client,
    channels: ch,
    publishEvent: (event) => client.publish(ch.events, [event]),
    publishPose: (batch) => client.publish(ch.pose, [batch]),

    onCoach: (cb) =>
      client.subscribe(ch.coach, (raw) => {
        const parsed = CoachMessage.safeParse(raw);
        if (parsed.success) cb(parsed.data);
      }),

    onRemoteEvent: (cb) =>
      client.subscribe(ch.events, (raw) => {
        const parsed = PhoneEvent.safeParse(raw);
        if (parsed.success) cb(parsed.data);
      }),

    async requestCoach(body) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), COACH_TIMEOUT_MS);
      try {
        const res = await fetch(`${apiBase}/coach`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        return res.ok ? { ok: true } : { ok: false, status: res.status };
      } catch {
        return { ok: false, status: null };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
