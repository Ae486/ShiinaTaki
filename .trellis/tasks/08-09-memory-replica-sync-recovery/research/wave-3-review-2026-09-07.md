# B5 Wave 3 Independent Review

Date: 2026-09-07 (Asia/Shanghai).

## Verdict

The implemented offline mechanics pass independent review after three fixes. Full Wave 3 / B5 recovery remains
**INCOMPLETE**: the supported provider has no operation-scoped derived-maintenance fence, and this recovery path has
no safe native-append result mapping. Neither limitation is converted into successful convergence. The task remains
`in_progress`; owner/manual acceptance, B4 current-Local coverage/final fence, B6 runtime composition, and live
activation remain open.

## Scope and ownership

- Worktree: `H:/TakiAgent`, branch `main`, unchanged HEAD/base `c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb`.
- Existing task: `08-09-memory-replica-sync-recovery`, parent `08-09-hindsight-memory-provider`.
- Child thread ID: `01a07a5f-10c3-7962-ab0a-51519e5433d0`; inherited session ID:
  `01a07553-c738-75f0-93c4-bd8a7cd0b014`. The child task resolver reported no session task; the parent-supplied active
  path supplied explicit context. `.trellis/.current-task` was an empty file. No pointer or task binding was changed.
- Reviewed all 35 tracked/untracked implementation source, test, and index files against the base, plus the actual
  authority, replica, scheduler, projection, transport, B4 import, and source-backed provider paths they use.
- The publication correction additionally touches three existing same-scope files:
  `packages/core/src/db/hindsight-replica-sync-repo.ts`,
  `packages/core/src/memory/hindsight/hindsight-incremental-sync.ts`, and
  `packages/core/src/memory/hindsight/hindsight-replica-sync-runner.test.ts`. Final source inventory: 38 files.
- This report is reviewer-owned. Leader-owned plans, manifests, handoff, executable specs, implementation evidence,
  and historical Waves 0-2 evidence were not rewritten.
- No subagents, new dependencies, staging/commit/push/reset/rebase/clean, task finish/archive, live Hindsight/LLM call,
  real user-data read/migration, or Authority activation. The protected legacy backup was never inspected, traversed,
  edited, or deleted and was explicitly excluded from root lint/audits. Hindsight access was narrow and read-only.

## Findings (fixed)

### F1 - Publication could outlive its captured Authority or trusted Bank scope

- **File:** `packages/core/src/db/hindsight-replica-sync-repo.ts:190`,
  `packages/core/src/memory/hindsight/hindsight-incremental-sync.ts:26`, and
  `packages/core/src/memory/hindsight/hindsight-replica-sync-runner.ts:78` / `:93`.
- **Issue:** recovery checked current Authority and Bank scope around an entire awaited pull. The underlying
  journal/snapshot transaction checked its lease, predecessor and deadline, but did not compare active Authority.
  Its Bank check also depended on a Bank record being present in that page. A scope/Authority change during HTTP
  could therefore publish records/FTS/cache/checkpoint before the outer wrapper rejected the result.
- **RED:** four actual-client/SQLite tests changed Authority or scope during first/second pull; the old code advanced
  the cursor from 3 to 4/6 despite reporting failure. Two actual snapshot run/rebuild tests incorrectly resolved
  successfully after Authority changed during page transfer.
- **Fix:** pass captured `expectedAuthority` through both publication inputs. Check actual active provider/epoch/
  lineage and current trusted Bank scope inside the same SQLite transaction, before writes and again before
  checkpoint publication. Scope is checked even when the journal page contains no Bank record. Existing complete
  prior pages, lease/CAS/deadline checks, and B4 immutable receipts remain intact.
- **Regressions:** first/second-pull cases at `hindsight-pending-recovery.test.ts:275` and `:292`; snapshot run/rebuild
  cases at `hindsight-replica-sync-runner.test.ts:300`; transaction-injected Authority changes at `:323` prove rollback
  of canonical records, FTS, cache, checkpoint, and the fixture's injected Authority mutation. All eight pass.

### F2 - Second-pull cursor reset abandoned a stage owned by the same run

- **File:** `packages/core/src/memory/hindsight/hindsight-pending-recovery-stages.ts:31`.
- **Issue:** after a cursor reset, the scheduler legitimately reused its lease for full rebuild. Re-entered recovery
  called `pending.claim()` for the already-owned `awaiting_pull` row; duplicate-claim refusal skipped it. The snapshot
  could be current while the manual run failed with Pending Memory still unresolved, requiring another action.
- **RED:** the second-pull reset test reported failed full reconciliation instead of finishing the same run; the
  first-pull reset control passed.
- **Fix:** continue a nonterminal stage already held by the identical scheduled lease. Other rows still use ordinary
  lease/version-CAS claim. Native/derived durable phases prevent redispatch; attempts are not incremented for this
  continuation, and duplicate concurrent runner calls remain coalesced.
- **Regressions:** `hindsight-pending-recovery.test.ts:310` covers both reset positions with one native dispatch,
  one derived check and one attempt. `:322` covers the captured absolute deadline and Authority fence during the
  second-pull rebuild. All four pass.

### F3 - Generation replacement mislabeled a possibly applied write as failed

- **File:** `packages/core/src/memory/hindsight/hindsight-pending-recovery-stages.ts:38`.
- **Issue:** after a lost native acknowledgement, a replacement Bank generation caused every receipt-less row to be
  marked `failed`, including rows already durably marked dispatched. A new generation cannot prove that the old
  generation never applied that write.
- **RED:** retain and mutation fixtures both returned `failed` where the preserved evidence required
  `outcome_unknown`.
- **Fix:** generation mismatch leaves dispatched receipt-less intents `outcome_unknown`, with original intent/native
  UUID intact and no automatic redispatch. Never-dispatched intents remain ordinary refused failures. Existing known
  native success retains its receipt and unresolved derived phase.
- **Regressions:** two real-client/repository/scheduler cases at `hindsight-pending-recovery.test.ts:344` pass and assert
  that only the original native write was sent.

These are concrete Taki implementation defects corrected within this review. They are separate from the two remaining
requirements below.

## Findings (not fixed)

### A - Required operation-scoped derived completion is unavailable

Pinned Hindsight revision inspected: `7eca2056dae5d70a682b755abfff8a107f6b08a0`. The five source/test files cited below
were clean against that revision. Paths in this subsection are relative to `H:/hindsight/`.

- `hindsight-api-slim/hindsight_api/api/http.py:3346` explicitly describes `result_metadata` as unstable internal/debug
  data. `hindsight-api-slim/hindsight_api/engine/memory_engine.py:2962` writes extraction outcome counts; these do not
  prove derived maintenance.
- `hindsight-api-slim/hindsight_api/engine/memory_engine.py:9033` persists the conditional mutation receipt before
  post-commit consolidation/graph submission at `:9076`. Submission IDs are discarded and enqueue failures are
  logged without changing the native receipt. A crash/enqueue failure can leave native success without required
  derived work.
- The same engine at `:16822` deduplicates consolidation by Bank. Bank-wide queue emptiness, a Bank task, or native
  retain completion is not operation-scoped completion evidence.
- `hindsight-api-slim/tests/test_taki_conditional_curation.py:18` disables automatic consolidation; those CAS tests
  cannot establish the missing derived contract.

The explicit `unavailableHindsightDerivedCompletion` port at
`packages/core/src/memory/hindsight/hindsight-derived-completion.ts:15` correctly fails with
`HINDSIGHT_DERIVED_FENCE_UNAVAILABLE`. Real-client offline tests retain successful native receipts in
`awaiting_derived` across restart and never resend them merely because the fence is unavailable. Positive derived
tests inject evidence; they prove consumer ordering and cursor validation only.

**Reason not fixed:** the supported public API does not supply the necessary producer evidence. This requires a
separately reviewed provider contract using its existing task machinery: durable operation-to-derived-work linkage,
submission repair, failure/retry semantics, and a lineage/generation-bound observable journal boundary. No endpoint,
queue-empty substitute, semantic maintenance engine, or server patch was invented here.

### B - Native append has no proven safe recovery mapping in this implementation

- `hindsight-api-slim/hindsight_api/api/http.py:705` confirms native append exists and concatenates into/reprocesses the
  existing document. It is not a replacement of the document with the submitted fragment.
- `hindsight-api-slim/hindsight_api/engine/retain/fact_storage.py:270` hashes sanitized combined content. At `:459`,
  original document text may be discarded. Fragment hashing/current fact enumeration does not establish the missing
  append-specific full-document result witness.
- `hindsight-api-slim/hindsight_api/engine/memory_engine.py:16435` resolves retain UUID replay by Bank/type without a
  payload fingerprint. `hindsight-api-slim/hindsight_api/api/http.py:6463` documents terminal operation pruning.
  Neither a missing operation nor a guessed retention interval supplies an indefinite replay guarantee.

The current path at `packages/core/src/memory/hindsight/hindsight-pending-replay.ts:38` refuses append before native
dispatch with `HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED`, preserves the original intent in an inspectable failed row,
and continues independent rows. Post-dispatch missing operations remain unknown and are never blindly resubmitted.

**Reason not fixed:** safe append result mapping is an unresolved consumer implementation requirement, not an upstream
absence of append. The current sources establish dispatch support but do not prove a safe in-scope mapping from the
fragment to its final full document/fact set under concurrency and restart. Follow-up must establish the pre-append
witness, resulting complete content/facts, and replay/retention semantics before removing the refusal; it must not
silently reinterpret append as replace or claim complete Wave 3 recovery.

## Other reviewed contracts

| Area | Evidence and conclusion |
| --- | --- |
| Admission/storage | Writer captures the real active epoch/checkpoint and trusted Bank. Migration 035 is additive; identity/hash/native UUID remain immutable, retries use version CAS, and transaction failure/reopen preserve state. Original timestamps and explicit policy/provenance are retained. |
| Native receipts | Submitted, native-success, awaiting-derived, awaiting-pull and completed remain distinct. Known receipts are not discarded by failed derived checks. Conditional replay uses its frozen normalized body/UUID before current-target revision checks. |
| Receipt-first provider path | `hindsight-api-slim/hindsight_api/engine/memory_engine.py:8599` returns an existing mutation receipt before current revision checks; `hindsight-api-slim/hindsight_api/engine/memories/conditional_mutation.py:14` and `:165` bind normalized request hash and target. The Taki client follows this contract. |
| Recovery/publication | Existing scheduler and Bank leases are reused. Both pulls, evidence checks and reset/rebuild share one absolute deadline. Cancellation, lease takeover, late callbacks, independent rows/Banks, all-superseded catch-up, manual request kind and backoff remain covered. |
| Derived consumer evidence | Receipt hash, operation, Authority epoch, provider lineage, Bank generation and cursor are bound. Only a complete applied journal checkpoint reaching the evidence cursor permits completion. Bad evidence preserves native receipts and other rows' progress. |
| Read safety | Pending overlay is separate and explicitly `confirmed: false`; admission does not mutate confirmed rows/FTS. Confirmed default reads omit invalidated/tombstoned units. Trusted policy/provenance and recall projection remain required B4/B6 inputs, not fabricated defaults. |
| Bounds/diagnostics | Admission is capped at 512 KiB, state at 2 MiB, retain result references at 256, HTTP responses at 512 KiB, and complete journal pages at 10,000 records. Errors are closed codes; credentials, raw exception/operation metadata and provider bodies are not copied into diagnostics. |
| Counts | Pending summary counts come from actual persisted phases/receipts. Scheduler lag remains unknown without matching cursor lineage/generation; no missing producer is represented as zero. Runtime/UI composition is still B6 work. |
| Migration/history | Fresh/reopen and 034-to-035 tests preserve canonical records, checkpoint/lease data and Authority/activation history. Earlier migration meaning and the old evidence archive are unchanged. |
| Cost/responsibility | Hindsight owns extraction, embeddings, consolidation, graph and recall mechanics. Taki owns routing/policy and durable client synchronization. No additional scheduler, generic job/Effect replay system, semantic engine or prompt copy was introduced. |
| Narrow B4 overlap | B4's `hindsight-import-orchestrator.ts` owns import ledger/cutover leases and a different retry/mapping lifecycle. B5 reuses wire schemas, hashes and UUID adapter, while its bounded native-completion helper uses the outbox/replica lease. Reusing B4 orchestration would import the wrong authority and retry semantics. |

## Verification

All commands ran from `H:/TakiAgent`, using Node `24.18.0` and pnpm `10.22.0`. The full gates below ran after all
behavioral fixes and source header/index updates.

| Command | Result |
| --- | --- |
| `pnpm --filter @taki/shared test` | PASS: 392 tests, 44 files. |
| `pnpm --filter @taki/core test` | PASS: 2,016 tests, 302 files; 14 review regression cases added. |
| `pnpm --filter @taki/cli test` | PASS: 47 tests, 8 files. |
| `pnpm --filter @taki/desktop test` | PASS: 548 tests, 103 files. |
| `pnpm -r typecheck` | PASS: Shared, Core, CLI, Desktop and E2E. |
| `pnpm lint --ignore-pattern '.backup-memory-legacy-migration-live-20260821-01/**'` | PASS: zero errors; only the pre-existing unused `max-lines` disable warning at `packages/core/src/db/run-repo.ts:6`. |
| `pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-pending-recovery.test.ts src/memory/hindsight/hindsight-replica-sync-runner.test.ts` | PASS after all fixes: 80 tests, 2 files. |
| `python -X utf8 ./.trellis/scripts/task.py validate .trellis/tasks/08-09-memory-replica-sync-recovery` | PASS: implement context 10 entries, check context 10 entries at reviewer validation. |
| `git diff --check c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb -- packages/shared/src packages/core/src/db packages/core/src/memory` | PASS. |
| `git diff --cached --check -- packages/shared/src packages/core/src/db packages/core/src/memory` | PASS; reviewer staged nothing. |
| Direct audit of tracked AND untracked source files | PASS: 38 files; UTF-8/no-BOM, final newline, whitespace/conflict markers, source header/index coverage and size guidance. |
| `node --input-type=module -e "await import('./packages/core/src/db/hindsight-replica-sync-repo.ts'); process.stdout.write('native replica publication import: pass\n')"` | PASS under native strip-only execution. |

Independent pre-fix focused baseline (132 tests / 10 files):

```powershell
pnpm --filter @taki/core exec vitest run src/db/pending-memory-repo.test.ts src/memory/hindsight/hindsight-pending-client.test.ts src/memory/hindsight/hindsight-pending-recovery.test.ts src/memory/hindsight/hindsight-client.test.ts src/memory/hindsight/hindsight-client-transport.test.ts src/memory/hindsight/hindsight-replica-sync-runner.test.ts src/memory/hindsight/hindsight-replica-scheduler.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/db/migrations/index-list.test.ts src/db/scheduled-task-repo.test.ts
```

RED commands were the two recovery-file filters `-t 'during pull'` and `-t 'Bank generation replacement'`, the
sync-runner filter `-t 'Authority change'`, and recovery filter `-t 'cursor reset during pull'`. They reproduced
4, 2, 2, and 1 failures respectively; their fixes and GREEN coverage are described above. They were intentional
regressions, not unaddressed gate failures.

An execution-process interruption lost five initially launched gate results and the in-memory checkpoint. CLI had
already completed with a full result. The old Shared/Core/Desktop/typecheck/lint tool IDs all returned unknown; a
scoped process check found no matching remaining check process, so none was killed. Only those five missing-result
gates were rerun. This repeated verification repaired missing evidence, not a failing implementation. The complete
final results above supersede the missing runs; CLI's already-complete result was retained.

Rust/Host gates, platform E2E execution, live provider/LLM acceptance and manual AC were not run or marked passed;
their consumers were unchanged. Test/typecheck/native-startup success does not close those gates.

### Isolated native startup and cleanup

An inline harness executed through `node --input-type=module` imported the recovery runner and Pending repository,
then spawned `node packages/core/src/main.ts` with `windowsHide: true` and working directory `H:/TakiAgent`.

- Fresh root: `G:/Temp/taki-b5-wave3-review-smoke-UmBazM`; data/inspection database:
  `G:/Temp/taki-b5-wave3-review-smoke-UmBazM/data/taki.db`.
- Child inherited only `SystemRoot`, `WINDIR`, `PATH`, `TEMP`, `TMP`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `COMSPEC`.
  It did not load `.env.local` or inherit provider credentials/`NODE_OPTIONS`.
- Explicit configuration: fresh `TAKI_DATA_DIR`, `TAKI_WS_HOST=127.0.0.1`, an ephemeral non-default `TAKI_WS_PORT`, a
  separate loopback dummy `TAKI_PROVIDER_BASE_URL`, `TAKI_PROVIDER_API_KEY=offline-dummy-key`,
  `TAKI_PROVIDER_MODEL=offline-smoke-model`, `TAKI_HINDSIGHT_ENABLED=false`, `TAKI_AMBIENT_SCREENSHOT=false`.
- Native imports and `ws server listening` succeeded. Owned child PID: 16520; exit:
  `{ code: null, signal: "SIGTERM" }`. `gracefulShutdownProven` is explicitly false.
- Inspection through Core's SQLite wrapper with no new migrations found every version 1..35,
  `pending_memory=0`, Authority selection `legacy-markdown`, and zero Hindsight activation receipts.
- Dummy provider request count: 0. No Hindsight/LLM/paid endpoint was contacted.
- Child stopped, SQLite inspection handle closed, temporary port probe closed, dummy provider closed, and owned
  temporary root removed: all true. The harness verified the resolved root was directly below system temp with its
  unique owned prefix before cleanup. Command exit 0; harness `pass: true`.

No owned process, tool session, listener, database handle or temporary root remains. No user-data database was opened.

## Final source inventory

38 source/test/index files = 24 production, 8 tests, 6 folder indexes. This report is additional task evidence;
leader-owned task/spec documents are outside this inventory. Ordinary diff checks do not inspect untracked files,
so every untracked entry below was read/audited directly.

| Directory | Files |
| --- | --- |
| `packages/shared/src/` | `pending-memory-schema.ts`, `pending-memory-schema.test.ts`, `memory-replica-schedule-schema.ts`, `index.ts`, `index.md` |
| `packages/core/src/db/` | `hindsight-replica-sync-repo.ts`, `pending-memory-repo.ts`, `pending-memory-store.ts`, `pending-memory-transition.ts`, `pending-memory-repo.test.ts`, `scheduled-task-repo.test.ts`, `index.md` |
| `packages/core/src/db/migrations/` | `035-pending-memory.ts`, `index-list.ts`, `index-list.test.ts`, `lineage-reopen-matrix.test.ts`, `index.md` |
| `packages/core/src/memory/` | `pending-memory-safety.ts`, `pending-memory-writer.ts`, `index.md` |
| `packages/core/src/memory/legacy-migration/` | `legacy-retain-sanitizer.ts`, `index.md` |
| `packages/core/src/memory/hindsight/` | `hindsight-client.ts`, `hindsight-import-contracts.ts`, `hindsight-import-identity.ts`, `hindsight-incremental-sync.ts`, `hindsight-replica-run-execution.ts`, `hindsight-replica-sync-runner.ts`, `hindsight-replica-sync-runner.test.ts`, `hindsight-derived-completion.ts`, `hindsight-pending-client.ts`, `hindsight-pending-client.test.ts`, `hindsight-pending-retain.ts`, `hindsight-pending-replay.ts`, `hindsight-pending-recovery-stages.ts`, `hindsight-pending-recovery-runner.ts`, `hindsight-pending-recovery.test.ts`, `index.md` |

## Proposed executable-spec updates

The leader owns `.trellis/spec/`; recommendations for `backend/memory-replica-sync.md` and its database/index pointers:

1. Recovery must carry captured Authority identity into actual journal AND snapshot/reset publication. Active
   provider/epoch/lineage and current trusted Bank scope are transaction-local guards, including pages without a Bank
   object; an outer post-await check is insufficient. Preserve already-committed prior pages and immutable receipts.
2. The same scheduler lease may resume durable Pending stages after cursor reset/rebuild. This is continuation, not
   another admission/attempt; preserve native/derived evidence and do not redispatch. A different lease still requires
   ordinary claim/CAS. The captured deadline spans both pulls and all reset/rebuild work.
3. Generation replacement distinguishes never-dispatched refusal from dispatched uncertainty. A lost-ACK write
   remains `outcome_unknown` in its original generation; known native success retains its receipt. Never infer an
   unapplied write from a missing/pruned operation or lack of derived evidence.
4. Keep explicit native/derived/local-confirmation phases, unconfirmed overlay, bounded admission/state/results and
   actual producer counts. Record the required producer fence and unsupported append mapping as separate incomplete
   contracts. Positive injected tests do not advertise provider support or complete acceptance.
5. Pin the new first/second-pull binding races, snapshot and transaction rollback, same-lease reset continuation, and
   generation-replacement uncertainty regressions. Preserve native Node startup/import proof and accurate cleanup;
   process termination alone does not prove graceful Windows shutdown.
