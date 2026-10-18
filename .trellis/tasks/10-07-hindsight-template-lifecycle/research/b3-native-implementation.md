# B3 Native implementation and evidence

Status: **the assigned Native-only implementation/generation batch is complete on 2026-10-10**. The wire,
35-case SQL/API/CLI group, 15-case physical-preservation group, earlier production types, current canonical
generation, four SDK gates and 77-case affected regression have passed within their recorded scopes. See the
final section for exact current evidence, failures, source release and the owner's stop boundary.

The separate Core/Native paired gate has not passed. Joint-01 stopped at a Core import; joint-02 reached real
Native Apply/result/snapshot calls but Core capture refused `HINDSIGHT_BACKUP_READBACK_MISMATCH`, before CLI,
paired restore or preflight. Core subsequently reported its own fixture correction and smoke pass; Native did
not rerun the joint gate. These retained failures are not superseded by Native-only or SDK successes.
This report does not assert independent B3/whole-5B acceptance.

## Scope and protocol

Native owns `H:/hindsight` on main at base HEAD `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`,
its tests, canonical clients/documentation and the Taki lifecycle spec. The Core/Shared and Desktop owners remain
separate. The explicit task is `.trellis/tasks/10-07-hindsight-template-lifecycle`; no global pointer is changed.

The common wire fixture is `packages/shared/src/fixtures/hindsight-template-backup-v2.json`, SHA256
`acc74518e6f7ff7da0de00842c0f5d642a38a0daab7bf195670b96c560694e43`. Its wire-only provenance is retained.
Strict Pydantic request, proof, route-c, archive and observation variants mirror the released Shared checkpoint.
Original lifecycle hashes, historical v1 semantics and the older `TemplateBackupEvidence` remain unchanged.
The exact new build is `taki-memory-hindsight-0.9.0-template-backup-v1`, optional `template_backup` 1.0.0.

## Implementation

- `engine/template_backup_models.py`, `template_backup_encoding.py`, `template_backup_projection.py`,
  `template_backup_storage.py`, `template_backup_config.py`, `template_backup.py` and `template_backup_json.py`
  implement strict wire commitments, actual same-connection SELECT evidence, full receipt inventory and the real
  authenticated resolver observation. `template_snapshot.py` shares complete receipt/SQL identity validation;
  `template_encoding.py` exposes unchanged request normalization.
- `api/taki_template_backup.py`, `memory_engine.py`, `api/http.py` and `api/taki_template_schema.py` expose the
  actual read-only observer, independent of filesystem backup enablement. `taki_compatibility.py` advertises the
  new optional producer. `config_resolver.py` adds opt-in strict tenant failure without changing ordinary B2
  same-resolution status or fallback behavior.
- `admin/taki_backup_request.py`, `admin/taki_backup_service.py`, `admin/taki_backup.py`, `admin/cli.py` and
  `api/taki_backup.py` carry v2 through actual route c and managed route b. A PostgresConnection wrapper retains
  the exact raw COPY connection. The CLI joins live service configuration with its independent database facet
  and full inventory, retaining its own cursors. V2 failure cleanup and CLI/API exception sanitization do not
  change v1 exception/serialization behavior. No new lock or migration was added.
- `hindsight-docs/docs/developer/admin-cli.md` documents actual options, service dependency, observation limits,
  partial-file behavior and the separate Core stopped-writer procedure. The lifecycle spec retains B2 executor
  lifetime and N1/N2 contracts and adds the B3 producer/acceptance boundaries.

The new source uses 640 MiB for the complete request and an additional 128 bytes for the observation wrapper;
each Apply remains 512 KiB. Response and v2 manifest caps are respectively 2 MiB and 4 MiB. Byte limits preserve
capacity and do not claim low memory use or performance optimization.

## Explicit restore and receipt boundaries

Root confirmed on 2026-10-09 that the v2 writer checks serialized manifest bytes before publication, while actual
Core archive/admit/preflight consumers own the 4-MiB pre-parse manifest read. Historical generic Native `_restore`
does not gain a global manifest cap, does not invoke Core, and does not orchestrate startup. Its real physical
COPY restore must still be joined with Core's stopped-writer preflight for integrated acceptance. Historical
artifact integrity and current configuration readiness remain distinct.

Native refresh markers really exist for `completed`, `superseded` and `failed`. `publish` records nonnull result
revision/hash for completed or refresh-skipped failed outcomes. `settle_failure` records null pairs for superseded
or failed. A no-marker result read can report pending/processing/generic failed, never superseded. Therefore Core
can require membership for completed with a nonnull pair, superseded, and failed with a nonnull pair; failed/null
alone cannot prove a marker. The Native membership reader validates actual stored rows rather than guessing.

## Executed evidence

Each `b3-native-<name>` prefix has a retained `.log`, `-result.json` and before/after `-sources.json` produced by
`research/run-b3-native-check.py`. It uses the existing clean environment, disables dotenv and removes only its
resolved owned TEMP. Root serializes every test/type/lint/build/generation slot.

| Evidence | Actual result | Meaning |
| --- | --- | --- |
| `wire-01` | 48/48 passed; pytest 8.25s; wrapper 49.507s | Shared DTOs/13 invalid cases/12 vectors, original-request forgery checks, v1 bytes, finite/duplicate JSON, bounded file growth, capacity arithmetic and maximum output metadata. |
| `ruff-01` | Failed with two I001 errors | Retained import-order failure. |
| `ruff-fix-01` | Passed | Only those scoped imports fixed. |
| `format-01` | 13 formatted; 10 unchanged | Scoped source normalization. |
| `ruff-02`, `format-check-01` | Passed, 23 files | Then-current scoped source. Later Native transport/test additions require their queued gate. |
| `exception-red-01` | Exit 1; both expected cases failed, pytest 48.87s | Removed only the two new v2 guards: the actual route propagated `RuntimeError(private-copy-fixture-detail)` and the actual CLI retained that unhandled exception. Exact guard bytes, red/green SHA256 and successful byte restoration are in `b3-native-exception-red-01-patch.json`. |
| `integration-format-01` | 3 formatted, 2 unchanged | Two owned CLI/API source files plus the new helper and two test modules. |
| `integration-ruff-01` | Exit 1; three I001 errors | Retained scoped import-order failure. |
| `integration-ruff-fix-01`, `integration-format-check-01` | Passed; 3 imports fixed, 5 files formatted | No remaining scoped lint/format issue. |
| `integration-01` | Exit 0; 35/35 passed, pytest 223.76s; wrapper 281.614s | Real SQL/auth/inventory/config and route-c/actual HTTP CLI coverage listed below, including the two formerly failing exception cases. All source/fixture inputs unchanged during the run. |
| `restore-format-01` | One file formatted | New actual customized/removed physical-restore test. |
| `restore-ruff-01` | Exit 1; one I001 error | Retained import-order failure. |
| `restore-ruff-fix-01`, `restore-format-check-01` | Passed | Scoped import correction and formatting. |
| `types-01` | Exit 0; all 20 production files passed in 2.431s | Existing `ty` with `--python-platform linux`; no source input changed. |
| `restore-01` | Exit 0; 15/15 passed, pytest 82.68s; wrapper 124.8s | Two real customized/removed COPY restores, three B1 independent backup/migration tests, four B2 label-storage tests and six existing v1/plain-admin backup tests. No source input changed. |
| `joint-ruff-fix-01`, `joint-format-01` | Passed; one import sorted and two joint files formatted | Only the new Native joint helper/test changed. |
| `joint-ruff-01`, `joint-format-check-01` | Passed; two files | All captured Native/Core/Shared inputs unchanged during both read-only checks. |
| `joint-01` | Exit 1; 2 failed, pytest 21.67s; wrapper 63.075s | Both scenarios stopped in Core `seed` module initialization: `transition-template-auxiliary.ts:8` imports `isHindsightTemplateConfigValue`, which the actual `@taki/shared` entry does not export. No real HTTP/Apply/paired-restore assertion was reached. All captured Native/Core/Shared inputs unchanged. |
| `joint-ruff-02`, `joint-format-check-02` | Passed; two files | Rechecked the early explicit HTTP-harness skip gate. All inputs unchanged. |
| `joint-02` | Exit 1; 2 failed, pytest 38.88s; wrapper 80.726s | Both real `seed` calls passed; actual Core owner/Native Apply calls succeeded. Core `capture` then refused `HINDSIGHT_BACKUP_READBACK_MISMATCH` at `hindsight-template-backup-joint-fixture.ts:103`, before CLI or physical restore. All captured Native/Core/Shared inputs unchanged. |

The red run used owned PG `taki-hindsight-g1-c501f2427f33`; Stopped/DataRemoved/RegistryRemoved all reported true.
Its raw `pytest.log` retains both sentinel stack traces under `.trellis/.runtime/g1-validation/`; the task-level
wrapper retains the actual exit/source hashes and removed its owned TEMP. No source input changed during red,
and both production source files were restored before the scoped formatting and green group.

The green integration run used owned PG `taki-hindsight-g1-c691a25ea6bd`; Stopped/DataRemoved/RegistryRemoved all
reported true and the recorder removed its owned TEMP. All server tasks/CLI invocations finished and no Native
check process remained on release. The two warnings are existing websockets/uvicorn deprecations.

The physical-restore run used owned PG `taki-hindsight-g1-0ccb9a5a558e`;
Stopped/DataRemoved/RegistryRemoved all reported true. Its recorder and the typecheck recorder removed their
owned TEMP directories. No Native check process remained on release.

No cross-repository paired restore/preflight, canonical generation or final source gate is claimed by the above.
Native-only physical preservation and production types have passed. The red cases are not counted as passing
acceptance, and these self-checks do not accept whole B3.

The first joint run used owned PG `taki-hindsight-g1-1b4eaf02b3c1`;
Stopped/DataRemoved/RegistryRemoved and owned TEMP removal all reported true. Both Node children exited 1.
Their individual command/output files and the complete pytest traceback remain retained; no HTTP listener or
Core SQLite fixture was created because the `seed` import failed first. Root was notified and the heavy slot
explicitly released. The Native owner did not patch Core or extend the grant into canonical generation.

The second joint run used owned PG `taki-hindsight-g1-bed48b7e7ce1`; all three PG cleanup flags and owned TEMP
removal reported true. Each scenario's seed process exited 0 and prepare exited 1, with no timeout. Both owned
HTTP listeners were closed and awaited, the Core entry ran its `finally` close, and no Native check process
remained when the slot was returned to Root. Its two warnings are existing websockets/uvicorn deprecations.

Actual source exchanges are retained separately, containing only route/status/byte counts/digests:

- `b3-native-joint-1e2c5ea668a6488db3bf467981e133bf-source-exchanges.jsonl`: customized, 19 HTTP 200 responses:
  3 Apply, 3 result, 6 snapshot, 7 version reads.
- `b3-native-joint-cd94ea78326849d7a73ecc51aad8c0e9-source-exchanges.jsonl`: removed, 26 HTTP 200 responses:
  4 Apply, 4 result, 8 snapshot, 10 version reads.

These are real producer-to-consumer calls, but the failing capture means they are not a passed paired-restore
gate. The Core owner must establish the read-back refusal's exact cause; do not label it a Native error or
silently repair the fixture/contract from the Native ownership scope.

## Written integration checks and remaining work

1. `tests/native_results/test_template_backup.py`: actual SQL/authorization/configuration observation, complete
   multi-page histories, unrequested no-op and refresh receipts, unselected/nonempty history, corrupt nonselected
   rows, rehashed original-selector forgery, generation/storage/query refusal, masked inheritance and session lifetime.
2. `tests/native_results/test_template_backup_transport.py`: actual route c, real managed CLI/owned HTTP service,
   disabled filesystem route, independent CLI snapshot versus newer service content/cursor, byte budgets, missing
   service/offline-empty behavior, actual config/inventory/facet drift, malformed service observations and cleanup.
   COPY exception sanitization was first found statically, then reproduced in the explicit two-case red run above.
3. `tests/native_results/test_template_backup_restore.py`: customized and removed overlays created by actual Apply,
   real refresh markers and raw-text B2 label production, evidence erased before binary COPY restore, and complete
   row/user-resource/original-anchor/definition/config comparisons. These are Native tests, not fabricated Core custody.
4. Rerun the prepared actual Core seed/export and stopped-writer preflight driver after its owner resolves the
   retained capture/read-back refusal and Root regrants the frozen-source check window. Preserve customized/removed state
   and refuse mismatched/current-config pairs before the explicit writer-start trap.
5. Run the joint selectors and canonical OpenAPI/SDK generation; record
   source/generated hashes and independent review handoff. Do not enter 5C, original services/data/model calls,
   performance work, dependency changes or Git lifecycle/finish/archive.

The affected ConfigResolver regression boundary is explicit: only B3 backup observations opt into `_strict`.
Ordinary callers keep their existing fallback behavior and B2's invocation-local success/provenance semantics.
The 35-case group covers strict refusal and compatible resolver replacement; the 15-case group reruns actual
B2 label production/storage through the unchanged default branch. Unmodified B2 independent evidence remains
applicable to its reviewed paths; it does not replace the new B3 joint/generation gate.

## Completed Native-only generation and affected gate (2026-10-10)

The owner's latest direction is to finish current assignments and stop. Root expressly limited this last
batch to Native schema/generation, the four existing SDK gates, the named affected tests and final evidence.
No `joint-03`, new independent review, whole-workspace gate, original service/data/model call, dependency change
or Git/task lifecycle action was started. Core TypeScript was excluded from these Native-only source captures;
the shared wire fixture remained captured and byte-identical.

### Canonical failure and focused repair

`openapi-01` failed before writing the canonical file. The original hook manually reinjected public observation
request roots that the actual FastAPI route already publishes. `schema-diagnostic-01` disproved the initial
null-annotation hypothesis: the sole collision was `TemplateApplyRequest` referencing plain `TemplateChanges`
and `TemplateSnapshot` in the helper graph, while FastAPI correctly referenced their distinct `-Input` models.
D77's schema encoding alone did not repair those references; both failed runs remain retained.

The hook now leaves the real observation request/response graphs with FastAPI and adds only the otherwise
unreachable `TakiBackupProofV2`, `TakiBackupResponseV2` and `TakiBackupArchiveV2` roots. Original B1/B2 manual
roots remain. Additions use the established FastAPI Schema encoding, and every meaningful component collision
is checked before any addition is published. No global suffix stripping, fake route, generated-source edit or
wire/hash relaxation was introduced. Two regressions exercise the actual complete application graph, explicit
nullable request, exact Input references, idempotence and atomic refusal of a conflicting hidden artifact.

### Current executed results

Every prefix below has its retained `.log`, `-result.json` and `-sources.json`. Formatting records separately
identify their intended source changes; all subsequent read-only runs report `changedInputs: []`.

| `b3-native-` evidence prefix | Actual result |
| --- | --- |
| `sdk-python-ruff-fix-01`, `sdk-python-format-01`, `sdk-rust-format-01`, `sdk-go-format-01` | Scoped normalization of new tests and task helpers. TypeScript test layout was normalized manually before the initial pin; no absent formatter is claimed as executed. |
| `sdk-python-ruff-01`, `sdk-python-format-check-01`, `pre-generation-pin-01` | Passed; 914-entry initial artifact/maintained snapshot. |
| `openapi-01` | Retained failure, 52.165 s; no canonical output was written. |
| `schema-diagnostic-01` | Retained diagnostic failure, 58.721 s; normalization-only hypothesis disproved with the two exact Input reference differences. |
| `schema-focused-01` | 2 passed / 49 deselected; pytest 25.90 s, wrapper 40.386 s. |
| `schema-format-01`, `schema-ruff-01`, `schema-format-check-01`, `schema-types-01` | Passed. Linux-target ty checks only the changed schema hook; the earlier other production-file evidence is not relabeled as a fresh full check. |
| `openapi-02`, `clients-01`, `generated-pin-01` | Canonical export 28.896 s; guarded clean client generation 144.642 s; 958 output/maintained entries pinned. |
| `openapi-03`, `clients-02`, `generated-pin-02` | Fresh same-source export 29.366 s and clean generation 120.032 s; all 958 entries exactly match the first generation. |
| `sdk-python-01` | 109 passed, pytest 5.79 s, wrapper 9.033 s; real-service main operations excluded. |
| `sdk-typescript-01`, `sdk-typescript-build-01` | 46 tests / 13 suites passed; CJS, ESM and declaration build passed. Wrapper times 7.933 s and 7.727 s. |
| `sdk-rust-01` | 14 tests across the six named contract binaries passed; release/locked/offline, 73.045 s. |
| `sdk-go-01` | 10 top-level named contracts plus their subcases passed, 8.775 s. The separate service-test package had no selected tests and is not counted as service acceptance. |
| `affected-01` | 77 passed across current wire/OpenAPI, actual SQL/HTTP compatibility and B2 label recovery; pytest 178.12 s, wrapper 220.284 s. |
| `tested-pin-01` | All 958 generated/maintained entries still match `generated-02` after SDK builds/tests and Native regressions. |

The two focused schema cases recur inside the 77-case run and are not added to it. Earlier wire-01 has been
extended from 48 to 51 cases by fixture parity and the two schema regressions. No sum of these overlapping
checks is presented as a whole-Native or whole-5B suite result. Existing warnings retain their scope: Python's
synchronous-retain operation-ID warning and LiteLLM's blocked metadata fetch with local fallback do not involve
real model/provider calls.

The canonical path is `H:/hindsight/hindsight-docs/static/openapi.json`. Generated manifests are
`b3-generated-generated-01.json`, `b3-generated-generated-02.json` and `b3-generated-tested-01.json`.
Both guarded client runs report exit 0 and no changed/restored maintained input: all twelve original wrapper,
README, module and lock/config files remain byte-identical. All original generator source remains unchanged.

### Cleanup, final source and stop

The affected run used owned PG `taki-hindsight-g1-82e482b67184`; `Stopped`, `DataRemoved` and `RegistryRemoved`
all reported true, and its owned TEMP was removed. Every completed recorder reports its own TEMP removal.
Runtime logs and `ownership.json` are retained under that fixture's `.trellis/.runtime/g1-validation/` root.
No HTTP listener was created by this final affected batch. Generators, SDK checks and pytest naturally exited.

`b3-native-implementation-final-source-01.json` pins the final source, maintained/generated artifacts, documents,
check records and bounded cleanup observations. This is an implementation handoff, not an independent review.
It includes older preserved inputs for traceability without claiming they were all authored in B3. Native and
Taki HEADs remain `eb6413a7f58c4f3f0adb88a33a99516f8707fef7` and `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.

Native/codegen/lifecycle-spec ownership and the sole heavy-check slot are returned to Root with that manifest.
Stop here. The real customized/removed joint pair/admit/physical-restore/preflight rerun, whole-B3 independent
reviews and Stage 6 installed/manual acceptance remain pending; no Stage 5C work is dispatched.
