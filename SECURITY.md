# Couch Coach security review (STRIDE threat model + code and dependency review)

_Reviewed 2026-10-21 by the security-auditor workstream. Scope: `couch-coach` at commit `9eb3d96` and `pose-reps` at `main`, plus the deployed stack `CouchCoachStack` (account 430411150226, us-east-1), checked read-only._

## Summary

| Severity | Count | Items |
|---|---|---|
| CRITICAL | 0 | none |
| HIGH | 2 | H1 public AppSync key reads every Session and forges messages into any of them (confirmed live); H2 anyone can mint unlimited Sessions, so the 30-call cap does not limit Bedrock and Polly spend |
| MEDIUM | 3 | M1 one unauthenticated Household shared by every install; M2 cross-Member memory poisoning and stored prompt injection; M3 the stage-wide throttle lets one client take the API down for everyone |
| LOW | 10 | L1 to L10 below |
| INFO | 7 | I1 to I7 below |

The PLAN requires "no CRITICAL/HIGH" before release. This report finds two HIGH items, so that bar is not met yet. Both HIGH items have concrete fixes below that fit in a few hours.

**What was fixed in this pass: nothing.** This review was told not to change code or AWS resources, and `SECURITY.md` is the only file it wrote. Every remediation below is a recommendation, ranked by severity.

**Concurrent work:** while this review ran, another workstream had uncommitted changes in `apps/phone`, `apps/tv`, `packages/events-client` and `services/coach` (resilience, a `presence` heartbeat and a coach eval). A skim found no new trust boundary in them. The new `presence` event inherits H1 like every other event.

## How the review was done

- **Design:** read `PLAN.md`, `docs/CONTRACTS.md`, ADRs 0001 to 0004, every source file in `infra/`, `services/`, `packages/` and `apps/phone`, and the TV code under `apps/tv/packages/shared-ui/src`.
- **Secrets:** ran `gitleaks git` over the full history of both repos and `gitleaks dir` over the working tree. Grepped all history diffs and commit metadata for email addresses.
- **Dependencies:** ran `npm audit` (`--omit=dev`, then the full tree) in `packages/protocol`, `packages/events-client`, `services/session`, `services/coach`, `infra`, `apps/phone`, `scripts` and `pose-reps`. Ran `yarn npm audit --all --recursive`, production and full, in `apps/tv` (Yarn 4.5).
- **TV APK:** read the merged release manifest and checked `apksigner verify --print-certs` on `app-release.apk`. Ran `strings` on the Hermes bundle to see which flagged packages actually ship.
- **Live, read-only checks:**
  - `curl -I` on the CloudFront phone app to see its response headers.
  - `GET /members`, recording only the status and the count.
  - A CORS preflight from a foreign origin.
  - Two AppSync WebSocket probes using only the public key (see H1). The probes printed no payload from any real Session. The single probe event went to a fresh random 128-bit channel that nobody uses.

## System decomposition

### Components and data flow
```
Phone browser (camera, MediaPipe, pose-reps) --HTTPS--> CloudFront --OAC--> S3 phone bucket (index.html, config.json, wasm, model)
Phone --WSS publish (API key)--> AppSync Events /cc/<sid>/pose | /events          --> TV subscribes (API key)
Phone --HTTPS POST /coach {sessionId, token, set}--> API GW HTTP API --> coach Lambda
TV    --HTTPS GET/POST /members, POST /session-->     API GW HTTP API --> session Lambda --> DynamoDB, Secrets Manager (HMAC key)
coach Lambda --> DynamoDB (cap counter, member history) --> Bedrock Converse (Haiku) --> Polly --> S3 audio/ (presigned 15 min)
coach Lambda --HTTPS publish (same public API key)--> AppSync /cc/<sid>/coach --> TV + phone
```

### Trust boundaries
1. **Internet to API Gateway.** No caller authentication on any route. CORS is `*`, and the stage throttle is 5 rps with a burst of 10.
2. **Internet to AppSync Events.** One API key that is public by design. It sits in the repo, in the TV APK and in the phone's `config.json`. It allows connect, subscribe and publish on namespace `cc`.
3. **Phone to coach Lambda.** An HMAC phone token, valid for 2 hours and bound to the Session id.
4. **Lambda to AWS services.** The IAM roles defined in `infra/lib/couch-coach-stack.ts:170-187`.
5. **App data to the LLM.** Member name, fault ids, set numbers and earlier cues go into the Bedrock prompt.
6. **Other apps and web pages on the Fire TV to the TV app.** The `couchcoach://` deep link.
7. **Build host and CI to the artifacts.** The npm and Yarn toolchains, GitHub Actions, and a `pose-reps` dependency pulled by `file:` path.

### Entry points
`GET /members`, `POST /members`, `POST /session`, `POST /coach`, the AppSync realtime WebSocket and HTTP `/event` publish, the CloudFront phone app with its URL query `s`, `t` and `m`, the TV deep link `couchcoach://attach?s=&m=&n=`, and the coach Lambda's async self-invoke event (`kind: 'coach-job'`). The self-invoke can only be reached by an IAM principal allowed `lambda:InvokeFunction`.

### Data stores and sensitive data
| Store | Data | Sensitivity |
|---|---|---|
| DynamoDB `MEMBER#/PROFILE` | display name (can be a real first name), lastSeenAt | personal data, low |
| DynamoDB `MEMBER#/SET#` (90-day TTL) | exercise, reps, score, fault counts, cue text | health-adjacent, low to moderate |
| DynamoDB `SESSION#/META` | memberId, exp, coachCalls | low |
| Secrets Manager | HMAC key (48 alphanumeric characters, about 285 bits) | **secret** |
| S3 audio `audio/<sid>/<n>.mp3` (1-day lifecycle) | spoken cue | low |
| AppSync channels (not stored) | 33-point body landmarks at 15 fps, member id, set summaries, cues | body-movement data: the main privacy asset (ADR 0001) |
| Phone URL and QR | Session id plus phone token | bearer credential for 2 hours |

## STRIDE pass

| Component | S: Spoofing | T: Tampering | R: Repudiation | I: Information disclosure | D: Denial of service | E: Elevation of privilege |
|---|---|---|---|---|---|---|
| AppSync Events | **H1**: anyone can publish as "the coach", the TV or the phone | **H1**: forged cue text and audio URL, fake poses or reps, forged `end_session` | no publisher identity at all | **H1**: `/cc/*` wildcard streams every Session | publish spam into any known Session | the public key equals server publish rights (**H1**) |
| `/members` | no caller identity (**M1**) | add members with any 40-character name to every TV (**M1**) | no access logs (L10) | member names and ids are public (**M1**, confirmed: 4 visible) | fill the 20-member cap, and there is no delete (**M1**) | n/a |
| `/session` | mint a Session for any memberId (**H2**, **M2**) | n/a | L10 | phoneUrl and token go back to whoever asks (by design) | consumes the shared 5 rps (**M3**) | n/a |
| `/coach` | HMAC token, verified correctly (I6) | free-form fault keys stored in another Member's history (**M2**) | L10 | n/a | denial of wallet across unlimited Sessions (**H2**) | n/a |
| Coach LLM | n/a | stored prompt injection through fault ids and the echoed cue (**M2**) | Cue logged with sessionId | the prompt holds only that Member's own data | output is capped at 120 tokens | no tools, so there is nothing to escalate to (I7) |
| Phone web app | token in URL (L1) | CSP `script-src 'self'`; text inserted via text nodes | n/a | `connect-src *.amazonaws.com` is broad (L6) | forged `end_session` stops the camera (**H1**) | n/a |
| CloudFront / S3 | OAC, buckets private | n/a | no access logs (L10) | missing HSTS and framing headers (L5) | n/a | n/a |
| TV APK | release key is the public RN debug key (L4) | the deep link can switch the TV to an attacker's Session (L3) | n/a | allowBackup (I3) | n/a | n/a |
| IAM | n/a | n/a | CloudTrail is the account default | n/a | no reserved concurrency (**H2**) | least privilege holds (I4) |
| Supply chain and CI | n/a | unpinned actions and an unpinned `pose-reps` checkout (L8) | n/a | personal email in commit metadata (L9) | n/a | build-toolchain advisories (L7) |

## Findings

### H1 (HIGH): the public AppSync key reads every Session and forges messages into any of them. Confirmed live.
**Where:**
- `infra/lib/couch-coach-stack.ts:84-98`: API key used for connect, publish and subscribe, and namespace `cc` has no handlers.
- `services/coach/src/events.ts:9-12`: the coach Lambda publishes Cues with that same public key.
- `apps/tv/packages/shared-ui/src/hooks/useCueAudio.ts:14`: the TV plays any `audioUrl`.
- `packages/protocol/src/index.ts:93`: the `audioUrl` schema is `z.string().url()`, so any URL passes.

**Evidence:**
- A WebSocket subscribe to `/cc/*` with the committed key returned `subscribe_success`.
- An HTTP publish with the same key to a fresh `/cc/<random>/coach` channel returned 200, and the wildcard subscriber received that event.

**Impact:**
- The "128-bit Session id is the capability" premise in `docs/CONTRACTS.md` does not hold. One wildcard subscriber passively collects every live Session's body-landmark stream, member ids, set summaries, cue text (which contains member names) and presigned audio URLs.
- That subscriber also learns each Session id, so it can then publish into those Sessions:
  - forged `cue` messages: 600 characters of text, plus an `audioUrl` pointing at any HTTPS file, which the TV plays aloud;
  - forged `pose`, `rep` and `set_end` events;
  - `control: end_session`, which stops the phone camera.
- Publish volume is also billed to the account.

**Is the stated threat model acceptable?** Not as written. The key being public was acceptable only because channel names were meant to be unguessable, and wildcard subscription removes that. With fixes 1 and 2 below in place, what is left is acceptable for a hackathon demo: someone who already knows a Session id (they saw the QR) can still publish noise into that one Session for 2 hours.

**Remediation, in order of effort:**
1. **Reject wildcard subscriptions on `cc`.** Add an `onSubscribe` handler (APPSYNC_JS) to the namespace. Check the handler API against the AppSync Events docs before deploying.
   ```ts
   events.addChannelNamespace('cc', { code: appsync.Code.fromInline(`
     import { util } from '@aws-appsync/utils';
     export function onSubscribe(ctx) { if (ctx.info.channel.path.includes('*')) { util.unauthorized(); } }
   `) });
   ```
2. **Make Cues server-only, which removes attack surface.**
   - Add an `IAM` auth provider.
   - Create a second namespace, for example `coach`, with `authorizationConfig: { publishAuthModeTypes: [IAM], subscribeAuthModeTypes: [API_KEY] }`.
   - Have the Lambda sign its HTTP publish with SigV4. Grant it with `events.grantPublish(coachFn)`.
   - **Delete `EVENTS_API_KEY` from the Lambda environment** (`couch-coach-stack.ts:161`). The server then no longer shares an identity with every client, and rotating or revoking the client key after judging no longer breaks Cues.
3. **Proper fix: an `AWS_LAMBDA` authorizer on `cc`.** It verifies the HMAC phone token, which both TV and phone already hold through `SessionResponse` and the QR, and checks that `segments[1]` equals the token's sessionId. The public API key can then be removed entirely.
4. **TV defence in depth:** play `audioUrl` only when its host is the audio bucket's S3 host.

### H2 (HIGH): anyone can mint unlimited Sessions, so the 30-call cap does not limit spend (denial of wallet)
**Where:**
- `services/session/src/handler.ts:74-115`: `POST /session` has no caller authentication and accepts any existing memberId.
- `services/coach/src/cap.ts:5-44`: the cap counts calls per Session only.
- `infra/lib/couch-coach-stack.ts:148-167`: the coach function has no `reservedConcurrentExecutions`.
- `couch-coach-stack.ts:264-277`: the $50 budget only sends email, and AWS Budgets data can lag by hours.

**Impact:**
- The script is short: `GET /members`, then loop over `POST /session` followed by 30 × `POST /coach`.
- Each `POST /coach` costs one Bedrock Converse call, one Polly neural synthesis, an S3 PUT and about 2 to 3 seconds of a 512 MB Lambda.
- At the 5 rps stage throttle, roughly 4.8 coach calls per second get through, which is about 400,000 a day. At list prices that is on the order of $1,500 to $2,000 per day, mostly Polly at about 200 characters per Cue. This is an estimate: check it against current pricing and the account's Bedrock quotas.
- The cap does what it says per Session. The problem is that Sessions cost nothing to create.

**Remediation:**
1. **Hard global ceiling, independent of identity.** In `admit()`, before the per-Session reservation, do one conditional `UpdateItem` on `QUOTA#<yyyy-mm-dd>` (`ADD n :1`, condition `n < :dailyMax`, for example 500). Return 429 when it trips. This is the same pattern as `cap.ts`, about 20 lines.
2. Set `reservedConcurrentExecutions` on the coach function (for example 3) so spend has a ceiling even under a burst.
3. Throttle each route separately with `CfnStage.RouteSettings` (for example `POST /session` at 0.5 rps), so new Sessions cannot be created at the full stage rate.
4. Add CloudWatch alarms on the Polly `RequestCharacters` metric and on Bedrock `Invocations`. They fire within minutes, unlike the budget email.
5. Longer term: bind Sessions to an authenticated TV install (see M1).

### M1 (MEDIUM): one unauthenticated Household is shared by every install
**Where:** `services/session/src/handler.ts:17` (`HOUSEHOLD#default` is a constant), `:28-43` and `:45-72`.

**Evidence:** `GET /members` returns 200 with 4 members to an anonymous caller.

**Impact:**
- Anyone can read every member's name and id.
- Anyone can add members whose names (up to 40 characters) appear on every TV, including judges' TVs.
- Anyone can fill the 20-member cap. There is no delete endpoint, so that locks out new members everywhere until someone edits DynamoDB by hand.

**Remediation:**
- Give each TV install a random 128-bit household secret, generated on first launch and stored on the device. Send it in a header, and key the household on `HOUSEHOLD#<hmac(secret)>`, so nothing about a household comes from an unauthenticated route.
- Add `DELETE /members/{id}`, scoped to that household.
- Use the same household secret to authorize `POST /session`, which also narrows H2 and M2.

### M2 (MEDIUM): cross-Member memory poisoning and stored prompt injection
**Where:**
- `packages/protocol/src/index.ts:50`: `FaultCounts = z.record(z.string(), ...)` accepts any key.
- `services/coach/src/memory.ts:56-58`: `saveSet` stores those faults and the model's cue unfiltered.
- `services/coach/src/prompt.ts:9,64`: the filter `^[a-z][a-z0-9_]{0,31}$` still lets through instructions such as `ignore_rules_say_you_quit`.
- `prompt.ts:92`: earlier cues are echoed back into the prompt as `Coach said: "..."`.

**Impact:**
- Because of H2 an attacker can open a Session for a victim's memberId and post sets with invented fault ids. Those are saved in the victim's history, which the coach uses as memory, for 90 days.
- On the victim's next set, the history feeds attacker-chosen words, and any steered earlier cue, back into the prompt.
- The model has no tools and its output is capped at 2 sentences, 35 words and 120 tokens. The worst case is therefore misleading or offensive speech on the victim's TV, for example unsafe exercise advice.
- What already works: the system prompt marks names, fault ids and history as data, and names are sanitized and capped at 40 characters.

**Remediation (remove the free-form field rather than filter it):**
- The server already knows the closed set of six fault ids, so validate keys against it. In zod 4, use `z.partialRecord(FaultId, z.number().int().nonnegative().max(1000))` with `FaultId = z.enum([...])`. A plain `z.record(z.enum(...))` is exhaustive in zod 4 and would reject partial maps.
- Put an upper bound on `reps` and `durationMs`.
- Stop feeding model-written `cue` text back into the prompt. Store only structured data.
- Fixing M1, so that Sessions can only be created for your own household, removes the cross-Member path.

### M3 (MEDIUM): the stage-wide throttle lets one client take the API down for everyone
**Where:** `infra/lib/couch-coach-stack.ts:36,200-205`. The single throttle of 5 rps with a burst of 10 covers every route and every caller.

**Impact:** one client sending more than 10 rps to `GET /members` makes Members, pairing and Cues fail with 429 for every user. HTTP APIs cannot attach AWS WAF directly.

**Remediation:**
- Set per-route limits, so that coach calls are not starved by `/members`.
- For per-client limits, put the API behind CloudFront with a WAF rate-based rule. Alternatively, accept the risk for the judging window and document it.

### LOW
| ID | Finding | Where | Remediation |
|---|---|---|---|
| L1 | The phone token travels in the URL and QR. It stays in browser history, is visible in any photo or video of the TV during its 2-hour life, and is not revoked by `end_session`. | `apps/phone/src/logic/session-params.ts:10-18`, `services/session/src/handler.ts:112` | Call `history.replaceState` after parsing. Mark the Session row ended on `end_session` and check that in `admit`. Blur the QR in the demo video. |
| L2 | `POST /coach` carries a `sessionId` that must equal the one inside the signed token. That field has one correct value and many wrong ones. | `packages/protocol/src/index.ts:104-109`, `services/coach/src/handler.ts:26-29`, `services/shared/token.ts:51` | Remove `sessionId` from `CoachRequest` and take it from the verified token, so a mismatch is impossible rather than rejected. |
| L3 | The debug deep link `couchcoach://attach` ships in release builds behind a BROWSABLE intent filter. Any web page or app on the TV can switch it to an attacker's Session and set the shown name. | `apps/tv/packages/shared-ui/src/navigation/attachLink.ts:14-27`, `CouchCoachApp.tsx:38-52`, `apps/expo-multi-tv/app.json:5` | Remove it from release builds (`if (!__DEV__) return null`) and drop `scheme` from the release config. Removing it is better than validating it. |
| L4 | `app-release.apk` is signed with the public React Native debug keystore (SHA-1 `5E:8F:16:06:2E:A3:...:F6:25`). | generated `android/app/build.gradle:117` (gitignored) | Create a private upload key before distributing the APK beyond your own sideload. |
| L5 | CloudFront sends no security headers: no HSTS, no `X-Content-Type-Options`, and no `frame-ancestors` (a meta CSP cannot set that one). | `infra/lib/couch-coach-stack.ts:109-118` | Set `responseHeadersPolicy` to `ResponseHeadersPolicy.SECURITY_HEADERS`, or a custom policy that also moves the CSP into a header with `frame-ancestors 'none'`. |
| L6 | The CSP `connect-src https://*.amazonaws.com wss://*.amazonaws.com` allows any AWS customer endpoint. The model fallback fetches Google's `latest` URL without an integrity check. | `apps/phone/vite.config.ts:18`, `apps/phone/src/pose.ts:5-6`, `apps/phone/scripts/prepare-assets.mjs` | List the exact API, AppSync and S3 hosts in the CSP, or set it from CloudFront where the hosts are known. Pin the model version and check its SHA-256 at build time. |
| L7 | TV build-toolchain advisories (Yarn): 1 critical (`shell-quote` through `react-devtools-core`), 32 high and 13 moderate rows. None of them is in the shipped Hermes bundle. | `apps/tv/yarn.lock` | See "Dependency review" below. |
| L8 | The couch-coach CI has no `permissions:` block, pins actions by tag, and checks out `pose-reps` `main` without pinning. | `.github/workflows/ci.yml:7-28` | Add `permissions: contents: read`, pin actions by SHA, and check out `pose-reps` with `ref: v0.1.x`. |
| L9 | The personal Gmail address appears in public commit metadata of both repos. It is also the budget and alarm address. It does not appear in any source file. | git author and committer on all 31 commits | Use the GitHub `noreply` address for future commits and turn on "Block command line pushes that expose my email". Rewriting history is optional. |
| L10 | API Gateway and CloudFront access logging are off, so abuse such as H2 or M1 cannot be traced after the fact. Lambda logs carry sessionId and memberId, but no source IP. | `infra/lib/couch-coach-stack.ts:190-205`, `:109-118` | Turn on HTTP API access logs (with `$context.identity.sourceIp`) on the `$default` stage. |

### INFO and positive controls
- **I1:** The committed AppSync key is public by design. gitleaks reported 4 history hits: this key in `infra/client-config.json`, `infra/cdk-outputs.json` and `apps/tv/.../config.generated.ts`, plus one false positive in `docs/friction-notes.md` (model id text). No other credentials were found in either repo's history or working tree. The cdk.out hits are asset hashes in a gitignored folder. `pose-reps` is clean. The budget email appears only in the gitignored `infra/cdk.out`, because it is passed with `-c budgetEmail`. Rotating the key does not help while H1 is open, because the key ships in the APK. Revoke it after judging, as STATUS already plans.
- **I2:** AWS account id `430411150226` appears in `PLAN.md:8,68`. Account ids are not secrets.
- **I3:** The TV has `allowBackup="true"`. It stores no secrets, so this is acceptable. Release builds have cleartext traffic off (`usesCleartextTraffic=false`); only the debug variants turn it on. Release permissions are limited to `INTERNET`, `ACCESS_NETWORK_STATE` and the AndroidX dynamic-receiver permission. `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` are removed explicitly.
- **I4:** IAM follows least privilege:
  - Bedrock: only the inference profile plus the foundation-model ARNs it routes to.
  - S3: only `audio/*`.
  - Lambda invoke: only the coach function itself.
  - Secrets Manager: only the HMAC secret.
  - DynamoDB: item actions on the table, and Query only on the members index for the session function.
  - Polly `*`: the service supports no resource-level scoping.

  The rest are minor:
  - The CDK-managed BucketDeployment role allows `cloudfront:CreateInvalidation` on `*`.
  - DynamoDB access is table-wide rather than restricted with `dynamodb:LeadingKeys`.
- **I5:** The Lambdas leave `@aws-sdk/*` external, so the deployed code uses the SDK that the Node 24 runtime provides, not the versions `npm audit` checked. AWS patches that SDK. Treat clean `services/*` audits as covering zod and the bundled code only.
- **I6:** The HMAC phone token is implemented correctly:
  - HMAC-SHA256 with a 285-bit key from Secrets Manager;
  - signature checked before any payload is trusted, with `timingSafeEqual` after a length check (the length is not secret);
  - expiry checked against the signed `exp`;
  - Session binding checked;
  - token capped at 512 characters by zod.

  The cap is enforced atomically with one conditional `UpdateItem`. The coach takes `memberId` from the server-side Session row, never from the request.
- **I7:** LLM tool permissions: the model has **no tools**. Its output goes only through `cleanCueText` (plain text, 2 sentences, 600 characters), then Polly, then the screen. The phone renders text through text nodes (`apps/phone/src/dom.ts`) and the TV through React Native `<Text>`, so model output cannot inject markup. The system prompt marks app-supplied fields as data. What is left of prompt injection is M2.

## Dependency review: reconciling the two scanners
| Scope | Tool | Result |
|---|---|---|
| `packages/protocol`, `packages/events-client`, `services/session`, `services/coach`, `infra`, `apps/phone`, `scripts`, `pose-reps` | `npm audit --omit=dev`, then the full tree | **0** vulnerabilities in every package, both runs |
| `apps/tv` (Yarn 4.5, `--environment production`) | `yarn npm audit --all --recursive` | 47 advisory rows: 1 critical, 32 high, 13 moderate, 1 low. The full tree adds 5 moderate rows from eslint and jsdom. |

The two results do not contradict each other. They cover different dependency graphs and different layers:

- **Different graphs.** The npm packages share none of the Expo and Metro toolchain. The Yarn advisories all come in through `expo`, `@expo/cli`, `@expo/metro-config`, `metro`, `@expo/plist`, `react-devtools-core` and `postcss`. Expo and React Native declare these as runtime `dependencies`, so Yarn's "production" filter keeps them.
- **Not in the shipped app.** A `strings` search of the release Hermes bundle found no trace of `shell-quote`, `react-devtools`, `xmldom`, `brace-expansion`, `postcss`, `node-forge` or `micromatch`. These packages run on the developer's machine against the developer's own trusted input (local images, plists, CSS, globs). They do not run on the Fire TV.
- **Rating:** LOW in this context (L7).
- **What removes them:** a lockfile override changes nothing for users of the APK. Building the APK in CI and never shipping the toolchain is what actually keeps them out.

If you do patch the build host, pin each package deliberately **inside its current major**. Several suggested fixes cross a major boundary that would break the Expo SDK 54 build:

| Package (found → pin) | Why this version |
|---|---|
| `shell-quote` 1.8.3 → 1.12.0 | same major |
| `@xmldom/xmldom` 0.8.12 → 0.8.15 | stay on 0.8; `@expo/plist` 0.4.8 is written against the 0.8 API, and 0.9 is breaking |
| `nanoid` 3.3.11 → 3.3.20 | stay on 3; 5 is ESM-only and `postcss@8.4` loads it with `require` |
| `brace-expansion` → 1.1.21 / 2.1.7 / 5.0.12 | the patched release of each major in use |
| `postcss` → 8.5.31 | same major |
| `source-map-js` → 1.2.2 | same major |
| `compression` → 1.8.2 | same major |
| `browserslist` → 4.29.4 | same major |
| `http-cache-semantics` → 4.3.0 | same major |
| `@babel/core` → 7.29.7 | same major |
| `@ungap/structured-clone` → 1.4.0 | same major |
| `image-size` (stays on 1.2.1) | **do not force**: the fix exists only in 2.x, `metro` 0.83 needs 1.x, and it only parses the project's own images |
| `uuid` (stays on 7.0.3) | **do not force**: the fix is in 11.x, and it is reached only through `xcode`, which is iOS-only tooling and never runs in the Android build |
| `node-forge` 1.4.0, `braces` 3.0.3 | no patched release exists; both are used only by the Expo CLI dev server and Metro on the developer's machine |

Container and image scanners were not run. The deployed artifacts are not container images, and AWS manages the Lambda runtimes. The one runtime image this stack ships besides your own code is the CDK `BucketDeployment` Lambda's AWS CLI layer, which is Python. `npm audit` cannot see it. Amazon Inspector Lambda scanning would. If Inspector reports findings there, they belong to that CDK-managed layer, not to this repo's dependency graph.

## Secrets and personal data
- No AWS keys, private keys or tokens appear in either repo's history. The only key-like value is the intended public AppSync key (I1).
- The budget and alarm email is not in source: `infra/lib/couch-coach-stack.ts:44-47` refuses to synthesize without `-c budgetEmail`, and the tests use `alerts@example.com`. The same address is public through commit metadata (L9).
- `debug.keystore` and `android/` are gitignored and not in history.

## Security controls can fail in ways that do not look like security
A correct security control applied in the wrong place usually does not return a 403. It shows up as missing data, a null, or a feature that "just stopped working". When fixing the items above, do not rule a control out because the symptom looked unrelated. Specific traps in this codebase:

- **Wildcard rejection or an AppSync Lambda authorizer (H1).** A wrong handler or a token mismatch appears on the TV as "connecting" or "Coach is quiet", or as a skeleton that never appears. It does not appear as an auth error. Test the denied path deliberately.
- **Moving Cues to an IAM-only namespace (H1).** If the TV subscribes to the old channel name, Cues stop silently. The 12-second "quiet" card will look like a Bedrock latency problem.
- **`reserveCoachCall` (`services/coach/src/cap.ts:36`).** It returns `memberId: String(out.Attributes?.memberId)`. A Session row that is missing `memberId` would give the string `"undefined"`. The coach would then read and write history under `MEMBER#undefined`, pooling memory across people. That would look like "the coach forgot me" or "the coach knows someone else's sets", not like an authorization bug. Reject a missing memberId explicitly.
- **zod 4 `z.record(z.enum(...))` is exhaustive (M2).** Used naively, every partial fault map fails validation. Users would see "Coach is quiet" instead of a 400 they can diagnose.
- **A household scope (M1)** applied to `GET /members` but not to `POST /session` looks like "my member list is empty" on one TV, while Sessions remain open across households.

## Recommended order of work (before the Devpost submission)
1. H1 steps 1 and 2: reject wildcards, move Cues to a server-only namespace, and remove the API key from the Lambda.
2. H2 steps 1 and 2: a global daily coach ceiling and reserved concurrency.
3. M2: a closed fault-id set, and no echoed cues in the prompt.
4. L3: remove the attach link from release builds. L5: add the CloudFront security headers policy.
5. After judging: revoke the AppSync key and `cdk destroy`, as STATUS already plans. M1 is the first item if the project continues.

## Remediation status (2026-10-21, deployed)

| Finding | Status | What was done |
|---|---|---|
| H1 wildcard read and Cue injection | **Fixed** (residual noted) | `onSubscribe` handlers on `cc` and `coach` accept only exact `/cc/<32-hex>/<segment>` and `/coach/<32-hex>` channels; `/cc/*`, `/coach/*` and `/*` are rejected (verified live). Coach messages moved to the `coach` namespace: API-key subscribe, **IAM-only publish** (the coach Lambda signs with SigV4; the API key returns 401 there). `EVENTS_API_KEY` removed from the Lambda. The TV plays audio only from S3 over HTTPS. **Residual:** someone who sees a Session's QR can publish noise into that Session's `/cc/<id>/pose` and `/events` for up to 2 h; closing that needs an `AWS_LAMBDA` authorizer (not built). |
| H2 unbounded spend | **Fixed** | Coach reserved concurrency 3; global daily ceiling of 300 coach calls (`QUOTA#<date>` conditional update, after the per-Session cap); per-route throttles (`POST /session` and `POST /members` 1 rps / burst 3, `POST /coach` 3/6, `GET /members` 3/6); 5-minute alarms on Bedrock invocations, Polly characters and coach invocations. **Residual:** an attacker can exhaust the daily 300 and deny the coach to everyone until UTC midnight (bounded cost, not unbounded). |
| M2 memory poisoning | **Fixed** | Server keeps only the six known fault ids and bounds reps, duration and counts; earlier Cue text is no longer fed back into the prompt. |
| M3 shared throttle | **Mitigated** | Per-route throttle buckets. |
| M1 shared default Household | Open (accepted for the hackathon) | Members are display names only, no login (PLAN non-goal). |
| LOW items | Open | Tracked above; none affects the demo's safety. |
