import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventsClient } from '../src/index';
import { FakeWebSocket } from './fake-websocket';

const OPTS = { httpHost: 'h.example', realtimeHost: 'r.example', apiKey: 'k' };
function make(extra: Record<string, unknown> = {}) {
  return createEventsClient({ ...OPTS, WebSocketImpl: FakeWebSocket as never, random: () => 1, ...extra });
}
const ackAll = (ws: FakeWebSocket) =>
  ws.sentOfType('publish').forEach((m) => ws.serverSend({ type: 'publish_success', id: m.id, successful: [], failed: [] }));
const settle = (p: Promise<void>) => p.then(() => 'ok', (e: Error) => e.message);

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('publish queue', () => {
  it('holds publishes made before the handshake and flushes them in order afterwards', async () => {
    const client = make();
    const ws = FakeWebSocket.last;
    const a = client.publish('/cc/s/events', [{ n: 1 }]);
    const b = client.publish('/cc/s/events', [{ n: 2 }]);
    ws.serverOpen();
    expect(ws.sentOfType('publish')).toHaveLength(0);
    ws.serverSend({ type: 'connection_ack', connectionTimeoutMs: 300_000 });
    expect(ws.sentOfType('publish').map((m) => m.events)).toEqual([['{"n":1}'], ['{"n":2}']]);
    ackAll(ws);
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
  });

  it('is bounded: drops the oldest pose batches first and keeps other events', async () => {
    const client = make({ maxQueue: 3 });
    const ws = FakeWebSocket.last;
    const pose1 = settle(client.publish('/cc/s/pose', [{ n: 1 }]));
    const rep = client.publish('/cc/s/events', [{ type: 'rep' }]);
    const pose2 = settle(client.publish('/cc/s/pose', [{ n: 2 }]));
    const pose3 = settle(client.publish('/cc/s/pose', [{ n: 3 }])); // 4th item: pose1 is dropped
    expect(await pose1).toMatch(/dropped/);
    ws.ack();
    const sent = ws.sentOfType('publish');
    expect(sent.map((m) => m.channel)).toEqual(['/cc/s/events', '/cc/s/pose', '/cc/s/pose']);
    ackAll(ws);
    await expect(rep).resolves.toBeUndefined();
    expect(await pose2).toBe('ok');
    expect(await pose3).toBe('ok');
  });

  it('drops the oldest event overall when nothing in the queue is ephemeral', async () => {
    const client = make({ maxQueue: 2 });
    const ws = FakeWebSocket.last;
    const first = settle(client.publish('/cc/s/events', [{ n: 1 }]));
    client.publish('/cc/s/events', [{ n: 2 }]).catch(() => {});
    client.publish('/cc/s/events', [{ n: 3 }]).catch(() => {});
    expect(await first).toMatch(/dropped/);
    ws.ack();
    expect(ws.sentOfType('publish').map((m) => m.events)).toEqual([['{"n":2}'], ['{"n":3}']]);
  });

  it('after a disconnect resends un-acked non-ephemeral publishes and rejects ephemeral ones', async () => {
    const client = make();
    const first = FakeWebSocket.last;
    first.ack();
    const rep = client.publish('/cc/s/events', [{ type: 'set_end' }]);
    const pose = settle(client.publish('/cc/s/pose', [{ n: 1 }]));
    first.serverClose();
    expect(await pose).toMatch(/connection lost/);
    vi.advanceTimersByTime(250);
    const second = FakeWebSocket.last;
    second.ack();
    expect(second.sentOfType('publish').map((m) => m.channel)).toEqual(['/cc/s/events']);
    ackAll(second);
    await expect(rep).resolves.toBeUndefined();
  });

  it('honours a custom isEphemeral predicate', async () => {
    const client = make({ maxQueue: 1, isEphemeral: (c: string) => c === '/low' });
    const low = settle(client.publish('/low', [{}]));
    client.publish('/high', [{}]).catch(() => {});
    expect(await low).toMatch(/dropped/);
  });
});

describe('stale pose batches', () => {
  it('drops queued ephemeral publishes older than 1 s at flush time but keeps fresh ones and events', async () => {
    const client = make();
    const ws = FakeWebSocket.last;
    const old = settle(client.publish('/cc/s/pose', [{ n: 1 }]));
    const event = client.publish('/cc/s/events', [{ type: 'rep' }]);
    vi.advanceTimersByTime(1500);
    const fresh = settle(client.publish('/cc/s/pose', [{ n: 2 }]));
    ws.ack();
    expect(await old).toMatch(/stale/);
    expect(ws.sentOfType('publish').map((m) => m.events)).toEqual([['{"type":"rep"}'], ['{"n":2}']]);
    ackAll(ws);
    await expect(event).resolves.toBeUndefined();
    expect(await fresh).toBe('ok');
  });

  it('keeps ephemeral publishes younger than the limit', () => {
    const client = make({ ephemeralMaxAgeMs: 2000 });
    const ws = FakeWebSocket.last;
    client.publish('/cc/s/pose', [{ n: 1 }]).catch(() => {});
    vi.advanceTimersByTime(1500);
    ws.ack();
    expect(ws.sentOfType('publish')).toHaveLength(1);
  });
});

describe('per-publish ephemeral override', () => {
  it('lets a caller mark a non-pose publish as ephemeral (e.g. a heartbeat) so it is never replayed late', async () => {
    const client = make();
    const first = FakeWebSocket.last;
    first.ack();
    const beat = settle(client.publish('/cc/s/events', [{ type: 'presence' }], { ephemeral: true }));
    first.serverClose();
    expect(await beat).toMatch(/connection lost/);
  });

  it('lets a caller mark a pose-channel publish as durable', async () => {
    const client = make();
    const first = FakeWebSocket.last;
    first.ack();
    const p = client.publish('/cc/s/pose', [{ n: 1 }], { ephemeral: false });
    first.serverClose();
    vi.advanceTimersByTime(250);
    FakeWebSocket.last.ack();
    expect(FakeWebSocket.last.sentOfType('publish')).toHaveLength(1);
    ackAll(FakeWebSocket.last);
    await expect(p).resolves.toBeUndefined();
  });
});
