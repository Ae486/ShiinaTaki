# C2a recovery R2 fixture repair self-check

Date: 2026-10-15. Implementer: /root/c2a_recovery_implement.

**PASS for the three affected static checks.** R2 has not been executed. Independent review and
Root-controlled execution remain pending; the first attempt remains FAIL.

## Cause and minimal repair

The [independent first-attempt diagnosis](c2a-recovery-first-attempt.md) localized the failed call
to the final live scanTree invocation. Final event/exec assertions had completed, but the replacement
Shell still held state/deployment.lock with exclusive Windows sharing. The same full scanner later
passed after process/helper reaping: 827 files, 103,461,077 bytes, zero sentinel hits.

The original catch did not retain the first failing leaf, errno or stack. This report preserves that
limit and does not invent an exact EBUSY/EPERM message.

Only the redundant live scan was removed. The complete protected-tree scan remains in cleanup after
stopProcesses and requireHelperGone, before R removal. It sets protectedTreeScannedAfterStop only on
success; the final cleanup boundary requires that flag before a result can retain PASS. The original
scanner, provisioning scan, every persistent file, sentinel check and file/byte/symlink bound remain
unchanged. All live evidence/assertions finish before teardown.

The main failure catch remains unchanged. Successful cleanup cannot overwrite an earlier false
casePassed; scan or cleanup failure still sets casePassed=false and records cleanupFailureStage.
No production lock or sharing behavior changed.

## Fresh R2 bindings and files

Root supplied the fresh token; this implementer did not create the roots, image or any runtime.

| Binding | Exact value |
| --- | --- |
| Token | `775da07b-2b69-44a3-868c-2604423dac11` |
| Staging | `G:/TakiAgent-c2a-docker-acceptance/recovery-775da07b-2b69-44a3-868c-2604423dac11` |
| Protected root | `C:/taki-c2a-docker-recovery-775da07b-2b69-44a3-868c-2604423dac11` |
| Image tag | `taki-c2a-fake:775da07b-2b69-44a3-868c-2604423dac11` |

| Changed input | Bytes | SHA-256 |
| --- | ---: | --- |
| [run-recovery.ts](docker-recovery/run-recovery.ts) | 47588 | `869146af78a9cde99cf70af2c857049548c3c097aedd09f63c95d779c8d11017` |
| [README.md](docker-recovery/README.md) | 9848 | `9c73c76e240e84e45b98d6872a9e6596f9df7d6e7c12d55d46556d36b9c0e3e4` |

The four owned files are the runner, README, this report and the
[machine-readable self-check](c2a-recovery-r2-self-check.json).
The unchanged recovery-probe.py remains 5,131 bytes with SHA-256
`e3e49ad25888b34332184775f3193a47ad9e3c0c4943fd08e3dc7b3611119b29`.
Source/README/probe encoding is strict UTF-8 without BOM.

## Checks and retained failure evidence

| Check | R2 result |
| --- | --- |
| Node syntax | PASS, exit 0 |
| Scoped ESLint --no-ignore | PASS, exit 0 |
| Single-entry TypeScript no-emit | PASS, diagnostics: [] |
| Python AST / Ruff check / Ruff format | Unchanged hash-bound R1 results reused; not rerun |

All three current checks ran after the final token-bound launcher edit. The JSON retains the exact
commands, timestamps, durations, exit codes and complete outputs. It also retains the original
TS2307/TS7006 failing check and its frozen source reference; those failures were resolved before R1
and are not current regressions.

The original runtime JSON remains 182,384 bytes with SHA-256
`22075fc1db3122b682056be6c99dedfb237d606e9ffefbcb46e24ff0c79d3551`,
casePassed=false and failureStage=final-effect-and-containment-check. The JSON includes the original
launcher command/output record (exit 1, 98,478 ms) verbatim from the retained command log, plus
hashes for the frozen inputs and the independent diagnosis. Expected nonzero diff exit codes denote
the narrow source/README changes. A missing prior-turn in-memory log caused no command to run;
the original records were loaded from the frozen JSON instead.

Root's 22-input freeze is preserved. The directly relevant frozen runner, README and original
self-check were rechecked; this implementer did not repeat the complete 22-input or accepted
production baseline verification.

Permanent R1 evidence is retained in the [verified archive](c2a-recovery-first-attempt-evidence.zip)
and [Root preservation record](c2a-recovery-first-attempt-preservation.json). The archive is 179,395
bytes with SHA-256 `fb0d5afca5f04df4d800c25d831db49c218a2d3233a07c919f5baa55e11b795d`.
Root verified all 72 entries; this implementer verified only the released archive hash. G: paths in
the raw original records identify their historical staging locations.

## Remaining boundary

No Docker/WSL/Core/Shell lifecycle, runtime test, image/Host/Rust build, new dependency, production
edit or Git lifecycle operation occurred. The unchanged source suite and Python checks were not rerun.
The consumed R1 token, single-use marker, original result and review were not reset or rewritten.

Independent review and the complete R2 runtime case remain necessary. The original resource/effect
assertions, budgets, exact cleanup and deploymentReady=false contract remain in force.
