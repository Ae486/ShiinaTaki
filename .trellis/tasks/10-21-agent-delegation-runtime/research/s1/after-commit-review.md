# S1 outermost-commit review

Date: 2026-10-22. Scope: focused independent persistence advice; production files were read only. This review owns only this record. No live database/model call, installation, Git operation, or acceptance claim was made.

## Recommendation

Add `Database.afterCommit(callback: () => void): void` to the existing SQLite wrapper. Keep all required admission/result/outbox/active-pointer writes in the canonical synchronous transaction participants. Use the new method only for process-local publication, terminal resource disposal and completion hints. Existing APIs do not expose the actual outermost commit, and moving only the domain writes into a participant does not fix premature process effects under a surrounding transaction.

Do not throw a callback error out of a successfully committed `transaction` or `afterCommit` call. Invoke every remaining registered callback, report each callback failure through the existing Core diagnostic path, and retain the successful SQL result. This is the same committed-truth principle already implemented by the Run live bus, not a new event framework.

## Requirements read first

- Runtime child `prd.md`: retain results independently of parent inference/publication; reuse existing Run/Attempt/Effect owners; preserve independent child lifetime and truthful recovery.
- Parent `prd.md` R02, R03, R06 and R12: one Runtime authority; separate recording/inference/publication; no parent-stop cascade; unchanged authority/delivery constraints.
- Joint contract section 5, especially lines 168-173, and section 13.1, lines 407-409: admission plus linkage and every canonical terminal transition plus linked result are atomic. COMMIT failure produces no success event or wake. Post-commit terminal notification disposes exact captured resources without changing outcome or releasing the execution lane early.
- `.trellis/spec/backend/sqlite-transaction-isolation.md`: preserve synchronous short transactions, savepoint isolation, deferred-COMMIT rollback, logical-depth restoration, and refusal of SQL after implicit whole-transaction rollback.
- `.trellis/spec/backend/database-guidelines.md`: live publication follows commit; observer errors cannot alter Run correctness; durable queries recover missed notifications.

The global `.trellis/.current-task` names an unrelated historical task and the subprocess has no session identity. The task explicitly assigned by the coordinator, plus its current `task.json` (`in_progress`, S1), governs this review. The inspected working directory and worktree HEAD are the requested T4 checkout and `task/t4-skills-mcp-productization`.

## Verified current behavior

| Source | Relevant evidence |
| --- | --- |
| `packages/core/src/db/sqlite.ts:25-30,50-66,74-99` | The wrapper exposes only `transaction(fn): void`; tracks logical depth; starts nested SAVEPOINTs; rolls back COMMIT failure and restores depth in `finally`. It has no commit callback facility. |
| `packages/core/src/db/sqlite.test.ts:96-193` | Existing cases cover deferred FK COMMIT failure, caught savepoint failure, `INSERT OR ROLLBACK`, earlier prepared statements and refusal of autocommit escape. Preserve these tests; do not substitute mocks for SQLite behavior. |
| `packages/core/src/db/run-repo.ts:96-115,119-151,188-237,275-331` | Admission and private canonical settlement publish immediately after their local `db.transaction` returns. That return may mean SAVEPOINT RELEASE. Start refusal and dispatch refusal call the same private settlement; public settlement applies deadline adjustment before private cancellation adjustment. |
| `packages/core/src/harness/run-service.ts:99-121,154-181,196-199` | Capture finishes before synchronous repository admission. Context binding follows repository return. Start/settle dispose context immediately after repository return; `release` currently calls `dispose` before deleting the context entry. Both details matter when callbacks become commit-aware. |
| `packages/core/src/harness/recovery-coordinator.ts:59-135` | Recovery invokes repository settlement directly. A hook solely in `RunService.settle` cannot cover it. |
| `packages/core/src/db/effect-repo.ts:18,60-80` | `onCommitIntent` already demonstrates a trusted synchronous transaction participant: failure rolls back required intent state. Its live publication is separately isolated. Reuse this separation. |
| `packages/core/src/db/run-event-live.ts:35-44,74-106` | The live bus isolates local `onCommitted`, overflow and asynchronous observer failures, with durable backfill. It has no connection to transaction depth and therefore cannot determine when publication is committed. |

A tiny in-memory probe against the actual wrapper reproduced the missing guarantee on Node `v24.18.0`: enter outer transaction, enter and successfully return from an inner transaction, publish an in-memory notification as the current repository does, then throw in the outer callback. Result: `rowsAfterRollback: 0`, `notificationsAlreadyPublished: 1`, original `outer failure` preserved. The probe imported only `sqlite.ts`, used `:memory:` with no migrations, and closed the connection. It did not exercise user data or claim a production defect outside the reviewed nested-use contract.

## Exact minimal API behavior

```ts
interface Database {
  // Existing signature and SQL failure behavior remain unchanged.
  transaction(fn: () => void): void;
  // Synchronous process effects only; never required durable writes.
  afterCommit(callback: () => void): void;
}
```

1. Extend the existing transaction state with a callback list for each entered boundary. Do not track independent transaction ownership in RunRepo or SubagentRepo. Savepoint names and the existing SQL-entry guard remain owned by `sqlite.ts`.
2. Registering during a live wrapper transaction appends to its current frame. Successful inner RELEASE merges that frame's callbacks into the parent at that point, preserving registration order. It does not execute them.
3. Ordinary inner rollback discards only that frame, including callbacks inherited from successfully released grandchildren. A caught inner error may leave valid outer callbacks and writes eligible to commit.
4. Outer rollback or failed outer COMMIT discards every surviving callback. SQLite's implicit whole-transaction rollback must also prevent subsequent `afterCommit` registration from escaping: apply the same logical-depth/`raw.isTransaction` guard used by SQL entry points. The enclosing frames finish unwinding normally; no callback survives into the next transaction.
5. Only after successful outer COMMIT, restore logical depth and detach/pop the completed frame in `finally`, then drain its callbacks **outside** the SQL transaction `try/catch`. Thus callback errors cannot trigger a misleading rollback attempt, and a callback can start a fresh independent transaction on the same connection.
6. Outside a wrapper transaction, execute through the same callback runner immediately. If a callback drain is already running, append to its ready queue instead of recursively draining. This permits convenient `db.afterCommit(...)` after an existing local repository transaction while still binding it to a live outer transaction. Prefer registering inside the operation's transaction for explicit ownership.
7. Use a small connection-owned ready queue and a draining flag to preserve FIFO when a callback commits a new transaction. Already-ready callbacks from commit A run before callbacks from reentrant commit B. Detach completed lists before execution; never append a reentrant callback to an already committed transaction frame. This is only an in-process callback drain, not a scheduler, persistent queue or second transaction manager.
8. Callback exceptions are individually isolated; remaining callbacks always receive their turn. Async callbacks are outside this contract, just as async transaction bodies are outside the existing contract. Callers schedule any asynchronous pump separately and own its rejection handling.

There is no inspected production pattern that manually opens transactions with `db.exec("BEGIN")`. Keep wrapper-managed transactions as the supported boundary; `afterCommit` must not claim an unmanaged raw transaction has committed. A frame-free call while `raw.isTransaction` is unexpectedly true should be refused as unsupported rather than executed early. No SQL parser or support for arbitrary manual transaction control is required.

## Failure reporting and cleanup

The minimal non-silent reporting seam is an optional `OpenDatabaseOptions.onAfterCommitError?: (error: unknown) => void`, parallel to the existing `onMigrated` composition callback. The wrapper catches each process callback error, invokes the reporter under a separate catch, and continues draining. Production composition must connect this to the existing logger with a bounded closed code such as `SQLITE_AFTER_COMMIT_FAILED`; do not serialize raw exception objects, captured context, prompt data or payloads. Tests can pass a spy. Do not add another logger, event bus, retry framework or global error service.

This reporter is optional for compatibility of existing `openDatabase` callers, but wiring it in the real Core bootstrap is a required part of claiming non-silent production behavior for the new callbacks. If that bootstrap file is outside the current worker's ownership, coordinate its small addition explicitly rather than claiming an unwired optional reporter is sufficient. The alternative is catch/report at every owner callback; it has more omission risk and does not remove the need for wrapper-level drain isolation.

Do not combine publication, disposal and completion wake in one unguarded closure. Register independent callbacks, or use independently guarded calls within the configured terminal callback, so a failing observer cannot prevent disposal and a failing disposer cannot prevent another required cleanup or hint. Required *durable* work must never move into these guarded callbacks.

For RunService, capture the exact context and delete its map entry before invoking `dispose`. That prevents a throwing disposer from leaving a permanently bound terminal context and prevents reentrant disposal of that same entry. A post-commit callback failure cannot relabel terminal truth. Removing an entry does not prove every external resource was physically released if its own disposer threw: report the failure, and make multi-resource disposers attempt their own remaining cleanup. Do not add automatic retry of arbitrary disposal side effects.

## Integration boundaries

- `RunLinkedState.onAdmitTx` and `onTerminalTx` execute inside their canonical transactions. The terminal participant receives the final cancellation/deadline-adjusted outcome. Any required participant failure rolls back canonical and linked records together. Duplicate/stale calls cannot rewrite results or enqueue another terminal notification.
- Register event publication and terminal process callbacks only for actual accepted writes. Use the existing configured post-terminal seam to reach the RunService context owner on **all** terminal paths, including direct repository recovery and `guardDispatch`.
- Remove or commit-fence the current immediate `RunService.start`/`settle` releases. Otherwise a surrounding transaction could release captured resources and later roll back the terminal transition even though the new repository notification is correct. No-op/duplicate terminal calls may perform only idempotent committed cleanup; do not dispose a context based on terminal state that is merely visible inside an uncommitted outer transaction.
- `RunService.admit` already awaits capture before entering repository admission. Preserve that order and the existing capture-disposal behavior when actual SQL admission fails. Do not attempt an async admission inside a synchronous outer transaction, and do not add an after-rollback framework to support that unsupported pattern.
- Admission notifications drain before synchronous `repo.admit` returns, while captured context binding happens afterward. A completion hint must schedule later work; it must not immediately dispatch the newly admitted Run before that binding is ready. If a permitted synchronous callback terminalizes an admission before binding, the bind step must recognize terminal truth and dispose the unused capture instead of installing a terminal context. This is a reentrancy constraint, not permission to build a second dispatcher.
- Callbacks carry immutable transition facts, not a reference to mutable frame state. A completion hint re-reads the durable completion row before admitting work. A callback never reconstructs reply authority or releases a still-running lane/controller.
- Convert relevant RunRepo event calls to the same after-commit path so an enclosing lifecycle transaction cannot leak start/retry/cancel events. Do not claim every unrelated repository is now universally safe inside an outer transaction; converting additional publishers requires a demonstrated call path, not a broad mechanical refactor.

## Small required verification matrix

| Case | Required assertions |
| --- | --- |
| Outer success with nested successes | Nothing fires before outer COMMIT; callbacks see committed rows and run once in registration order. Callback can open a new transaction. |
| Caught ordinary inner failure | Failed child/grandchild callbacks and rows disappear; valid outer/sibling callbacks fire only if outer commits. |
| Later outer rollback and deferred FK COMMIT failure | No admission/terminal event, wake or disposal; all canonical/linked rows rolled back; same connection subsequently works. Use actual SQLite deferred constraints. |
| Caught `INSERT OR ROLLBACK` | No callback fires; further `afterCommit` registration refuses alongside existing SQL-entry guards; no callback leaks into a later transaction. |
| First callback throws | SQL stays committed; writer reports success; error reporter called; later publication/cleanup/hint callbacks still execute. A throwing reporter does not interrupt draining. |
| Reentrant commit during drain | New transaction is independent; its rollback cannot affect prior committed truth; no callbacks are lost/repeated; already-ready callbacks precede newly committed callbacks. Outside-transaction registration uses the same runner. |
| Canonical linked admission/terminal fault injection | Participant failure rolls back Run/Attempt/receipt/events plus linkage/result/outbox/pointer. Duplicate admission validates linkage; duplicate/stale terminal call adds no result or notification. |
| Every terminal entry point | Start cancellation/deadline/budget refusal, guardDispatch refusal, explicit settle and recovery each record the adjusted result atomically and notify only after actual commit. |
| Captured-context disposal | Outer rollback keeps context; successful direct-repo terminal commit removes/disposes exact context once. Throwing dispose still removes the entry and permits remaining callbacks. Existing duplicate admission and Memory restore tests remain valid. |

The current wrapper tests were inspected but not rerun by this advisor. The only execution was the tiny `:memory:` probe above. The implementer owns the new behavioral tests and required project checks; passing them establishes this S1 boundary, not full G1-G4 or owner acceptance.

## Alternatives considered

- **Only canonical linked writes, unchanged notification sites:** simpler for top-level calls, but fails the demonstrated nested transaction guarantee and leaves premature RunService disposal.
- **Outer service transaction plus notifications after return:** canonical linked state must also cover direct start/guard/recovery; existing repository events may already have escaped. Spreads ownership and cannot cover the async capture gap.
- **Use RunEventLiveBus as commit detection:** its existing observer isolation is useful, but the bus has no SQLite commit/rollback knowledge and is best effort. It cannot own required terminal cleanup or decide whether a savepoint committed the database.
- **Selected extension:** one transaction-owned callback mechanism, canonical required writes, and isolated process effects. It directly closes the demonstrated gap while retaining legacy transaction semantics and the existing Runtime/DB owners.
