# C2a source and fake-process acceptance

Date: 2026-10-14. Root owns this acceptance and the final resource disposition.

**Independent SOURCE PASS.** The xhigh checker completed the whole C2a source review, ran the affected
independent checks and released SOURCE + CHECK SLOT. No source change or unresolved defect remained in
that final review. Root matched all 109 final source hashes, verified both task-only patches with
read-only reverse checks, archived 91 evidence/input files, and removed all three owned G: staging
trees (13,222,106 logical bytes). No protected C: fixture or tested child remains. All six source ACs pass.
The task stays `in_progress`; Docker/database/C2b criteria remain open.

## Accepted behavior

An operator request admits real Core Run/Attempt/Effect records, passes the Rust Gate and copied protected
Host installation, and reaches an independently authorized Native fake consumer through the private
credential channel. Host ownership records survive interruption; repeated/uncertain requests observe
the original resource instead of repeating effects. All public results keep `deploymentReady: false`.

The actual installed test uses `FixedDockerAdapter` with an explicitly registered **substitute Docker
executable/private pipe**. Core, SQLite, Shell, Host, Native and the fixed child are real processes/files;
the Docker engine and its resource metadata are substituted. This is not Docker or database acceptance.

| Source criterion | Evidence / result |
| --- | --- |
| Admitted private startup and installed reachability | Independent copied-install test passed through actual Core/operator, Rust Gate, copied Host and Native child. |
| Durable original-resource recovery | Core/Host process suites cover create/start/grant/submit interruption, duplicate/concurrent requests, DB/registry reopen and lost replies without replay. |
| Exact ownership and authority | Shared/Rust strict shapes, adapter/registry identity cases, Core checkpoint/currency tests and Native independent-grant cases pass. |
| Fake-only containment and Catalog ownership | Host rejects nonmatching selected/inherited values before checkpoint/grant/frame; installed/process evidence scans public state, argv, logs and persistent fixture files. Core remains the sole Catalog writer. |
| Observation, new startup and compatibility | Original running state survives admission expiry; explicit fresh startup requires new admission. Observer has no create/delete path. Unchanged C1/Core compatibility evidence is retained. |
| Independent quality, packaging and cleanup | Independent checks and copied entry pass; process cleanup is asserted in the installed proof. Final staging disposition is recorded in the Root readback. |

## Independent checks

All sixteen independent commands exited 0. No full repository rebuild or unrelated suite was repeated.

| Check | Result |
| --- | --- |
| Core C2 / fixed adapter / registry | 28 passed (15 + 10 + 3) |
| Host real-helper/Native recovery | 17 passed |
| Native owner/child process cases | 4 passed |
| Shared protocol/schema/governance | 121 passed |
| Rust focused / golden wire | 10 + 1 passed; 4 older C1 copied fixtures ignored |
| Actual copied-install chain | 1 passed, 33.83 seconds Vitest duration |
| Types and static checks | Core/Shared/Host types, 43-file scoped ESLint, 8-file Native Ruff/format/Linux-target ty and strict all-target Clippy passed |

The independent total is **182 passed**, with the four explicitly ignored old C1 cases above.
The implementer's 42-case Core broker/challenge/route/C1/Catalog compatibility pass remains valid for its
unchanged inputs; it was not rerun or included in that independent total. Linux-target type checking
does not execute the new Linux socket path.

## Identity and retained evidence

- Taki: `main`, HEAD `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
- Native: `main`, HEAD `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.
- Source: 109 changed files (99 Taki, 10 Native; 45 modified, 64 added), compared with the exact pre-C2a
  dirty-workspace baseline. Fingerprint: `b0e7896be6c5e49c7d588fb59a537787c1614c6bc302cacda30372c001eca2f9`.
- Independent installed proof: `taki-c2a-fixture-f9a819b1-00c2-4475-9d41-d1b4d3132413.json`, SHA-256
  `bcf2221d8e9738b757eb9db950cb900e54666c70db04178135f149dd38d49ba0`; `ownedCleanup: true`, tested child PID 33644 exited.
- [Independent review](c2a-source-review.md) retains S1/S2/S3 and the final verdict;
  [independent evidence](c2a-independent-source-evidence.json) records the exact checks and source pins.
  The [self-check](c2a-implementation-self-check.md) and [source manifest](c2a-implementation-source-manifest.json)
  are immutable historical implementer evidence, including their then-pending independent-review wording.
- [Root readback](c2a-root-final-readback.json), [Taki delta](c2a-source-delta-takiagent.patch),
  [Native delta](c2a-source-delta-hindsight.patch) and [raw evidence archive](c2a-source-check-evidence.zip)
  preserve the task-only changes and first failures before temporary baselines/logs are removed.
  The four original silent-command logs that were never created remain explicitly missing; no log was fabricated.

The fixes preserve post-dispatch uncertainty through Effect/Run settlement, consume the canonical Run
settlement result, isolate C2 admission's interactive-object mutation from C1, and reap the resident
before releasing Rust installation/state guards. No new framework or retry mechanism was added.

## Remaining gates

The [next preflight request](c2a-docker-acceptance-plan.md) is prepared for the existing Docker Desktop,
fixed Linux endpoint and minimal workload/cache inventory. The owner has now approved this read-only
preflight after cleanup, including potential automatic startup of existing restart-policy containers.
The [preflight passed](c2a-docker-preflight.md): the Linux engine and cached Native candidate are present;
three unrelated containers are running and left untouched. It does not authorize image builds or active
container changes. The source fixture has no real-engine switch; a small real-engine launcher and
its fault/scanning controls still need to be prepared from those runtime facts before container acceptance.

Next prove real Docker with generated fake values, then actual disposable-database shutdown/persistence.
C2b trusted receipts and C3/C4 model or populated-data tests follow their own accepted contracts. No
original business data, keys or real model was used. C1's eight accepted Linux tests do not cover C2's
new control socket, and Ubuntu service/platform AC2/6 remain open after the systemd 249 preflight.
No commit, push, finish/archive, original environment change or manual acceptance is claimed.
