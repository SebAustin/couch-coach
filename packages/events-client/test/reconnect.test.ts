import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, createEventsClient, type EventsStatus } from '../src/index';
import { FakeWebSocket } from './fake-websocket';

const OPTS = { httpHost: 'h.example', realtimeHost: 'r.example', apiKey: 'k' };

function make(extra: Record<string, unknown> = {}) {
  return createEventsClient({ ...OPTS, WebSocketImpl: FakeWebSocket as never, random: () => 1, ...extra });
}
const socketCount = () => FakeWebSocket.instances.length;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('backoffDelay', () => {
  it('stays within [cap/2, cap] and never exceeds the configured maximum', () => {
    const base = 250;
    const max = 5000;
    for (let attempt = 0; attempt < 20; attempt++) {
      const cap = Math.min(max, base * 2 ** attempt);
      for (const r of [0, 0.25, 0.5, 0.999]) {
        const d = backoffDelay(attempt, base, max, () => r);
        expect(d).toBeGreaterThanOrEqual(cap / 2);
        expect(d).toBeLessThanOrEqual(cap);
        expect(d).toBeLessThanOrEqual(max);
      }
    }
  });

  it('grows exponentially before reaching the cap', () => {
    const at = (n: number) => backoffDelay(n, 250, 5000, () => 1);
    expect([at(0), at(1), at(2), at(3), at(4), at(5), at(9)]).toEqual([250, 500, 1000, 2000, 4000, 5000, 5000]);
  });
});

describe('reconnect', () => {
  it('reconnects with growing delays after the socket drops, and resets after a successful handshake', () => {
    const client = make();
    const states: EventsStatus['state'][] = [];
    client.onStatus((s) => states.push(s.state));
    FakeWebSocket.last.ack();
    FakeWebSocket.last.serverClose();
    expect(states.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(249);
    expect(socketCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(socketCount()).toBe(2);
    // second consecutive failure waits longer (500 ms)
    FakeWebSocket.last.serverClose();
    vi.advanceTimersByTime(499);
    expect(socketCount()).toBe(2);
    vi.advanceTimersByTime(1);
    expect(socketCount()).toBe(3);
    // success resets the attempt counter
    FakeWebSocket.last.ack();
    expect(states.at(-1)).toBe('connected');
    FakeWebSocket.last.serverClose();
    vi.advanceTimersByTime(250);
    expect(socketCount()).toBe(4);
  });

  it('resubscribes every channel after reconnecting and keeps delivering to the same listeners', () => {
    const client = make();
    const got: unknown[] = [];
    client.subscribe('/cc/s/pose', (e) => got.push(['pose', e]));
    client.subscribe('/cc/s/coach', (e) => got.push(['coach', e]));
    FakeWebSocket.last.ack();
    FakeWebSocket.last.serverClose();
    vi.advanceTimersByTime(250);
    const ws = FakeWebSocket.last;
    ws.ack();
    const subs = ws.sentOfType('subscribe');
    expect(subs.map((s) => s.channel).sort()).toEqual(['/cc/s/coach', '/cc/s/pose']);
    const coach = subs.find((s) => s.channel === '/cc/s/coach')!;
    ws.serverSend({ type: 'data', id: coach.id, event: '{"type":"cue"}' });
    expect(got).toEqual([['coach', { type: 'cue' }]]);
  });

  it('recovers and resubscribes within 5 s of a drop using default backoff (SC6)', () => {
    const client = make({ random: Math.random });
    client.subscribe('/cc/s/pose', () => {});
    FakeWebSocket.last.ack();
    FakeWebSocket.last.serverClose();
    // two more failed attempts in a row, then success
    vi.advanceTimersByTime(250);
    FakeWebSocket.last.serverClose();
    vi.advanceTimersByTime(500);
    FakeWebSocket.last.serverClose();
    vi.advanceTimersByTime(1000);
    const ws = FakeWebSocket.last;
    ws.ack();
    expect(ws.sentOfType('subscribe')).toHaveLength(1);
  });

  it('ignores events from a socket that has been replaced', () => {
    const client = make();
    const got: unknown[] = [];
    client.subscribe('/c', (e) => got.push(e));
    const old = FakeWebSocket.last;
    old.ack();
    old.serverClose();
    vi.advanceTimersByTime(250);
    old.serverSend({ type: 'data', id: old.sentOfType('subscribe')[0]!.id, event: '1' });
    old.serverClose();
    vi.advanceTimersByTime(5_000); // shorter than the handshake timeout
    expect(got).toEqual([]);
    expect(socketCount()).toBe(2); // the stale close did not schedule another reconnect
  });

  it('surfaces socket errors via onStatus without throwing', () => {
    const client = make();
    const errors: string[] = [];
    client.onStatus((s) => s.error && errors.push(s.error));
    const ws = FakeWebSocket.last;
    expect(() => ws.onerror?.({ message: 'ECONNREFUSED' })).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});

describe('keep-alive', () => {
  it('reconnects when no message arrives within connectionTimeoutMs', () => {
    make();
    FakeWebSocket.last.ack(1000);
    vi.advanceTimersByTime(999);
    expect(socketCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances[0]!.closed).toBe(true);
    vi.advanceTimersByTime(250);
    expect(socketCount()).toBe(2);
  });

  it('keeps the connection alive while ka messages arrive', () => {
    make();
    const ws = FakeWebSocket.last;
    ws.ack(1000);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(900);
      ws.serverSend({ type: 'ka' });
    }
    expect(ws.closed).toBe(false);
    expect(socketCount()).toBe(1);
  });

  it('resubscribes after a keep-alive timeout', () => {
    const client = make();
    client.subscribe('/c', () => {});
    FakeWebSocket.last.ack(1000);
    vi.advanceTimersByTime(1000 + 250);
    const ws = FakeWebSocket.last;
    expect(ws).not.toBe(FakeWebSocket.instances[0]);
    ws.ack();
    expect(ws.sentOfType('subscribe')).toHaveLength(1);
  });

  it('retries when the handshake never completes', () => {
    make({ handshakeTimeoutMs: 2000 });
    FakeWebSocket.last.serverOpen(); // opened but no connection_ack
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances[0]!.closed).toBe(true);
    vi.advanceTimersByTime(250);
    expect(socketCount()).toBe(2);
  });
});

describe('close', () => {
  it('stops reconnecting, closes the socket and rejects later publishes', async () => {
    const client = make();
    const states: EventsStatus['state'][] = [];
    client.onStatus((s) => states.push(s.state));
    FakeWebSocket.last.ack();
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(socketCount()).toBe(1);
    expect(states.at(-1)).toBe('closed');
    await expect(client.publish('/c', [{}])).rejects.toThrow(/closed/);
  });

  it('rejects publishes that are waiting for an ack', async () => {
    const client = make();
    FakeWebSocket.last.ack();
    const p = client.publish('/c', [{}]);
    client.close();
    await expect(p).rejects.toThrow(/closed/);
  });
});
