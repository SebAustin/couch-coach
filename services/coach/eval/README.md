# Coach Cue eval

Calls Bedrock (real `buildCoachPrompt` + `converseCue` + `cleanCueText`) on 12 fixed cases and scores each Cue
with deterministic checks. `npm test` never calls AWS; this does.

```bash
cd services/coach
npm run eval                                   # 2 runs x 12 cases = 24 Bedrock calls, gate 90%
EVAL_RUNS=1 npm run eval                       # 12 calls, for quick iteration
EVAL_CASES=jj-observed-feet-worse npm run eval # one case
EVAL_RESCORE=eval/results/latest.json npm run eval  # re-check saved Cues, 0 calls (use after editing checks)
```

Needs AWS credentials with `bedrock:InvokeModel` on the Haiku 4.5 inference profile (`MODEL_ID`, default
`us.anthropic.claude-haiku-4-5-20251001-v1:0`, region `us-east-1`). Results land in `eval/results/latest.json`
(Cues, checks, inference config, system prompt). `baseline.json` is the pre-fix prompt on the same cases.

## Cases (`cases.ts`)
Squat and jumping jack; clean sets; one dominant Fault; mixed Faults; no history, other-exercise history only,
and same-exercise history that improved, got worse or stayed the same. `jj-observed-feet-worse` replays the
live bug ("feet staying wider" with `feet_not_wide` on 8 of 10 reps).

## Checks (`checks.ts`), all must pass for a Cue to pass
| Check | Rule |
|---|---|
| `words<=35` | cleaned Cue has at most 35 words |
| `sentences<=2` | raw model output has at most 2 sentences (cleanCueText would hide overruns) |
| `dominant-area-or-praise` | mentions the main Fault's body area, or praises a clean set |
| `no-fault-contradiction` | never calls a Fault on >= 30% of reps good/absent ("your feet are staying wider"), never calls a faulty set clean |
| `no-false-trend` | no progress claims unless the trend is improved; no past references on a first-ever set |
| `no-unrelated-body-part` | no body part outside the Exercise's Fault areas (e.g. elbows on a squat) |
| `name-policy` | name (or any part of it) used at most once, and only on sets 1, 4, 7... |

The checks are keyword rules: cheap and repeatable, but they do not judge tone or variety. Read the Cues in the
report. When a check misfires, add the Cue to `test/eval-checks.test.ts` first, then fix the rule and rescore.
