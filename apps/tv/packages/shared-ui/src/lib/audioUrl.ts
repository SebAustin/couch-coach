/** Presigned S3 GET URLs from the coach Lambda: <bucket>.s3.amazonaws.com or <bucket>.s3.<region>.amazonaws.com. */
const S3_HOST = /^[a-z0-9.-]+\.s3(\.[a-z0-9-]+)?\.amazonaws\.com$/;

/** Defence in depth (SECURITY.md H1): only play Coach audio served by S3 over HTTPS, never an arbitrary URL. */
export function isTrustedAudioUrl(url: string | undefined): boolean {
  if (!url) return false;
  const match = /^https:\/\/([^/?#]+)/.exec(url);
  return !!match && S3_HOST.test(match[1]!.toLowerCase());
}
