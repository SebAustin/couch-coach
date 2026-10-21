/**
 * AppSync Events handler code (APPSYNC_JS) for the channel namespaces.
 *
 * Both namespaces are subscribable with the public API key, so the only thing that keeps one Session's
 * traffic private is that its channel name (a 128-bit id) is unguessable. A wildcard subscription such as
 * `/cc/*` would defeat that, so onSubscribe accepts only the exact channel shapes and nothing containing `*`.
 *
 * `segments` is the number of "/"-separated parts including the empty leading one:
 *   /cc/<sessionId>/pose   -> ['', 'cc', id, 'pose']  (4)
 *   /coach/<sessionId>     -> ['', 'coach', id]       (3)
 */
export function onSubscribeCode(namespace: string, segments: number): string {
  return `import { util } from '@aws-appsync/utils';

export function onSubscribe(ctx) {
  const path = ctx.info.channel.path;
  const parts = path.split('/');
  if (path.includes('*') || parts.length !== ${segments} || parts[1] !== '${namespace}' || parts[2].length !== 32) {
    util.unauthorized();
  }
}
`;
}

export const CC_NAMESPACE = 'cc';
export const COACH_NAMESPACE = 'coach';
export const CC_SUBSCRIBE_CODE = onSubscribeCode(CC_NAMESPACE, 4);
export const COACH_SUBSCRIBE_CODE = onSubscribeCode(COACH_NAMESPACE, 3);
