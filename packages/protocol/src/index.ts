import { z } from 'zod';

/** MediaPipe Pose Landmarker returns 33 landmarks per frame. */
export const KEYPOINT_COUNT = 33;
/** Each landmark is sent as [x, y, visibility]. */
const VALUES_PER_KEYPOINT = 3;
const PRECISION = 1000;

export const Exercise = z.enum(['squat', 'jumping_jack']);
export type Exercise = z.infer<typeof Exercise>;

export interface Landmark {
  x: number;
  y: number;
  visibility: number;
}

const round = (n: number) => Math.round(n * PRECISION) / PRECISION;

/** One camera frame on the wire: capture time (ms) and flattened [x, y, visibility] * 33. */
export const PoseFrame = z.object({
  t: z.number(),
  k: z.array(z.number()).length(KEYPOINT_COUNT * VALUES_PER_KEYPOINT),
});
export type PoseFrame = z.infer<typeof PoseFrame>;

export function encodeFrame(pose: readonly Landmark[], t: number): PoseFrame {
  return {
    t,
    k: pose.flatMap((p) => [round(p.x), round(p.y), round(p.visibility)]),
  };
}

export function decodeFrame(frame: PoseFrame): { t: number; pose: Landmark[] } {
  const pose: Landmark[] = [];
  for (let i = 0; i < frame.k.length; i += VALUES_PER_KEYPOINT) {
    pose.push({ x: frame.k[i]!, y: frame.k[i + 1]!, visibility: frame.k[i + 2]! });
  }
  return { t: frame.t, pose };
}

/** Published on /cc/<sessionId>/pose, several frames per publish. */
export const PoseBatch = z.object({
  type: z.literal('pose'),
  frames: z.array(PoseFrame).min(1).max(10),
});
export type PoseBatch = z.infer<typeof PoseBatch>;

const Score = z.number().min(0).max(100);
const FaultCounts = z.record(z.string(), z.number().int().nonnegative());

export const SetSummary = z.object({
  exercise: Exercise,
  reps: z.number().int().nonnegative(),
  score: Score,
  faults: FaultCounts,
  durationMs: z.number().nonnegative(),
});
export type SetSummary = z.infer<typeof SetSummary>;

/** Published on /cc/<sessionId>/events by the Camera Phone; the TV also publishes `control: end_session` there. */
export const PhoneEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    memberId: z.string(),
    /** Camera frame aspect ratio (width / height) so the TV can lay out the skeleton. */
    aspect: z.number().positive().optional(),
    t: z.number(),
  }),
  z.object({ type: z.literal('set_start'), exercise: Exercise, t: z.number() }),
  z.object({
    type: z.literal('rep'),
    exercise: Exercise,
    index: z.number().int().positive(),
    score: Score,
    faults: z.array(z.string()),
    t: z.number(),
  }),
  z.object({ type: z.literal('set_end'), set: SetSummary, setIndex: z.number().int().positive(), t: z.number() }),
  z.object({
    type: z.literal('control'),
    action: z.enum(['pause', 'resume', 'end_session']),
    t: z.number(),
  }),
]);
export type PhoneEvent = z.infer<typeof PhoneEvent>;

/** Published on /cc/<sessionId>/coach by the coach Lambda. */
export const CoachMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('cue'),
    text: z.string().min(1).max(600),
    audioUrl: z.string().url().optional(),
    setIndex: z.number().int().positive(),
    t: z.number(),
  }),
  z.object({ type: z.literal('thinking'), setIndex: z.number().int().positive(), t: z.number() }),
]);
export type CoachMessage = z.infer<typeof CoachMessage>;

export const SessionId = z.string().regex(/^[0-9a-f]{32}$/);

/** POST /coach body. */
export const CoachRequest = z.object({
  sessionId: SessionId,
  token: z.string().min(1).max(512),
  setIndex: z.number().int().positive().default(1),
  set: SetSummary,
});
export type CoachRequest = z.infer<typeof CoachRequest>;

/** POST /session body and response. */
export const SessionRequest = z.object({ memberId: z.string().min(1).max(64) });
export type SessionRequest = z.infer<typeof SessionRequest>;

export const SessionResponse = z.object({
  sessionId: SessionId,
  phoneToken: z.string(),
  phoneUrl: z.string().url(),
  expiresAt: z.number(),
  memberId: z.string(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/** GET/POST /members. */
export const Member = z.object({
  memberId: z.string(),
  name: z.string().min(1).max(40),
  lastSeenAt: z.number().optional(),
});
export type Member = z.infer<typeof Member>;
export const CreateMemberRequest = z.object({ name: z.string().trim().min(1).max(40) });

export function channels(sessionId: string) {
  const base = `/cc/${sessionId}`;
  return { pose: `${base}/pose`, events: `${base}/events`, coach: `${base}/coach` };
}

/** Runtime configuration shared by the phone and TV; written from CDK outputs. */
export const ClientConfig = z.object({
  apiBaseUrl: z.string().url(),
  eventsHttpHost: z.string(),
  eventsRealtimeHost: z.string(),
  eventsApiKey: z.string(),
  phoneUrl: z.string().url(),
});
export type ClientConfig = z.infer<typeof ClientConfig>;
