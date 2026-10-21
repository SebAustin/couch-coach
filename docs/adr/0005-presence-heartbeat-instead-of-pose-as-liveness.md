# The phone sends a presence heartbeat; pose frames are not a liveness signal

The first TV build decided "the phone is gone" when no pose batch arrived for a few seconds (`docs/ux.md` 2.3 still says 5 s). That breaks in the most common case in a living room: the Member steps out of frame, drinks some water or walks to the sofa. MediaPipe returns no pose, the phone has nothing to publish, and the TV shows "Lost your phone" for a phone that is working fine. The opposite also happens: a phone that is backgrounded, locked or off Wi-Fi looks identical to an empty room.

The Camera Phone now publishes `{ type: 'presence', person, t }` on `/cc/<sessionId>/events` every 2 s from a timer that is independent of the camera loop. `person` is true when a pose was detected in the last 1.5 s. The TV treats any phone signal (presence, pose batch, or any other phone event) as proof of life. It shows "Lost your phone" only after 10 s without one (`PHONE_SILENT_MS`), and "We can't see you" when presence keeps arriving with `person: false`. After 10 s of silence the TV also asks the events client to `reconnect()`, then again every 10 s. Presence is published as an ephemeral event, so the client never replays a stale heartbeat after a reconnect.

Consequences:
- The TV can say two different things for two different problems, and the fix for each is different (step back vs. wake the phone).
- The cost is one small publish every 2 s per Session. The threshold moved from the spec's 5 s to 10 s so that two missed beats do not trigger a false alarm.
- Presence is not authenticated. It is a `cc` event like any other, so it inherits the residual noted in ADR 0006 and `SECURITY.md` H1: someone who has seen the QR can fake or suppress it for up to 2 h.
- A phone that is alive but whose camera has died keeps sending `person: false`; the TV shows "We can't see you", not "Lost your phone". The phone recovers the camera on its own after iOS interruptions.

Rejected: raising the pose-silence timeout (it only delays the false alarm), and a server-side heartbeat through the API (extra Lambda invocations and cost for something AppSync Events already carries).
