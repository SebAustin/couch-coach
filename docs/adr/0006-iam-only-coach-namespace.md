# Coach messages live in an IAM-publish-only AppSync namespace

The first deploy used one public API key for everything: the phone and TV connect, subscribe and publish with it, and the coach Lambda used the same key to publish Cues. The security review (`SECURITY.md` H1) confirmed two live problems. A wildcard subscription to `/cc/*` returned every Session's body landmarks, Member names and presigned audio URLs, which defeated the "128-bit Session id is the capability" assumption. And anyone with the key could publish a forged `cue`, including an `audioUrl` the TV would play aloud.

Decision, shipped in commit `1f52e24`:
1. Both namespaces get an `onSubscribe` handler (`infra/lib/event-handlers.ts`) that accepts only the exact channel shapes `/cc/<32 hex>/<segment>` and `/coach/<32 hex>`, and rejects anything containing `*`.
2. Cues move to a second namespace, `coach`, on the channel `/coach/<sessionId>`. Clients may subscribe with the API key, but only IAM may publish. The coach Lambda signs its HTTP publish with SigV4 (`grantPublish` on that namespace only), and `EVENTS_API_KEY` is gone from its environment. The API key returns 401 on a publish there.
3. The TV plays Cue audio only from an S3 host over HTTPS (`isTrustedAudioUrl`), as defence in depth.

Consequences:
- A client cannot forge a Cue, and revoking or rotating the public key after judging does not affect how the server publishes.
- `channels(sessionId).coach` changed from `/cc/<id>/coach` to `/coach/<id>`, so the phone and TV must subscribe to the new path. A client on the old path gets no Cues and no error: the TV just shows "The Coach is quiet this time" after 12 s, which looks like a Bedrock timeout. Check the channel first when Cues vanish.
- Residual, accepted for the demo: someone who has seen a Session's QR can still publish noise into that Session's `/cc/<id>/pose` and `/events` for up to 2 h. Closing it needs an `AWS_LAMBDA` authorizer that verifies the HMAC phone token. It was not built.
- The Lambda needs the AppSync Events HTTP host and an `appsync:EventPublish` grant, which adds one IAM statement to review.

Rejected: only blocking wildcards (leaves Cue forgery open), and the Lambda authorizer on `cc` straight away (the right fix, but hours of work and a new failure mode on the critical path with the deadline close).
