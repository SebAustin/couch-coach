import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A phone token is valid for two hours (docs/CONTRACTS.md). */
export const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export type TokenCheck =
  | { ok: true; exp: number }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'session_mismatch' | 'expired' };

/** 128-bit random Session id, lowercase hex (matches protocol `SessionId`). */
export function newSessionId(): string {
  return randomBytes(16).toString('hex');
}

const mac = (secret: string, signedPart: string): Buffer =>
  createHmac('sha256', secret).update(signedPart).digest();

/** token = base64url(`${sessionId}.${expMs}`) + '.' + base64url(HMAC-SHA256(secret, `${sessionId}.${expMs}`)). */
export function signPhoneToken(
  sessionId: string,
  secret: string,
  nowMs: number,
): { token: string; exp: number } {
  const exp = nowMs + TOKEN_TTL_MS;
  const signedPart = `${sessionId}.${exp}`;
  const token = `${Buffer.from(signedPart).toString('base64url')}.${mac(secret, signedPart).toString('base64url')}`;
  return { token, exp };
}

export function verifyPhoneToken(
  token: string,
  sessionId: string,
  secret: string,
  nowMs: number,
): TokenCheck {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };

  const signedPart = Buffer.from(parts[0], 'base64url').toString();
  const given = Buffer.from(parts[1], 'base64url');
  const expected = mac(secret, signedPart);
  // Signature first: nothing in the payload is trusted until it checks out.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const dot = signedPart.lastIndexOf('.');
  const tokenSession = signedPart.slice(0, dot);
  const exp = Number(signedPart.slice(dot + 1));
  if (dot < 0 || !Number.isFinite(exp)) return { ok: false, reason: 'malformed' };
  if (tokenSession !== sessionId) return { ok: false, reason: 'session_mismatch' };
  if (nowMs > exp) return { ok: false, reason: 'expired' };
  return { ok: true, exp };
}
