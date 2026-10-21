# Contracts between parallel workstreams

Read this before touching another workstream's code. Shared schemas live in `packages/protocol/src/index.ts`; that file is the source of truth, and this doc only explains it.

## Packages are standalone (no npm workspaces)
Each folder has its own `package.json` and lockfile; depend on siblings with `file:` paths, e.g. `"@couch-coach/protocol": "file:../../packages/protocol"`. This lets parallel builders run `npm install` without racing on one lockfile. `@couch-coach/protocol` ships TypeScript source (`main: ./src/index.ts`); esbuild (CDK `NodejsFunction`), Vite and vitest consume it directly.

## pose-reps public API (repo `../pose-reps`, MIT)
```ts
export type Landmark = { x: number; y: number; z?: number; visibility?: number }; // normalized 0..1, MediaPipe indices
export type Pose = readonly Landmark[]; // length 33
export type ExerciseId = 'squat' | 'jumping_jack';
export interface FaultDef { id: string; label: string; weight: number }
export const FAULTS: Record<ExerciseId, readonly FaultDef[]>;
export interface RepResult { index: number; faults: string[]; score: number; startMs: number; endMs: number }
export interface Counter {
  push(pose: Pose, tMs: number): RepResult | null; // returns a RepResult when a rep completes
  reps(): readonly RepResult[];
  setScore(): number; // mean of rep scores, 0 when no reps
  reset(): void;
}
export function createCounter(exercise: ExerciseId, options?: Partial<CounterOptions>): Counter;
export function scoreRep(exercise: ExerciseId, faultIds: readonly string[]): number; // 100 - sum(weights), floor 0
```
Fault ids and weights:
| Exercise | id | weight |
|---|---|---|
| squat | `shallow_depth` | 30 |
| squat | `knees_caving` | 25 |
| squat | `torso_lean` | 20 |
| squat | `heels_rising` | 15 |
| jumping_jack | `arms_not_overhead` | 30 |
| jumping_jack | `feet_not_wide` | 30 |

`ExerciseId` values match `Exercise` in the protocol.

## HTTP API (API Gateway HTTP API, CORS `*`, JSON)
| Route | Body | Response |
|---|---|---|
| `GET /members` | — | `{ members: Member[] }` |
| `POST /members` | `{ name }` | `Member` (201) |
| `POST /session` | `{ memberId }` | `SessionResponse` (201); `phoneUrl` = `<phone CloudFront URL>/?s=<sessionId>&t=<phoneToken>`; the TV appends `&m=<memberId>` to the QR |
| `POST /coach` | `CoachRequest` | `202 { ok: true }`; the Cue arrives later on the coach channel. 401 on bad token, 429 over the 30-call cap. |

`phoneToken` = `base64url(sessionId.exp)` + `.` + `base64url(HMAC-SHA256(secret, sessionId.exp))`, valid 2 h.

## AppSync Events
- Namespace `cc`, API-key auth for subscribe and publish. Channels from `channels(sessionId)`: `/cc/<id>/pose`, `/cc/<id>/events`, `/cc/<id>/coach`.
- Phone publishes `PoseBatch` (3 frames, ~5 publishes/s) and `PhoneEvent`; its `hello` carries `aspect` (camera width / height). The TV publishes `{type:'control', action:'end_session'}` on the events channel when the Member ends the Session from the TV, and the phone must handle it (stop the camera and show "Session ended"). the coach Lambda publishes `CoachMessage` (first `thinking`, then `cue`); the TV subscribes to all three.
- Realtime: `wss://<eventsRealtimeHost>/event/realtime`, subprotocols `['aws-appsync-event-ws', 'header-' + base64url(JSON.stringify({ host: eventsHttpHost, 'x-api-key': key }))]`. Send `{type:'connection_init'}`, wait for `connection_ack` (has `connectionTimeoutMs`; `ka` keep-alives reset the timer). Subscribe: `{type:'subscribe', id, channel, authorization:{host, 'x-api-key'}}` → `subscribe_success`; data arrives as `{type:'data', id, event: '<JSON string>'}`. Publish over WS: `{type:'publish', id, channel, events:['<JSON string>'], authorization:{...}}` → `publish_success`.
- HTTP publish (Lambda): `POST https://<eventsHttpHost>/event` with `{ channel, events: ['<JSON string>'] }` and header `x-api-key`.

## Client config
CDK writes `ClientConfig` (see protocol) to:
- `config.json` at the root of the phone web bucket, which the phone fetches at startup;
- `infra/client-config.json` via `infra/scripts/write-client-config.ts` (from `infra/cdk-outputs.json`). Committing it is fine: the API key is a public client key scoped to `/cc/*` that expires 2026-12-15. The TV's `apps/tv/scripts/sync-shared.mjs` turns it into `config.generated.ts`.

## Ownership (parallel build, Oct 21)
| Workstream | Owns | Must not edit |
|---|---|---|
| A pose-reps | `../pose-reps/**` | couch-coach |
| B cloud | `infra/**`, `services/**` | apps, packages |
| C client | `packages/events-client/**`, `apps/phone/**` | infra, services, apps/tv |
| D TV | `apps/tv/**` | everything else |
| UX | `docs/ux.md` | code |
| Orchestrator | `packages/protocol/**`, root files, `docs/CONTRACTS.md`, `PLAN.md`, `STATUS.md` | — |
A change needed in someone else's area goes in your final report, not in their files.
