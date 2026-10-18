# C1b Linux process acceptance — 2026-10-14

## Verdict

**PASS: 8 Linux tests passed, 0 failed, 0 skipped.** The final exact suite exited 0 in
69.093 seconds (72.075 seconds including the external process observer). This is
actual Ubuntu 22.04.5 / WSL2 process evidence, not Windows skips or static emulation.

The approved disposable runtime was CPython 3.11.17 from python-build-standalone
20261013, with the locally installed locked python-dotenv 1.2.2 wheel. Both artifact
SHA-256 values matched the approved plan. The initial 34-input independent manifest
matched completely. The implementation was not changed.

Combined with the accepted 24 Windows Native tests and 20 fake-observer tests, this
supports **AC7 automatic C1 process acceptance**. AC2/6 service/platform/final-installer
checks remain open. C2 Docker and C3 real-model gates, original credentials/data and
manual acceptance remain separate. Every public result still has
`deploymentReady: false`.

## Findings fixed

### Fixture readiness and positive-case lifetimes were too short for DrvFS imports

File: `H:/hindsight/docker/standalone/tests/test_managed_bootstrap_linux.py`.

The first run passed 2 tests and failed 6 at the fixture's three-second socket-ready
wait. A bounded same-interpreter/same-source probe measured **4.5486 seconds** from
Popen to socket appearance; the process then exited 0 with no stdout/stderr and was
reaped. This was fixture startup overhead before grant/socket construction.

After increasing only the fixture startup wait to ten seconds, the second run
passed 5 tests and failed 3 when the real submitter returned unavailable or
outcome-unknown. A separate probe measured **3.5232 seconds** inside the submitter
call against its original three-second grant, returning unavailable/outcome-unknown.
Both probes cleaned their owned directories.

The final test-only correction is:

- Socket-ready wait: 3 -> 10 seconds.
- Positive-case default admission: 3 -> 10 seconds.
- Duplicate-submission fake child lifetime: 1.5 -> 6 seconds; final wait: 5 -> 15 seconds.
- Graceful-case admission: 3 -> 10 seconds, still shorter than the child's
  **12-second TERM handler**, while production's independent **30-second grace**
  remains unchanged.

The one-second lost-ACK expiry case, half-second trickle case, private I/O,
cancellation, exact-identity/refusal assertions and all production constants remain
unchanged. Actual submitter subprocess coverage is preserved. No warm-up framework,
import hook, runtime relocation or production protocol relaxation was introduced.

### Linux documentation still described the tests as unexecuted

File: `H:/hindsight/docker/standalone/managed_bootstrap/README.md`.

Updated only the Linux evidence row and closing evidence sentence with the dated
8/8 result and continuing service/Docker/provider limits.

Root owns task/PRD/spec/HANDOFF updates; no such documents or earlier evidence were
edited by this checker.

## Verification

Exact command, from `/mnt/h/hindsight`:

```bash
/mnt/g/Temp/taki-c1b-linux-20261014/runtime/python/bin/python3.11 -B -m unittest discover -s docker/standalone/tests -p test_managed_bootstrap_linux.py -v
```

| Run / check | Result |
| --- | --- |
| Original accepted source | 2 pass, 6 fail, 0 skip; exit 1; unittest 27.843 s |
| Socket-ready wait correction | 5 pass, 3 fail, 0 skip; exit 1; unittest 45.988 s |
| Final fixture correction | **8 pass, 0 fail, 0 skip; exit 0; unittest 69.093 s** |
| Scoped Ruff on changed Linux test | PASS |
| Scoped Ruff format check | PASS |
| Existing all-platform ty bootstrap scope | PASS |
| Accepted input identity before execution | 34/34 identical |
| Final input identity | 32/34 identical; only the Linux test and README changed |

All eight final cases passed: changed configuration refusal, independent graceful
shutdown, lost-ACK observation after admission expiry, actual process-group and
grandchild reaping, partial-frame cancellation, socket UID/modes and duplicate
submission, absolute trickle deadline, and wrong kernel UID/unsafe-directory refusal.

The JSON evidence preserves all three complete test logs, exact commands, UTC times,
exit codes, both timing probes, runtime/package locations, observed fixture and
process identities, original/final source hashes and scoped check outputs. The
observer launched the exact command; it did not modify tests or log frame values,
process environments or credentials.

The current WSL effective UID was 0. This proves that concrete Linux process
environment; it does not claim non-root service enrollment or credential-source
installation. Existing WSL localhost-proxy/Maven PATH warnings and pip's root-user
warning were nonfatal. No related settings were changed.

## Cleanup and retained evidence

All **24 suite fixture directories and two timing-probe directories** cleaned
themselves. Final Linux readback found no `/tmp/taki-c1b-fake-*` directory and no
process using the owned runtime or exact fixture entrypoints. The final run's five
observed consumer/grandchild identities were absent after reaping; tests also
asserted their own recorded PIDs were gone. No leftover Linux directory required
manual deletion.

The exact G: temporary root used **113,112,994 bytes** before removal, below the
536,870,912-byte cap. It was resolved, checked against the approved G:/Temp parent
and rejected if redirected, then removed entirely with one PowerShell
`Remove-Item -LiteralPath ... -Recurse -Force` operation. The root is now absent;
source and permanent evidence remain present. No cross-shell deletion occurred.

System Python remains **3.10.12**, with no system python-dotenv. Final WSL readback
shows **Ubuntu-22.04 Stopped** and **docker-desktop Stopped** without a distro
termination command. Final free space: H: **14,312,681,472 bytes**; G:
**150,073,966,592 bytes**. These are observed volume totals, not a claim that system
or concurrent disk activity was reversed. No VHDX compaction or build-cache cleanup
was performed.

The authoritative machine-readable record is
[c1b-linux-check-evidence-2026-10-14.json](c1b-linux-check-evidence-2026-10-14.json).
The earlier independent manifest SHA-256 remains
`f69ca93f675bf3513ef687952c357c0be0004a305e1ff46ecc91c21d12033c17`;
it was preserved, not rewritten to hide the fixture corrections.

No system runtime/PATH/mount, systemd/service, Docker, original data/key, real-model,
build-output or Git lifecycle action was performed.
