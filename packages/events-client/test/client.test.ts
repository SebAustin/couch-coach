import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventsClient, type EventsStatus } from '../src/index';
import { FakeWebSocket } from './fake-websocket';

const OPTS = {
  httpHost: 'abc.appsync-api.us-east-1.amazonaws.com',
  realtimeHost: 'abc.appsync-realtime-api.us-east-1.amazonaws.com',
  apiKey: 'da2-key',
};

function make(extra: Record<string, unknown> = {}) {
  return createEventsClient({ ...OPTS, WebSocketImpl: FakeWebSocket as never, random: () => 1, ...extra });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('handshake', () => {
  it('connects to the realtime endpoint with the AppSync subprotocols and sends connection_init', () => {
    make();
    const ws = FakeWebSocket.last;
    expect(ws.url).toBe(`wss://${OPTS.realtimeHost}/event/realtime`);
    const protocols = ws.protocols as string[];
    expect(protocols[0]).toBe('aws-appsync-event-ws');
    const header = Buffer.from(protocols[1]!.replace('header-', ''), 'base64url').toString('utf8');
    expect(JSON.parse(header)).toEqual({ host: OPTS.httpHost, 'x-api-key': OPTS.apiKey });
    ws.serverOpen();
    expect(ws.sent).toEqual([{ type: 'connection_init' }]);
  });

  it('reports connecting then connected after connection_ack', () => {
    const client = make();
    const states: EventsStatus['state'][] = [];
    client.onStatus((s) => states.push(s.state));
    FakeWebSocket.last.ack();
    expect(states).toEqual(['connecting', 'connected']);
  });
});

describe('subscribe', () => {
  it('subscribes after the ack and delivers parsed events', () => {
    const client = make();
    const got: unknown[] = [];
    client.subscribe('/cc/s1/pose', (e) => got.push(e));
    const ws = FakeWebSocket.last;
    expect(ws.sentOfType('subscribe')).toHaveLength(0); // not before the ack
    ws.ack();
    const [sub] = ws.sentOfType('subscribe');
    expect(sub).toMatchObject({
      channel: '/cc/s1/pose',
      authorization: { host: OPTS.httpHost, 'x-api-key': OPTS.apiKey },
    });
    ws.serverSend({ type: 'subscribe_success', id: sub!.id });
    ws.serverSend({ type: 'data', id: sub!.id, event: JSON.stringify({ type: 'pose', n: 1 }) });
    expect(got).toEqual([{ type: 'pose', n: 1 }]);
  });

  it('stops delivering and sends unsubscribe once the last listener leaves', () => {
    const client = make();
    const got: unknown[] = [];
    const off = client.subscribe('/cc/s1/events', (e) => got.push(e));
    const ws = FakeWebSocket.last;
    ws.ack();
    const [sub] = ws.sentOfType('subscribe');
    off();
    expect(ws.sentOfType('unsubscribe')).toEqual([{ type: 'unsubscribe', id: sub!.id }]);
    ws.serverSend({ type: 'data', id: sub!.id, event: '{"a":1}' });
    expect(got).toEqual([]);
  });

  it('shares one wire subscription between listeners on the same channel', () => {
    const client = make();
    const a: unknown[] = [];
    const b: unknown[] = [];
    client.subscribe('/cc/s1/coach', (e) => a.push(e));
    client.subscribe('/cc/s1/coach', (e) => b.push(e));
    const ws = FakeWebSocket.last;
    ws.ack();
    const subs = ws.sentOfType('subscribe');
    expect(subs).toHaveLength(1);
    ws.serverSend({ type: 'data', id: subs[0]!.id, event: '{"x":2}' });
    expect(a).toEqual([{ x: 2 }]);
    expect(b).toEqual([{ x: 2 }]);
  });

  it('surfaces subscribe_error and malformed events via onStatus instead of throwing', () => {
    const client = make();
    const errors: string[] = [];
    client.onStatus((s) => s.error && errors.push(s.error));
    client.subscribe('/cc/s1/pose', () => {});
    const ws = FakeWebSocket.last;
    ws.ack();
    const [sub] = ws.sentOfType('subscribe');
    ws.serverSend({ type: 'subscribe_error', id: sub!.id, errors: [{ errorType: 'UnauthorizedException', message: 'nope' }] });
    expect(() => ws.serverSend({ type: 'data', id: sub!.id, event: 'not json' })).not.toThrow();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('UnauthorizedException');
  });

  it('isolates a throwing listener from the others', () => {
    const client = make();
    const got: unknown[] = [];
    client.subscribe('/c', () => {
      throw new Error('boom');
    });
    client.subscribe('/c', (e) => got.push(e));
    const ws = FakeWebSocket.last;
    ws.ack();
    ws.serverSend({ type: 'data', id: ws.sentOfType('subscribe')[0]!.id, event: '1' });
    expect(got).toEqual([1]);
  });
});

describe('publish', () => {
  it('sends events as JSON strings and resolves on publish_success', async () => {
    const client = make();
    const ws = FakeWebSocket.last;
    ws.ack();
    const p = client.publish('/cc/s1/events', [{ type: 'hello' }, { type: 'rep' }]);
    const [msg] = ws.sentOfType('publish');
    expect(msg).toMatchObject({
      channel: '/cc/s1/events',
      events: ['{"type":"hello"}', '{"type":"rep"}'],
      authorization: { host: OPTS.httpHost, 'x-api-key': OPTS.apiKey },
    });
    ws.serverSend({ type: 'publish_success', id: msg!.id, successful: [], failed: [] });
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects on publish_error and on failed events', async () => {
    const client = make();
    const ws = FakeWebSocket.last;
    ws.ack();
    const p1 = client.publish('/c', [{}]);
    ws.serverSend({ type: 'publish_error', id: ws.sentOfType('publish')[0]!.id, errors: [{ errorType: 'X', message: 'bad' }] });
    await expect(p1).rejects.toThrow(/bad/);
    const p2 = client.publish('/c', [{}]);
    ws.serverSend({ type: 'publish_success', id: ws.sentOfType('publish')[1]!.id, successful: [], failed: [{ identifier: 'a', index: 0 }] });
    await expect(p2).rejects.toThrow(/failed/);
  });

  it('treats a missing publish ack as a dead connection: drops the socket and resends the publish', async () => {
    const client = make({ publishTimeoutMs: 1000 });
    const first = FakeWebSocket.last;
    first.ack();
    const p = client.publish('/cc/s/events', [{ type: 'rep' }]);
    await vi.advanceTimersByTimeAsync(1001);
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    const second = FakeWebSocket.last;
    expect(second).not.toBe(first);
    second.ack();
    const [resent] = second.sentOfType('publish');
    expect(resent!.events).toEqual(['{"type":"rep"}']);
    second.serverSend({ type: 'publish_success', id: resent!.id, successful: [], failed: [] });
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects an ephemeral publish whose ack never arrives and still drops the connection', async () => {
    const client = make({ publishTimeoutMs: 1000 });
    const first = FakeWebSocket.last;
    first.ack();
    const p = client.publish('/cc/s/pose', [{ n: 1 }]);
    const assertion = expect(p).rejects.toThrow(/connection lost/);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(first.closed).toBe(true);
  });

  it('gives up on a publish after 3 unacknowledged attempts', async () => {
    const client = make({ publishTimeoutMs: 1000 });
    FakeWebSocket.last.ack();
    const p = client.publish('/cc/s/events', [{}]);
    const assertion = expect(p).rejects.toThrow(/timed out/);
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1001); // attempt times out
      await vi.advanceTimersByTimeAsync(250); // reconnect
      FakeWebSocket.last.ack(); // new socket acks but never acknowledges the publish
    }
    await assertion;
  });

  it('rejects empty or oversized (>5) event lists', async () => {
    const client = make();
    await expect(client.publish('/c', [])).rejects.toThrow();
    await expect(client.publish('/c', [1, 2, 3, 4, 5, 6])).rejects.toThrow();
  });
});
