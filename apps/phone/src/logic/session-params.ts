import { SessionId } from '@couch-coach/protocol';

export const UNKNOWN_MEMBER = 'unknown';

export type SessionParams =
  | { ok: true; sessionId: string; token: string; memberId: string }
  | { ok: false };

/** Read `s` (sessionId), `t` (phoneToken) and optional `m` (memberId) from the page URL. */
export function parseSessionParams(search: string): SessionParams {
  const params = new URLSearchParams(search);
  const sessionId = params.get('s') ?? '';
  const token = params.get('t') ?? '';
  if (!SessionId.safeParse(sessionId).success || token.length === 0 || token.length > 512) {
    return { ok: false };
  }
  const memberId = (params.get('m') ?? '').slice(0, 64) || UNKNOWN_MEMBER;
  return { ok: true, sessionId, token, memberId };
}

/** Which Pose Landmarker to run: `lite` (default, fastest) or `full` (more accurate landmarks, more GPU per frame). */
export type ModelVariant = 'lite' | 'full';

/** `model=full` in the page URL opts into the full model; anything else keeps lite. */
export function parseModelVariant(search: string): ModelVariant {
  return new URLSearchParams(search).get('model') === 'full' ? 'full' : 'lite';
}
