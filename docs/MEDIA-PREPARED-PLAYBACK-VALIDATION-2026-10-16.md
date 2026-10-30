# Real-model prepared playback composition — 2026-10-16

Status: scoped engineering test passed. Production startup and Home acceptance were implemented subsequently;
see [the production slice record](MEDIA-CO-WATCHING-PRODUCTION-2026-10-16.md) for its separate live evidence and pending
desktop-delivery acceptance. The owner authorized continued development/testing and real models, preserving the
existing no-task-creation/binding choice. No commit, push, archive or production profile change was performed.

## What was tested

The test uses the unchanged production `ChatAgent`, OpenAI-compatible model factory, confined `read_file` and
`write_file`, Co-Watching classification adapter, accepted-work/Run/Effect owners and prepared publication.
The real model is the designated `deepseek-flash`. A real Edge video supplies observations through the installed
extension, paired Rust Shell and running Core. The test reads those observations over the operator RPC and drives
the actual selected player over loopback CDP. It leaves the video paused and observation enabled.

The input is R7's original successful native result for BV1UEaq6qEZt / CID 42265479965 / page 1, verified against
SHA-256 `06c65b0e23d4edebda8d6bb50830c5cef66378696213546e9a848dffe704f380`. No native analysis was resubmitted.
The model reads the full original JSON and a test Skill-style instruction file through real file tools, then writes
four proposed candidate texts into its isolated Workspace. The source/instruction files are write-protected at the
tool path boundary. Candidate identities and native moment bindings are validated before staging.

The accepted purpose, captured authority/Host manifest, concise test persona and final transport acknowledgement
come from controlled test fixtures. The test uses real SQLite owners, but their database is separate from the live
desktop Core database. The accepted-source gate reads a bounded current playback snapshot; it is not a new production
adapter or cross-process atomic authorization. No generated test utterance was inserted into the owner's live Timeline.
Passing therefore does not prove the production acceptance UI, full Character context, Skill installation/governance,
remote Host behavior, live MCP/native service reads, in-flight provider cancellation or actual desktop delivery.

## Observed behavior

| Scenario | Observed result |
| --- | --- |
| Non-primary preparation | Model used actual file tools and produced four valid bound candidates; no conversation rows |
| Paused playback | First candidate held, no transport call |
| Playing the same source | First candidate sent through the fixture transport; publication added no model Effect |
| Foreground input | Primary reservation deferred background publication |
| Revision | Ordinary foreground Agent read the plan and wrote revision r2; first published text remained byte-identical |
| Later playback | Second revised candidate sent; requesting the first under r2 refused as already committed |
| Forward skip beyond a moment | Candidate retired as `expired`, with no catch-up speech |
| Stop while quiescent | Accepted root cancelled; a later candidate request refused; Timeline stayed unchanged |
| M51 publication accounting | Two children had no model Effects; no Initiative model-opportunity row was created |

The foreground Timeline retains actual file-tool calls and results. Example revised output was:
“遮罩式那种最稳，叠式和共享元素花哨是花哨，用不好就容易出问题。”
The wording is grounded in the existing analysis and visibly shorter after revision. This inspection is not owner
persona/quality acceptance, and the underlying tiny-ASR limitations recorded with R7 still apply.

## Runs and accounting

First run: `.runtime/prepared-playback-real-20261016-105210/`. Preparation, revision and two publications passed;
the test then expected `suppressed` for a pre-dispatch gate rejection. A deterministic reproduction showed that
the existing coordinator correctly retires it as `expired`. Nothing was sent. The test expectation was corrected,
and a regression pins that reopening the gate cannot revive the retired candidate. No production logic was changed.
This first harness version did not retain all usage rows before cleanup; its model usage is unknown, not zero.

Successful rerun: `.runtime/prepared-playback-real-20261016-105901/`. The complete live test passed in 25.89 seconds
(Vitest total 29.35 seconds). Its eight recorded model Effects and eight usage rows report 157,910 input tokens,
2,228 output tokens, and 160,138 total tokens. These are the successful run's returned-usage subtotal only.
Physical HTTP retry count and billed monetary cost were not measured. The first run is not included in that subtotal.
Playback/publication/Stop used no additional model request. Full native JSON is read during the test; this fixture's
aggregate input volume is not a measured production per-utterance cost or an optimized prompt budget.

Evidence includes `observations.json`, `preparation.json`, `revision.json`, `timeline.json`, `run-events.json`,
`usage-rows.json`, `effect-rows.json`, `summary.json`, `source-manifest.json`, and `final-playback.json`.
The final actual browser source remains paused at 137.6 / 300 seconds. All existing application processes remain running.

## Code and verification

- `packages/core/src/co-watching/real-prepared-playback.test.ts`: explicit paid-test opt-in, real preparation/revision,
  live player gate, two publications, no-replay/expiry/Stop checks, and failure-safe evidence.
- `packages/core/src/testing/real-playback-client.ts`: loopback-only Core/CDP test client with deadlines and schema validation.
- `prepared-publication-fixture.ts`: explicit finite test expiry/model labels and separate Workspace path accessor.
- `delivery/prepared-publication.test.ts`: irreversible pre-dispatch retirement regression.
- Core typecheck and scoped ESLint passed. The final default run passed 26 deterministic tests and skipped the live
  test as intended; the separately opted-in real-model run passed. No broad unrelated acceptance gate is claimed.

The local `.runtime/media-implementation-20261015-playback/run-real-prepared-test.ps1` launcher reads only the
designated provider keys into its child environment. It creates a new evidence directory and preserves historical
attempts. Credentials and raw provider exceptions are not written into the test report. Ordinary package tests
remain non-paying unless `TAKI_E2E_REAL_PREPARED_PLAYBACK=1` is explicitly supplied.

## Next production boundary

Implement the authenticated explicit acceptance producer and exact native-result/source binding through the
existing owners, then connect standard Skill preparation and real final delivery. Preserve the source-only browser
contract: observing a video cannot create consent. Conversation/revision, Stop races and full restart/Continue must
subsequently be tested through that actual entry; the current fixture cannot certify those absent production paths.
