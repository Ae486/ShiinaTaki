# C4 deterministic production-process acceptance

Date: 2026-09-28. Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.
Task: `09-11-initiative-intentions-acceptance`. This report records engineering execution, not owner acceptance.

## Scope and real boundaries

Added `e2e/src/initiative-recovery.e2e.test.ts` and
`e2e/src/fixture/initiative-interview-seed.ts`. The suite uses the existing
`startInitiativeProcess({productionEntry: true})`: its process entry imports unmodified production `Core/main.ts`
and exposes IPC only for readiness and shutdown. Actual operator WebSocket RPC, ChatAgent/installed AI SDK, governed
tools, canonical SQLite Run/Attempt/Effect/Delivery owners, source adapters, WakeEngine, selected context, recall,
Timeline and Monitor are exercised. No production source injection or test-only dispatch command is used.

The model transport is the existing loopback OpenAI-compatible scripted SSE provider. It returns deterministic
tool calls; Core executes those calls and sends their actual results in subsequent SDK requests. This proves
production wiring and lifecycle behavior, not language-model judgment or provider generalization.

## Isolation and retained policy

- Each of the three scenarios creates its own validated `taki-intention-process-*` temporary root, database,
  provider server and fresh Core WebSocket port. Graceful stop is awaited before restart. Every read-only SQL
  observation closes its connection. Test teardown closes sockets, Core and provider and removes only that root.
- All Memory seeding happens before Core startup. `seedCanonicalLocal` establishes the canonical Local baseline;
  `seedInitiativeInterviewMemory` calls `CanonicalMemoryRepo.retain` to create a real Source, Unit, Policy, FTS entry,
  retained snapshot and operation receipt. No test writes SQLite while Core owns it.
- The seeded `e2e-character` record uses the existing `episodes` layer with `retrieved` visibility and permanent
  retention. Its synthetic user-reported interview outcome is explicitly unknown. A unique probe occurs in the
  retained Source/Unit data, never in Pattern purpose, primary user message or Memory Blocks.
- Production model/utterance budgets, model cadence, output lifetime and check interval remain unchanged. Tests use
  authenticated settings to select `taki`, fixed UTC and a valid quiet-hours window outside the current hour.
  Periodic wakes are disabled and event sources enabled through their actual controls. The master switch initially
  stays disabled while the primary tool creates the plan, then is explicitly enabled.
- Automatic windows are ordinary model-tool inputs: the first case starts five seconds later and expires after
  sixty seconds; offline cases start ten seconds later and expire after eighteen seconds. There is no fake clock,
  shortened production cadence, lowered hard quota, native process or remote paid provider.

## Executed scenarios

| Scenario | Observed evidence |
| --- | --- |
| Automatic plan, one-shot consumption and restart | Actual primary `plan_follow_up` returns `created`, then a differently worded second call returns `duplicate`. SQL contains one exact original finite window and the real user Timeline source. Pattern, review and Scheduled Task tables stay empty. Master-disabled state creates zero heartbeat Runs. Enabling admits one heartbeat Run; actual `heartbeat_respond(silent)` completes and terminally consumes the plan. Real process restart and policy reevaluation retain the same terminal source identity with no additional provider request or Run. |
| Offline expiry followed by independent recalled question | Core is stopped before `notBefore`; SQL confirms zero heartbeat Runs. Wall-clock waiting exceeds the original eighteen-second deadline. Reopened production Core marks the old plan expired, clears prospective content and leaves its Run ID null. Master-toggle reevaluation still creates no old Run. A new operator-proposed and explicitly confirmed current-window Pattern creates an independent opportunity. Actual bounded `recall` reads Global and Character separately; only its Character result introduces the probe and confirmed interview record. The next SDK request then commits a fresh question through ordinary Timeline. The original Intention remains expired and the matter remains unknown. |
| Offline expiry with subsequent Memory withdrawal | After the same expiry path, an actual primary `invalidate_memory` call applies revision 2 to the seeded Character record while old user Timeline remains. A separately reviewed Pattern still admits an independent Run, but actual recall excludes that invalidated probe/record. The scripted model deliberately chooses silence, so no follow-up question is published. The old plan remains expired and neither process restart nor rechecking replays it. |

The independent Pattern is authored and confirmed by real operator RPC rather than prewritten database rows.
The normal case asserts that its first heartbeat request contains no probe. After real Global and Character
recall results arrive, the scripted provider asserts the confirmed Character record and the literal unknown-outcome
fact before returning speech. It never pretends an unexecuted recall returned a fact. The withdrawal variant asserts
the old probe is absent from the actual Character result before choosing silence.

The live C4 tool contract is `recall({scope: "global" | "character"})`, one selected-topic attempt per Bank. The broader
canonical primary recall tool supports `both`, but the C4 wrapper does not. The tests follow the installed C4 interface;
the query and per-Bank limits remain Core-owned and frozen from the offered purpose.

## Monitor and backoff observations

- Actual Monitor trajectory RPC parses through `TrajectoryResultSchema`, includes delivery lifecycle rows and reports
  one model request for direct silence or three model requests for Global recall, Character recall and final decision.
  Each is one heartbeat Run; an SDK tool-loop step is not mislabeled as another judgment.
- An unauthenticated fresh WebSocket is refused with `NOT_AUTHENTICATED` for both backoff read and reset. The existing
  fixture's trusted-loopback operator connect then permits the real methods. This checks the connection boundary;
  remote pairing-token provisioning is outside the scenario.
- Explicit reset returns normal stage, zero qualified weak evidence, the actual one daily judgment and an operator
  reset timestamp. Those values survive a real Core process restart. Reset does not erase the canonical judgment
  count or let the same consumed source bypass the normal model cadence.
- No fake presentation reports or qualified non-engagement rows are inserted. These cases do not establish repeated
  weak-feedback stage progression or real screen exposure; deterministic owning-service and native evidence remain
  separate.

## Commands and exact observed results

| Command | Result |
| --- | --- |
| `pnpm --filter @taki/e2e exec vitest run src/initiative-recovery.e2e.test.ts` | **3 tests passed**, 1 file. Started 20:48:52 local time; 73.01 seconds total, 70.90 seconds in tests. |
| `pnpm --filter @taki/core exec vitest run src/initiative/wake/wake-intention.integration.test.ts` | **16 tests passed**, 1 file. Started 20:54:14 local time; 7.66 seconds total. |
| `pnpm exec eslint e2e/src/initiative-recovery.e2e.test.ts e2e/src/fixture/initiative-interview-seed.ts packages/core/src/initiative/wake/wake-intention.integration.test.ts` | Passed, no diagnostics. |

The additional sixteenth module integration test verifies the root's finite unavailable-source retry behavior:
with periodic wakes off and source temporarily unavailable, the event timer attempts no model and retains one
bounded next check. Restoring the source permits one ordinary admission at that check, preserving the original
window and leaving no replay timer. This test uses fake timers at the module boundary; the process tests above use
the real wall clock.

The first process run passed without weakening assertions or changing production behavior. The initial scoped
lint found a test teardown `throw` lexically inside `finally`; extracting the validated cleanup function fixed it
without changing isolation. No full test suite, real-provider suite or native acceptance was run by this worker.

## Remaining boundaries

- Local canonical recall and direct record invalidation are proven here. Hindsight live/degraded-provider behavior,
  remote synchronization, physical retention deletion and derived-record global erasure are not claimed.
- The withdrawal occurs after the original plan expired. It proves a fresh independent judgment excludes withdrawn
  Memory while preserving old Timeline; it is not by itself proof of every ingestion-receipt-to-active-Intention
  invalidation path. Those exact witness paths have their own Memory/domain tests.
- The suite proves ordinary Timeline publication and Monitor evidence. It does not prove native rendering, human
  reading, subjective wording acceptance or owner confirmation. Parent manual acceptance criteria remain pending
  unless separately confirmed by the owner.
- Root owns the final shared/Core/Desktop/E2E typecheck, full build/regression gate and formal review. The separate
  reviewer owns any express-only terminal lifecycle correction; this worker did not modify that production path.

## Admission-push regression added after the initial process run

The reviewer identified that actual new Class B admission must also publish the separate backoff invalidation,
before qualified feedback exists. The two offline/independent-Pattern variants now read backoff first, assert zero
daily judgments, and capture the operator socket's notification length after that ordered read response. They then
confirm the independent Pattern with no intervening primary user turn, require a new authenticated
`INITIATIVE_BACKOFF_METHODS.changed` notification for `taki`, and re-read an actual daily judgment count of one.
This baseline cannot count an earlier primary engagement/reset notification as admission proof. The test makes
no stronger exact-once notification or replay-count promise.

Scoped ESLint passed after this assertion was added. The 3/3 process result above predates this final assertion;
root owns the final combined production-process rerun after the review fix. No production file was changed by
this test follow-up.

## Final integration-owner rerun

The root reran all three initiative process suites and the local provider-observer suite after the final C4
production fixes and the admission-specific notification assertions. `validation/process-final.log` records
**4 files / 32 tests passed**, including these three recovery cases, in 287.88 seconds. This supersedes the
pending-rerun boundary above without changing its historical first-run result. Real-provider and native outcomes
remain separately documented.
