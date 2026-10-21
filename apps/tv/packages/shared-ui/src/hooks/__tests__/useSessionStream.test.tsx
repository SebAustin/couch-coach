import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { COACH_TIMEOUT_MS, END_PUBLISH_TIMEOUT_MS, QUIET_CARD_MS, useSessionStream, type SessionStream } from '../useSessionStream';
import type { EventsClient, EventsStatus } from '../../vendor/events-client';
import { channels, encodeFrame, KEYPOINT_COUNT } from '../../vendor/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION = 'ab'.repeat(16);
const CONFIG = { eventsHttpHost: 'h.example', eventsRealtimeHost: 'r.example', eventsApiKey: 'k' };

function fakeClient() {
  const listeners = new Map<string, (event: unknown) => void>();
  let statusCb: (s: EventsStatus) => void = () => undefined;
  const client: EventsClient = {
    subscribe: jest.fn((channel: string, cb: (event: unknown) => void) => {
      listeners.set(channel, cb);
      return () => listeners.delete(channel);
    }),
    publish: jest.fn(() => Promise.resolve()),
    onStatus: jest.fn((cb: (s: EventsStatus) => void) => {
      statusCb = cb;
      cb({ state: 'connected', attempt: 0 });
      return () => undefined;
    }),
    close: jest.fn(),
    reconnect: jest.fn(),
  } as EventsClient & { reconnect: jest.Mock };
  return { client, emit: (channel: string, event: unknown) => listeners.get(channel)?.(event), setStatus: (s: EventsStatus) => statusCb(s) };
}

const mounted: TestRenderer.ReactTestRenderer[] = [];

function mount(sessionId: string | null, fake = fakeClient(), now = () => 1_000_000) {
  const out: { current: SessionStream | null } = { current: null };
  function Harness({ id }: { id: string | null }) {
    out.current = useSessionStream(id, { config: CONFIG, createClient: () => fake.client, now });
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness id={sessionId} />);
  });
  mounted.push(renderer);
  return { out, fake, renderer, Harness };
}

const pose = Array.from({ length: KEYPOINT_COUNT }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));

describe('useSessionStream', () => {
  afterEach(() => {
    // Unmount so pending Coach timers (12 s) never outlive a test.
    act(() => {
      while (mounted.length) {
        try {
          mounted.pop()!.unmount();
        } catch {
          /* already unmounted by the test */
        }
      }
    });
    jest.useRealTimers();
  });

  it('subscribes to the three Session channels and closes the client on unmount', () => {
    const { fake, renderer } = mount(SESSION);
    const ch = channels(SESSION);
    expect((fake.client.subscribe as jest.Mock).mock.calls.map((c) => c[0]).sort()).toEqual([ch.coach, ch.events, ch.pose].sort());
    act(() => renderer.unmount());
    expect(fake.client.close).toHaveBeenCalled();
  });

  it('does not connect without a Session', () => {
    const { fake } = mount(null);
    expect(fake.client.subscribe).not.toHaveBeenCalled();
  });

  it('folds phone events into state and ignores malformed ones', () => {
    const { out, fake } = mount(SESSION);
    const ch = channels(SESSION);
    act(() => fake.emit(ch.events, { type: 'hello', memberId: 'm1', aspect: 0.75, t: 1 }));
    expect(out.current!.state.hasPhone).toBe(true);
    expect(out.current!.state.aspect).toBe(0.75);
    act(() => fake.emit(ch.events, { type: 'rep', nonsense: true }));
    expect(out.current!.telemetry.current.invalidMessages).toBe(1);
  });

  it('buffers pose frames outside React state and records telemetry', () => {
    const { out, fake } = mount(SESSION, undefined, () => 1_700_000_000_500);
    const batch = { type: 'pose', frames: [encodeFrame(pose, 1_700_000_000_300), encodeFrame(pose, 1_700_000_000_366)] };
    act(() => fake.emit(channels(SESSION).pose, batch));
    expect(out.current!.buffer.stats().frames).toBe(2);
    expect(out.current!.telemetry.current.poseBatches).toBe(1);
    expect(out.current!.telemetry.current.receiveLatencyMs).toBe(134);
  });

  it('marks the phone as joined on the first valid PoseBatch, even if hello was missed', () => {
    const { out, fake } = mount(SESSION);
    expect(out.current!.state.hasPhone).toBe(false);
    act(() => fake.emit(channels(SESSION).pose, { type: 'pose', frames: [] })); // invalid: min 1 frame
    expect(out.current!.state.hasPhone).toBe(false);
    act(() => fake.emit(channels(SESSION).pose, { type: 'pose', frames: [encodeFrame(pose, 12345)] }));
    expect(out.current!.state.hasPhone).toBe(true);
  });

  it('reports a null latency when the phone clock is not epoch ms', () => {
    const { out, fake } = mount(SESSION);
    act(() => fake.emit(channels(SESSION).pose, { type: 'pose', frames: [encodeFrame(pose, 12345)] }));
    expect(out.current!.telemetry.current.receiveLatencyMs).toBeNull();
  });

  it('publishes control end_session on the events channel', async () => {
    const { out, fake } = mount(SESSION, undefined, () => 42);
    await act(async () => {
      await out.current!.endSession();
    });
    expect(fake.client.publish).toHaveBeenCalledWith(channels(SESSION).events, [{ type: 'control', action: 'end_session', t: 42 }]);
  });

  it('never blocks the Recap when the end_session publish fails', async () => {
    const fake = fakeClient();
    (fake.client.publish as jest.Mock).mockRejectedValue(new Error('offline'));
    const { out } = mount(SESSION, fake);
    await act(async () => {
      await expect(out.current!.endSession()).resolves.toBeUndefined();
    });
  });

  it('counts phone events, poses and presence as phone signals, but not Coach messages', () => {
    let clock = 1_000;
    const { out, fake } = mount(SESSION, undefined, () => clock);
    const ch = channels(SESSION);
    expect(out.current!.telemetry.current.lastSignalAt).toBe(0);
    clock = 2_000;
    act(() => fake.emit(ch.events, { type: 'presence', person: false, t: 1 }));
    expect(out.current!.telemetry.current.lastSignalAt).toBe(2_000);
    expect(out.current!.state.personPresent).toBe(false);
    clock = 3_000;
    act(() => fake.emit(ch.pose, { type: 'pose', frames: [encodeFrame(pose, 5)] }));
    expect(out.current!.telemetry.current.lastSignalAt).toBe(3_000);
    clock = 4_000;
    act(() => fake.emit(ch.coach, { type: 'thinking', setIndex: 1, t: 1 }));
    expect(out.current!.telemetry.current.lastSignalAt).toBe(3_000);
  });

  it('keeps the client open until the end_session publish settles, even after unmount', async () => {
    const fake = fakeClient();
    let settle!: () => void;
    (fake.client.publish as jest.Mock).mockReturnValue(new Promise<void>((resolve) => { settle = resolve; }));
    const { out, renderer } = mount(SESSION, fake);
    let ended!: Promise<void>;
    act(() => {
      ended = out.current!.endSession();
    });
    act(() => out.current!.close()); // the Recap is showing; close() must wait for the publish
    act(() => renderer.unmount()); // ...and so must unmount cleanup
    expect(fake.client.close).not.toHaveBeenCalled();
    await act(async () => {
      settle();
      await ended;
    });
    expect(fake.client.close).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting for the end_session publish after 5 s and then closes', async () => {
    jest.useFakeTimers();
    const fake = fakeClient();
    (fake.client.publish as jest.Mock).mockReturnValue(new Promise<void>(() => undefined));
    const { out } = mount(SESSION, fake);
    let ended!: Promise<void>;
    act(() => {
      ended = out.current!.endSession();
    });
    act(() => out.current!.close());
    expect(fake.client.close).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(END_PUBLISH_TIMEOUT_MS + 10);
      await ended;
    });
    expect(fake.client.close).toHaveBeenCalledTimes(1);
  });

  it('closes immediately when nothing is pending', () => {
    const { out, fake } = mount(SESSION);
    act(() => out.current!.close());
    expect(fake.client.close).toHaveBeenCalledTimes(1);
  });

  it('asks the events client to reconnect when it supports it, and tolerates older clients', () => {
    const { out, fake } = mount(SESSION);
    act(() => out.current!.reconnect());
    expect((fake.client as unknown as { reconnect: jest.Mock }).reconnect).toHaveBeenCalledTimes(1);
    const old = fakeClient();
    delete (old.client as { reconnect?: unknown }).reconnect;
    const m = mount(SESSION, old);
    expect(() => act(() => m.out.current!.reconnect())).not.toThrow();
  });

  it('turns an unanswered thinking state into quiet after 12 s, then hides the card after 8 s', () => {
    jest.useFakeTimers();
    const { out, fake } = mount(SESSION);
    act(() => fake.emit(channels(SESSION).coach, { type: 'thinking', setIndex: 1, t: 1 }));
    expect(out.current!.state.coach.status).toBe('thinking');
    act(() => jest.advanceTimersByTime(COACH_TIMEOUT_MS + 10));
    expect(out.current!.state.coach.status).toBe('quiet');
    act(() => jest.advanceTimersByTime(QUIET_CARD_MS + 10));
    expect(out.current!.state.coach.status).toBe('none');
  });

  it('keeps a Cue on screen until dismissed', () => {
    jest.useFakeTimers();
    const { out, fake } = mount(SESSION);
    act(() => fake.emit(channels(SESSION).coach, { type: 'cue', text: 'Nice work', setIndex: 1, t: 1 }));
    act(() => jest.advanceTimersByTime(60_000));
    expect(out.current!.state.coach.status).toBe('cue');
    act(() => out.current!.dismissCue());
    expect(out.current!.state.coach.status).toBe('none');
  });

  it('exposes the socket status', () => {
    const { out, fake } = mount(SESSION);
    act(() => fake.setStatus({ state: 'reconnecting', attempt: 2, error: 'socket closed' }));
    expect(out.current!.connection.state).toBe('reconnecting');
  });
});
