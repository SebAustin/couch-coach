import { describe, expect, it } from 'vitest';
import { newSessionId, signPhoneToken, TOKEN_TTL_MS, verifyPhoneToken } from '../../shared/token';

const SECRET = 'test-secret-value';
const SESSION_ID = '0123456789abcdef0123456789abcdef';
const NOW = 1_800_000_000_000;

describe('phone token', () => {
  it('round-trips: a freshly signed token verifies for its own session', () => {
    const { token, exp } = signPhoneToken(SESSION_ID, SECRET, NOW);

    expect(exp).toBe(NOW + TOKEN_TTL_MS);
    expect(verifyPhoneToken(token, SESSION_ID, SECRET, NOW + 1000)).toEqual({ ok: true, exp });
  });

  it('is valid for exactly two hours', () => {
    expect(TOKEN_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('uses the documented wire format base64url(sessionId.exp).base64url(hmac)', () => {
    const { token } = signPhoneToken(SESSION_ID, SECRET, NOW);
    const [payload, mac] = token.split('.');

    expect(Buffer.from(payload!, 'base64url').toString()).toBe(`${SESSION_ID}.${NOW + TOKEN_TTL_MS}`);
    expect(mac).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32-byte HMAC-SHA256, unpadded base64url
  });

  it('is deterministic for the same inputs', () => {
    expect(signPhoneToken(SESSION_ID, SECRET, NOW).token).toBe(signPhoneToken(SESSION_ID, SECRET, NOW).token);
  });

  it('rejects an expired token', () => {
    const { token, exp } = signPhoneToken(SESSION_ID, SECRET, NOW);

    expect(verifyPhoneToken(token, SESSION_ID, SECRET, exp + 1)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = signPhoneToken(SESSION_ID, 'other-secret', NOW);

    expect(verifyPhoneToken(token, SESSION_ID, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a token presented for a different session', () => {
    const { token } = signPhoneToken(SESSION_ID, SECRET, NOW);
    const other = 'f'.repeat(32);

    expect(verifyPhoneToken(token, other, SECRET, NOW)).toEqual({ ok: false, reason: 'session_mismatch' });
  });

  it('rejects a payload whose expiry was extended without re-signing', () => {
    const { token } = signPhoneToken(SESSION_ID, SECRET, NOW);
    const [, mac] = token.split('.');
    const forged = `${Buffer.from(`${SESSION_ID}.${NOW + 10 * TOKEN_TTL_MS}`).toString('base64url')}.${mac}`;

    expect(verifyPhoneToken(forged, SESSION_ID, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it.each(['', 'nodot', 'a.b.c', '.', '!!!.???'])('rejects malformed token %j', (bad) => {
    const result = verifyPhoneToken(bad, SESSION_ID, SECRET, NOW);

    expect(result.ok).toBe(false);
  });

  it('rejects a MAC of the wrong length without throwing', () => {
    const { token } = signPhoneToken(SESSION_ID, SECRET, NOW);
    const [payload] = token.split('.');

    expect(verifyPhoneToken(`${payload}.AAAA`, SESSION_ID, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('newSessionId', () => {
  it('is 128-bit lowercase hex and unique', () => {
    const a = newSessionId();
    const b = newSessionId();

    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
