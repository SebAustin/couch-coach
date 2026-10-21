# STATUS (resume point)

_Last updated: 2026-10-21 by the orchestrator._

Deadline: **Fri 2026-10-23 12:00 PT**. Plan of record: `PLAN.md` (r4).

## Done
- Skill plugins updated (mattpocock-skills 1.3.1, ai-project-agency 1.3.15).
- PLAN r4 written; ADR 0004 records the AgentCore → Bedrock Converse decision.

- Repos live; protocol (12 tests); UX spec `docs/ux.md`.
- pose-reps v0.1.0 tagged, CI green, 55 tests, 97.6% stmt / 92.9% branch coverage (synthetic fixtures only).
- events-client (36 tests) + phone app (23 tests), verified headless with mocked AppSync; not yet against real AppSync or a real phone.

- AWS stack `CouchCoachStack` deployed (us-east-1); phone app live at https://d36nqce57j19po.cloudfront.net; smoke test: POST /coach → Cue 0.9 s warm / 2.5 s cold (templated Cue).

## In progress
- Android toolchain + TV app.

## Demo notes
- Place the phone about 45° in front for squats and straight on for jumping jacks (2D heuristics; see pose-reps README).
- Thresholds need one pass on real footage at checkpoint 1 (heel rise and knee cave are the most view-dependent).

## Next
- Step 1 parallel build: pose-reps, infra + services, protocol + events-client, Android toolchain.

## Waiting on the user
- Submit the Anthropic use-case form in the Bedrock console (Haiku access); until then Cues are templated. No redeploy needed once it lands.
- Confirm the AWS SNS subscription email for the coach alarms.
- Checkpoint 1 (Oct 22): enable ADB debugging on the Fire TV and give its IP.
- Checkpoint 2: film the video, upload to YouTube, submit on Devpost, decide on npm publish.

## After judging
- Revoke the AppSync API key (expires 2026-12-15 anyway) and `cdk destroy` if no longer needed.
