# Independent final Runtime review

Date: 2026-10-25. Result: one verified actionable finding. Production/test review was read-only; this document is the only owned write. The coordinator assigned the repair separately after this report.

## P2 — A transient idle admission failure permanently disables automatic handling for that Character

Location: `packages/core/src/harness/subagent-inbox-execution.ts:29` and `:34-38`.

Every exception from `executeInbox` adds the Character to the process-lifetime `refused` set. Later hints skip that Character before admission. The only reset is `retry()`, called by `SubagentService.authorityChanged()` at `packages/core/src/harness/subagent-service.ts:61-64`. A production-source search found no caller of `authorityChanged`; `subagent-composition.ts:26-28` and the queue callback in `main.ts:436-439` only invoke `released()`, which does not reset the latch.

Reachable scenario: a completed child event is accepted while the primary lane is occupied. Once idle, its first main-handler admission fails before any model intent, for example when the configured Hindsight connection is temporarily unavailable. Production snapshot capture awaits Memory at `run-snapshot-capture.ts:68`, and `memory/hindsight/hindsight-memory-subsystem.ts:70-72` checks its current connection. After the dependency recovers, queue releases and later accepted events still skip the Character. The accepted event has neither a delivered receipt nor an inbox consumer, so the explicit reconciliation endpoint has no target. A subsequent foreground user request or process restart can incidentally recover it, but ordinary successful idle opportunities cannot. The same Character-level latch also prevents unrelated later eligible events advancing after a delivered handler failure.

Required correction: connect a meaningful production retry/authority-change opportunity to the existing reset, or retain explicit pre-intent retry state that can be safely resumed. Do not retry immediately on the failing attempt's own queue release. Already delivered events must retain reconciliation and never become fresh automatic work.

Confidence: high. This is a demonstrated scheduling/wiring defect, not a request for a new architecture.

### Reproduction evidence

Executed an inline native Node `--input-type=module` probe (Node v24.18.0) against the actual `subagentFixture`, SDK, SQLite repositories and `SubagentService`; no production/test source file was written. The probe:

1. Held the primary Character lane and delegated one child that emitted `complete_subagent`.
2. After the final event was accepted, temporarily replaced the fixture's `runs.admit` with a throwing function for the first idle admission.
3. Released the lane and called `service.released()`; restored normal admission after the recorded failure.
4. Called `released()` three more times, then compared with an explicit `authorityChanged()` call.

Observed output:

```json
{"capturesAfterRecovery":1,"errors":["SUBAGENT_INBOX_EXECUTION_UNAVAILABLE"],"eventState":"accepted","ready":["taki"],"recovery":{"entries":[],"nextCursor":null}}
{"capturesAfterExplicitAuthorityChanged":2,"eventState":"delivered"}
```

The first probe invocation had an invalid text fixture shape (`text` instead of `deltas`) and failed before fixture creation. The corrected invocation above is the evidence. No real Hindsight or network outage was induced; the production failure path is established separately by source inspection.

## Scope and verified boundaries

Reviewed against the current PRD/design/implementation plan, original October 24 direction in `docs/AGENT-DELEGATION-RESEARCH.md`, S0 interface review, slice/root checkpoints, and private-inbox/shared-delegation/accepted-work specs. Verified workspace `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, and preserved the inherited dirty tree. The legacy global avatar task pointer was not treated as the active review authority; the coordinator explicitly assigned `.trellis/tasks/10-25-agent-delegation-conversations`.

Examined the following owners and their directly referenced integration points:

- DB: `subagent-event-repo.ts`, `subagent-input-repo.ts`, `subagent-terminal.ts`, `subagent-inbox-terminal.ts`, `subagent-inbox-repo.ts`, `subagent-inbox-recovery-repo.ts`, `subagent-speech-repo.ts`, `subagent-execution-repo.ts`, `subagent-conversation-repo.ts`, `run-linked-state.ts`, migration runner and migrations 058/060/061/062.
- Runtime: `subagent-service.ts`, `subagent-state.ts`, `subagent-execution.ts`, `subagent-inbox-context.ts`, `subagent-inbox-execution.ts`, `subagent-recovery.ts`, `subagent-activity.ts`, `subagent-composition.ts`, `run-service.ts`, `run-snapshot-capture.ts` and the actual `main.ts` linked-state/recovery/queue/inbox/publication composition.
- Agent/publication: `subagent-interact-tool.ts`, `subagent-tools.ts`, `subagent-delegate-tool.ts`, `run-message-store.ts`, `agent-attempt.ts`, relevant `chat-agent.ts` boundaries, `direct-request-report.ts`, `direct-request-proposal.ts`, `primary-request-witness.ts`, and authenticated `subagent-methods.ts` registration.

The reviewed storage path separates accepted events, actual model-intent inclusion, explicit action/disposition and public speech. Addressed input and its action receipt share a SQLite transaction; needs-input terminal settlement does not overwrite an already answered request. Explicit inbox resume keeps original intents/actions and admits a new consumer through linked admission; unknown non-model effects refuse. Generic validity does not impose a new task deadline, finite source validity remains independent, and old terminal/deadline bytes are retained by migration. Missing process publication grants yield a publication refusal while preserving private handling. These conclusions apply to the examined paths and tests, not every possible runtime failure.

## Fresh checks

Command, from T4:

```text
pnpm --filter @taki/core exec vitest run src/db/subagent-inbox.test.ts src/harness/subagent-inbox-recovery.test.ts src/harness/subagent-interactive.test.ts src/db/migrations/058-agent-inbox.test.ts src/delivery/direct-request-validity.test.ts src/delivery/direct-request-inbox.test.ts src/delivery/direct-request-report.test.ts
```

Result: 7 files / 41 tests passed, 2026-10-25 22:18 local. This includes actual-intent rollback, addressed input/action atomicity, explicit resume identity/rollback/unknown-effect refusal, wait/Stop/day-later continuation, guarded legacy migration and original-request publication validity. The newly reported missing production retry trigger was separately demonstrated by the inline probe; the passing suite did not cover that wiring gap.

## Cross-review coordination and evidence limits

- Context/UI reviewer independently reproduced the SDK swallowing an `onStepEnd` checkpoint exception, permitting another model request and false validated completion. The coordinator assigned that fix to the context owner. This report does not duplicate their finding or claim its later repair passed.
- Hidden-visible-row cursor gap remains an evidence gap, not a final finding. Core currently filters active unmapped rows while returning later input rows without a stable visible watermark. The other reviewer reproduced a read-cache omission for a constructed sequence with more than a page of later rows. I independently confirmed the query semantics, but neither reviewer established a supported production schedule that admits that many later visible inputs before the finish-step mapping closes the gap. Do not escalate this candidate without that reachability evidence.
- No additional verified publication, migration, Stop, addressed-wait or explicit-resume blocker was found in this review. This is not blanket approval of unchecked behavior.
- Native WebView2/Core execution, the coordinator's full suite, the context-owner repair and human acceptance remain separate. This reviewer did not run real provider calls, native Hindsight, T4/main schema convergence, real-user database operations, dependency changes, commit/push or task archival.

## Independent P2 repair recheck — 2026-10-25, 22:35 local

Current finding status: **resolved for the implemented, explicitly scoped retry opportunities**. The original finding and reproduction above describe the pre-fix code and remain historical evidence. Root owns final integration acceptance.

Re-read `subagent-inbox-execution.ts`, `subagent-service.ts`, `subagent-execution.ts`, `subagent-interact-tool.ts`, `subagent-state.ts`, the new retry tests, the terminal after-commit owner and the existing queue/composition path.

Verified production behavior:

- The service now installs `state.inboxOpportunity(characterId)` as a Character-scoped retry. A fresh accepted work/input triggers it; idempotent input/work readbacks do not count as new opportunities. Addressed input uses the committed after-commit callback.
- Accepted `request_parent` interaction events trigger it after commit. Canonical child terminal events trigger it only when their immutable event is eligible. Stop-derived and record-only terminal events do not become wake opportunities.
- The existing RunRepo terminal listener triggers it for an actually completed primary Run. The terminal transition invokes listeners after the canonical SQLite commit, and `main.ts` uses this same composed service/repository. This is real production wiring, not a test-only direct call to the old `authorityChanged` API.
- A failure after actual delivery no longer places the entire Character in the refusal set. Its delivered members remain fenced by existing durable consumer/membership/intents and reconciliation, while independent later eligible events may advance.
- A pre-intent failure still defers automatic recapture. Its own terminal/release path only hints; it cannot reset its own refusal and loop. A fresh opportunity arriving while admission is active records `retryRequested`, so it is not lost when that older admission subsequently fails. A later failure without another fresh opportunity defers again.
- Ordinary opportunity paths pass the exact Character. Other Characters' refusal latches remain intact; no current caller broadens a scoped opportunity into a global reset.

Fresh minimal check:

```text
pnpm --filter @taki/core exec vitest run src/harness/subagent-inbox-retry.test.ts --maxWorkers=1
```

Result: **1 file / 3 tests passed**. These exercise post-intent reconciliation alongside a later handled event, no retry on repeated queue release, fresh accepted work recovery and successful-primary-terminal recovery. No broad suite was launched alongside the coordinator's full Core run.

An additional inline native Node v24.18.0 probe used the actual fixture/SDK/SQLite service with two Characters. Both first idle admissions failed before intent. Repeated release hints did not retry either. Completing only Taki's primary Run caused one new Taki admission and left Beta refused:

```json
{"afterFailures":{"taki":1,"beta":1},"afterReleases":{"taki":1,"beta":1},"afterTakiPrimary":{"taki":2,"beta":1},"recoveryTargets":0}
```

This independently supports the no-spin and Character-isolation conclusions. The probe wrote no production/test source and used no real-user data or external service.

### Remaining trigger boundary

Mere network/dependency restoration or elapsed time is **not** itself a wired retry signal. There is still no production caller of the general `authorityChanged()` API; the implemented recovery opportunities are fresh accepted input/work, eligible child events and successful primary completion. An otherwise idle accepted backlog after a pre-intent failure can remain deferred until one of these opportunities or process restart. No timer, polling retry, network-reconnect retry or wall-clock delivery guarantee is claimed. The coordinator explicitly accepted this supported-opportunity boundary and will report it. Real Hindsight/network-recovery and final native/full-suite acceptance remain outside this recheck.
