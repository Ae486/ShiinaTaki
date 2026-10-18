# Independent B1-B3 Native review

Status: **independent Native review scoped PASS**. The minimal permission fix, 14 affected cases, two-file Ruff
and format checks, and four-module Linux-target typecheck passed on the same 952 recorded inputs. Native source
is frozen and released; the sole heavy-check slot was returned to root before report finalization. This is not
a full Native suite or whole-Stage-5B acceptance. The review continued on 2026-10-13; the filename follows dispatch.

## Scope and source

- Task: `.trellis/tasks/10-07-hindsight-template-lifecycle`. The session uses this explicit task path; the empty
  global `.current-task` was not changed.
- Taki: `H:/TakiAgent`, main, HEAD `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
- Native: `H:/hindsight`, main, HEAD `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.
- Reviewed current Native lifecycle, provider/claim, label provenance, backup observation/API/CLI, physical
  inventory, schema installation and generator integration. Core/Shared/Desktop production remained read-only.
  Existing B1/B2 independent evidence was reused where its implementation remained unchanged.
- Root assigned the sole heavy-check slot separately for the red run and affected green/Ruff/typecheck batch.
  No nested agent, original instance/data/credential, repository `.env`, paid provider, new dependency, Git
  lifecycle action or task lifecycle action was used. Only the named Native helper and test file were changed.

## Findings (fixed)

### N1. Snapshot and committed-result reads bypassed configuration field visibility

- Files: Native `hindsight_api/engine/template_access.py:41` and
  `tests/native_results/test_template_independent_routes.py:82`.
- Actual paths: `template_snapshot.py:73` checks `read_permissions()` and then returns selected stored/inherited
  config values. `template_snapshot.py:253` reads the immutable receipt and constructs selectors from its actual
  returned `changes.config` before calling the same helper. The helper previously checked only Bank read actions.
- Existing contract: `config_resolver.py:247` already calls `get_allowed_config_fields()` when filtering ordinary
  Bank-config read output. The tenant extension's older method description emphasizes modifications, but the
  actual read path and the lifecycle spec both require field visibility. B2 label evidence and B3 backup
  observation already enforced that visibility. This fix aligns the missing readers with that existing behavior.
- Reproduction: four real authenticated FastAPI-route/PostgreSQL cases cover snapshot/result with a denied field
  set or a throwing field hook. All four returned HTTP 200 containing the disallowed `retain_mission` value;
  every failure was the expected `200 == 403` assertion, with no collection/setup/teardown failure.
- Fix: after the existing read-action checks, a nonempty `selectors.config_keys` must be allowed by the current
  tenant field hook. Denied/malformed fields and hook exceptions use the existing sanitized `field_refused`
  response. `None` still allows all fields. Status/model-only/zero-config reads do not acquire a config-field
  requirement. Request hashes, receipt contents, transaction order and original authorized replay stay intact.
- Regression precision: the same four cases also prove successful reads with only the two selected snapshot
  fields, or only the one field actually returned by the committed receipt. Other managed config fields and
  historical snapshot fields do not widen result-read requirements. This positive control was tightened after
  retaining the original red-run source manifest; its negative assertions were not changed.
- B3 observer code was not refactored. Its existing explicit field guard remains; the affected backup/API/CLI
  checks cover use of the updated shared read helper. No wire/schema/generator/dependency change was needed.
- Spec review: `.trellis/spec/backend/hindsight-template-lifecycle.md` already requires actual Bank/action/field
  authorization and refusal on validator exceptions. The fix implements that contract; the frozen spec was not
  rewritten merely to restate it.

## Actual-path review

Implementation paths below are under `H:/hindsight/hindsight-api-slim/hindsight_api/`. Bare engine filenames
and `retain/`, `reflect/` or `transfer/` paths are under its `engine/` directory; `tests/` paths are relative
to `H:/hindsight/hindsight-api-slim/`.

| Boundary | Current implementation checked |
| --- | --- |
| Identity, read-only evidence and CAS | `template_access.py`, `template_snapshot.py`, `template_apply.py`, `template_mutations.py`, `template_initialization.py`, strict definitions/models and unchanged D78-based template codec. Reads select existing identity in repeatable-read transactions; Apply authenticates, recovers existing receipts before writer/provider admission, locks the Bank, checks the full reviewed snapshot and commits changes/children/receipt together with the final live publication check. |
| Refresh execution and settlement | `template_refresh.py`, `template_provider_guard.py`, `memory_engine.py:3025`, `worker/poller.py:554` and `:838`, `llm_wrapper.py:128`, `:1045`, `:1189`, `reflect/agent.py:593`, `retain/embedding_utils.py:105`, `memory_engine.py:15208`. The actual queue claim, inherited revocable provider scope, retry/permit checks, pre-embedding check and final locked publication remain connected; generic Worker settlement cannot overwrite a template child. |
| Structured labels and existing safeguards | `retain/template_label_origin.py`, both parsers in `fact_extraction.py:1551` and `:2348`, `retain/receipt_context.py`, `retain/orchestrator.py:524`, `replication.py:1122`, `template_label_publication.py`, `template_label_store.py` and `template_label_evidence.py`. Private original-field/config-resolution evidence reaches final unit IDs and canonical payloads; outer append invalidates heads independently of application capture. Consolidation renews only a captured exact head and permitted bookkeeping delta. |
| Migration, capability and inventories | e51/e62 migration lineage and writer/history guards, `taki_compatibility.py:512`, `admin/cli.py:121`, `transition_snapshot.py:32` and `transfer/export.py:116`. Physical backup includes all five lifecycle/label evidence tables in dependency order. Auxiliary witnesses retain complete exact rows; portable export explicitly omits instance-owned authority. B3 adds no migration. |
| Exact B3 wire and selection | `template_backup_models.py:60`, `:99`, `template_backup_encoding.py:19`, `template_backup_projection.py:104`. The strict v2 retains original selected Apply identity and complete definition projection, separately commits database and inherited-config facets, and preserves v1. Existing bounded bodies/arrays/JSON and cross-language vectors remain the finite contract. |
| Complete Native history | `template_backup_storage.py:57`, `:86`, `:141`. Inventory traverses all receipt history in keyset pages, validates every full receipt/hash/SQL identity, and checks the exact selected anchor. Caller-selected request IDs cannot hide undeclared no-op/refresh-only receipts; unselected history is not treated as empty history. |
| Actual service observations | `template_backup_config.py:119`, `:174`, `:199`, `:265` and `template_backup.py:77`. Authorization binds actual engine/backend/resolver/context identity, resolves inherited values even behind Bank overrides and revalidates before sealing. The observation is a point-in-time sample, not an invented revision or proof that ABA cannot occur. |
| Same-transaction proof/COPY and managed CLI | `admin/cli.py:398` passes `PostgresConnection(conn)` to `read_template_backup_proof()` and performs COPY on that same underlying repeatable-read connection. `admin/taki_backup_service.py:80` and `:139` independently compare the authenticated service response with the CLI transaction's inventory/database facets while preserving the CLI's own cursors. `trust_env=False`, final observation validation, bounded manifests and partial-file cleanup remain in place. |
| Restore compatibility and schema generation | `admin/transition_restore.py`, existing plain/v1 restore dispatch, `api/taki_template_schema.py:19`, canonical export and client-generation scripts. Generic historical restore is not subjected to a new global manifest requirement. The schema hook preserves FastAPI's actual Input graph and publishes extra artifact roots only after collision checks; canonical and generated bytes are reused from the verified B3 runs. |

No additional concrete defect was established in these boundaries. Older independent reports are evidence for
unchanged paths, not a replacement for the current helper, producer, caller and inventory review above.

## Verification

Every new run uses `research/run-b3-native-check.py`. Its `-result.json` contains exact argv, cwd, exit code,
duration, log, before/after source manifest and owned-TEMP cleanup. Native pytest runs only through the existing
`run_isolated_hindsight.py --allow-http-fixture -- ...` runner, with its network guard, deterministic fixtures and
real owned PostgreSQL. The four permission regressions use actual FastAPI handlers with ASGI transport; the
managed-CLI regression additionally uses the real owned HTTP listener.

| New evidence | Result |
| --- | --- |
| `b3-native-independent-config-visibility-red-01-result.json` | Exit 1; four expected failures, three deselected; pytest 58.09 s, wrapper 138.935 s. All four actually disclosed the denied value with HTTP 200. Its 952 before/after inputs were unchanged. |
| `b3-native-independent-config-visibility-green-01-result.json` | Exit 0; 14 passed, two existing websockets/uvicorn deprecation warnings; pytest 162.35 s, wrapper 245.126 s. Includes the complete seven-case independent route module, three existing Apply/auth/CAS/replay cases, backup observation and field refusal, route-c capture and actual managed CLI. |
| `b3-native-independent-config-visibility-ruff-01-result.json` | Exit 0, 1.251 s; Ruff check passed for `template_access.py` and `test_template_independent_routes.py`. |
| `b3-native-independent-config-visibility-format-01-result.json` | Exit 0, 1.104 s; both files already formatted. |
| `b3-native-independent-config-visibility-types-01-result.json` | Exit 0, 3.832 s; Linux-target ty passed for `template_access.py`, `template_apply.py`, `template_snapshot.py`, `template_backup_config.py`. |

The red source/log/result remain immutable. No passing total combines repeated or overlapping selections.

### Reused checks and input reconciliation

- B1 independent Native matrix: 166 passed, with SQL/auth/rollback/CAS/claims/provider boundaries, historical
  migrations and physical inventory. The new field-read finding and its new affected checks supersede that
  matrix's missing field-read coverage; the old matrix is not relabeled as a current full-suite execution.
- B2 independent parser/provider group: 141 passed; label/storage/backup/HTTP group: 46 passed. Their ten raw-JSON
  regression cases overlap. Current label-origin/publication implementations remain unchanged by B3 or this fix.
- B3 implementation: `affected-01` 77 passed (current wire/OpenAPI, SQL/HTTP compatibility and B2 recovery),
  `integration-01` 35 passed, and `restore-01` 15 passed. Current Native backup producers were unchanged after
  the implementation release until the common read-permission helper fix; its affected observation/CLI paths
  passed in this review's affected green run.
- B3 canonical export/client generation ran twice from the same schema inputs. Four SDK gates passed:
  Python 109 (real-service main operations excluded), TypeScript 46 in 13 suites plus CJS/ESM/declaration build,
  Rust 14 in six named offline binaries, Go ten named top-level contracts. The permission helper has no DTO,
  route signature or schema change, and `field_refused` was already in the existing response enum. Canonical
  and SDK source inputs remain unchanged; root explicitly authorized reuse instead of regeneration/retesting.
- `b3-native-resume-unchanged-artifacts-01.json` independently reconciles the implementation release against
  the 958-entry generated-artifact inventory, 12 maintained files, four generation manifests and five generator
  sources, with no mismatches. These inventory categories are not summed. The prior 938-source comparison had
  only the known two joint-fixture corrections and recorder-input coverage change. This review additionally
  changes the named permission helper and regression file, whose exact inputs are retained in the new runs.
- Existing scoped production and schema-hook Linux-target ty/Ruff evidence remains reusable for other unchanged
  Native files. None of these records claims a full-package Windows Native typecheck.

### Root-owned physical paired acceptance

The successful `b3-native-joint-06-result.json` and `b3-root-joint-06-readback-20261012.json` are root-executed
evidence, not tests executed by this reviewer: two scenarios passed, pytest 316.85 s, wrapper 390.753 s, exit 0.
The frozen 2,594 inputs had no drift; the freeze SHA256 is
`56a5e574b895eb01b69a73307f45dcd9a997e6e0155bcc2e57acc3ff38795596`.

Both customized and removed scenarios exercised actual managed CLI, mismatched/correct admit, physical restore,
fresh preflight, config/receipt-drift refusal and continuing historical verification. All 61 Native tables had
equal complete rows after restore, retaining a real refresh child/result, user model and nonempty B2 sidecar.
Customized selected `taki-bank-v2` with receipt counts `[2, 1]`; removed selected `none` with `[3, 1]`.
Each used five fake refresh completions (four tool responses and one final text), without paid providers.

- Customized command evidence: `b3-native-joint-aaae03b8006e40e6ab9486ced192bb5c-commands.json`, SHA256
  `ba951fa42ff14f82ae9043cf5c6607d8293a63f16dfdd374bfb8dcb5c6ddcccb`.
- Removed command evidence: `b3-native-joint-fbe295c6f03c43dcbf7e0143fb2bd460-commands.json`, SHA256
  `54751d06cfce7874f05750e631ec5020b983dfa02d93957ef927991bd14b9380`.

Joint-01 through joint-05 failures remain preserved. The later fixture fixes used real final synthesis, the
proper JSONB before-image and HTTPX proxy isolation; they did not relax assertions, guards or timeouts. The
permission fix changes authorization for restricted reads, not paired wire/projection/storage semantics, so
root explicitly retained this joint evidence and scheduled the affected read/observation/CLI cases instead.
Those affected cases now pass with the final helper. Joint-06 is retained as its original complete-pair evidence,
not relabeled as a fresh run after this fix; the new checks supply the affected authorization and CLI coverage.

### Final source reconciliation

`b3-independent-native-reviewed-source-01.json`, SHA256
`9f2f89243938334cbd675165e1cdf285f984b3c48a0402aaa9f2fe53b5ae7516`, pins all 952 current source/dependency/fixture
inputs and each new result/log/source-manifest hash. Every passing run's before/after source manifest is identical,
SHA256 `a10d2f37328f8bd13e623c4f03acf362511abfb78bcd4fd4e106ced9801a95cd`; a final independent file-by-file rehash
found no drift. Both recorded repository HEADs also remain unchanged.

The red source manifest has SHA256 `7d39220b62867f6bb7e4706b6b0b2f60ef343fdeace1f3598b1a72881c288b65`. Its only
differences from final green are the permission helper and the tightened successful-read controls in the same
four-case regression function. All five recorded runs report unchanged inputs during execution and owned TEMP
removal. This read-only reconciliation does not add another test, generator, SDK or full-suite execution.

## Cleanup and limits

- Red fixture `taki-hindsight-g1-19bf49595753`: Stopped/DataRemoved/RegistryRemoved all true. The recorder removed
  its owned TEMP. The fixture's logs and ownership evidence remain available under `.trellis/.runtime/g1-validation/`.
- Green fixture `taki-hindsight-g1-149fd32fc64b`: Stopped/DataRemoved/RegistryRemoved all true. Its owned TEMP
  was removed. Ruff, format and typecheck recorders also removed their own TEMP directories. All new check
  subprocesses have naturally exited; no Native heavy workload remains assigned to this reviewer.
- The current whole-package Windows Native optional/platform diagnostics remain outside this scoped fix.
  Linux-target ty is not Windows/full-package acceptance. Provider work already submitted is not recalled;
  configuration observations do not prove absence of undetected ABA.
- Root owns workspace lint/types/tests/build/boot, the final full Core/Healthy matrix, source reconciliation,
  Home acceptance and whole-Stage-5B acceptance. This Native report cannot accept those layers. Installed/manual
  and original-data acceptance remains owner-confirmed and outside automated evidence. Stop before 5C.

## Findings (not fixed)

No concrete defect remains unfixed in this Native review scope. The historical Windows/full-package limits and
root-owned remaining whole-stage gates above are not claimed as passed by this scoped review. Native source and
the lifecycle-spec write ownership are released without any additional production/spec changes.
