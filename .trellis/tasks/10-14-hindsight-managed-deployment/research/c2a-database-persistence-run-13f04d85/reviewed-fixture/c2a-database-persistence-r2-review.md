# C2a database persistence R2 exact-byte review

Date: 2026-10-15. Reviewer: /root/c2_design_check.

**PASS for the narrow R2 repair. Runtime NOT RUN.** The corrected assertion matches the actual Host writers, and the added failure evidence stays within the original fixed-reader, report and cleanup contracts. No further source fix was required. Root may prepare the fresh case from these exact bytes under the existing authorization.

## Findings (fixed)

- **File:** docker-database/run-persistence.ts:595-601.
- **Issue:** R1 required all create/start/inject attempts to be observed. That contradicts the real producer: create/start complete through verified resource steps; injection alone advances its attempt phase.
- **Fix by the implementer:** Keep exact action order and Effect/Core-attempt correlations, require verified volume/container/start steps, and require observed only for the inject attempt. No Host/Native/database behavior was changed.

- **File:** docker-database/run-persistence.ts:196-218,245-258,430-431,595-611,673-719,795-799.
- **Issue:** R1 did not retain the initial raw status/registry content or a specific assertion code before its failure; cleanup removed the child report without preserving it.
- **Fix by the implementer:** Retain the parsed public status, bounded safe registry/helper projections, latest existing fixed-reader result and closed failure codes/stages. On failure, copy only the existing fixed last-stop report after the original cleanup stop/inspect and before removal. Its absence or invalidity is secondary evidence and never replaces the first failure.

The prior independent static PASS missed the universal-phase error. That report remains preserved as historical evidence. R1 remains FAIL; neither its missing raw phase values nor SQL/checked-stop results are reconstructed from source or cleanup success.

## Findings (not fixed)

None within the admitted R2 repair. No additional requirement, generalized diagnostic framework or failure matrix is introduced.

## Producer-grounded assertion check

The three current producer sources exactly match their entries in the source manifest preserved with R1.

| Producer path | Actual writer contract | R2 implication |
| --- | --- | --- |
| apps/hindsight-host/src/deployment-owner.ts:67-111,137-143 | addAttempt initializes admitted. Create/start dispatch their effects and return observation without changing attempt phase. | Do not require their attempt phases to be observed. |
| apps/hindsight-host/src/deployment-owner.ts:188-204 | recoverResources verifies inspected volume/container/start in record.steps. | Require all three verified resource steps. |
| apps/hindsight-host/src/deployment-injection.ts:61-77 | The real submit path fences submit-dispatched, validates the returned binding, then writes observed. | Require the inject entry's observed phase. |
| apps/hindsight-host/src/deployment-registry.ts:19-35 | Attempt phases and resource steps are separate bounded fields. | Keep both facts and their action/identity correlations distinct. |

A valid completed history can therefore have admitted/admitted/observed with verified resource steps. This is a source-established contract, not a claim that R1's unretained registry bytes were recovered.

## Evidence and cleanup delta

- The complete launcher diff against frozen R1 is limited to the new token, the corrected predicate, safe projections, closed failure stages/codes, latest existing reader evidence and the fixed failure-stop copy. The original two-generation success sequence, ten-second held execute, first-stop preservation, final-stop copy and resource cleanup remain unchanged.
- registryFacts omits authorization objects, custody payloads and private frames. Correlation UUIDs are non-reusable identity facts. Helper evidence contains owned PID/parent/creation and fixed-executable/argv-match facts; no arbitrary command line or environment is retained.
- Generation evidence now stores the same flat registry projection. Root's readback should consume deploymentId, operationId, containerId, volume, configurationDigest, steps and attempts from that projection; it must not assume the old full registry object.
- retainFailureStop is called once only for a failed case with a known, revalidated original container. The existing cleanup stop and stopped-state check precede the fixed cp. The <=10-second client uses the remaining original five-minute cleanup budget; there is no new live probe, startup, SQL request, inspector or deadline reset.
- The copied file must be regular, <=128 KiB, sentinel-free and bound to the current case and latest original inject startup before its result/hash is published. Missing, stale or invalid evidence remains an explicit secondary outcome. The original failed stage/code is preserved independently of cleanup.
- The failure-stop result is diagnostic evidence only. Termination during initialization can follow the fixture's early failure and does not itself prove an unrelated PostgreSQL defect or graceful-stop acceptance.

## Exact release

| File under research/ | Bytes | SHA-256 |
| --- | ---: | --- |
| docker-database/fake_child.py | 44233 | 427bc9e824e4a1dacadf29acca4d0e57faed1800a41972eb4c7797fc5b974800 |
| docker-database/database-read.py | 6084 | 0ad82eb436c9c4389852c07ddb7c28eed6e9b5cd59740fb71c1ebb42db243419 |
| docker-database/run-persistence.ts | 55442 | 951de1587a37a0dba96fbf76bf029943128c9e80fc7ea1aa5dfe888fff470d25 |
| docker-database/README.md | 22962 | ffd27eba8edae875cdd8f8a84beea17e4dc1385e180c879fba7388816181419a |

R1 archive: 531,237 bytes, SHA-256
`049a9a614ddf2f109698afbd73296ee28c0e4a780361514223fe26f1732bfcd9`.
The archive hash, four exact original fixture entries, staged original child, accepted source-manifest pin and retained persistence.json were independently read without extraction. This review did not repeat Root's all-entry archive audit.

The raw R1 persistence.json hash remains
`50e1eaff879108199ba3b069d7b5e7406cf7ef0742984aa12d99aec2f0bc8c41`.
It records casePassed=false, failureStage=pre-injection-observation-and-start, ownedRuntimeCleanup=true and no initialRun/firstGeneration/firstStop/finalStop result. Its pre-injection observation took 784 ms and contained no wrapper/PG/data initialization. These limited observations do not establish database persistence.

Both Python files match their exact archived R1 bytes after replacing the one case UUID with
`13f04d85-ee84-408e-890c-88922e36c69e`. SQL, supervision, signal/report deadlines, fixed reader and scanner code are unchanged. The JSON companion records the per-file comparisons, producer hashes, final build-context pins and independent TS commands/results.

## Verification

| Check | Result |
| --- | --- |
| Node syntax | PASS; --check only |
| Scoped ESLint | PASS; --no-ignore, --max-warnings 0 |
| TypeCheck | PASS; one launcher entry, noEmit=true, incremental=false, diagnostics=[] |
| Python delta | PASS; exactly one UUID substitution in each file, with unchanged byte lengths |
| Python Ruff/format and four scanner cases | Reused from the frozen R1 implementation after exact token-only comparison; not rerun |
| Docker/app/WSL/build/install/old 182-case suite | NOT RUN |

No reviewer source edit or additional test harness was needed. Only these two review reports were written; original R1 diagnosis, self-check, review and archive records remain unchanged. No production/spec/template synchronization is required for this task-only assertion/evidence repair; README Stage 3 R2 records its boundaries.

## Root handoff

Use only the new T=`13f04d85-ee84-408e-890c-88922e36c69e`,
S=`G:/TakiAgent-c2a-database/persistence-13f04d85-ee84-408e-890c-88922e36c69e`,
W=`C:/taki-c2a-db-persistence-13f04d85-ee84-408e-890c-88922e36c69e`,
and matching `taki-c2a-db:T` tag. Do not reuse R1 resources.

This PASS releases the corrected task fixture for the already authorized one-case sequence. It does not establish actual two-generation logged-data persistence, adopted/direct reaping, completion of stop/scan/report within 25 seconds, final owned cleanup, Native API/C2b readiness or owner acceptance. Preserve both failed and successful runtime evidence under their original case identities.

