import { useCallback, useEffect, useReducer, useRef, useState, type MutableRefObject } from 'react';
import { config as defaultConfig } from '../config';
import { FrameBuffer, looksLikeEpochMs } from '../lib/frameBuffer';
import { initialLiveState, liveReducer, type LiveState } from '../lib/liveState';
import { createEventsClient, type EventsClient, type EventsClientOptions, type EventsStatus } from '../vendor/events-client';
import { channels, CoachMessage, PhoneEvent, PoseBatch, type ClientConfig } from '../vendor/protocol';

/** No Cue within this long after `thinking` shows the "Coach is quiet" card (docs/ux.md 2.3). */
export const COACH_TIMEOUT_MS = 12_000;
/** The "Coach is quiet" card hides itself after this long. */
export const QUIET_CARD_MS = 8_000;
/** Max time to wait for the TV's own `end_session` publish before showing the Recap anyway. */
const END_PUBLISH_TIMEOUT_MS = 2_000;

export interface Telemetry {
  /** TV clock (ms) when the last PoseBatch arrived; 0 before the first. */
  lastPoseAt: number;
  /** TV clock (ms) of the last event of any kind. */
  lastEventAt: number;
  /** now - frame.t at arrival (negative or large values mean the TV and phone clocks disagree), or null when t is not epoch ms. */
  receiveLatencyMs: number | null;
  poseBatches: number;
  invalidMessages: number;
}

export interface SessionStream {
  state: LiveState;
  connection: EventsStatus;
  /** Jitter buffer the skeleton renders from. Stable for the life of the Session. */
  buffer: FrameBuffer;
  /** Mutable counters read by the render loop and debug overlay; never trigger renders. */
  telemetry: MutableRefObject<Telemetry>;
  dismissCue(): void;
  /** Tells the phone (best effort) that the TV ended the Session. */
  endSession(): Promise<void>;
  close(): void;
}

export interface SessionStreamOptions {
  config?: Pick<ClientConfig, 'eventsHttpHost' | 'eventsRealtimeHost' | 'eventsApiKey'>;
  createClient?: (options: EventsClientOptions) => EventsClient;
  now?: () => number;
}

const INITIAL_STATUS: EventsStatus = { state: 'connecting', attempt: 0 };
const newTelemetry = (): Telemetry => ({
  lastPoseAt: 0,
  lastEventAt: 0,
  receiveLatencyMs: null,
  poseBatches: 0,
  invalidMessages: 0,
});

/**
 * Subscribes to a Session's three channels and folds them into UI state. High-rate pose data goes to the
 * FrameBuffer (outside React state); everything else goes through `liveReducer`.
 */
export function useSessionStream(sessionId: string | null, options: SessionStreamOptions = {}): SessionStream {
  const { config = defaultConfig, createClient = createEventsClient, now = Date.now } = options;
  const [state, dispatch] = useReducer(liveReducer, initialLiveState);
  const [connection, setConnection] = useState<EventsStatus>(INITIAL_STATUS);
  const bufferRef = useRef<FrameBuffer>(new FrameBuffer());
  const telemetry = useRef<Telemetry>(newTelemetry());
  const clientRef = useRef<EventsClient | null>(null);
  const sessionRef = useRef<string | null>(sessionId);
  sessionRef.current = sessionId;

  useEffect(() => {
    bufferRef.current.reset();
    telemetry.current = newTelemetry();
    dispatch({ kind: 'reset' });
    setConnection(INITIAL_STATUS);
    if (!sessionId) return undefined;

    const client = createClient({
      httpHost: config.eventsHttpHost,
      realtimeHost: config.eventsRealtimeHost,
      apiKey: config.eventsApiKey,
    });
    clientRef.current = client;
    const ch = channels(sessionId);
    const reject = () => {
      telemetry.current.invalidMessages += 1;
    };

    const offStatus = client.onStatus(setConnection);
    const offEvents = client.subscribe(ch.events, (raw) => {
      const parsed = PhoneEvent.safeParse(raw);
      if (!parsed.success) return reject();
      telemetry.current.lastEventAt = now();
      dispatch({ kind: 'phone', event: parsed.data });
    });
    const offCoach = client.subscribe(ch.coach, (raw) => {
      const parsed = CoachMessage.safeParse(raw);
      if (!parsed.success) return reject();
      telemetry.current.lastEventAt = now();
      dispatch({ kind: 'coach', message: parsed.data });
    });
    const offPose = client.subscribe(ch.pose, (raw) => {
      const parsed = PoseBatch.safeParse(raw);
      if (!parsed.success) return reject();
      const arrival = now();
      const newest = parsed.data.frames[parsed.data.frames.length - 1]!;
      bufferRef.current.pushBatch(parsed.data, arrival);
      const t = telemetry.current;
      t.lastPoseAt = arrival;
      t.lastEventAt = arrival;
      t.poseBatches += 1;
      t.receiveLatencyMs = looksLikeEpochMs(newest.t) ? arrival - newest.t : null;
    });

    return () => {
      offPose();
      offCoach();
      offEvents();
      offStatus();
      client.close();
      if (clientRef.current === client) clientRef.current = null;
    };
    // The client is intentionally recreated only when the Session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Coach timeouts: thinking -> quiet after 12 s; the quiet card hides after 8 s.
  useEffect(() => {
    if (state.coach.status === 'thinking') {
      const id = setTimeout(() => dispatch({ kind: 'coach_timeout' }), COACH_TIMEOUT_MS);
      return () => clearTimeout(id);
    }
    if (state.coach.status === 'quiet') {
      const id = setTimeout(() => dispatch({ kind: 'dismiss_cue' }), QUIET_CARD_MS);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [state.coach]);

  const dismissCue = useCallback(() => dispatch({ kind: 'dismiss_cue' }), []);

  const endSession = useCallback(async () => {
    const client = clientRef.current;
    const id = sessionRef.current;
    if (!client || !id) return;
    const event: PhoneEvent = { type: 'control', action: 'end_session', t: now() };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, END_PUBLISH_TIMEOUT_MS);
    });
    try {
      await Promise.race([client.publish(channels(id).events, [event]), timeout]);
    } catch {
      // The phone also ends on its own when the TV goes quiet; never block the Recap on this.
    } finally {
      clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;
  }, []);

  return { state, connection, buffer: bufferRef.current, telemetry, dismissCue, endSession, close };
}
