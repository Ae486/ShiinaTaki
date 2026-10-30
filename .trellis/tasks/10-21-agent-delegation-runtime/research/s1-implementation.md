# S1 implementation and handoff

Date: 2026-10-22. Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.

S1 implements the reviewed durable foundation. It does **not** enable delegation, a dispatcher, new model tools, a child UI, Memory mutation restrictions, parent inference, or publication. Parent R02-R08/R12-R14 and AC02-AC05/AC09/AC11 remain integration acceptance obligations. No paid/model call, real user database mutation, commit, push, reset, cleanup, archive or parent planning-document change was made.

## Changes and ownership

The exact 33 source/test/index paths and before/after SHA-256 values are in [s1/changed-files.json](s1/changed-files.json). Existing dirty-working-tree preimages, including subsequently authorized bootstrap and test-stub paths, are retained in [s1/preimages.json](s1/preimages.json) and `s1/preimages/`. New files are explicitly identified. The comparison is against those working preimages, not repository HEAD: [s1/s1-working-baseline.diff](s1/s1-working-baseline.diff). Text diff normalizes line endings for review; the preimage files and hashes preserve exact original bytes.

| Boundary | Changes |
| --- | --- |
| Shared | New `context-source-schema.ts`, `subagent-schema.ts`, `subagent-result-schema.ts`, `run-message-schema.ts`; named public exports; optional `sourceMaterials` on the existing native Timeline tool-result part; schema regression tests and index |
| Persistence | Migration `056-subagent-conversations.ts` and ordered registry; new conversation, input, execution/result, private-message repositories, typed row readers and narrow linked-state contract; migration/repository tests and indexes |
| Canonical Run | `run-repo.ts` admits linked state atomically. `run-terminal-transition.ts` extracts the existing canonical settlement/Attempt update and adds mandatory linked terminal participation and commit notifications. `run-service.ts` captures trusted work scope and disposes exact contexts through committed facts |
| Effect | `effect-repo.ts` supplies the actual prepared `EffectLifecycle` to its existing synchronous `onCommitIntent` callback. Existing zero-argument callbacks remain compatible |
| Outermost commit | `sqlite.ts` owns frame-scoped `afterCommit` callbacks and FIFO reentrant draining. `boot/core-bootstrap.ts` connects bounded callback-failure diagnostics after stored logging settings load. Existing transaction/isolation and boot tests were extended |
| Compatibility fixture | `testing/run-service-stub.ts` explicitly refuses linked admission; transport-only tests do not fake persistence authority |

There are exactly four new table families: `subagent_conversations`, `subagent_inputs`, `run_messages`, `subagent_executions`. There is no new work table, relationship history, permission service, event framework or semantic Memory store. No `.trellis/scripts/` or generated template was changed.

## Durable contracts

- Each new work self-references its `inputId` as `workInputId`. Display `inputSeq` and exact-work `workSeq` are independently allocated in the acceptance transaction. Queued B neither changes active A's control token nor consumes/supersedes A's messages or completion policy.
- An input operation key is unique per child; its parsed immutable request is digested. An exact duplicate returns the original row before current control checks; a changed payload, lifetime, target or selection conflicts. Accepting a message requires its expected control version and optional expected active Run. Sender identity is supplied by trusted Core callers, not inferred from prose.
- New work requires `lifetimeMinutes` in the existing 5–720 range. Core captures `workExpiresAt` once, even when no Run exists yet. Same-work message/continue rows inherit it. Retry/reuse cannot renew it. Linked child and parent Run deadlines must be present and no later than this expiry; already expired work refuses new admission. Reply-acceptance expiry must equal the original work expiry.
- Initial snapshot, instructions/direction, requested allow/inherit-exclude tool selection, completion policy and original input material stay immutable. Explicit empty tool selection survives. Native calls retain actual names/IDs/results; raw tool-call arguments are removed from selected/private durable messages. Provider capability facts/digests are unchanged.
- User stop is a durable child latch. Parent interruption cannot downgrade it. Parent input cannot clear it. Continue requires quiescence and the exact control version; only an authenticated-user binding may clear a user latch. For an active child, `stop` requires a synchronous cancellation participant so cancellation refusal rolls back the latch. The Run service still owns actual cancellation; a pointer release does not release a live controller/lane.
- Model input receipts are created only in the actual model Effect intent callback, before that Effect row is inserted. Deferred foreign keys couple receipt/input-consumption state to the Effect transaction. First receipt fields never change. Later actual provider intents/replacement Attempts retain separate receipt evidence; replay emits each addressed input once. A selected-but-undispatched batch is unconsumed. A later unselected message remains pending; skipping a pending input inside the selected watermark is refused.
- Private step uniqueness includes Run, Attempt, step, entry kind and message index. Complete native call/result groups and source/status sidecars survive. Exact repeated step capture is a no-op; differing content at the same identity conflicts. Partial evidence has a distinct identity; replay suppresses a partial if the completed same-Attempt/step exists. Cross-Run child history uses global message `seq`, not UUID order.
- A proposal is distinct from terminal truth. Child proposal identity is exact active Run/Attempt plus persisted work-token digest. Same-identity content cannot change. A genuinely newer active Attempt/token may replace the current proposal slot; late callbacks cannot. Completed private step evidence remains immutable. Parent proposals may likewise be replaced only after an actual active Attempt change.
- Every configured canonical terminal entry path reaches the same participant: start cancellation/deadline/budget refusal, guard-dispatch refusal, public settlement and direct recovery settlement. It receives the final cancellation/deadline-adjusted outcome, commits any staged final private batch, records the child result/outbox or parent result, and releases only the exact active child pointer. Any required write failure rolls back Run, Attempt, Receipt, event, private-tail and linked-state changes together.
- A stale proposal's body/source is discarded. Only visible output after the current Attempt's latest addressed-input receipt may supply unstructured fallback. An exact-work current Run with no new output still records a truthful `body:null`/`outputKind:none` terminal status and preserves its `request_parent` notification. Only an actually newer unconsumed work watermark causes work supersession. A historical proposal cannot be relabelled as covering newer input.
- Record-only terminal work remains `not_requested`; request-parent work becomes `pending`, or `withheld` for actual same-work supersession. Parent admission is unique on the child completion and stable idempotency key. An admitted or terminal parent never resets the outbox to obtain another model call. Parent result/decision and publication disposition are inspectable; none of these rows publishes speech.

## Exact S2/S3 APIs

Core-only composition must install the same participant before admitting children **and before recovery scans**. This is not installed in `main.ts` by S1, so ordinary legacy callers retain absence behavior.

```ts
const executions = createSubagentExecutionRepo(db);
const runs = createRunRepo(db, eventRepo, { liveBus, linkedState: executions.linkedState });
const service = createRunService({ repo: runs, snapshot, provider, modelId });

const accepted = inputs.accept({
  subagentId, operationKey, sender: { kind: "parent", runId: parentRunId },
  direction, materials,
  input: { kind: "work", completionPolicy: "request_parent", lifetimeMinutes: 30,
    toolSelection: { mode: "inherit", excludeNames: [] } },
});

const admission = await service.admitLinked(triggerWithBoundedDeadline, {
  admission: existingCaptureOptions,
  linked: { kind: "subagent", triggerInputId: accepted.input.inputId,
    token: { subagentId, workInputId: accepted.input.workInputId,
      throughWorkSeq: inputs.latestWorkSeq(accepted.input.workInputId),
      controlVersion: children.get(subagentId).controlVersion },
    validateTx: () => { /* recheck trusted live source/capacity; no IO */ } },
});
// Admission advances the child control version. Use the returned durable token thereafter.
const token = executions.token(admission.run.runId);
```

`RunSnapshotCapture.capture` options now include `workScope`. `RunExecutionContext.workScope` is trusted immutable `{kind:"subagent",subagentId,workInputId}` or `{kind:"parent-continuation",completionId}`. Both may have `initiator=subagent`; that initiator alone is not a Memory-authority discriminator. `admitLinked` copies/fixes its link before asynchronous capture, then the repository checks current data and invokes `validateTx` inside atomic admission. An in-process duplicate returns the original execution; lost linked executable context requires explicit continuation instead of a silent restore.

```ts
inputs.accept({ subagentId, operationKey, sender: { kind: "user" }, direction, materials,
  input: { kind: "message", workInputId, expectedControlVersion, expectedRunId } });
inputs.accept({ subagentId, operationKey, sender: { kind: "user" }, direction: "", materials: [],
  input: { kind: "continue", workInputId, expectedControlVersion } });
children.stop({ target: { subagentId, workInputId, expectedControlVersion, expectedRunId },
  origin: "user", cancelRunTx: (runId) => { service.requestCancel(runId); } });

effects.prepareIntent({ ...existingModelIntent,
  onCommitIntent: (effect) => messages.recordModelInputs({ effect, token, stepNumber, inputIds }) });
messages.recordStep({ runId, attemptId, batch: { stepNumber, entryKind: "output", messages: visibleNativeMessages } });
messages.stageTerminal({ runId, attemptId, batch: { stepNumber, entryKind: "partial", messages: observedPartial } });
executions.recordProposal({ runId, attemptId, workToken: token, proposal,
  digest: digestRunValue(SubagentProposalSchema.parse(proposal)) });
service.settle(runId, attemptId, "completed");
```

S2 must pass the prepared Effect identity through `model-effect-middleware.ts`/WorkContext; those consumers are deliberately unchanged here. `recordModelInputs` requires the existing `EffectLifecycle` value with `kind:model` and actual `inputDigest`; it refuses retroactive insertion after the Effect already exists. The receipt's readable content is direction; its `inputId` joins the retained full materials. Renderers must read those materials when reconstructing addressed context. Persist completed/intermediate failed-Attempt evidence through `recordStep`; reserve `stageTerminal` for the final Run tail after the retry decision.

Queries: `children.get/list`; `inputs.get/list/latestWorkSeq`; `executions.get/list/scope/token/result/pending`; `messages.list({runId,afterSeq?,limit?,replay?})`; `messages.history({subagentId,workInputId?,afterSeq?,limit?,replay?})`. `history` includes child Runs in insertion order and excludes the main continuation transcript; linked synthesis is available from `executions.result`. These are repository reads, not yet RPC endpoints. S3 should project list summaries rather than expose a full snapshot in ordinary navigation.

```ts
const completion = executions.result(childRunId);
await service.admitLinked({ ...parentTrigger,
  idempotencyKey: `subagent-completion:${childRunId}`, payloadRef: childRunId,
  initiator: "subagent", deliveryClass: "internal", contextMode: "autonomous",
  deadlineAt: completion.child.workExpiresAt,
  provenance: { provider: "core.subagent-completion", parentRunId: originalParentRunId },
}, { linked: { kind: "parent-continuation", completionId: childRunId,
  resultDigest: completion.childDigest, validateTx: checkLiveContinuationAuthority } });
executions.recordParentProposal({ runId: parentRunId, attemptId, proposal,
  digest: digestRunValue(ParentContinuationProposalSchema.parse(proposal)) });
```

`setCompletion` supports typed `deferred`/`withheld` transitions only before admission. `recordPublication` joins the exact committed parent result digest and cannot turn internal/no-action outcomes into a reply or reopen recorded/refused disposition. `inputs.bindReplyAcceptance` writes one immutable trusted acceptance with matching Character/work expiry. S3 must establish the actual primary witness, accepted-root purpose/currentness and publisher; JSON alone is not authority.

## Outermost-commit behavior

`Database.afterCommit(callback)` appends to the current wrapper-owned transaction frame; successful savepoints merge, failed frames disappear. Callbacks run only after outer COMMIT and depth restoration, through a connection-owned FIFO that also supports reentrant commits. Implicit whole-transaction rollback refuses further SQL and callback registration. Unmanaged raw transactions are not supported by `afterCommit`.

Callback exceptions and diagnostic-sink exceptions are isolated; committed SQL remains successful and later cleanup/hints still run. Bootstrap logs only `SQLITE_AFTER_COMMIT_FAILED`, never raw callback text. RunService removes an exact context before disposal. Already-committed unused captures, including reentrant observer terminalization during admission, use this same isolated path. Required linked SQL writes remain synchronous participants and are never moved into afterCommit.

`RunRepo.onTerminalCommit` supports exact resource owners; `RunLinkedState.afterTerminalCommit` is a post-commit invalidation/completion hint. Hints must schedule later work and re-read durable state, not dispatch synchronously before `RunService` finishes capture binding. This does not make every unrelated legacy repository publisher safe inside arbitrary outer transactions; no broad publisher refactor was made.

## Verification evidence

Environment: Node `v24.18.0`, pnpm `10.22.0`, actual `node:sqlite`; SDK versions remain the separately accepted upgrade. No model requests were made.

| Check | Result / evidence |
| --- | --- |
| Shared contract/native-part regression | 32 tests in 2 files passed; [s1/shared-tests.json](s1/shared-tests.json) |
| Core focused lifecycle, SQLite, Effect, migration lineage, bootstrap and compatibility regression | 228 tests in 17 files passed; [s1/core-tests.json](s1/core-tests.json) |
| Final exact-work/proposal/status correction | 35 tests passed after the last currentness correction; [s1/final-regressions.json](s1/final-regressions.json). This is a subset rerun, not 35 additional distinct tests |
| Shared and Core typechecks | Both exit 0; [s1/typechecks.json](s1/typechecks.json), corresponding `.log` files |
| Root ESLint on every changed TS file | Exit 0; [s1/lint.json](s1/lint.json). The final two-file terminal/test correction also passed ESLint |
| Real Node strip-only Core boot | Listening log and socket connection confirmed; loopback model trap received 0 requests; [s1/boot-reviewed/boot.json](s1/boot-reviewed/boot.json). Only the spawned process tree was stopped after observation; its stop exit is not an application crash claim |
| Exact working-preimage audit | 33 changed source/test/index files, UTF-8 without BOM, no trailing whitespace, `git diff --check` exit 0; [s1/diff-check.json](s1/diff-check.json) |

Commands are reproducible from the repository root:

```powershell
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/core typecheck
pnpm --filter @taki/shared exec vitest run src/subagent-schema.test.ts src/timeline-schema.test.ts
pnpm --filter @taki/core exec vitest run src/db/subagent-repo.test.ts src/db/sqlite.test.ts src/db/effect-repo.test.ts src/db/migration-runner.test.ts src/db/run-event-repo.test.ts src/db/run-event-live.test.ts src/db/migrations/056-subagent-conversations.test.ts src/db/migrations/020-parallel-foundation-convergence.test.ts src/db/migrations/036-memory-timeline-convergence.test.ts src/db/migrations/040-hindsight-cutover-convergence.test.ts src/boot/core-bootstrap.test.ts src/harness/run-service.test.ts src/harness/run-service-memory-restore.test.ts src/harness/recovery-coordinator.test.ts src/harness/initiative-recovery.test.ts src/harness/run-work.test.ts src/harness/run-work-binding.test.ts
$s1Files = @(Get-Content .trellis/tasks/10-21-agent-delegation-runtime/research/s1/changed-files.json -Raw | ConvertFrom-Json | Where-Object { $_.path.EndsWith('.ts') } | ForEach-Object { $_.path })
pnpm exec eslint @s1Files
node .trellis/tasks/10-21-agent-delegation-runtime/research/s1/boot-smoke.mjs another-isolated-fixture
python .trellis/tasks/10-21-agent-delegation-runtime/research/s1/finalize-evidence.py
```

The independent review reproduced two defects in an earlier S1 state (stale proposal/token binding and throwing unused capture disposal); both have explicit regressions now. The reviewer remains responsible for its independent disposition. No full Core/Desktop/Rust suite was repeated for this foundation-only checkpoint.

## Remaining integration and tradeoffs

- S2/S3 must install the participant in real composition before recovery; implement shared execution/queue/controller ownership, real currentness/recovery decisions, effective executable-tool selection and fixed child Memory exclusions. Persisted scopes identify authority but do not themselves enforce it. Main continuation retains provider facts and its existing permitted Memory authority.
- S3 owns real primary witness/reply acceptance, retained report root, completion pumping, publication authority, actual publisher/disposition joins and query/subscription protocol. S4-S6 own row-level source publication/replay/compaction and Memory-source carriage. S7 owns actual child UI. No corresponding acceptance criterion is marked passed by S1.
- Source metadata is optional descriptive data. Material selection must resolve only actually supplied/acquired working-context evidence; failed/unavailable and successful-empty tool results remain distinct. The schemas do not turn model-authored source strings into trusted facts.
- Without a validated collector, the terminal report uses the last current visible assistant segment; the complete transcript is retained and queryable. This avoids concatenating an unbounded history or silently truncating accepted content. Input/result fields reject oversized payloads (1,000,000 text characters, 200 material descriptions, 2,000 native parts/messages) rather than truncate them; S2 public protocol should preserve these refusal semantics.
- Old unused proposals can be replaced only at a genuinely new active identity; canonical terminal results, first receipts, initial context and accepted inputs remain immutable. Private failed-step evidence should be written before an Attempt retry.
- The reviewer will sync `sqlite-transaction-isolation.md` and `database-guidelines.md` after ownership transfer; this implementer did not concurrently edit those specs.
- Rollback uses the saved task-owned source preimages, reconciling any later collaborator changes. Keep additive schema and retained results. Migration 056 has only been applied to isolated synthetic fixtures in this task; no user DB restore/drop is authorized.

S1 is ready for the coordinator's independent check and explicit ownership handoff. It is not a usable-delegation or UI delivery claim.
