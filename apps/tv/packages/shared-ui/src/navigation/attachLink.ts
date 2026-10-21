import { SessionId } from '../vendor/protocol';

export interface AttachRequest {
  sessionId: string;
  memberId: string;
  name: string;
}

/**
 * Demo / debug deep link: `couchcoach://attach?s=<sessionId>&m=<memberId>&n=<name>` (Android intent) or
 * `/?attach=1&s=...` (web preview). It opens the TV straight onto an existing Session so a script can drive Live
 * (see scripts/publish-synthetic.mjs) without scanning a QR. It carries no secret: the Session id is not a credential.
 */
export function parseAttachLink(url: string | null | undefined): AttachRequest | null {
  if (!url) return null;
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return null;
  const head = url.slice(0, queryStart);
  const params = new URLSearchParams(url.slice(queryStart + 1).split('#')[0]);
  const isScheme = /^couchcoach:\/\/attach\/?$/.test(head);
  if (!isScheme && params.get('attach') !== '1') return null;
  const sessionId = params.get('s');
  if (!sessionId || !SessionId.safeParse(sessionId).success) return null;
  const memberId = params.get('m') || 'demo';
  const name = (params.get('n') || 'Demo').slice(0, 40);
  return { sessionId, memberId: memberId.slice(0, 64), name };
}
