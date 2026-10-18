# C2a first actual Docker case: runtime evidence review

Date: 2026-10-15. Reviewer: /root/c2_design_check.

**PASS for the first actual Docker fake-consumer case, executed with the reviewed R2 fixture.**
This accepts the recorded admission/delivery/duplicate-observation case only. The complete Docker
checkpoint, database and C2b criteria remain open; deploymentReady remains false.

## Evidence binding

Both ZIPs were read directly in memory. Every retained member matched its preservation record's
length and SHA-256, with no missing, extra or duplicate members. No staging tree was reconstructed.

| Archive | Bytes / files | Verified SHA-256 |
| --- | --- | --- |
| [Second attempt](c2a-docker-second-attempt-evidence.zip) | 60,128 / 43 | 789e5c43dcd115455987bbed0dbdc049773b9233d4111049fd8ce089310fe7be |
| [First attempt](c2a-docker-first-attempt-evidence.zip) | 56,397 / 42 | b6564758888abd09bf8c4e3614e85cae8bf925a4dbd02bdc4c05ee93856da001 |

The second archive's five reviewed-fixture inputs match the released R2 hashes and prepared-inputs.json.
The retained Native recipe/modules match that input manifest. The four prior static review/report
hashes remain unchanged. The original successful base-probe.json is reused byte-for-byte with its
archive/member hashes recorded: Python 3.11.16, dotenv 1.2.2, UID/GID 1000 and an empty data seed.
The recorded prerequisites recheck the same engine and immutable cached base before one local build.

## Supported runtime result

launcher-command.json records exit 0 in 98,198 ms; first-case.json records 95,176 ms including cleanup.
The launcher completed at 2026-10-14T16:25:34.640Z, before the subsequently reported interruption.

| Identity | Recorded value |
| --- | --- |
| Operator fixture/idempotency token | 8378a950-87c8-44e3-a909-d213a284f113 |
| Core-generated deployment/original Run | 330899ae-6175-40c2-af31-b806d1b96357 |
| Actual Docker container | 9b378419b65aa8fdd9102d132081f627bfba8bb717e05ba056f4beacba3b1412 |
| Native startup | 305b354f-436e-406d-aac7-0a1186464c3e |

The archived launcher assertions require actual completed Core Run status, create/start/inject
registry attempts with real effect/attempt identities, unchanged registry effects after the same-key
repeat and original-resource observation, and exactly one container create/start event and submission.
All three public status results must match. The fixture token does not select the Core Run UUID.

The retained facts show four control execs and one submitter exec, all no-TTY and exit 0. Their reviewed
assertions also check actual container binding, open stdin and fixed Python/module arguments. The live
fake child marker names PID 50 and the same startup. Both Unix sockets are UID/GID 1000, mode 0600.

All 16 named scan categories have zero fake-sentinel matches. The final C: fixture-tree scan covers
827 files / 103,185,094 bytes; the new volume scan covers one 84-byte marker and checks process argv.
Both captured container log streams are empty. These are the stated scan surfaces, not an exhaustive
image-layer or writable-layer examination.

## Cleanup and interruption boundary

The successful case records exact owned container/volume removal, removal of its unique image tag,
protected C: root removal and reaping of test processes 43024/45932. Cleanup/scanning failure would
force a failed case and nonzero launcher exit in the reviewed code.

After the unrelated interruption, interruption-recovery.json records the owner's authorization and
startup of the same pinned Docker Desktop binary. root-post-recovery.json and the retained read-only
command replies confirm the same engine, absent test container/volume/tag and unchanged cached base;
the case was not rerun. Seven original container IDs remain. redis and arboris-app are running with
new start times following that Desktop startup. Their uninterrupted continuity is not established.
gpt-load was already absent from the first attempt's inventory before its first Docker mutation.

The [second preservation record](c2a-docker-second-attempt-preservation.json) records verified archival
followed by removal of 1,644,418 logical bytes from the exact G: staging root. Its two rebuildable
binary outputs retain hashes only. Both attempt staging roots are recorded removed; build-cache or
VHDX reclamation is not claimed. This later interruption/startup is not controlled daemon-restart
or original-resource recovery acceptance: the successful test resources had already been cleaned.

## Findings (fixed)

No new defect required a fix in this evidence review. The [first failure](c2a-docker-first-attempt.md)
remains preserved: missing TAKI_GATE_AUTOAPPROVE stopped the debug Shell before deployment admission;
the minimized binary probe exited 2. The previously reviewed R2 correction supplies allow-once only
to that isolated Shell child and is now supported by the successful actual case.

## Findings (not fixed)

No blocking inconsistency was found for this limited PASS. Retained inner runtime evidence consists
of executed assertions and safe facts from the hash-bound reviewed fixture. Individual inner Docker
events, exec-inspect, metadata/log replies and operator response bytes were not all preserved, so
their raw contents cannot each be independently reconstructed from the archive. This review verifies
the retained evidence and assertion path; it does not claim a second execution or complete raw trace.

Helper/ACK loss, Core/Host and container/daemon restart recovery, new-startup/fresh-tmpfs and persistent
volume recovery, disposable database shutdown/data persistence, C1 service AC2/6, C2b receipts, real
models/business data and owner/manual acceptance remain open. No task AC or spec was changed.

## Verification

- Lint: PASS, reusing the hash-bound R2 scoped ESLint result; not rerun.
- TypeCheck: PASS, reusing R2 single-entry no-emit with zero diagnostics; not rerun.
- Tests: the first actual Docker case passes on retained runtime evidence. The accepted 182 source
  tests and four older ignored C1 cases remain unchanged and were not rerun.
- This review only read files and wrote this report. No Docker/WSL/app start, build, behavior test,
  dependency installation, production edit or Git lifecycle action occurred.

Ownership of this report is released to Root.
