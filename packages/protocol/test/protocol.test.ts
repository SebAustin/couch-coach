import { describe, expect, it } from 'vitest';
import {
  channels,
  CoachMessage,
  CoachRequest,
  decodeFrame,
  encodeFrame,
  KEYPOINT_COUNT,
  PhoneEvent,
  PoseBatch,
  SessionResponse,
} from '../src/index';

const pose = Array.from({ length: KEYPOINT_COUNT }, (_, i) => ({
  x: i / 100,
  y: 1 - i / 100,
  visibility: 0.9,
}));

describe('pose frames', () => {
  it('round-trips a pose through the compact frame encoding to 3 decimals', () => {
    const frame = encodeFrame(pose, 1234);
    const decoded = decodeFrame(frame);
    expect(decoded.t).toBe(1234);
    expect(decoded.pose).toHaveLength(KEYPOINT_COUNT);
    expect(decoded.pose[5]).toEqual({ x: 0.05, y: 0.95, visibility: 0.9 });
  });

  it('rejects a batch whose frame has the wrong number of values', () => {
    const bad = { type: 'pose', frames: [{ t: 1, k: [0.1, 0.2] }] };
    expect(PoseBatch.safeParse(bad).success).toBe(false);
  });

  it('accepts a batch of three encoded frames', () => {
    const batch = { type: 'pose', frames: [1, 2, 3].map((t) => encodeFrame(pose, t)) };
    expect(PoseBatch.parse(batch).frames).toHaveLength(3);
  });
});

describe('live motion on pose frames', () => {
  it('round-trips depth, phase and target, rounded to 0.01', () => {
    const frame = encodeFrame(pose, 7, { depth: 0.4267, phase: 'active', target: 0.4 });
    expect(PoseBatch.parse({ type: 'pose', frames: [frame] }).frames[0]!.motion).toEqual({
      depth: 0.43,
      phase: 'active',
      target: 0.4,
    });
  });

  it('keeps frames without motion (older phones)', () => {
    const parsed = PoseBatch.parse({ type: 'pose', frames: [encodeFrame(pose, 1)] });
    expect(parsed.frames[0]!.motion).toBeUndefined();
  });

  it('drops a malformed motion value but keeps the pose batch', () => {
    const frame = { ...encodeFrame(pose, 1), motion: { depth: 2, phase: 'flying', target: 0.4 } };
    const parsed = PoseBatch.safeParse({ type: 'pose', frames: [frame] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.frames[0]!.motion).toBeUndefined();
  });
});

describe('phone events', () => {
  it('parses a rep event with faults', () => {
    const e = PhoneEvent.parse({
      type: 'rep',
      exercise: 'squat',
      index: 3,
      score: 75,
      faults: ['knees_caving'],
      t: 10,
    });
    expect(e.type).toBe('rep');
  });

  it('parses a hello with the camera aspect ratio', () => {
    const e = PhoneEvent.parse({ type: 'hello', memberId: 'm1', aspect: 9 / 16, t: 1 });
    expect(e.type === 'hello' && e.aspect).toBeCloseTo(0.5625);
  });

  it('parses a presence heartbeat without a person in frame', () => {
    const e = PhoneEvent.parse({ type: 'presence', person: false, t: 1 });
    expect(e.type === 'presence' && e.person).toBe(false);
  });

  it('rejects an unknown exercise', () => {
    expect(
      PhoneEvent.safeParse({ type: 'set_start', exercise: 'burpee', t: 1 }).success,
    ).toBe(false);
  });

  it('rejects a score above 100', () => {
    expect(
      PhoneEvent.safeParse({
        type: 'rep',
        exercise: 'squat',
        index: 1,
        score: 101,
        faults: [],
        t: 1,
      }).success,
    ).toBe(false);
  });
});

describe('coach and session contracts', () => {
  it('parses a coach request with a set summary', () => {
    const req = CoachRequest.parse({
      sessionId: 'a'.repeat(32),
      token: 'tok',
      set: { exercise: 'squat', reps: 5, score: 82, faults: { shallow_depth: 2 }, durationMs: 20000 },
    });
    expect(req.set.reps).toBe(5);
  });

  it('rejects a session id that is not 32 hex chars', () => {
    expect(
      CoachRequest.safeParse({
        sessionId: 'nope',
        token: 't',
        set: { exercise: 'squat', reps: 1, score: 1, faults: {}, durationMs: 1 },
      }).success,
    ).toBe(false);
  });

  it('parses a cue without audio', () => {
    const msg = CoachMessage.parse({ type: 'cue', text: 'Nice set', setIndex: 1, t: 5 });
    expect(msg.type === 'cue' && msg.text).toBe('Nice set');
  });

  it('parses a session response', () => {
    const r = SessionResponse.parse({
      sessionId: 'b'.repeat(32),
      phoneToken: 'x.y',
      phoneUrl: 'https://example.com/?s=1',
      expiresAt: 99,
      memberId: 'm1',
    });
    expect(r.memberId).toBe('m1');
  });

  it('builds per-session channel names', () => {
    expect(channels('abc')).toEqual({
      pose: '/cc/abc/pose',
      events: '/cc/abc/events',
      coach: '/coach/abc',
    });
  });
});
