# W2 implementation and verification

Date: 2026-09-30. Implementer: original `/root/w2_implement`.
Status: W2 implementation and its scoped automated checks are complete; independent whole-wave review is pending.
This replaces the earlier incremental checkpoint. W3-W8 and product/manual acceptance are not claimed here.

## Scope and workspaces

- Taki: `H:/TakiAgent`, `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
- Native: `H:/hindsight`, `main`, HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
- Existing task: `09-29-hindsight-transitions-emergency`; the parent session binding, not the empty legacy
  `.current-task` or the unrelated T4 pointer, supplies authority. No T4 file was modified.
- W0/W1 passed independent gates before this wave. W2 extends native ownership/proof/delta and Shared/Core transport;
  it does not compose a transition driver, construct W3 candidates, commit Core authority or implement Home actions.
- All PG tests use fresh owned fixtures with disabled dotenv, mock models, cached embeddings and restricted local
  networking. No original database, live authority, paid model, dependency, Git history or task lifecycle was changed.

## Delivered behavior

### Persistent native writer ownership

The independent `taki-transition-v1` protocol is advertised by build
`taki-memory-hindsight-0.9.0-transitions-v1`, contract `transitions.version=1.0.0`. Migration
`e30a9d7f6c21` follows unchanged `d77a4f8c2e10`; Core migration head remains 052.

Durable requests, fences, accepted writers/work, append-only history, separate maintenance/action/evidence,
auxiliary pages, deltas and sticky Bank-origin rows support acquisition, drain, claim, renew, proof, exact lookup
and explicit resolution. Executor TTL revokes execution without reopening the fence. Accepted foreground work and
its witnessed async descendants drain; late unrelated admissions and stale executor/writer identities refuse.
The SQL fallback covers canonical rows, D77 publication, journal/cursor changes, queue admission and association
OLD/NEW row ownership plus both endpoints under sorted Bank locks. Authentication/tenant and Bank restrictions are
checked by the engine facade; DTO executor tokens are not credentials. Capability probing checks the actual full
schema/trigger dependency inventory, including maintenance, actions, evidence, auxiliary and delta state.

### Finite maintenance and paired final proof

The existing native D78 consolidation, model, input, action and evidence algorithms run under a separately typed
transition owner/history. No D78 transfer/result or Core activation receipt is invented. A static mental model
without `source_query` retains its payload/revision/hash and explicit non-applicability reason.

The final native snapshot, complete D77 state/history, auxiliary original/derived rows, finite maintenance evidence
and transition proof publish in one Bank-fenced transaction. Exact proof-referenced snapshots remain readable after
ordinary TTL; arbitrary expired snapshots do not gain that exception. Already bound application policies rebind
through the existing D77 validator after maintenance, preserving original bodies and restrictions while changed
native assessments become due. Newly derived unbound objects remain in complete native evidence for W3's justified
initial policy producer; W2 does not invent model assessments or silently remove these objects.

Historical proof publication remains immutable when a new executor generation claims ownership. The native reader
validates its real history, namespace/request and original publisher; Core does not wrongly require the historical
publisher to equal the current executor. Recovery returns the same proof without repeating maintenance/model work.

### Complete-descriptor re-entry and new scopes

Delta verifies the exact common baseline, full target inventory, native revisions/hashes, prior application
versions/body hashes and explicit retirement witnesses before writing. It reuses unchanged IDs/bodies and native
rows for policy/Block-only edits. Native/application changes and the exact recoverable delta result commit together;
failure rolls them back together, and reply recovery reads the result before another embedding or write.

A distinct transition publication appends the current Local original-input revision under previous revision,
manifest and record hashes. Ordinary D77 same-artifact original equality stays strict. Historical body bytes remain
readable. Source `original_witness` and encoded typed metadata derive from the actual post-delta native source;
there is no predicted/null/old witness claiming authentic original provenance.

A genuinely new scope uses its independent `unused_scope` proof, not a synthetic exit/retirement receipt. Only an
actual post-migration Bank INSERT creates a birth marker; no old Bank is backfilled. Sticky usage/deletion,
complete history and exact template/config witnesses reject used-then-cleared, recreated, pruned, unknown-history
or mutated-template Banks. W3 must independently prove the Local scope was absent from the previous common baseline.

A safe no-effect reused-Bank abort restores the original retired owner. A safe unused-scope abort retains
`unused_baseline_held` quarantine. Applied or uncertain delta/maintenance effects retain the original recovery
identity and cannot become a terminal abort. Ordinary writes remain fenced and stale executors never revive.

### Authenticated API, SDKs and Core client

Twelve typed operations under `/ext/taki-memory/banks/{bank_id}/transitions` expose unused-scope proof,
acquire/lookup/claim/renew/fence/verify/outcome, delta/lookup and immutable evidence/auxiliary pages.
Canonical OpenAPI uses stable named components for nullable artifact and D77/fence error unions; the wire adds no
`root` property. Python/TypeScript/Go/Rust SDKs are regenerated from it with pinned tools, retaining maintained
wrappers and module manifests. Existing G1/D77/D78 contracts remain independently usable.

Core supplies bounded authenticated methods, native-compatible hash/identity validation and independent capability
admission. Both normalized and ordinary HTTP-detail fence/stale 409 envelopes are intercepted before legacy
cursor-reset handling, including D77 parsing; they never grant rebuild permission. W1 still has no real driver.

### Physical backup/restore correction found at the final gate

Adding publication triggers exposed a real restore defect: COPY of earlier tables created derived fence rows before
COPY reached `memory_transition_fences`, causing a duplicate key. The first integrated regression retained this
failure rather than treating it as a fixture-only issue.

The existing privileged offline `_restore` transaction now uses `admin/transition_restore.py` to suspend only the
three transition publication/admission trigger functions on the copied tables. It retains FK and immutable-history
protection, loads the original recorded origins/fences/history, validates deferred FKs, then restores the exact
prior trigger modes before commit. A failed COPY rolls back both data and trigger DDL. This helper is not an HTTP
capability; target services/workers must be stopped for administrative restore.

The real test compares every stored column across all backup tables, including bytea bodies, proof/outcome,
retired/quarantined ownership and creation/usage/deletion markers. Expired executors still leave restored Banks
fenced. A true previous-revision (`d77a4f8c2e10`) archive restores without creating birth markers for old empty Banks.
Absent historical proof stays absent; existing binary-COPY shape checks still govern version compatibility.

## Files changed

The exact native delta is [w2-native-files.json](w2-native-files.json): 133 paths with final SHA-256, including 40
production Python files, API/SDK generated output, four maintained SDK contract tests and native regressions.
It excludes unchanged pre-existing dirty files and the unrelated status-only control-plane CLI.

| Area | Production files / responsibilities |
| --- | --- |
| Native new owner | `engine/transition_{context,models,storage,service,writers,execution,api_service,unused_scope}.py` |
| Native proof | `engine/maintenance_candidate.py`, `transition_{maintenance,maintenance_store,snapshot,certificate,application_rebind}.py` |
| Native delta | `engine/transfer/transition_delta{,_models,_preflight,_rows,_application}.py` |
| Native integration | `engine/memory_engine.py`, `engine/db/postgresql.py`, `engine/replication.py`, existing `cutover_verification_{candidate,certificate,context,model,runner,state,store,view}.py`, `transfer/current_state_rows.py`, `application_state/{service,snapshot}.py` |
| Native public/admin | `api/{taki_transitions,taki_application_schema,taki_application_state}.py`, `extensions/builtin/taki_memory.py`, `engine/taki_compatibility.py`, `admin/{cli,transition_restore}.py`, new `e30a9d7f6c21_add_transition_publication_fences.py`, `TAKI_PATCHES.md` |
| Native tests | `tests/native_results/test_transition_{fence,proof,delta,unused_scope,api,recovery,integrity,core_projection,backup}.py`, `transition_delta_helpers.py`; build/migration fixture adaptations in `test_cutover_compatibility.py`, `test_cutover_maintenance_migration.py`, `tests/test_taki_extension_contract.py`, `tests/test_taki_admin_backup.py` |
| SDK | Canonical `hindsight-docs/static/openapi.json`; generated Python/TypeScript/Go assets; maintained Rust build-generated models; `test_transition_contract.py`, `transition_contract.test.ts`, `transition_contract_test.go`, `transition_contract.rs` |
| Shared | `hindsight-transition-schema.ts`, `hindsight-transition-delta-schema.ts`, their schema test, `hindsight-application-native-schema.ts`, `hindsight-connection-schema.ts`, `index.ts`, `index.md` |
| Core | `hindsight-transition-{client,proof,capability,errors}.ts`, client tests; `hindsight-{client,contracts,compatibility-service,application-capability,errors}.ts`, folder index |
| Guidance | `.trellis/spec/backend/{memory-transitions,hindsight-application-runtime,index,quality-guidelines}.md`, `CLAUDE.md`, `eslint.config.js`; this report, continuation checkpoint, projection fixture and evidence JSON/logs |

The parent approved only the exact Shared pure public named-re-export index allowance from 500 to 520 lines.
The strict AST guard and 360-line implementation cap remain unchanged. W0/W1 scheduler, queue and database edits
visible in the combined working tree are not attributed to W2.

## Verification evidence

Do not add the counts below: several runs deliberately overlap. Test commands are scoped selections, not the entire
native suite. Every listed Stage 4 PG fixture has `exitCode=0` and `stopped=true` unless its failure is explicitly shown.
Private logs/results are retained under `.trellis/.runtime/stage4-native-tests/<id>/`.

### Native integration and regressions

The final integrated command (cwd `H:/TakiAgent`) was:

```powershell
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/native-tests.mjs tests/native_results/test_transition_fence.py tests/native_results/test_transition_proof.py tests/native_results/test_transition_delta.py tests/native_results/test_transition_unused_scope.py tests/native_results/test_transition_api.py tests/native_results/test_transition_recovery.py tests/native_results/test_transition_integrity.py tests/test_taki_extension_contract.py tests/test_taki_admin_backup.py tests/test_migration_shape.py
```

Run `504c1a2e95968fcf`: **271 passed, 104 skipped, 2 failed**, 301.63s, exit 1, stopped. All seven selected transition
files passed. Every skip belongs to `test_migration_concurrently_ddl_runs_in_autocommit_block`, which explicitly skips
migrations with no CONCURRENTLY DDL. They are non-applicable shape cases, not waived transition coverage.
The failures were the old backup build assertion and the actual fence-row restore collision described above.

Final affected backup command after the complete fix:

```powershell
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/native-tests.mjs tests/test_taki_admin_backup.py tests/test_admin_backup_restore.py tests/native_results/test_transition_backup.py tests/native_results/test_application_backup.py
```

Run `7e117e93b43fb4d0`: **28 passed in 99.58s**, exit 0, stopped. This includes both earlier failures, the full affected
admin backup/restore file, D77 original receipts, and the two new transition restore tests. Intermediate
`7939d19ef4854e80` had 14 passes/one new restore failure (deferred FK events prevented trigger reenabling); after
checking constraints before reenabling, `6443c68a44f36ce5` passed both new cases in 24.95s. All failed evidence remains.

| Additional owned PG run | Proven behavior / result |
| --- | --- |
| `94c4a72af3f50139` | 4 passed: accepted foreground/descendant drain, SQL commit barrier, TTL/stale identity. Corrects `d56eb84a0b336f74` 2/2 caused by composite `IS NOT NULL` rejecting nullable valid writer fields. |
| `c8066c0b1a7bd30e` | 2 passed: empty/nonempty paired proof, real finite maintenance/static model handling, originals, repeat lookup, retirement. Corrects wiring-only failures retained in `d00a4a2e37271037` (6 passed/2 failed; old D78 cases already passed). |
| `30c04b0e89813fe6` | 10 passed in 69.31s: complete delta, original revisions, unchanged reuse, policy/Blocks, foreign baseline, native/app failure rollback. |
| `60d49ef4b7ddc045` | 5 passed: source typed original/actual native witness and fence regressions. |
| `ba82f21e3aa6da5e` | 4 passed: invalidate/restore ID retention and explicit delete/expiry with retained app history. |
| `40be1365a4034fd9` | 8 passed: actual unused birth/history/template proof, first delta/final join, ACK recovery and used/cleared/missing-history/app/config refusal. |
| `620f5b29d0649898` | 5 passed: authenticated API, pre-effect abort, staged-effect recovery and paired proof. |
| `12253b5ce0c2d9b6` | 21 passed in 95.33s: association row Bank/endpoints, cursor guards, complete schema dependency refusal, foreign self-hashed proof, unused-scope abort/retry and D77 OpenAPI. |
| `4e64b4942b45522c` | 7 passed: new unit/Bank, authenticated API and OpenAPI regression. |
| Parent-owned legacy | `630d3d11b91418dc`: 29 passed/2 old fixture failures; corrected `a4092c3371b33c60`: 2 passed. Together cover the 31 distinct compatibility/maintenance-migration cases. See `native-baseline-check.md`; no unnecessary duplicate run. |

### Real HTTP to Core

Cwd `H:/TakiAgent`:

```powershell
& 'H:/hindsight/.venv/Scripts/python.exe' '.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py' --allow-http-fixture -- tests/native_results/test_transition_core_projection.py tests/native_results/test_transition_delta.py::test_new_local_unit_and_bank_edit_preserve_existing_native_identities tests/native_results/test_transition_recovery.py::test_incomplete_return_maintenance_resumes_exact_plan_before_abort_can_release -q --tb=short -n 0
```

Fixture `g1-validation/taki-hindsight-g1-5be9388d48b7`: **3 passed in 43.14s**, exit 0; ownership confirms stopped and
owned fixture cleanup. Tests execute PostgreSQL -> real owned HTTP -> the Core projection fixture. They preserve
source original fields, typed metadata and old body bytes. They also seal a final proof, expire the executor, claim
generation 2, recover the identical proof with no repeat maintenance, refuse old-owner resolution and activate with
the new live owner. The group covers new-unit/Bank changes and interrupted maintenance recovery. It reruns the
previous actual-HTTP fixture failure (`12b0154485bb`, wrong layer tag); a pure-native pass was not substituted.

### Canonical generation and offline SDKs

Pinned generation helper (cwd Taki):

```powershell
& 'H:/hindsight/.venv/Scripts/python.exe' '.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_windows_codegen.py' --openapi --python --typescript --go --rust --docs
```

The final schema was generated in selected steps: `d03e2032fdc8` OpenAPI/Rust build; `f7ab6dbbfa6d`
Python/TypeScript/Go plus Go/docs build. The latter intentionally has no Rust log because that ran separately.
A complete OpenAPI/four-client repeat `440a699736c2` also built Go/Rust successfully. The 740 compared canonical,
Python, TypeScript and Go source files are byte-identical across the repeat; see `w2-codegen-repeat.json`.
Rust output is produced by its maintained build script and separately compile/test-checked.

Canonical OpenAPI SHA-256: `fe0f1f29ef5ff03e0cd9e0c81204ac5a3224cfa623deeb70abcfe3cb356de185`.
Earlier `beecbc90677d` and `82ce4f3c8c8d` exposed generator error-union and duplicate nullable-union naming failures;
source schema names were fixed and regenerated, never patched in generated Rust.

| SDK, cwd under `H:/hindsight/hindsight-clients` | Offline command | Result |
| --- | --- | --- |
| Python, `python` | `python -m pytest tests --ignore=tests/test_main_operations.py -n 0 -p g1_fixture_network_guard -q --tb=short` | 98 passed; existing synchronous-retain operation_id warning. Guard module from the reviewed validation directory, fixture port 0. |
| TypeScript, `typescript` | `npm test -- --runInBand --testPathIgnorePatterns=main_operations.test.ts`; wrapper/generated build | 10 suites / 39 tests passed; CJS, ESM and DTS builds passed. |
| Go, `go` | `go test ./... -run '^(TestDispositionTraitsCompatibility|TestNativeResultNullableStatus|TestNativeReferenceNullableDocument|TestTransitionNullableArtifactContract)$'` | exit 0 with GOPROXY/GOSUMDB off and canonical toolchain GOPATH/GOMODCACHE/GOCACHE. Generated service examples skip; they are not behavioral evidence. |
| Rust, `rust` | `cargo test --release --locked --offline --test native_result_contract --test transition_contract` | 4 native-result plus 1 transition contract passed. |

Python/Rust nullable fixtures originally omitted the actual complete-wire `block_contract_version` default; corrected
fixtures passed. An initial Go run used the wrong cache environment; final run used `g1-toolchain/{go-work,go-modules,
go-build}` and the existing Go 1.25 tool. No package/dependency installation was needed.

### Core, Shared and quality

Cwd Taki:

```powershell
pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-transition-client.test.ts src/memory/hindsight/hindsight-application-transport.test.ts src/memory/hindsight/hindsight-compatibility-service.test.ts src/memory/hindsight/hindsight-cursor-reset.test.ts src/memory/hindsight/hindsight-application-policy.test.ts --maxWorkers=2 --reporter=dot
pnpm --filter @taki/shared exec vitest run --maxWorkers=2 src/hindsight-transition-schema.test.ts src/memory-transition-schema.test.ts src/hindsight-connection-schema.test.ts src/hindsight-backup-schema.test.ts src/hindsight-cutover-schema.test.ts src/hindsight-current-state-encoding.test.ts src/hindsight-application-encoding.test.ts
pnpm lint
pnpm typecheck
```

- Core: **5 files / 110 passed**. Shared: **7 files / 66 passed**. The initial Core fixture assertion mistakenly treated
  a synchronous input refusal as a rejected Promise; the corrected final group passed.
- Root lint and every workspace typecheck: exit 0. Persisted `w2-{shared-tests,lint,typecheck}.log`.
- Native API full `ruff check hindsight-api-slim`: exit 0, `w2-native-ruff.log`.
- Native `ruff format --check hindsight-api-slim --exclude '**/test_taki_replication_curation.py'`: exit 0,
  779 files formatted. The full format probe identifies only a pre-existing missing blank-line pair in that unchanged
  curation test after normalizing this wave's PostgreSQL helper line endings. Its original bytes remain preserved.
- `ty check --python ../.venv` on all new transition engine/transfer modules, maintenance candidate, API and restore
  helper: exit 0 (`w2-native-ty-scoped.log`). Full `ty check --python ../.venv hindsight_api` retains **27** known
  Windows/MLX/Unix-resource diagnostics (`w2-native-ty-full.log`); it is not reported green.
- Both repositories' `git diff --check`: exit 0. No Rust Shell/UI source changed; desktop native builds were not run.
- The monolithic native `lint.sh` was inspected but not invoked: it synchronizes dependencies and autoformats
  unrelated control-plane/integration trees. Scoped/non-mutating equivalent checks preserve the required existing
  dirty-file baseline. The independent checker must retain the documented platform/unchanged-format limitations.

## Preservation, rollout and remaining gates

[w2-preservation.json](w2-preservation.json) rehashes the original 205 native dirty paths: 180 byte-identical,
25 explicit W2 source/fixture/canonical-generation extensions, zero missing. The new unpublished migration is the
only changed migration; historical `d77a4f8c2e10` remains byte-identical. The separate control-plane CLI checkpoint
still matches SHA-256 `ce3ccd97b3759b2a0848221a9487de67178ce640d1ddc324a3043f7507655ef2`; it was captured during W2,
not retroactively claimed as part of the pre-W2 205-file manifest. Maintained wrappers/Go module manifests were
preserved by generation. Source baselines and failed runs are retained.

For a separately authorized deployment, use the matched native build/clients and apply the forward e30 migration
through the existing migration path, then probe the actual authenticated transition capability. No new environment
variable is required. PostgreSQL SQL-row storage is supported; Oracle/external-memory backends do not advertise
this capability. Do not enable a Core driver based only on method availability. An older native build can retain
its existing independent G1/D77/D78 support but cannot provide this transition guarantee.

Rollback is not a destructive down-migration: e30 refuses downgrade once origin/transition evidence exists. Any
administrative recovery must use an isolated compatible backup/restore with stopped target services and retain
recorded identity/history; an unresolved owner remains quarantined until exact recovery.

Remaining gates: independent whole-W2 review, then W3 candidates/common-baseline/mapping/complete closure,
W4 atomic Core authority+custody+queue COMMIT/runtime recovery, W5-W8 drivers/UI/integration and owner/manual/live
acceptance. Native outcome primitives do not prove Core authority selection. These tests establish deterministic
mechanics with real storage, not semantic model quality or a full original-data round trip.
