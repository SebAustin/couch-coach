import { isTrustedAudioUrl } from '../audioUrl';

describe('isTrustedAudioUrl', () => {
  it('accepts presigned S3 URLs in both host styles', () => {
    expect(isTrustedAudioUrl('https://couch-audio.s3.amazonaws.com/audio/x/1.mp3?X-Amz-Signature=a')).toBe(true);
    expect(isTrustedAudioUrl('https://couch-audio.s3.us-east-1.amazonaws.com/audio/x/1.mp3?X-Amz-Signature=a')).toBe(true);
  });

  it('rejects other hosts, plain http, look-alike hosts and garbage', () => {
    expect(isTrustedAudioUrl('https://evil.example.com/loud.mp3')).toBe(false);
    expect(isTrustedAudioUrl('http://couch-audio.s3.amazonaws.com/a.mp3')).toBe(false);
    expect(isTrustedAudioUrl('https://s3.amazonaws.com.evil.com/a.mp3')).toBe(false);
    expect(isTrustedAudioUrl('not a url')).toBe(false);
    expect(isTrustedAudioUrl(undefined)).toBe(false);
  });
});
