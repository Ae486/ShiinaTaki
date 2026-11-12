# Private worker progress and check-ins

## 1. Scope / Trigger

Apply to all running shared child work, including generic `record_only` and source-owned Co-Watching preparation.
`subagent_work_progress` owns captured intervals; `subagent_task_steps` binds actual task-model Effect intents to
completed SDK steps. Utility compaction contributes token usage but never task steps. Migration 063 is additive T4
lineage only; it emits no execution or check-in and reconstructs no historical step counts.

## 2. Signatures

- `createSubagentProgressRepo(db).intent({ workInputId, stepNumber, effect })` binds the actual model Effect;
  `.complete({ runId, attemptId, stepNumber, modelEffectId })` assigns its unique completed work ordinal.
- `WorkContext.recordCompletedStep(CompletedWorkStep)` receives `completed`, `safeFrontier`, `naturalFinish`,
  `modelEffectId`, the Attempt/global step and native messages. Production supplies the actual Effect even for empty output.
- `acceptDueSubagentCheckIn(db, workInputId): string | null` participates in the caller's synchronous transaction.
  `events.checkInForRun(runId)` reads the immutable producer boundary plus the canonical wait's current resolution.
- `subagent.continue` accepts `characterId`, exact `target`, `operationKey`, `direction`, `materials`, and
  `replyToEventId`. The authenticated handler supplies user origin; model `continue_child` supplies parent origin.
- `SubagentSummary.progress` carries `workInputId`, completed/interval-start counts, captured N/K, consecutive parent
  approvals and `tracking`; `pendingRequest` pairs `reason: check_in` with a `SubagentCheckIn` sidecar.

## 3. Contracts

### Runtime boundary

- Count each completed SDK step once, including empty-message steps, across SDK rollover, Runs and service restart.
  Keep failed provider retry intents distinct; only the Effect associated with the actual completed step gets its ordinal.
- Source/material/native persistence, the ordinal increment, ordinary collectors and a due factual event/wait/sidecar
  share the completed-step transaction. Callback failure is latched and fences all later dispatch/checkpoint work.
- The one ordered child boundary handles accepted final completion, ordinary input wait, due check-in, then pressure
  rollover. Stop, failed recording and unresolved non-model Effects retain their stronger refusal semantics.
- Generic accepted completion on step N wins. A natural unstructured stop is never a validated final report.
- A source-owned completion retains its existing natural SDK end plus successful owner validation after stream drain.
  On a natural final N, validation wins or preserves its existing failure. A continuing tool frontier at N (even a
  valid artifact write) has not completed the feature work and legitimately pauses for check-in.
- A question accepted on N remains a question. Its exact answer creates the already-due check-in before another task
  request; it does not reset the interval. Pending corrections do not postpone N and stay unconsumed until actual intent.
- Check-in is an immutable `needs_input` event with a typed `reason=check_in` sidecar and a canonical input wait. Its
  witness is a real completed model Effect, never a fabricated collector call. Notification is independent of the
  work's final `record_only` reporting policy. An answered-before-terminal wait remains the producer Run's boundary.

### Progress evidence

The report is explicitly a Core factual snapshot: exact tracked steps, most recent worker-authored text when present,
older summary with coverage, bounded recent tool evidence references and unconsumed input count. It states when
remaining work is not established. No synthesis request, percent-complete inference or fabricated tool outcome is used.
Full original result/source evidence remains in its canonical repositories and is pageable.

### Continuation and policy

- `TAKI_SUBAGENT_CHECKIN_STEPS` defaults to 50 (positive safe integer); `TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS`
  defaults to 3 (nonnegative safe integer). Both use existing environment > stored > default configuration.
  `apply=live` means captured at the next new work/check-in interval; it never changes an existing interval or wait.
- Only explicit exact-event Continue/redirect resolves a check-in. `handle_agent_event` uses `continue_child`;
  `answered_child` is an ordinary answer and cannot implicitly approve a check-in.
- Each accepted parent check-in continuation increments once. K=3 allows three approvals; check-in four requires the
  user. K=0 requires the user immediately. Duplicate operation/action receipts cannot increment or reset twice.
- Only authenticated direct user input to the addressed work resets consecutive parent approvals. It does not reset
  N or implicitly resolve a check-in. Ordinary primary chat, parent messages, unrelated work and restart do not reset.
  Persisted `requiredActor=user` remains authoritative after guidance/config changes until exact user continuation.
- User Stop is independent and user-only. A check-in answer may be accepted before the producer releases its pointer;
  scheduling waits for lane/pointer release. An idle inbox release must schedule already accepted source-owned children.
- `tracking=post_upgrade` explicitly labels a legacy work whose earlier exact counts are unknown. The first accepted
  post-upgrade direction establishes the tracked interval; migration/restart never resumes old effects.

### Co-Watching

The adapter uses `events.checkInForRun` to distinguish the immutable old Run boundary even after its wait is answered.
A checkpoint preserves the session, pending edit, workspace artifact path/revision and source binding. The next Run
reuses that artifact only when the edit and committed-delivery digest are unchanged and no owner revision is pending.
An explicit owner revision keeps the existing fresh-artifact behavior. `paused_child` is a general pause; it does not
claim a user Stop. Queue release cannot clear an open check-in or append an automatic owner-resume input.
Final plan validation/publication, source validity, finite acceptance and actual Stop remain feature-owned.

### Read projection

`SubagentSummary.progress.workInputId` scopes the displayed counter. Child usage aggregates unique persisted model
Effects plus `run_usage` across child executions, including Utility calls and excluding parent/inbox Runs. Each field
is null until all contributors supply it and no model is in flight. `knownTotalTokens` is an explicit partial subtotal
of effects with both input/output known. Historical single-sided synthetic `total_tokens` never becomes a full total.
Zero calls and genuinely reported zero are distinct from missing usage.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Completed callback lacks an actual tracked model Effect | `SUBAGENT_STEP_WITNESS_REQUIRED`; no count or later dispatch |
| Effect has not settled | `SUBAGENT_STEP_INCOMPLETE_EFFECT`; no completed ordinal |
| Count is due before a task request | `SUBAGENT_CHECKIN_REQUIRED`; no new task-model intent |
| Ordinary message names a check-in as its answer | `SUBAGENT_CHECKIN_CONTINUE_REQUIRED`; wait remains open |
| Core-owner or parent tries to approve a user-only wait | `SUBAGENT_CHECKIN_AUTHORITY_REQUIRED` or `SUBAGENT_CHECKIN_USER_REQUIRED`; no input/interval change |
| Parent Continue encounters user Stop | `SUBAGENT_USER_CONTINUE_REQUIRED`; latch remains |
| Source expires or a non-model Effect is unknown | Existing source/reconciliation refusal; no source reconstruction or replay |
| Checkpoint SQL fails | Roll back source/count/event/wait participant and fence later SDK dispatch |
| Repeated callback/accepted action or answer before terminal | One ordinal/event/approval; immutable producer boundary remains |

## 5. Good/Base/Bad Cases

- Good: the N-th continuing artifact write pauses; exact continuation reuses its source-owned artifact, then natural
  completion validates through the existing owner. Final `record_only` still creates no final parent inference.
- Base: a validated final at N finishes normally with no check-in; N=50/K=3 stays captured until the next interval.
- Bad: count tools/Utility calls, reset on restart/main chat, synthesize user authority or treat an artifact write as final.

## 6. Tests Required

- `subagent-checkin.test.ts`: N-1/N final precedence, actual empty output, N=50 across SDK rollover, unique witness/count,
  K=3 escalation, K=0, early answer, restart, next-interval config, and atomic checkpoint failure with no later request.
- `subagent-followup-contracts.test.ts` and `subagent-inbox-retry*.test.ts`: actual disclosed tool selection, scoped user
  attention, complete/partial usage, bounded retry plus delivered-event exclusion and explicit exhausted retry.
- `co-watching/child-adapter.test.ts`: source-owned natural validation, artifact reuse at a checkpoint, owner revision,
  user Stop and source callbacks; invalid completion and source loss retain their established failure semantics.
- `config/subagent-config.test.ts` and migration 063: policy defaults/precedence; old receipt preservation, empty new
  counters, idempotent reopen and no execution. Preserve recording/worker-context/foreground privacy regressions.
- Shared schemas and Desktop progress/attention/controls must preserve unknowns, exact actor and action targets.
  Scripted SDK/SQLite tests do not imply live-provider semantic, native UI, human or T4/main convergence acceptance.

## 7. Wrong vs Correct

Wrong: `if (localSdkStep === N) stop()` resets on rollover and races final completion.

Correct: commit the actual Effect's completed work ordinal with source evidence, decide final/question/check-in in
one ordered boundary, and retain `checkInForRun(producerRunId)` even when the exact wait was answered before release.
