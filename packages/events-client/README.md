# @couch-coach/events-client

Raw AppSync Events WebSocket client. No Amplify, no Node-only APIs (global `WebSocket`, own base64url helper), so it runs in browsers and React Native. TypeScript source package: `main` is `./src/index.ts`, no build step. See ADR 0003.

```ts
import { createEventsClient } from '@couch-coach/events-client';

const client = createEventsClient({ httpHost, realtimeHost, apiKey /*, WebSocketImpl */ });
const off = client.subscribe('/cc/<sessionId>/pose', (event) => { /* JSON-parsed */ });
await client.publish('/cc/<sessionId>/events', [{ type: 'hello', memberId: 'm1', t: Date.now() }]); // 1-5 events
client.onStatus(({ state, attempt, error }) => { /* connecting | connected | reconnecting | closed */ });
client.reconnect(); // throw the socket away and reconnect now (e.g. on visibilitychange -> visible)
client.close();
```

Behaviour:
- `connection_init` / `connection_ack`; the `connectionTimeoutMs` from the ack (capped at `maxKeepAliveMs`, default 120 s, because AppSync's 300 s would hide a dead socket for 5 minutes) arms a keep-alive timer that any message (`ka`, data, ...) resets. Expiry closes the socket and reconnects.
- A publish with no `publish_success` within `publishTimeoutMs` is treated as a dead connection: the socket is dropped and in-flight publishes are recovered as on any disconnect (resent up to 3 attempts in total, then rejected with `timed out`).
- `subscribe_error`, or no `subscribe_success` in time, retries that subscription with backoff.
- `reconnect()` replaces the socket immediately (no backoff) and is a no-op after `close()`.
- Reconnect forever with jittered exponential backoff (`backoffDelay`: 250 ms base, cap 5 s, delay in [cap/2, cap]); the attempt counter resets on the next ack. All channels are resubscribed.
- `publish(channel, events, { ephemeral? })` is queued while not connected. Ephemeral publishes (default: channels ending in `/pose`, or per call) older than `ephemeralMaxAgeMs` (1 s) are dropped at flush time. The queue is bounded (`maxQueue`, default 60): the oldest ephemeral (`/pose`) publishes are dropped first (their promise rejects with `dropped: ...`). After a disconnect, un-acked non-ephemeral publishes are resent (at-least-once, so consumers should dedupe by rep/set index); ephemeral ones are rejected.
- Nothing throws after creation: socket errors, `subscribe_error`, malformed events and listener exceptions are reported through `onStatus({ error })`.

Test: `npm test` (vitest, fake WebSocket + fake timers, no network).
