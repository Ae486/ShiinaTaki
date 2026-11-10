# Maintenance Monitor independent final review

Date: 2026-11-06. Reviewed only the new maintenance Monitor follow-up against the
owner request, `maintenance-monitor-plan.md`, and `maintenance-monitor-advisor.md`.
Prior tidy/backlog changes and unrelated dirty work were not reopened. This
reviewer changed no production source or tests; this report is the only written
task artifact.

## Result

Both confirmed findings below were fixed by the parent and independently checked
against the resulting source. The final targeted production-wiring regression
passes. No further confirmed blocker remains in this bounded review. The parent
still owns full gates, actual browser validation and the final acceptance claim.

## Findings

### 1. Future Legacy automatic tidy bypassed the operation owner — fixed by parent

- Original invocation: `memory/auto-memory.ts:153` runs the provider maintenance
  pass, then `:162-165` calls the raw `tidy.maybeRun`. `memory/tidy-pass.ts:62-63`
  delegates to the durable owner only when its `requestRun` dependency exists.
  At the beginning of review, the Legacy constructor in `memory/bootstrap.ts`
  supplied no callback, and `memory/runtime-composition.ts` only wired one for
  Canonical Local. Those future Legacy calls would be excluded from normal cache
  statistics but have no operation association or maintenance-list record.
- The parent confirmed Legacy remains supported within this requirement and added
  `requestTidyRun` to the existing Legacy construction seam, forwarding it into
  `createTidyPass` (`bootstrap.ts:48,87`; `runtime-composition.ts:127`). Trigger and
  raw-execution semantics remain in their existing owners.
- Independent post-fix Node evidence used actual Legacy runtime composition,
  `autoMemory.onTurnCompleted`, one eligible synthetic memory, an installed
  submission spy, and in-memory SQLite. Output was `submitCalls: 1, modelCalls: 0`:
  the automatic path now handed work to the callback rather than running the model
  itself. A subsequent real operation-owner/SDK/SQLite experiment produced one
  linked tidy call and a completed maintenance record.
- The new production integration regression was independently run after the fix:
  `admits automatic Legacy tidy through the same operation owner and records its
  actual call` passed (one passed, four skipped).

### 2. Missing Legacy review coverage was displayed as a confirmed zero — fixed by parent

- Locations at reproduction: `memory/operations/memory-operation-kind-tidy.ts:32`
  substitutes zero for an omitted `outcome.reviewed`;
  `db/maintenance-monitor-repo.ts:76` forwards producer progress directly;
  `desktop/.../monitor/maintenance-monitor-panel.tsx:49` renders that number as
  `已检查`. The older Operations view preserves the missing result count as
  unavailable, so this is a newly introduced presentation claim.
- Independent actual Legacy automatic entry -> operation owner -> SDK -> SQLite ->
  Monitor reproduction returned a successful outcome with `steps: 1`, `edits: 0`
  and no `reviewed` or `remaining` fields. The new summary returned
  `progress: { edits: 0, steps: 1, reviewed: 0, remaining: null }`, with one linked
  model call. The store had one visible memory in the reviewed report.
- The Shared maintenance progress projection now permits a nullable reviewed count
  (`shared/src/maintenance-monitor-schema.ts:34`). The final summary uses the
  actual outcome count, or only a measured in-flight coverage snapshot, and leaves
  unavailable coverage null (`db/maintenance-monitor-repo.ts:77-78`). The panel
  renders null as `未知` (`desktop/.../monitor/maintenance-monitor-panel.tsx:49`).
  Actual edits/steps and measured Canonical coverage are preserved without a new
  execution state or inferred historical count.
- The updated production integration regression explicitly asserts Legacy
  `reviewed: null, remaining: null` while still verifying the completed operation
  and its linked model call. Its final independent run passed.

## Source properties checked

- **Population isolation:** `db/cache-usage-repo.ts:98-114` excludes exactly Utility
  labels `tidy` and `compact`; other auxiliary contributions remain. The scope
  literal and cache-strip wording describe the new population. Maintenance model
  calls still retain their actual auxiliary spending records. Latest-primary
  occupancy remains in the existing primary-source/Run attribution path, and the
  maintenance projection does not insert synthetic Runs or Run usage rows.
- **Migration compatibility:** migration 068 is additive. Its explicit baseline
  population prevents subtraction against the old all-call totals. Reconstruction
  uses original settlement times, strict-before membership, current explicit-zero
  cache pairing, and included-population ambiguity checks. Excluded maintenance
  timestamp ties do not invalidate the regular population. Old unlinked call rows
  remain null-linked; no nearby timestamps are used to invent an association.
- **Producer-proved linkage:** `memory-operation-service.ts:100-102` wraps tidy
  execution with the durable operation reference; the immutable ambient owner
  survives Utility batches. `compaction-coordinator.ts:184` associates the actual
  compact generation with its current lease. Legacy's separate pre-compaction
  flush is not silently reclassified. The auxiliary meter freezes this reference
  at call start; aggregate cost comes from these links, never tidy's cumulative
  process Utility total.
- **Read scope and pagination:** `maintenance-monitor-repo.ts:14-45` limits pages
  to 25 operations, checks cursor identity, and uses the immutable first compaction
  event time rather than mutable retry start time. Selected detail verifies kind,
  operation and Character; calls are filtered by all three fields before paging
  or aggregation. Call pages are bounded at 100 while totals cover the same entire
  operation. Read projection invokes no recovery, retry or model work.
- **Publication and lifecycle:** operation and auxiliary changes reach the service
  after commit. Compaction adds failure/cancellation/start hints, not only a
  successful-summary callback. Observer exceptions are contained; service
  invalidation coalesces into a microtask. Authentication is checked at membership
  and publication; DISABLED withdraws data without a database read. Core shutdown
  disposes the observation service without changing producer settlement ownership.
- **Reactive isolation:** the controller installs its handler before requesting
  the baseline, rejects older revision/generation/query replies, and retires
  physical clients. Selection and paging replace membership. Hidden/background-tab
  retirement stops detail reads/emits; reconnection subscribes from the current
  query, with no mutation replay or polling. Mode hints have their own physical
  binding. Home's existing mode-availability owner separately handles disabled
  navigation after reconnect.
- **Privacy and measurements:** public detail is lifecycle, safe failure codes,
  recorded counts and model-call usage. It does not expose prompt bodies, memory
  content or summary text, and does not manufacture a compression ratio from
  `beforeTokens` and `outputChars`. Model call coverage and unknown token totals are
  explicit. The simple projection and existing owners avoid a second execution
  framework.

## Verification and limits

- Independent current regression: `pnpm --filter @taki/core exec vitest run
  src/memory/operations/memory-tidy-runtime.integration.test.ts -t
  'admits automatic Legacy tidy' --maxWorkers=1` — one passed, four skipped after
  both corrections, including the explicit unknown-coverage assertion.
- Two isolated Node experiments used the real Legacy composition/automatic entry;
  the latter included the durable operation owner, wrapped SDK model, SQLite
  auxiliary ledger and new Monitor projection. The model was scripted and no
  provider network call was made.
- Parent-reported prior targeted passes (cache 16, Monitor service/repo 5,
  SDK/compaction/tidy 57, Desktop 6) informed scope but are not claimed as this
  reviewer's independent executions. Parent owns final lint/typecheck/full-suite
  and actual browser evidence, including checks after the findings above.
- No live database mutation, paid model, commit, push, archive, or unrelated edit
  was performed. Source review and scripted integration do not establish human
  acceptance or real-model semantic quality.
- Concurrent migration 069/delegation changes reported by the parent belong to a
  separate scope. They were preserved and not independently reviewed here; this
  Monitor change remains migration 068.
