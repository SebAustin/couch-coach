# Runbook

How to deploy, change, watch and shut down the Couch Coach backend, and what to do when it misbehaves. For how the parts fit together, see [architecture.md](architecture.md).

Everything below runs from the repo root unless a `cd` says otherwise. The AWS commands assume the AWS CLI v2 with credentials for the account that owns the stack, and `--region us-east-1` (the stack is pinned to that Region in `infra/bin/app.ts`).

Commands marked **(verified)** were run against the deployed stack or a local checkout while writing this page. Commands marked **(not run)** change or delete things and were checked by reading the code and CLI help only.

## What exists

| Thing | Name or how to find it |
|---|---|
| CloudFormation stack | `CouchCoachStack` |
| Coach Lambda | `couch-coach-coach` (fixed name; it invokes itself) |
| Session Lambda | CDK-named; log group `CouchCoachStack-SessionLogs...` |
| Log groups | `aws logs describe-log-groups --log-group-name-prefix CouchCoachStack --query 'logGroups[].logGroupName' --output text` **(verified)** |
| DynamoDB table | `aws cloudformation describe-stack-resources --stack-name CouchCoachStack --query "StackResources[?ResourceType=='AWS::DynamoDB::Table'].PhysicalResourceId" --output text` **(verified)** |
| AppSync Events API | `aws appsync list-apis --query "apis[?name=='couch-coach-events'].apiId" --output text` **(verified, shows all APIs)** |
| Stack outputs | `aws cloudformation describe-stacks --stack-name CouchCoachStack --query 'Stacks[0].Outputs' --output table` **(verified)**. Outputs: `apiBaseUrl`, `eventsHttpHost`, `eventsRealtimeHost`, `eventsApiKey`, `phoneUrl`, `bedrockProfileId` |

## Prerequisites for deploying

- Node 22 or newer, npm, and the sibling checkout of `pose-reps` (`../pose-reps` next to this repo) if you build the phone app.
- AWS credentials with rights to create the resources in the stack (IAM roles, Lambda, API Gateway, AppSync, DynamoDB, S3, CloudFront, Secrets Manager, SNS, CloudWatch, Budgets).
- **Bedrock access to Claude Haiku 4.5 in `us-east-1`.** A new account must first fill in Anthropic's use-case form in the Bedrock console. Without it every Converse call fails with `ResourceNotFoundException: Model use case details have not been submitted for this account`. The stack still deploys; the Coach then falls back to templated Cues, so a missing model grant looks like a bland Coach, not an outage.
- An email address you can read. It receives the budget and alarm emails, and SNS sends a **confirmation link you must click**. Until you do, no alarm email arrives.

The stack refuses to synthesise without `-c budgetEmail=<address>`; the address is never stored in source.

## Deploy a fresh stack

```bash
# 1. Siblings and dependencies
git clone https://github.com/SebAustin/pose-reps.git ../pose-reps     # skip if it is already next to this repo
# The shared packages and the services need their own install too: infra and the phone link to them by path
# and resolve zod from the linked folder. Without this, synth fails with "Cannot find module 'zod'".
for d in packages/protocol packages/events-client services/session services/coach apps/phone infra scripts; do (cd $d && npm ci); done   # (verified in a fresh clone)

# 2. Build the phone web app first, so the stack uploads the real app instead of a placeholder page
(cd apps/phone && npm run build)

# 3. One-time per account and Region. The context flag is required: bootstrap synthesises the app.
(cd infra && npx cdk bootstrap -c budgetEmail=you@example.com)         # (not run)

# 4. Deploy and capture the outputs
(cd infra && npx cdk deploy -c budgetEmail=you@example.com --outputs-file cdk-outputs.json)   # (not run)

# 5. Turn the outputs into the shared client config
(cd infra && npm run write-client-config)                              # (verified, against the existing outputs file)

# 6. Rebuild the TV app against the new stack (see the TV section below)
```

Notes:
- `npx cdk synth -c budgetEmail=you@example.com` **(verified, also in a fresh clone)** and `npm run build` in `apps/phone` **(verified, also in a fresh clone)** run locally and change nothing in AWS. Run them first to catch problems early. `npx cdk diff -c budgetEmail=...` **(verified)** shows what a deploy would change.
- The first deploy takes several minutes, mostly CloudFront (338 s on the first run).
- Step 5 writes `infra/client-config.json`. The committed copy points at the author's stack, so after your deploy `git status` shows it changed. That is expected.
- The phone app finds its API through `config.json`, which CDK writes at the bucket root. You do not need step 5 for the phone, only for the TV.
- To use another model profile: add `-c bedrockProfileId=us.<model-id>`. Only `us.*` system profiles are supported (`infra/lib/bedrock-arns.ts`).
- Smoke test after deploy:

```bash
curl -s "$(jq -r .apiBaseUrl infra/client-config.json)/members"       # {"members":[...]}  (verified against the live API)
(cd scripts && npm run e2e -- --batches 15 --sets 1)                   # (verified) prints SC1 and SC5 lines; creates a Member named "E2E Replay"
```

`npm run e2e` exits non-zero when SC1 fails. SC1 currently misses its 300 ms target on short runs; see the latency section of the architecture doc. Judge the run by SC5 and by receiving all batches.

## Redeploy after a change

| You changed | Do |
|---|---|
| Lambda code (`services/**`, `infra/lambda/**`) or the stack | `cd infra && npx cdk deploy -c budgetEmail=<same address as before>` |
| Phone app (`apps/phone`) | `(cd apps/phone && npm run build)` then the same `cdk deploy`. The phone-shell deployment invalidates CloudFront `/*`. |
| `packages/protocol` or `packages/events-client` | Redeploy (the Lambdas bundle protocol) **and** rebuild the TV (`yarn sync` copies both into the TV app) |
| Coach prompt or model | Run the eval first (`cd services/coach && npm run eval`, 24 Bedrock calls, needs `bedrock:InvokeModel`), then deploy |
| TV app | Rebuild and reinstall the APK; no AWS step |

**Always redeploy with the same `budgetEmail`.** `cdk diff` **(verified)** shows that a different address replaces the Budget and the SNS subscription, and the new subscriber must confirm again.

If `cdk deploy` fails on a Lambda bundle with `npx canceled due to missing packages`, run `npm ci` in `infra/` first: the bundler uses the esbuild installed there.

## TV app after a deploy

```bash
cd apps/tv
yarn install
yarn sync            # reads ../../infra/client-config.json, rewrites packages/shared-ui/src/config.generated.ts and the vendored protocol
yarn sync:check      # (verified) "Vendored files are up to date."
source scripts/android-env.sh && yarn build:apk     # -> dist/couch-coach.apk
bash scripts/fire-tv-wizard.sh                      # guided sideload and first Session; or: yarn install:apk <fire-tv-ip>
```

If `infra/client-config.json` is missing when you run `yarn sync`, the app is built with a placeholder config and shows a "Setup needed" banner. See `apps/tv/DEPLOYMENT.md` for rollout, smoke test and rollback.

## Logs

The Lambdas write JSON logs, retained for 14 days. Application lines carry `sessionId`, and often `memberId`, `call`, `setIndex`, `bedrockMs`, `pollyMs` and `totalMs`.

```bash
G=$(aws logs describe-log-groups --log-group-name-prefix CouchCoachStack-CoachLogs --query 'logGroups[0].logGroupName' --output text)
aws logs tail "$G" --since 1h --follow                         # (verified, without --follow)
aws logs filter-log-events --log-group-name "$G" --filter-pattern '"cue publish failed"' --start-time $(( ($(date +%s) - 3600) * 1000 ))
```

Follow one Session in Logs Insights **(verified)**:

```
fields @timestamp, message.msg, message.totalMs, message.bedrockMs, message.pollyMs
| filter message.sessionId = "<32-hex session id>"
| sort @timestamp asc
```

```bash
aws logs start-query --log-group-name "$G" --start-time $(( $(date +%s) - 7200 )) --end-time $(date +%s) \
  --query-string '<the query above>' --query queryId --output text
aws logs get-query-results --query-id <id>
```

Messages worth searching for:

| `message.msg` | Meaning |
|---|---|
| `coach call accepted` | `POST /coach` passed the token and the caps |
| `cue published` | The Cue reached AppSync; `hasAudio`, `bedrockMs`, `pollyMs`, `totalMs` show where the time went |
| `bedrock failed, using templated cue` | Bedrock errored or timed out (6 s). Check access and quotas |
| `polly/s3 failed, text-only cue` | No audio this time |
| `publish failed` / `cue publish failed` | AppSync rejected or timed out the publish (twice, for the latter) |
| `token rejected` | `reason` is `malformed`, `bad_signature`, `session_mismatch` or `expired` |
| `coach call refused` | `reason: cap_exceeded` (30 per Session) or `no_session` |
| `daily coach ceiling reached` | 300 calls used for the UTC day |
| `async hand-off failed, running inline` | The self-invoke failed; the job ran inside the request |

Older log lines (before the 2026-10-21 logger fix) hold `message` as a JSON string, so `message.sessionId` does not match them.

There is no API Gateway or CloudFront access logging (`SECURITY.md` L10), so abuse cannot be traced by caller.

On the TV: `adb logcat -s ReactNativeJS:V AndroidRuntime:E`, and the debug overlay (Menu button on Live). The phone has a debug panel and an "Export last 30 s" landmarks file, shown when the phone URL carries `&debug=1`.

## Alarms and what to do

Five CloudWatch alarms notify the SNS topic `Couch Coach alarms`, which emails `budgetEmail`. Check their state with:

```bash
aws cloudwatch describe-alarms --alarm-name-prefix CouchCoachStack --query 'MetricAlarms[].[AlarmName,StateValue]' --output text   # (verified: all OK)
```

| Alarm | Fires when (5 min window) | First steps |
|---|---|---|
| `Api5xxAlarm` | any HTTP API 5xx | Look for `session handler failed` or `coach handler failed` in the Lambda logs |
| `CoachErrorsAlarm` | any coach Lambda error | Same logs; check a failed async job (`retryAttempts` is 0, so a failed job is not retried) |
| `BedrockInvocationsAlarm` | 40 or more Converse calls | Normal during a long demo with many Sets. A spike with no demo means abuse: see below |
| `PollyCharactersAlarm` | 6000 or more characters | Same as above |
| `CoachInvocationsAlarm` | 100 or more coach invocations (each Cue is two) | Same as above |

A $50 monthly budget also emails at 80% of actual spend (AWS Budgets data can lag by hours, so the alarms above are the fast signal).

**If you suspect abuse** (spend alarms with nobody using the demo), in order:
1. Cap the coach: `aws lambda put-function-concurrency --function-name couch-coach-coach --reserved-concurrent-executions 0` stops all Cues at once **(not run)**. Restore it to 3 afterwards, or redeploy, which resets it to the stack's value.
2. Revoke the AppSync key (next section) to cut off pose and event traffic.
3. Read the logs for the affected Sessions.

The built-in ceilings are a daily limit of 300 coach calls, 30 per Session, coach concurrency of 3 and per-route throttles (architecture doc, "Failure handling").

## Revoke the API key after judging

The AppSync key is public by design (it ships in the repo, the APK and the phone `config.json`) and expires on 2026-12-15 on its own. Revoke it earlier once judging ends.

```bash
API_ID=$(aws appsync list-apis --query "apis[?name=='couch-coach-events'].apiId" --output text)   # (verified)
aws appsync list-api-keys --api-id "$API_ID" --query 'apiKeys[].[id,expires]' --output text         # (verified)
aws appsync delete-api-key --api-id "$API_ID" --id <key id from the line above>                      # (not run)
```

Effects: the TV and phone can no longer connect, so the demo stops working. Coach publishing is unaffected, because the coach Lambda uses IAM, not the key. The stack now differs from CloudFormation; a later `cdk deploy` creates a new key and changes `eventsApiKey`, so you must run `write-client-config` and rebuild the TV and phone to use it.

If you plan to run the project on, also address `SECURITY.md` M1 (shared Household) first.

## Tear down: `cdk destroy`

```bash
cd infra && npx cdk destroy -c budgetEmail=you@example.com       # (not run)
```

- The email is required only because synthesis needs it; use the same one.
- The stack sets `RemovalPolicy.DESTROY` on the DynamoDB table, both S3 buckets (`autoDeleteObjects`, which runs a helper Lambda to empty them), the Secrets Manager secret and the log groups. **All Members and Set history are deleted.** Nothing is retained.
- Left behind: the CDK bootstrap stack `CDKToolkit` and its staging bucket (shared by any CDK app in the account and Region; remove them only if nothing else uses them).
- Secrets Manager may keep the HMAC secret in a scheduled-deletion state for a while after the stack is gone. Check with `aws secretsmanager list-secrets --include-planned-deletion`. (Not verified.)
- Afterwards, `aws cloudformation describe-stacks --stack-name CouchCoachStack` should return "does not exist".
- The TV APK and the `pose-reps` repo are unaffected.

## Costs

Everything is pay per use, with no always-on compute. These are estimates from public list prices at the time of writing; check the pricing pages before relying on them.

| Item | Driver | Rough size |
|---|---|---|
| Coach calls | Bedrock Haiku 4.5 (short prompt, 80 output tokens) plus Polly neural (about 150 characters per Cue) | Well under one cent per Cue. At the daily ceiling of 300 calls, around one dollar a day at most |
| AppSync Events | Per operation and per connected minute. An active Session publishes about 5 pose batches a second, about 18,000 an hour, each delivered to the TV | Small for a demo; check current Events pricing before a long-running or public deployment |
| Secrets Manager | One secret | About $0.40 a month |
| DynamoDB | On demand, TTL on Sets (90 days), Sessions and quota rows | Cents |
| S3, CloudFront | Phone app bundle (about 45 MB with the MediaPipe WASM), audio files that expire after 1 day. Price class 100 | Cents unless the phone app gets heavy traffic |
| Lambda, API Gateway | Arm64, 256 and 512 MB, throttled | Cents |
| CloudWatch | Logs kept 14 days, five alarms | Cents |

Guards: the daily ceiling and per-Session cap, reserved concurrency 3, per-route throttles, the three spend alarms, and a $50 monthly budget. The worst case without those guards was estimated at over a thousand dollars a day (`SECURITY.md` H2), which is why they exist. A forgotten stack costs a few dollars a month even when idle, mostly the secret and CloudFront, so run `cdk destroy` when you are done.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| TV says "Can't reach Couch Coach" | The TV is offline, the API is down, or the APK has the wrong config. It retries every 10 s. Test `curl <apiBaseUrl>/members`. If you redeployed, run `yarn sync` and rebuild the APK. |
| TV shows a "Setup needed" banner | `yarn sync` ran without `infra/client-config.json`. Run `npm run write-client-config` in `infra`, then `yarn sync` and rebuild. |
| Phone page is blank or says the link is bad | The QR link lost its `s` or `t` parameter, or the token expired (2 h). Press New code on the TV. |
| Phone cannot use the camera | The page needs HTTPS (CloudFront serves it) and a permission prompt accepted. On iPhone use Safari. |
| Phone says "Step back" or counts nothing | The legs are out of frame (`pose-reps` ignores frames missing hips, knees or ankles). Put the phone back about 2 to 3 m, upright. Squats work best with the phone about 45 degrees in front, jumping jacks head-on. |
| TV shows "Lost your phone" | No signal for 10 s: phone locked, left the app, or lost Wi-Fi. Wake the phone; the TV reconnects on its own. After 30 s use New code. |
| TV shows "We can't see you" | The phone is alive but sees nobody. Step into frame. |
| Reps are over- or under-counted, Faults look wrong | Camera angle and a small body in frame are the main causes (`../pose-reps/README.md`, "Camera placement and limits"). Record with `RECORD_DIR=dir npx tsx scripts/debug-session.ts` and replay with `scripts/replay-export.ts`. |
| "The Coach is quiet this time" on the TV | No Cue within 12 s. Check in this order: (1) logs for `bedrock failed` or `publish failed`; (2) `coach call refused` (cap or daily ceiling, HTTP 429); (3) the phone and TV subscribe to `/coach/<id>` (ADR 0006); (4) the Lambda role and Bedrock access. |
| Cues read like a template ("Nice work, Sam: 8 squat reps. Next set, focus on knees caving.") | The templated fallback: Bedrock failed. Look for `bedrock failed, using templated cue`. `AccessDeniedException` or "Model use case details have not been submitted" means the account lacks Haiku 4.5 access. |
| Cue text appears but no voice | Polly or S3 failed (`polly/s3 failed`), the presigned URL expired (15 min), or the TV blocked a non-S3 URL. The audio row shows "Audio unavailable". |
| `POST /coach` returns 429 | `coach call limit reached for this session` (30 per Session; start a new Session) or `daily coach call limit reached` (300 per UTC day; resets at 00:00 UTC). |
| `POST /coach` returns 401 | Token expired (2 h), or the Session row is gone. Start a new Session. A rotated HMAC secret also invalidates every live token. |
| `POST /members` returns 409 "household is full" | The shared Household holds 20 Members (hidden ones count) and there is no delete endpoint. Delete a profile item by hand: `aws dynamodb delete-item --table-name <table> --key '{"pk":{"S":"MEMBER#<id>"},"sk":{"S":"PROFILE"}}'` **(not run)**. |
| A test Member shows up on the TV | Hide it without losing its Coach memory: `aws dynamodb update-item --table-name <table> --key '{"pk":{"S":"MEMBER#<id>"},"sk":{"S":"PROFILE"}}' --update-expression 'SET hidden = :t' --expression-attribute-values '{":t":{"BOOL":true}}'` **(not run)**. `GET /members` omits hidden Members unless called with `?includeHidden=1`. |
| `error TS2307: Cannot find module 'zod'` in a build, test or `cdk synth` | A file-linked package (`packages/*`, `services/*`) has no `node_modules`. Run `npm ci` in it (loop in "Deploy a fresh stack"). |
| Subscribe is rejected as unauthorized | The channel path is not an exact `/cc/<32 hex>/<segment>` or `/coach/<32 hex>`, or contains `*`. That is the `onSubscribe` guard working. |
| Skeleton lags or stutters | Pose rate is limited by the phone (7.5 to 15 fps seen in the first test). The TV adds 150 to 450 ms of playout delay on purpose. Open the debug overlay to see fps and starved samples. |
| `adb: device offline` | Wait a few seconds after boot, then `adb kill-server && adb start-server`. For a Fire TV, re-check ADB debugging and the "Allow USB debugging" prompt. |
| `cdk` says it needs `budgetEmail` | Pass `-c budgetEmail=you@example.com` to every `cdk` command, including `bootstrap`, `diff`, `synth` and `destroy`. |
| `ts-node` or `tsx: command not found` from CDK | CDK runs `node --import tsx bin/app.ts`. Run `npm ci` in `infra/` so `tsx` exists. |
