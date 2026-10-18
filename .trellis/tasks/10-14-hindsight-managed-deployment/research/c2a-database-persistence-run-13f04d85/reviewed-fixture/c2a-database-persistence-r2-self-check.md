# C2a database persistence R2 self-check

Date: 2026-10-15. Implementer: `/root/c2a_database_implement`.

**Affected static checks PASS; R2 runtime NOT RUN.** The narrow task repair is released for
independent exact-byte review. Root owns preparation, image build, runtime, preservation and
cleanup. Public `deploymentReady` remains false.

## Change and first-failure preservation

The [first-attempt diagnosis](c2a-database-persistence-first-attempt-diagnosis.md) established
that requiring all attempts to be `observed` contradicts the Host contract. Create/start retain
admitted attempt phases and publish verified resource steps; injection has its own observed phase.
The original runtime FAIL and missing raw registry/exception evidence remain unchanged.

R2 now checks the original create/start/inject order, per-attempt Effect/Core-attempt IDs,
injection `observed`, and verified volume/container/start steps. It makes no production or
database-behavior change. New evidence is limited to:

- Parsed public status and a bounded original-resource/action/phase/identity projection before
  assertions. Generation records use the same projection. Non-reusable checkpoint/startup-
  authorization/snapshot IDs are correlation facts only; authorization/grant/custody payloads
  and private frames are excluded.
- Specific initial resource/helper/Run/SQL stages, an allowlisted first failure code and a
  separate cleanup code. Helper facts contain owned PID/parent/creation and match booleans,
  not arbitrary command lines or environment data.
- The latest existing fixed-reader result retained before readiness assertions.
- On failure only, one copy of the existing fixed `last-stop.json` after the same cleanup stop
  and stopped-state check, before original CID deletion. The file stays <=128 KiB and the client
  <=10 seconds within the existing five-minute cleanup deadline. Case/startup/containment checks
  precede safe result publication; missing/stale/invalid output is secondary and never replaces
  the first failure. No new live probe, inspector, start, SQL retry or generic logger is added.

Both Python files differ from their frozen first-attempt bytes only in the single case UUID.
SQL, subreaper/process ownership, signal deadlines, report protocol and scanner are unchanged.
The task source, README and new R2 self-check files are the only implementation writes.

## Exact files

| File under `research/` | Bytes | SHA-256 |
| --- | ---: | --- |
| `docker-database/fake_child.py` | 44233 | `427bc9e824e4a1dacadf29acca4d0e57faed1800a41972eb4c7797fc5b974800` |
| `docker-database/database-read.py` | 6084 | `0ad82eb436c9c4389852c07ddb7c28eed6e9b5cd59740fb71c1ebb42db243419` |
| `docker-database/run-persistence.ts` | 55442 | `951de1587a37a0dba96fbf76bf029943128c9e80fc7ea1aa5dfe888fff470d25` |
| `docker-database/README.md` | 22962 | `ffd27eba8edae875cdd8f8a84beea17e4dc1385e180c879fba7388816181419a` |

All files are UTF-8 without BOM/CRLF/trailing whitespace. Raw commands, outputs, the one
intermediate lint finding and final pass results are in the [JSON record](c2a-database-persistence-r2-self-check.json).

## Checks

| Check | Result |
| --- | --- |
| Frozen first-attempt archive | SHA-256 matched `049a9a614ddf2f109698afbd73296ee28c0e4a780361514223fe26f1732bfcd9`; read exact reviewed Python entries without extracting them. Root owns verification of all 55 entries. |
| Python change boundary | Byte comparison after one UUID substitution matched both files exactly; AST and in-memory compile passed. No module/main ran. |
| Node syntax | PASS. |
| Scoped ESLint | PASS, no warnings. The added failure-copy call made the cohesive task cleanup 51 lines; its exact size directive documents ordering without changing production rules. |
| Single-entry TypeScript noEmit | PASS, zero diagnostics; no incremental output/build tree. |
| Source review | Compared the complete launcher diff against frozen R1: assertion/evidence changes and token only. |

Python Ruff/format and the four small actual-stream-helper cases are reused from the frozen
implementation: the byte comparison proves their code unchanged. No behavior test, broad
source suite, Docker/WSL, application, image/Host/Rust build or new dependency was run.

## Fresh reserved case and release

Use [README Stage 3 R2](docker-database/README.md):

- Token: `13f04d85-ee84-408e-890c-88922e36c69e`.
- S: `G:/TakiAgent-c2a-database/persistence-13f04d85-ee84-408e-890c-88922e36c69e`.
- W: `C:/taki-c2a-db-persistence-13f04d85-ee84-408e-890c-88922e36c69e`.
- Tag: `taki-c2a-db:13f04d85-ee84-408e-890c-88922e36c69e`.

S and W remain absent; this agent created no runtime resource. The original failed stage was
removed by Root after preservation. Use its task-local evidence ZIP and preservation record,
never the historical G: path. Prior checks/reviews/diagnosis and frozen evidence are unchanged.

Independent R2 review precedes the same reviewed one-case execution. Actual PostgreSQL
persistence, graceful reap/stop/scan/report timing and Engine facts remain unproved by this
static repair. C2b, actual Native API/provider and owner acceptance remain separate.
