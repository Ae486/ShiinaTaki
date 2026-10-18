# C2a recovery implementation self-check

Date: 2026-10-15. Implementer: /root/c2a_recovery_implement.

**PASS for task-only static checks.** Independent implementation review and actual recovery execution
remain pending. This is Stage 2 implementation evidence, not a Docker runtime acceptance result.
The existing owner authorization covers the isolated slice; Root retains execution and cleanup ownership.

## Files and behavior

- [run-recovery.ts](docker-recovery/run-recovery.ts) implements the fixed outer Host-completion fault,
  exact Shell/helper/Core termination and original-state reopen, one original-container restart,
  bounded persistence probes and explicit fresh-startup admission.
- [recovery-probe.py](docker-recovery/recovery-probe.py) provides bounded stdlib-only process/socket/
  mount/marker facts and create-only writes for two small non-secret markers. It never reads process
  environment/memory, grants, credentials, the registry or a database.
- [README.md](docker-recovery/README.md) binds the new token, exact resources, preparation, single-use
  execution, budgets, evidence and cleanup to the accepted design.
- This report and [raw check evidence](c2a-recovery-self-check.json) complete the five owned files.
  No production, shared relay, frozen first-case, task metadata or database-fixture file was changed
  by this implementer.

The first relay is closed synchronously within the exactly matched inject completion callback. Its
upstream cannot forward the completion. The callback contains its own failures so cleanup remains
reachable. Core must retain the canonical unknown Run/Attempt outcome while the Host registry records
observed injection and the same Native child remains alive.

Reopen reuses intact Core/Host/Node state and persisted Node authentication; the new Shell connects
directly to the new Core URL. The original relay remains closed. The process check binds the resident
to the current fixture parent, exact executable/argv and creation identity; the Native check binds
startup, PID and process-start ticks. Read-only reconciliation may advance registry revision without
creating another effect or changing original attempt/step facts.

After one exact container restart, the new startup must wait unbound without a child. Fresh C2 and
C1 authority/mapping identities are checked against stable resource, configuration and Catalog facts.
Counter values need current validity, not numerical increase across Core boots. Event evidence is
scoped separately to the original container and volume; pre-restart exec metadata is retained before
the daemon may retire those exec IDs. A bounded failed startup-status read is distinguished from
grant/submit success. The marker check is filesystem evidence only.

## Final verification

| Check | Final result |
| --- | --- |
| Node syntax | PASS; final launcher |
| Python AST | PASS; AST_OK |
| Scoped ESLint with --no-ignore | PASS; final launcher |
| Single-entry TypeScript no-emit | PASS; diagnostics: [] |
| Ruff check with --no-cache and existing Native configuration | PASS; All checks passed! |
| Ruff format check with --no-cache | PASS; 1 file already formatted |

The JSON preserves all **11 original command records**, including exact command/cwd, timestamp,
duration, exit code and complete output. The first TypeScript check failed with TS2307 for a direct
task-local zod import and the resulting TS7006. Removing that task-only dependency and validating
private probe facts with bounded assertions fixed both errors; existing Shared schemas still validate
production wire messages. No dependency was added. Final Node syntax, ESLint and no-emit checks ran
after the last launcher edit; the Python file was unchanged after its passing checks.

Two documented lint exceptions apply only to this single-use launcher: file length and the cohesive
loseHostCompletion function. Other lint rules and production limits are unchanged.

| Final input | Bytes | SHA-256 |
| --- | ---: | --- |
| [run-recovery.ts](docker-recovery/run-recovery.ts) | 47334 | `f7c907eda8a156da8ca20be9d199c2d6ac5eb35ac84b01625ace6a50f608493e` |
| [recovery-probe.py](docker-recovery/recovery-probe.py) | 5131 | `e3e49ad25888b34332184775f3193a47ad9e3c0c4943fd08e3dc7b3611119b29` |
| [README.md](docker-recovery/README.md) | 9401 | `08643e9afef9600213a0570faed2058bcb74ead8acea99d61159d83b4f4831be` |

All three files decode as strict UTF-8 without a BOM. The frozen first-case runner and README match
their retained SHA-256 baselines; full values are in the JSON. The reused container scanner and shared
relay have current hash snapshots only, with no independent before-hash comparison claimed.
Root's unchanged 109-file accepted production baseline is reused; this implementer did not repeat
that full hash verification or its accepted tests.

## Remaining execution boundary

No Docker/WSL/Core/Shell lifecycle, behavior test, Host/image/Rust build or Git lifecycle action ran
during this stage. The unchanged 182-case source suite, four older ignored C1 fixtures and successful
first Docker case were not rerun.

The executable fault loses the outer Host-to-Core completion. Private Native ACK loss, inner
create/start/submit faults, custody rotation/unavailability, controlled daemon restart, actual
database persistence, C1 service criteria, C2b and real-model/business-data/manual acceptance remain
separate. Every deploymentReady value remains false.

The five files are ready for Root and the original independent reviewer. Root must retain the
single-use marker, preserve first failures and exact input hashes, enforce the accepted budgets,
and complete the exact owned cleanup before assessing runtime acceptance.

