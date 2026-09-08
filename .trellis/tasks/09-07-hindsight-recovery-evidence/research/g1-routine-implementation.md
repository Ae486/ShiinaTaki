# G1 Routine Implementation Checkpoint

Updated: 2026-09-08. Implementer: `/root/hindsight_g1_implement`.

## Independent-review remediation handoff - 2026-09-08

The corrective implementation and final affected checks are complete; source is
frozen. The independent reviewer withdrew R1 with executable evidence and reviewed
R2 through R8 as closed, including the final typed-counter adjustment. The leader
owns the final review/task records. The owner-approved actual-source Rust build and
four contracts passed in `d31d069c8e07`. The earlier 39-case and package passes below are historical
baselines; the current final results are 69 native, 396 Shared and 2036 Core tests.
Public schema/generated trees were not changed by this corrective turn.

| Review item | Current corrective evidence |
| --- | --- |
| R1 entity-only witness | Candidate withdrawn by independent review. Real `update_memory_unit(entities=...)` advances included `edited_at`; the old prepared guard already rejects it. Added `test_review_source_fences.py::test_entity_only_native_curation_fences_prepared_input`; no production witness change. |
| R2 NULL historical body | RED `a79adbde3c9d`: append did not refuse. Preparation now distinguishes absent row from present `original_text=NULL`, refusing the latter with `plan_incompatible` before factual writes. `test_append_refuses_existing_document_without_historical_text` verifies old facts/hash remain intact. |
| R4 changed chunk boundaries | Same RED run: the first fragment's unique marker was absent from native facts despite a complete receipt. Restrict the historical-prefix metadata shortcut to untracked writes. `test_changed_chunk_size_append_extracts_first_fragment_before_sealing` asserts the actual chunks-mode fact contains the marker. |
| R1/R2/R4 green | `9e418bb81520`: 4 passed / 17.79 s, including the existing archived-survivor/marker-only-consolidation test. Independent reviewer closed R2/R4 and withdrew R1. |
| R5 native validation mapping | RED `c34b2227a5a9`: 5 real ASGI cases returned 500 instead of 422/403/429. Add sanitized ValueError/OperationValidationError mapping to tracked mutation. `test_review_mutation_api.py` checks status, fixed envelope, no leaked original error, and no receipt publication. |
| Moved timestamp type | `group_retain_items` now explicitly narrows validated datetime values and rejects a bypassed invalid string; it preserves native default/unset/date/offset/microsecond inputs. New `test_native_requests.py` has 10 cases. Root owns the corrected changed-source type gate; 27 unrelated Windows MLX/Unix diagnostics remain baseline. |
| R5/timestamp green | `960009eeba6b`: 15 passed / 14.90 s. R5 independently reviewed and closed. |
| R6 Unicode hash | RED Python `ed21734deaf3`: 1 fail / 7 pass; same wire vector hashed to `5d23d9dd...` in Python and `6d7f8716...` in Node. Both hash the original entity list now, independent of Unicode trim/lower/dedup; native execution normalization is unchanged. Shared 4 passed; Python hashes + actual mutations `bc8e4a2beb92`: 11 passed / 11.58 s. |
| R3 independent row progress | Leader owns runner repair and its new two-row regression; independent reviewer reported that regression passed. No implementer edit to the runner this corrective turn. |
| R7 pruned explicit retry | RED `ada9138c6a8c`: 3 real native delete/roll-up retry failures. Preserve typed parent admission metadata; restore only original unsealed children and the original aggregate row on explicit retry, with immutable identity checks. `42339e6c4a74`: 18 passed including lifecycle/mutation. The reviewer's additional reused-parent/fully-pruned-children case produced RED `ba97351250d4`; a private typed identity/request-hash marker now binds both original and restored parents. Ordinary native requests cannot supply it. |
| R7 missing native statistics | The restored parent keeps the original token/item/child metadata. `NativeRestoredParentOutcome` marks incomplete queue history with nullable counters and `native_result_outcome_complete=false`; fixed receipt inputs still determine G1 proof. Ordinary unmarked native parents keep their original outcome serialization and SQL merge. Tests cover a pruned completed sibling, cancellation, reused UUIDs and sealed-result refusal. |
| R8 native outbox | RED `011c8614374d`: 3 failures (A/B/A/B duplicate events, no event after factual-commit crash/retry, and outbox failure leaving sealed facts). Reuse the native per-input factory and call the callback on the final coverage transaction with facts/journal/receipt. A sealed retry does not repeat the callback. Real SQL records prove per-document visibility, commit-before-crash and rollback/retry behavior. |
| R7/R8 focused green | `7907f97a971c`: 11 passed / 53.07 s (8 retry, 3 outbox). The final typed-null counter form is included again in the final 69-case matrix. Both findings independently closed. |

All completed corrective fixtures above report stopped/data removed/registry removed.
R6's public shape is unchanged. The revised entity wire-vector digest is
`735043973bdf7f2cb8e75753ec10d9561b4c196b5ebb29368563e98eb0211a56`; the rich
mutation vector is `67855e3d9b871d5fecbe17babc2667fa5f6445714fdaa2ddf5b4a4f80593e9a3`.
The original operation's exact frozen command remains the replay identity; semantic
entity normalization is performed separately by the native curation path.

### Current final checks and source freeze

| Gate | Final result |
| --- | --- |
| Native full matrix, including backup and real HTTP -> Core -> SQLite | `c6b4ce7f991d`: **69 passed**, 144.22 s; 30 added cases relative to the pre-review 39-case matrix. Two existing uvicorn/WebSocket deprecation warnings only. |
| Shared full suite | **396 passed / 45 files**, 6.70 s; one additional Unicode wire-vector case. |
| Core full suite, run independently after PostgreSQL stopped | **2036 passed / 303 files**, 39.42 s; includes the leader's new R3 two-row recovery case. |
| All five TypeScript package typechecks | Passed. |
| Changed provider source typecheck | Leader run `3dcd8e4b32f7`: 14 changed Python files passed, including the final typed counter. The full Windows provider check still has 27 unchanged optional MLX/Unix environment diagnostics; it is not a full-provider pass. |
| Scoped provider Ruff lint / format | Passed; 23 corrective source/test files already formatted. |
| Shared changed-file ESLint | Both changed files passed. The leader separately checked its R3 files. |
| Two-repository scoped tracked whitespace | Passed. Untracked corrective files were formatted and checked as explicit paths. |

One first Core full run reported 2035 passes and one failure in the unchanged
`mcp-http.test.ts` (`remote_echo` was undefined). The isolated existing test passed
without edits, then the full independent Core run passed all 2036 cases. The cause
was not established; do not describe a confirmed startup or timing diagnosis.
No MCP source or test was modified. Prior CLI/Desktop/SDK successes were not
repeated in this turn because their code and accepted contracts did not change.

Final native evidence is in
`H:/TakiAgent/.trellis/.runtime/g1-validation/taki-hindsight-g1-c6b4ce7f991d/pytest.log`.
Its `ownership.json` and stop logs show the owned instance stopped; the harness
completion and explicit checks confirm both `data/` and the matching
`C:/Users/55473/.pg0/instances/taki-hindsight-g1-c6b4ce7f991d` registry are absent.
All corrective fixtures were stopped and cleaned. No owned check process remains.

This corrective turn changes seven provider production files (`native_requests`,
`native_operation_receipts`, `native_receipt_lifecycle`, `memory_engine`, retain
`receipt_context`/`orchestrator`, and the Taki extension router), Shared's portable
hash encoder/test, and native regression tests. New test files are
`test_native_requests.py`, `test_review_source_fences.py`,
`test_review_mutation_api.py`, `test_review_retry.py` and `test_review_outbox.py`.
The leader owns the R3 Core runner/test repair, generated trees and other records.

The leader closed the approved actual-source Rust build gate. B4/B6/B7/initial or healthy-switch cutover
and live/manual acceptance are independent. No new dependency, live service/data,
authority activation, Git write or task finish/archive was performed by the corrective implementer.

## Pre-review implementation handoff - 2026-09-08

The selected routine G1 slice is implemented and its implementer-owned offline
checks pass. This is ready for the leader's independent review, final canonical
SDK gate and task/spec/patch-ledger update. It is not owner/manual acceptance or
completion of the separate B4/B6/cutover work. The older progress sections below
are historical checkpoints; their pending items are superseded by this section.

### Implemented behavior

- Tracked admission durably binds the original request, operation, Bank lineage
  and generation. Native retain still uses its existing asynchronous children,
  outer splitting, streaming/delta extraction, native update modes and background
  maintenance. No new public size limit or automatic model-refresh trigger was added.
- Native facts and exact part evidence commit on the existing factual transaction.
  Frozen append plans carry original request/input identity, full resulting body,
  deterministic chunk ordinals and a source witness. Native delta keeps archived
  survivors. Equal chunk text at different ordinals remains distinct work.
- Successful zero, failed extraction and missing/duplicate/malformed provider Batch
  results are distinct. A durable Batch checkpoint resumes the existing provider
  batch after an interrupted poll; a known failed batch needs explicit native retry.
- Mutation results retain the original unit snapshot and committed cursor, including
  no-op boundaries. Later source edits/deletion and queue pruning cannot rewrite a
  sealed result or cause a duplicate command to apply again.
- Result/status/page reads are engine-authenticated and read-only. Immutable pages
  carry full source references; receipt, result and page hashes have separate domains.
  The independent native-results capability checks PostgreSQL schema plus the actual
  SQL memory/document-store capabilities at both admission and worker execution.
- `native_receipt_lifecycle.py` integrates native cancellation, explicit retry and
  Bank retirement with the existing Bank -> receipt -> task lock order. Fixed child
  coverage cannot shrink after pruning; explicit retry can restore an original
  missing, unsealed child from its saved task. Stale attempts and source takeover
  cannot publish. A sibling success cannot erase a durable cancellation.
- Sealed retries run the native ANN/post-insert maintenance tail without repeating
  extraction or factual writes. Completed inputs release prepared source bodies;
  sealed children release private task payloads; the final immutable result owns
  the reference set without duplicate private copies. SQL tests verify this cleanup.
- Taki persists the complete frozen tracked dispatch before possible send, preserves
  it across restart, verifies every full-result page in constant retained memory,
  and stores a bounded compact proof. New factual proof enters existing `awaiting_pull`
  and completes only after the actual persisted SQLite checkpoint reaches the
  original native cursor under unchanged Authority, Bank, lease and deadline guards.
- Missing-result identity is checked before any resubmission. Policy-forbidden zero
  stays an explicit proven outcome without being relabelled unapplied. Old rows keep
  absent dispatch/proof fields and their old hashes; they are not auto-promoted.
  Migration 035 is byte-identical to the preserved B5 baseline.
- The real HTTP -> typed Taki client -> Pending runner -> SQLite fixture covers
  replace, lost append acknowledgement, two SQLite reopen boundaries, failed second
  pull, original proof reuse, full source application and native mutation. It observes
  unconsolidated native facts and makes zero calls to the supplied derived port.
  Its explicit test-owned source/policy/provenance bindings are not B4/B6 adapters.
- Maintained TypeScript and Python wrappers expose matching tracked retain/mutation,
  status and immutable-page methods (Python sync and async variants), with mapping
  regressions. The leader owns all generator-owned artifacts and generator changes.

### Implementer-owned changed file groups

Hindsight provider:

- New `hindsight_api/native_requests.py`,
  `engine/native_operation_receipts.py`, `engine/native_receipt_lifecycle.py`,
  `engine/retain/receipt_context.py` and Alembic
  `a8e1b6d4f0c3_add_native_operation_receipts.py`.
- Existing `api/__init__.py`, `api/dependencies.py`, `api/http.py`,
  `engine/memory_engine.py`, `engine/retain/orchestrator.py`,
  `engine/retain/fact_extraction.py`, `engine/taki_compatibility.py`,
  `extensions/builtin/taki_memory.py` and `admin/cli.py` contain the minimal native
  model/precheck/transaction/lifecycle/backup and extension integration hooks.
- New `tests/native_results/` fixture and protocol matrix; updated
  `tests/test_taki_extension_contract.py` and the capability-bearing fake in
  `tests/test_retain_pipeline_cancellation.py`.
- Maintained `hindsight-clients/typescript/src/index.ts` and
  `tests/native_result_mapping.test.ts`; maintained
  `hindsight-clients/python/hindsight_client/hindsight_client.py` and
  `tests/test_native_result_mapping.py`.

Taki consumer:

- New Shared `hindsight-native-result-schema.ts`,
  `hindsight-native-proof-encoding.ts` and its colocated test; updated
  `pending-memory-schema.ts`, `memory-replica-schedule-schema.ts`,
  `hindsight-connection-schema.ts` and public exports/index.
- New Core `hindsight-native-result-client.ts`, `hindsight-native-proof.ts`,
  `hindsight-native-proof.test.ts` and `hindsight-pending-native-result.ts`;
  updated client/compatibility/Pending client/replay/recovery runner and stages.
- Updated `db/pending-memory-repo.ts`, `pending-memory-store.ts`,
  `pending-memory-transition.ts`, the repository tests and folder indexes.
  Existing B5 migration, derived path and unrelated runtime files are preserved.
- The standalone Node HTTP fixture is
  `research/validation/taki-native-result-http.fixture.ts` under this task. It was
  moved out of Core so fixture-only filesystem/process setup cannot violate Core's
  OS-access boundary. This report is the implementer's only task-record ownership.

### Final verification evidence

| Gate | Result |
| --- | --- |
| Full native matrix with actual HTTP fixture | `348e5ef69a97`: 39 passed, 82.13 s; only two uvicorn/WebSocket deprecation warnings |
| Previous complete native matrix | `98054febe1d8`: 39 passed, 83.40 s |
| Final retain/sealed-tail regression after schema titles and duplicate-cleanup removal | `4c88afdb6114`: 4 passed, 15.00 s |
| Native nonempty admin backup/restore and partial append continuation | `de61e28a76bb`: 1 passed, 23.01 s; also included in both 39-case full runs |
| Worker capability guard and relocated actual HTTP fixture | `dd0d5335b71d`: 2 passed; also included in full runs |
| Shared full suite | 395 passed |
| Core full suite | 2035 passed |
| CLI full suite | 47 passed |
| Desktop full suite | 548 passed / 103 files, final repeat 11.16 s |
| All five Taki TypeScript package typechecks | Passed |
| Root ESLint over packages/apps/e2e | 0 errors; one pre-existing `run-repo.ts` warning |
| Provider scoped Ruff lint and format | Passed after six mixed-line-ending/test-wrapping corrections |
| Scoped tracked diff whitespace and report encoding | Passed; report UTF-8 without BOM and below 32 KiB |

The leader separately reported Python wrapper suite 74 passed, TypeScript wrapper
suite 34 passed, Go build/contract checks and docs build passed. The leader's broad
native mechanical selection was 544 passed / 99 not-applicable skips / one old
test-double failure. The fake lacked the actual backend capability queried before
the intended DB error; adding that minimal capability restored the cancellation
test (`26775358cd7a`: 1 passed). These leader-owned gates must use the leader's
current records, especially after the final schema regeneration.

Every native fixture above used the owner-guarded disposable PostgreSQL harness,
disabled dotenv/real credentials, deterministic model substitutes, and only its
owned DB and explicitly owned loopback listener. `348e5ef69a97` records `stopped=true`;
the final `4c88afdb6114` completion reports stopped/data removed/registry removed.
No owned check process remains running at this handoff.

### Final source freeze and remaining leader gates

- The public native-results wire was frozen for canonical generation. The final
  source-only schema titles are `TakiNativeOperationStatus` and
  `TakiNativeReceiptReason`; status/reason literal values and wire shape did not
  change. These titles prevent the actual Rust generator's generic enum-name
  collision. The leader was notified before rerunning generation. No generated
  artifact was hand-edited by this implementer.
- The leader still owns final deterministic OpenAPI/client regeneration, generated
  artifact whitespace/parity, Rust build resolution, the independent checker and
  executable spec/ledger/PRD/HANDOFF updates. This report does not substitute for
  those gates or authorize a new dependency.
- Initial activation/healthy provider switching still require independent finite
  completeness evidence. No queue-emptiness or zero-Pending count is a cutover proof.
- B4 current-Local completeness and B6 full Local/native policy, provenance,
  source-body and metadata adapters remain explicit external work. No live/real-LLM,
  current-data, authority activation or manual acceptance was run.
- The protected legacy backup and other worktrees were not inspected. The unrelated
  Hindsight `hindsight-control-plane/bin/cli.js` still matches preserved SHA-256
  `ce3ccd97b3759b2a0848221a9487de67178ce640d1ddc324a3043f7507655ef2`.
  No dependency, staging, commit, push, reset/rebase or task finish/archive occurred.

## Historical implementation checkpoints

## Scope and ownership

The owner authorized implementation after technical readiness. The leader dispatched
the selected routine G1 native-result/append slice in `H:/hindsight` and `H:/TakiAgent`.
`design.md`, `implement.md`, `grill.md`, `g1-native-result-protocol.md` and
`g1-taki-consumer-and-field-map.md` are the active inputs; the earlier strict derived
work graph is historical. Initial/healthy-switch cutover and B4/B6 remain independent
gates. No live data, real LLM/service, authority activation, dependencies or Git writes
are authorized. Preserve all prior B5 changes, provider `bin/cli.js`, other worktrees
and the protected legacy backup. The session-scoped task binding is authoritative;
the empty legacy `.current-task` was not changed.

## Implemented source so far (not acceptance)

- Added `hindsight_api/native_requests.py` by moving the native public write models
  and sharing native item/strategy mapping. Native HTTP names/options remain stable.
- Added typed public/hash/receipt persistence in `engine/native_operation_receipts.py`.
  Request, prepared input, result and native receipt hashes have separate domains.
  Wire hashing uses ordered JSON arrays, UTF-8 map-pair order, explicit defaults,
  strict Unicode scalars and safe integer values.
- Added PostgreSQL migration `a8e1b6d4f0c3` after verified unique head `f7d0a5c3e9b2`:
  `memory_native_operation_receipts` and `memory_retain_part_receipts`. Oracle is
  deliberately unsupported. Both tables are in `BACKUP_TABLES`; no queue/source FK.
- Added engine-owned tracked mutation, result/status and immutable page methods.
  Mutation seals its original result and actual journal cursor on the native Phase-2
  transaction; no-op uses the locked boundary. Legacy receipts do not gain a cursor.
- Native retain admission has an optional typed context, fixed input/child association,
  generated document IDs and durable payload fingerprint in the existing admission
  transaction. Untracked public parameters and replay behavior remain separate.
- Added `retain/receipt_context.py` for private prepared plans, child execution fences,
  SQL source-state witnesses, exact chunk coverage, immutable source result seals and
  per-part provider Batch API checkpoints.
- Shared native screening/append assembly helpers in `retain/orchestrator.py` feed
  preparation before any factual write. Streaming, delta and metadata transactions
  publish the ordinary journal and exact part evidence together. Zero results use
  proof-bearing native transactions, without inventing a fact.
- Preparation preserves native outer splitting of the submitted fragment and
  prepends the complete historical body only to the first slice. Its native delta
  can therefore preserve historical survivor IDs/lifecycle; later slices retain
  native streaming. The first transaction covers only its declared slice, and the
  full input seals after every slice. Full combined body overrides and exact global
  offsets are fixed before any canonical write. An initial implementation split
  the already-combined body and forced full streaming; source review replaced that
  approach before acceptance because it unnecessarily re-extracted old facts and
  could change archived-survivor behavior. No new input cap or public mode change.
- Added opt-in typed Batch API failure propagation and checkpoint identity in
  `retain/fact_extraction.py`; this still needs its dedicated fixture matrix.
- Added extension routes for tracked retain/mutation, status and immutable result
  pages. Native pre-body precheck is shared via `api/dependencies.py`.

## Verification ledger

Use the leader-owned harness in `research/validation/run_isolated_hindsight.py` with
the existing `H:/hindsight/.venv/Scripts/python.exe`. It disables dotenv and inherited
credentials, allows only its owned PostgreSQL socket, verifies the actual data path,
and stops/removes the owned data/registry. No model/provider network calls are used.

- Initial harness run `feb399fffd37`: Windows socket-pair guard/pytest setup failed;
  no valid behavior RED. Leader fixed the harness.
- Leader run `ba9bfa4ab5bf`: six expected missing-module hash REDs; three fixture ML
  setup errors. No mutation behavior claim.
- Runs `bb9c6f4bfced`, `cb0d4ce815c9`, `4f1c6e81a770`: fixture-only setup issues
  (optional ML import, config resolver lifecycle, then embedding dimension). Fixed
  by a mock LLM, deterministic 384-dimensional embeddings, native RRF reranker and
  post-initialize config injection. Native migration itself succeeded.
- Run `9ac5b7665304`: import failure after moving write models. The actual caller
  was `api/__init__.py`; it now imports `MemoryItem`/`RetainRequest` directly from
  `native_requests.py` while preserving the existing package `__all__` API. Temporary
  HTTP aliases were removed after the caller audit. No behavior claim for that run.
- Run `32df4fe65be1`, `tests/native_results -q --tb=short`: **11 pass, 1 fail** in
  19.69 seconds. Mutation original result/cursor after later deletion, rollback and
  no-op all passed. Six hash cases passed. Append full body/idempotent repeat and
  read-only unavailable status passed. The remaining assertion wrongly counted the
  native graph-maintenance row created by source deletion; narrowed to retained
  parent/child rows. Rerun is still required.
- Source compile checks passed at the earlier checkpoints. Scoped Ruff check/format
  ran and import findings were fixed. Final full lint/type/backup/migration and
  generated artifact gates have not run yet.

All listed fixture instances reported stopped and owned data/registry removed; logs
remain in ignored `.trellis/.runtime/g1-validation/<fixture>/pytest.log`.

## Next required work

1. Complete deterministic native cases: interrupted append, exact duplicate ordinals,
   successful zero versus extraction failure, full/delta survivors, large text/JSON
   inputs, stale attempts/cancellation, marker-only consolidation, partial takeover,
   fixed child coverage and Bank lifetime/backup behavior.
2. Finish lifecycle hooks and safe retry behavior for retained native receipts;
   verify post-write maintenance tail on sealed-result native retries.
3. Add Shared canonical native wire/compact proof/dispatch contracts and actual
   Taki HTTP -> SQLite confirmation through the original factual checkpoint.
   Preserve old intent and receipt hashes, undefined legacy dispatch protocol and
   old row behavior; no rewrite of migration 035.
4. Verify every immutable page/ordinal/count/hash, bounded response/state, Authority,
   Bank, lease and deadline guards, second-pull failure/reopen and independent rows.
5. Notify leader when public schema is stable. Leader owns portable canonical
   OpenAPI/SDK generation tooling and final provider ledger/task/HANDOFF updates.
   Generated trees are not yet modified; the public capability/build is not yet
   accepted as a complete routine contract.

The metadata JSON-to-string ambiguity and trusted policy/provenance/source-body
bindings remain explicit B4/B6 dependencies. This routine slice does not claim
full Local maintenance, cutover, live/manual or parent-task acceptance.

## Context checkpoint - 2026-09-08 01:45 local

Window: `01a07c74-3db8-7221-9c6e-d4a6cc08d61e`. The current bounded implementation
assignment continues; no user cancellation or new scope has occurred.

Additional Taki source now exists:

- Shared: `hindsight-native-result-schema.ts`, `hindsight-native-proof-encoding.ts`,
  named public exports/index, optional dispatch/native-status/native-result receipt
  fields in `pending-memory-schema.ts`, two closed native-result diagnostics.
- Core: `hindsight-native-result-client.ts`, `hindsight-native-proof.ts`,
  `hindsight-pending-native-result.ts`; existing client/replay/stages/runner now
  negotiate tracked support and use frozen tracked commands. Native result pages
  are validated by ordinal, UUID order, per-page hash and whole-stream digest.
  Proof enters existing `awaiting_pull`, then the actual SQLite checkpoint fence.
- SQLite Pending store/transition/repository now preserve original dispatch after
  possible send, validate local receipt-envelope and producer hashes, retain old
  rows without default promotion, and count both receipt variants. Migration 035
  is unchanged; no new Taki SQL phase/migration was needed.
- The prior derived port is optional and remains only the explicit legacy path;
  no new tracked write schedules or waits for derived work. The old build remains
  admitted for its old contracts, while G1 requires exact `...-g1-v1` build and
  independent native-results capability. Provider manifest/source build updated;
  complete compatibility acceptance is still pending.

New checks:

- Shared typecheck: pass. Core typecheck: pass (exec session `32739`, exit 0).
- Shared focused legacy schemas: 17 pass / 2 files.
- Core pending repo/client/recovery/compatibility: 65 pass / 4 files.
- Native basic suite has not rerun after the later preparation/capability changes.
  Its last result remains 11 pass / 1 fixed test assertion, not an all-green claim.

Outstanding correctness/verification before acceptance:

1. Add the full native matrix (partial restart/duplicate ordinals/zero/error/delta
   archived survivors/large append JSON and replace/consolidation marker/cancel/
   stale worker/Bank lifetime/fixed children/Batch API) using real SQL and existing
   mock/chunks modes. Current native tests cover only the initial small cases.
2. Add Bank retirement/cancellation integration as required; ensure SQL-backed
   memory with `owns_document_store=True` cannot advertise native proof. Public
   read must not silently show queued forever after child deletion/cancellation.
3. Review PreparedRetainInput hash coverage (include total chunk count/request/input
   binding) and complete sealed-result native post-write/ANN maintenance recovery.
4. New Core/Shared G1 tests still need Python/TS frozen hash vectors, protocol/data
   tamper and old-row reopen, zero-result policy, <=512KiB/<=2MiB bounds, and the
   genuine producer-to-consumer HTTP gate. Check status identity before a missing-
   receipt retry, and avoid inventing zero for missing partial progress.
5. Run final lint/function-size/header/index/typed-model review. The recent source
   patches have not received final formatter/quality review. Verify native public
   model/precheck/API regressions and migration/backup behavior.
6. Maintained SDK wrapper methods and canonical generated artifacts are untouched.
   Root owns portable generation tooling; notify root only when public schema is
   stable. Existing provider extension tests still expect the old build/contract
   inventory and must be updated to the intended independent new capability.

Root's actual loopback harness is now ready: add `--allow-http-fixture` before `--`.
Import `owned_http_listener` from `g1_fixture_network_guard`, retain its open
`127.0.0.1:0` socket and pass `sockets=[listener]` to uvicorn. Keep the context open
until the clean Node child and server have both stopped. Other/closed/localhost
alias ports are denied. This remains an isolated fixture, not a current service.

No owned native fixture/check command remains running in this child at checkpoint.
The leader may be preparing generator tools independently. Resume from this record
and the `functions` store key `handoff`, not from a new research pass.

## HTTP-to-SQLite fixture checkpoint - 2026-09-08 02:06 local

Window: `01a07cfb-01b6-7ff0-ab5a-fd09fb37479b`. Added provider
`tests/native_results/test_taki_consumer.py` and Taki
`hindsight-native-result-http.fixture.ts`. The owned listener serves the real
initialized native engine; a clean Node process uses the actual typed client,
snapshot/journal projection, Pending writer/runner and SQLite repositories.
Its source text, policy, provenance and matching layer tag are explicit fixture
bindings. They do not implement B4/B6 runtime mappings.

- `a323762a4ec6`: collection failed because the new test directory lacked a Python
  package marker; fixed. Its fixture-only TS parameter properties and positional
  SQLite parameters also failed typecheck; replaced by erasable fields and the
  repository's named-parameter API.
- `4c5e10bd8187`: all **12 native basic cases passed**; the new HTTP test used a
  fixed future timestamp and expired the actual provider snapshot. Core typecheck
  passed after the fixture corrections.
- `2ff8f0cf3e6c`: native retain, wire hashes and result verification succeeded;
  fixture source policy omitted its required `taki-layer:profile` input tag and
  canonical projection rejected it. Added that explicit fixture binding; did not
  change production projection or claim a complete field adapter.
- `d8f7ae650902`: **real HTTP-to-SQLite test passed**, 12.53 seconds. Replace and
  native delta append used two POSTs total. Lost append acknowledgement survived
  SQLite reopen; failed second pull persisted `awaiting_pull`; a second reopen
  confirmed the original compact proof only after the actual checkpoint fence.
  Native un-consolidated facts remained present and the supplied derived port was
  called zero times. No derived freshness or cutover success was asserted.

All four owned fixtures stopped and removed their data/registry. The two uvicorn
WebSocket deprecation warnings are unrelated to the HTTP contract. No fixture
command remains active. Next: cancellation/retirement and native tail recovery,
plan/hash/source-store guards, high-risk native matrix, new consumer tamper/hash
tests, wrappers, and schema freeze notification to the leader.
