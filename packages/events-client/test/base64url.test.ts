import { describe, expect, it } from 'vitest';
import { base64UrlEncode } from '../src/index';

describe('base64UrlEncode', () => {
  it.each(['', 'a', 'ab', 'abc', '{"host":"x","x-api-key":"da2-abc"}', '???>>>~~~', 'héllo wörld ✓ 🚀'])(
    'matches Node base64url for %j',
    (text) => {
      expect(base64UrlEncode(text)).toBe(Buffer.from(text, 'utf8').toString('base64url'));
    },
  );
});
