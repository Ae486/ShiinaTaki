# Wave 3 Pending Memory Implementation Evidence

Implementation started: 2026-09-06. Final implementation verification: 2026-09-07 (Asia/Shanghai).

The offline implementation is ready for independent review. Full Wave 3 recovery acceptance remains incomplete:
the current provider does not expose the required operation-scoped derived-completion fence, and native append lacks
the source-mapping proof needed by this recovery path. Neither limitation is treated as successful convergence.

## Scope and baseline

- Active task: `08-09-memory-replica-sync-recovery`, under `08-09-hindsight-memory-provider`.
- Worktree: `H:/TakiAgent`, branch `main`, implementation base `c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb`.
- Runtime used for verification: Node `24.18.0`, pnpm `10.22.0`, Windows PowerShell.
- Changes are limited to Shared contracts, Core Pending Memory/storage/native-client recovery seams, their tests and
  folder indexes, and this evidence. The leader owns task/parent status documents, handoff, and executable spec updates.
- No runtime provider activation, user-data migration, real provider/LLM request, dependency addition, Git staging or
  commit, task rebinding, finish/archive, or automatic authority change was performed. The protected legacy backup was
  excluded from checks and was not inspected or changed. Hindsight source inspection was read-only.

## Delivered behavior

| Area | Implementation and boundary |
| --- | --- |
| Durable admission | `createPendingMemoryWriter` captures the existing Hindsight authority/checkpoint, trusted Bank identity, original timestamp, operation ID, expected revision, and canonical request. Repeated admission preserves the original intent; changed payload under the same identity is refused. B6 runtime wiring remains separate. |
| Storage | Migration 035 adds `pending_memory`, unique by authority epoch/Bank/operation. Immutable indexed identity, canonical intent hash, stable native UUID, version CAS, persisted retries, and bounded state survive SQLite reopen. It does not write confirmed records, FTS, authority selection, or activation receipts. |
| Separate projection | `overlay()` returns explicit `confirmed: false` entries. Confirmed replica reads remain separate. Summary counts come from real persisted phases; missing evidence never becomes a fabricated completion or zero. |
| Replay | Existing replica scheduler claims and Bank leases drive the recovery runner. Authentication, compatibility/lineage/Bank verification and the first remote pull precede retain-first native replay. There is no second scheduler or generic Run Effect replay path. |
| Conditional mutations | Queued stale/missing targets become `superseded`. Lost-acknowledgement replay uses the same frozen mutation UUID and normalized payload before checking current target revision: a committed provider receipt can remain valid even if the target was subsequently changed or removed. |
| Completion | Native write success, operation-scoped derived evidence, and local second-pull confirmation are distinct durable facts. Only a matching derived fence reached by the verified local checkpoint permits `completed`. |
| Isolation | Failed/unsupported/superseded rows do not prevent other eligible rows from running. Bank failure preserves already committed replica and other Bank progress. Cancellation, lease replacement, deadlines, authority changes, and late callbacks cannot publish stale completion. |

The state machine persists `queued`, `submitted`, `awaiting_derived`, `awaiting_pull`, `completed`, `superseded`,
`failed`, `outcome_unknown`, and `cancelled`. Queued cancellation prevents dispatch. Interrupted submitted work retains
its uncertainty and native identity; interruption does not invent cancellation of an accepted provider write.

Recovery uses one captured absolute deadline across the first pull, replay, derived checks, cursor reset/rebuild, and
second pull. The existing 60-second execution default, 61-second lease default, retry policy, journal transaction
bound, and 512 KiB HTTP response cap are preserved. Admission separately caps serialized Pending Memory intents at
512 KiB, persisted state at 2 MiB, and resolved retain results at 256 fact references. These are Taki implementation
bounds, not claims about Hindsight API limits.

Retain resolution requires the right native `batch_retain` identity/outcome, exact document/content evidence,
complete fact enumeration, valid revisions, and matching count. Zero facts require explicit policy permission.
Native metadata values are encoded to the provider's string-valued map and original timestamps are retained.
Only source facts supported by native curation are mutated; observation/derived targets are refused.

If one operation reports an unreachable derived cursor, its stored native receipt is preserved and its derived evidence
is rejected. Independently verified rows can still complete. An all-superseded pass also pulls again so a concurrent
provider mutation is not mistaken for an unchanged local replica.

## Provider evidence and unresolved requirements

Inspected provider revision: `7eca2056dae5d70a682b755abfff8a107f6b08a0` in `H:/hindsight`.
The five inspected source/test paths below were clean against that revision. The findings distinguish native APIs from
the Batch 0 conditional-mutation extension; local fixture success does not expand either contract.

All relative paths in this table are under `H:/hindsight/`.

| Source | Observed contract and consequence |
| --- | --- |
| `hindsight-api-slim/hindsight_api/api/http.py:634-645` | Native retain has an occurrence timestamp and `dict[str, str]` metadata. Canonical JSON metadata requires explicit string encoding. |
| `hindsight-api-slim/hindsight_api/api/http.py:705-710` | Native append concatenates the new fragment with existing document text and reprocesses the combined document. The replace-source content-hash proof cannot be reused for an append fragment. |
| `hindsight-api-slim/hindsight_api/api/http.py:1811-1819,4347-4359,4384-4404` | Conditional curation accepts `expected_revision`/`mutation_id`; the native route restricts source curation to world/experience and exposes missing/revision/conflict outcomes. |
| `hindsight-api-slim/hindsight_api/api/http.py:3346-3349` | `result_metadata` is documented as internal/debug-only and unstable. It is not an operation-scoped maintenance-completion API. |
| `hindsight-api-slim/hindsight_api/api/http.py:6463-6469` | Terminal native operations are retained only for a configured window and are pruned afterward. A post-dispatch missing operation is not proof that it never executed. |
| `hindsight-api-slim/hindsight_api/engine/memory_engine.py:2962-2995` | Retain outcome metadata records extracted unit count/outcome, not derived maintenance completion. |
| `hindsight-api-slim/hindsight_api/engine/memory_engine.py:8599-8628` | Committed mutation replay returns its stored receipt before revision checks or later derived submission. The client must preserve exact request identity and must not reject a known committed replay merely because the current target changed. |
| `hindsight-api-slim/hindsight_api/engine/memory_engine.py:9033-9050,9076-9095` | The mutation receipt commits before best-effort post-commit consolidation/graph submission. Submission IDs are discarded and enqueue failures are only logged. A native receipt cannot prove those operations completed. |
| `hindsight-api-slim/hindsight_api/engine/memory_engine.py:16436-16462` | Native retain duplicate admission verifies Bank and operation type, without a request-payload fingerprint. Local immutable intent hashing is required; it does not create an indefinite remote idempotency guarantee. |
| `hindsight-api-slim/hindsight_api/engine/memory_engine.py:16822-16874` | Consolidation deduplication is Bank-scoped. An unrelated Bank job or temporarily empty queue cannot prove completion for a particular retained/mutated write. |
| `hindsight-api-slim/hindsight_api/engine/memories/conditional_mutation.py:14-57,165-190` | Conditional mutation fingerprints the normalized request, including expected revision, and verifies memory/request identity when reading the receipt. The receipt carries the fact/revision result, without a derived fence. |
| `hindsight-api-slim/hindsight_api/engine/retain/fact_storage.py:270-272,449-468` | Stored content hashes describe sanitized combined content; original text may be discarded. Append requires evidence about the pre-existing document and resulting full content/facts. |
| `hindsight-api-slim/tests/test_taki_conditional_curation.py:18-21` | The conditional-curation test fixture disables automatic consolidation. Its passing CAS tests do not establish derived-completion behavior. |

### Requirement A: operation-scoped derived completion is unavailable

`MemoryDerivedCompletionPort` expresses required consumer evidence: operation/native receipt identity, authority epoch,
provider lineage, Bank generation, and a completed journal cursor. It is an explicit dependency, not an invented
provider endpoint. `unavailableHindsightDerivedCompletion` fails closed with
`HINDSIGHT_DERIVED_FENCE_UNAVAILABLE`. Known native successes remain durably `awaiting_derived` and are never sent
again merely because this fence is missing. Positive fence/second-pull tests use injected evidence only.

A separate provider follow-up must durably connect each accepted operation/mutation with its required derived work,
including repair after a crash or enqueue failure between native commit and submission. It must expose bounded
pending/failure/completion evidence through a journal cursor tied to lineage and Bank generation. Waiting for all
unrelated Bank work or interpreting handler completion as a fence is insufficient.

### Requirement B: native append lacks a safe recovery mapping

Canonical retain admits `append`, but this recovery implementation cannot prove its mapping from the appended fragment
to the final provider document and fact set. It records `HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED` before native dispatch,
retains the intent in a visible terminal failed row, and continues other rows. This is a distinct unsupported recovery
requirement, not a completed capability or a reason to loop forever retrying the same unsupported payload.

A provider/source-mapping follow-up must define a pre-append document revision/content witness, the resulting full
document hash and fact identities, plus stable replay/retention semantics. Native retain operations that disappear
after dispatch remain `outcome_unknown`; this implementation does not guess a retention TTL or blindly submit again.

Provider follow-up tests must cover lost acknowledgements, duplicate delivery, the native-commit/enqueue crash window,
derived failure/cancellation/pruning, unrelated concurrent Bank work, generation changes, and the final journal/second-
pull boundary. No Hindsight patch, service start, generated-client change, or live test was performed in this wave.

## Verification

All commands ran from `H:/TakiAgent`. Final behavioral gates passed on 2026-09-07. Later changes were limited to role
headers, folder-index corrections, and this evidence; unchanged full suites were not repeated after those doc-only edits.

| Command/check | Result |
| --- | --- |
| `pnpm --filter @taki/shared test` | 392 tests, 44 files passed. |
| `pnpm --filter @taki/core test` | 2,002 tests, 302 files passed. |
| `pnpm --filter @taki/cli test` | 47 tests, 8 files passed. |
| `pnpm --filter @taki/desktop test` | 548 tests, 103 files passed. |
| `pnpm -r typecheck` | All five packages passed: Shared, Core, CLI, Desktop, and E2E. |
| Focused Core command below | 132 tests across 10 files passed. |
| `pnpm lint --ignore-pattern '.backup-memory-legacy-migration-live-20260821-01/**'` | Passed; only the existing unused `max-lines` disable warning at `packages/core/src/db/run-repo.ts:6`. |
| `python -X utf8 ./.trellis/scripts/task.py validate .trellis/tasks/08-09-memory-replica-sync-recovery` | Passed: implement context 10 entries, check context 9 entries. |
| Curated context existence/size audit | All referenced files exist and satisfy the 32 KiB context-file limit. |
| Source audit | 35 owned source/test/index files; 22 production files have required module headers and folder-index coverage. UTF-8/no-BOM, final newline, whitespace, conflict-marker, and size checks passed. |
| Whitespace checks | Scoped tracked working-tree and staged checks passed. New files were read directly because ordinary `git diff --check` does not inspect untracked files. No files were staged. |

Focused command:

```powershell
pnpm --filter @taki/core exec vitest run src/db/pending-memory-repo.test.ts src/memory/hindsight/hindsight-pending-client.test.ts src/memory/hindsight/hindsight-pending-recovery.test.ts src/memory/hindsight/hindsight-client.test.ts src/memory/hindsight/hindsight-client-transport.test.ts src/memory/hindsight/hindsight-replica-sync-runner.test.ts src/memory/hindsight/hindsight-replica-scheduler.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/db/migrations/index-list.test.ts src/db/scheduled-task-repo.test.ts
```

New contract coverage contains 14 Shared cases and 52 Core cases (repository 15, pending client 11, recovery 26).
Cases cover durable reopen, immutable identity/payload conflict, transaction rollback/CAS/lease fencing, queued cancel,
overlay separation, unsafe payloads, unavailable/invalid derived evidence, original time/metadata, expected-revision
supersession, receipt-first mutation retries, missing native operations, independent rows/Banks, ignored-abort transport,
absolute deadlines, second-pull failure/restart, and unchanged authority/activation receipts.

An initial recovery test failed because its fixture lacked the trusted layer-policy binding required by the requested
reclassification. The fixture was given that explicit binding; production admission was not weakened or supplied with
fabricated policy. Subsequent focused and full suites above passed. Initial compile/lint issues were corrected before
the final gates. The final source audit also found and narrowly repaired the pre-existing missing migration-index
entries 025 and 028; the migration implementations themselves were unchanged.

### Isolated native Core startup and cleanup

An inline `node --input-type=module` harness spawned `node packages/core/src/main.ts` with `windowsHide: true`,
working directory `H:/TakiAgent`, and a fresh `G:/Temp/taki-b5-wave3-smoke-GlXznv/data` directory. It inherited only OS
essentials (`SystemRoot`, `WINDIR`, `PATH`, `TEMP`, `TMP`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `COMSPEC`).
It did not load `.env.local` or inherit provider credentials/`NODE_OPTIONS`.

The harness explicitly set an ephemeral non-default loopback WS port, a separate loopback dummy HTTP provider,
`TAKI_PROVIDER_API_KEY=offline-dummy-key`, `TAKI_PROVIDER_MODEL=offline-smoke-model`,
`TAKI_HINDSIGHT_ENABLED=false`, and `TAKI_AMBIENT_SCREENSHOT=false`. It waited for `ws server listening`, stopped its
own child, and inspected the resulting database through Core's SQLite wrapper with an empty inspection migration list.

Observed output (command exit 0):

- Core listening: true; migrations: every version from 1 through 35.
- `pending_memory` row count: 0; authority selection: `legacy-markdown`; Hindsight activation receipts: 0.
- Dummy provider request count: 0.
- Child exit: `{ code: null, signal: "SIGTERM" }`; `gracefulShutdownProven: false`.
- Owned child stopped, inspection handle closed, dummy provider closed, temporary directory cleaned: all true.

The inspection handle was closed before cleanup. The harness verified that the resolved temporary root was directly
under the system temp directory and had its unique owned prefix before deleting it. No owned smoke process, listener,
database handle, tool session, or temporary root remains. This proves native startup and isolated migrations, not
graceful Windows shutdown, real Hindsight operation, Rust/Host behavior, or live recovery acceptance.

## Source inventory

The implementation owns these 35 source/test/index files, plus this evidence file. Leader-owned task/spec/status
documents are deliberately not included in this implementation inventory.

| Directory | Files |
| --- | --- |
| `packages/shared/src/` | `pending-memory-schema.ts`, `pending-memory-schema.test.ts`, `memory-replica-schedule-schema.ts`, `index.ts`, `index.md` |
| `packages/core/src/db/` | `pending-memory-repo.ts`, `pending-memory-store.ts`, `pending-memory-transition.ts`, `pending-memory-repo.test.ts`, `scheduled-task-repo.test.ts`, `index.md` |
| `packages/core/src/db/migrations/` | `035-pending-memory.ts`, `index-list.ts`, `index-list.test.ts`, `lineage-reopen-matrix.test.ts`, `index.md` |
| `packages/core/src/memory/` | `pending-memory-safety.ts`, `pending-memory-writer.ts`, `index.md` |
| `packages/core/src/memory/legacy-migration/` | `legacy-retain-sanitizer.ts`, `index.md` |
| `packages/core/src/memory/hindsight/` | `hindsight-client.ts`, `hindsight-import-contracts.ts`, `hindsight-import-identity.ts`, `hindsight-replica-run-execution.ts`, `hindsight-replica-sync-runner.ts`, `hindsight-derived-completion.ts`, `hindsight-pending-client.ts`, `hindsight-pending-client.test.ts`, `hindsight-pending-retain.ts`, `hindsight-pending-replay.ts`, `hindsight-pending-recovery-stages.ts`, `hindsight-pending-recovery-runner.ts`, `hindsight-pending-recovery.test.ts`, `index.md` |

Existing native wire schemas, transport/authentication, deterministic identity/hash functions, replica projection,
leases, and scheduler remain the reused foundations. Legacy sanitizer and import UUID algorithms are unchanged; their
headers/indexes now describe their narrow reuse. The existing runner only gains captured deadline/authority plumbing.
Migration-tail expectations are updated for 035 without changing earlier schema meaning.

Document-to-fact completion verification overlaps narrowly with B4's importer. Its orchestration cannot be reused:
B4 is tied to immutable import/cutover ledger and leases, while B5 uses the pending outbox and existing replica lease.
The new helper reuses wire/hash/identity contracts without making B4's state machine the ongoing replay authority.

## Remaining gate

Independent review is still required. This record does not mark the task, full B5, Wave 3 recovery acceptance, or any
manual acceptance criterion complete. Provider requirements A and B above require separate follow-up. Live use also
requires B4 current-Local coverage and its final fence, trusted policy/provenance bindings, B6 runtime composition, and
explicit owner-approved activation. Rust/Host, platform E2E execution, real provider, and live LLM checks were not run.
