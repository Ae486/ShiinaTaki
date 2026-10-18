# C1b temporary Linux runtime and process acceptance

Status: approved by the owner on 2026-10-14 through the explicit temporary-environment/test permission.
Execution is complete: **8 PASS, 0 FAIL, 0 SKIP**, with owned cleanup complete. See the
[dated check report](c1b-linux-check-2026-10-14.md) and its machine-readable evidence for the three retained
runs, measured fixture corrections and final source/cleanup readback. This plan records the approved procedure.

## Purpose and current evidence

Run the eight existing `test_managed_bootstrap_linux.py` cases in Ubuntu-22.04. The accepted C1b
Windows/source results remain 24 Native and 20 fake-observer passes; Linux execution is still pending.
The existing Ubuntu has Python 3.10.12, no Python >=3.11 and no python-dotenv. The earlier permission
covered starting Ubuntu with existing dependencies and stopping when prerequisites were missing.

The original task remains `in_progress`. On 2026-10-14, H: has 14,312,755,200 bytes free (13.33 GiB)
and G: has about 150.2 GB free. Prior build cleanup is complete. Both Ubuntu-22.04 and docker-desktop
were observed stopped during this readback. The owner subsequently granted the narrow approval below.

## Temporary files and pinned inputs

Use the currently absent directory `G:/Temp/taki-c1b-linux-20261014`, visible in Ubuntu as
`/mnt/g/Temp/taki-c1b-linux-20261014`. Downloads and the extracted runtime stay on G:.
Use the bundle's `runtime/python/bin/python3.11` by absolute path; leave system Python and PATH unchanged.
The Linux socket/process fixtures use their existing small `/tmp/taki-c1b-fake-*` directories because
the tests require Linux file modes and Unix sockets. Retain only the small acceptance log in this task.

| Input | Pinned artifact | Download size | SHA-256 |
| --- | --- | --- | --- |
| CPython 3.11.17, python-build-standalone 20261013, Linux x86_64 GNU | `cpython-3.11.17+20261013-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz` | Official release displays 29.4 MB | `3b8e5a248bcc351265ffe68f5e457668a2e09c99a47f81f658988c7d3d107522` |
| python-dotenv 1.2.2 | `python_dotenv-1.2.2-py3-none-any.whl` | 22,101 bytes | `1d8214789a24de455a8b8bd8ae6fe3c6b69a5e3d64aa8a8e5d68e694bbcb285a` |

Sources:

- <https://github.com/astral-sh/python-build-standalone/releases/download/20261013/cpython-3.11.17+20261013-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz>
- <https://files.pythonhosted.org/packages/0b/d7/1959b9648791274998a9c3526f6d0ec8fd2233e4d4acce81bbae76b44b2a/python_dotenv-1.2.2-py3-none-any.whl>
- Native `uv.lock:4394` pins the same dotenv version, wheel, size and digest as the accepted Windows environment.

Allow at most 512 MiB for these temporary G: files. Check the archive's unpacked size before extraction;
stop if it exceeds this allowance. The runtime needs no compilation or project dependency synchronization.

## Execution after approval

1. One `trellis-check` agent at **high** effort owns the temporary environment and serial Linux check;
   Root owns task/AC/handoff updates. No nested agents or unrelated checks.
2. Download the two pinned files from Windows to the directory above and verify their digests. Start only
   the already authorized Ubuntu-22.04, extract into `runtime/`, and use the interpreter there. If execution
   from `/mnt/g` or bundled pip is unavailable, report that failure before changing mounts or installing tools.
3. Install only the local locked wheel into this disposable interpreter. Disable index access, dependency
   resolution, caches and bytecode generation:

   ```bash
   /mnt/g/Temp/taki-c1b-linux-20261014/runtime/python/bin/python3.11 -I -B -m pip \
     --isolated --disable-pip-version-check install --no-index --no-deps --no-cache-dir --no-compile \
     /mnt/g/Temp/taki-c1b-linux-20261014/python_dotenv-1.2.2-py3-none-any.whl
   ```

4. Record Python/dotenv versions and run the existing suite from `/mnt/h/hindsight`:

   ```bash
   /mnt/g/Temp/taki-c1b-linux-20261014/runtime/python/bin/python3.11 -B -m unittest discover \
     -s docker/standalone/tests -p test_managed_bootstrap_linux.py -v
   ```

   Capture the exit code and individual results. Preserve first-failure evidence if any; apply only a
   demonstrated, scoped correction under the existing source authorization, with its affected checks.
5. Wait for the recorded test processes and verify their fixture cleanup. Inspect and remove only this
   run's owned leftovers. Resolve the exact G: temporary root before removal and keep Windows deletion
   entirely in PowerShell; handle Linux fixture paths entirely in Linux. Do not terminate the whole distro
   or unrelated processes. Record temporary-root absence, process readback, disk space and WSL state.
6. Root records the Linux verdict and updates AC7 only if the entire combined process criterion is proved.
   AC2/6 stay open for Ubuntu service/platform evidence. No source or fixture result changes `deploymentReady`.

## Acceptance scope

These cases prove actual Unix socket modes/kernel peer UID, changed identity refusal, duplicate submission,
partial-input cancellation, absolute/trickle deadlines, lost ACK/status recovery after admission expiry,
process-group/grandchild reaping and the independent graceful-shutdown budget. Windows skips or a successful
interpreter import do not count as Linux passes.

No system runtime replacement, systemd/service installation, Docker startup, database/model startup,
original data or keys, real provider calls, full build, Git lifecycle or task archival is included.
Real model and populated-data acceptance remains downstream of C2 isolated deployment and C3 wiring.
