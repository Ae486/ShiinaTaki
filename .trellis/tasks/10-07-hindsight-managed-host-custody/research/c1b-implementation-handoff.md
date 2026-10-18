# C1b implementation handoff

Date: 2026-10-13. Owner: `/root/c1a_implement`.

The bounded C1b implementation and its permitted Windows checks are complete for
independent SOURCE/process review. Linux runtime evidence is still unexecuted.
This is not a deployment, installed observer, Native provider-start or C2a verdict.
The worker releases **SOURCE + CHECK SLOT** with this handoff; Root owns subsequent
review scheduling, task/spec updates, platform authorization and overall status.

## Workspace and ownership

- Fixed cwd: `H:/TakiAgent`; task: `.trellis/tasks/10-07-hindsight-managed-host-custody`.
- Session: `codex_01a1309f-e374-7241-ab38-4e50f040d985`; the session binding is
  authoritative while the global `.current-task` file is empty.
- Taki: `main`, `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
- Native: `H:/hindsight`, `main`, `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.
- Scope: 14 new Native Python files, one Native README, two new Host TypeScript
  files and additions to the Host README/source index. No existing Native
  production source was edited. Root retains PRD/design/spec/leader/HANDOFF ownership.
- No dependency installation, Git lifecycle, WSL/Ubuntu startup, Docker, service,
  original data/credential access, real provider call or model access occurred.

## Changed source

| Repository | Files | Responsibility |
| --- | --- | --- |
| Native | `docker/standalone/managed_bootstrap/{__init__,protocol,bootstrap,supervision,unix_socket,submitter}.py` | Strict private protocol, independent grant, one-startup fencing, fixed Linux submitter and owned process supervision |
| Native | `docker/standalone/managed_bootstrap/README.md` | Exact limits, fake mapping and P/W/L/D evidence boundaries |
| Native | `docker/standalone/tests/test_managed_bootstrap_{protocol,process,linux}.py` | Protocol, real Windows subprocess and platform-only Linux regressions |
| Native | `docker/standalone/tests/fixtures/{fixed_consumer,pipe_bootstrap,pipe_submitter,unix_bootstrap,unix_submitter}.py` | Isolated fixed fake consumer and actual process/socket drivers |
| Taki | `apps/hindsight-host/src/restart-observer.ts` and `.test.ts` | Fake original-resource observation, independent grants, unknown recovery and no replay |
| Taki | `apps/hindsight-host/README.md`, `apps/hindsight-host/src/index.md` | Prototype discovery and explicit installed-payload boundary |

The [source hash manifest](./c1b-source-hashes.json) enumerates every owned file,
reused source/configuration inputs and the unchanged C1a baseline. It also hashes
the evidence files except itself.

## Implemented contracts

1. Private input is one strict UTF-8 JSON packet with a u32 little-endian length,
   at most 4 MiB and exact EOF. Values are bounded before encoding and after
   decoding by 65,536 UTF-16 units / 196,608 UTF-8 bytes. Duplicate keys, unexpected
   fields/slots, duplicate slots, NUL, invalid Unicode and invalid identities refuse.
   UUID nil/maximum/case behavior matches the accepted Shared boundary.
2. A frame cannot authorize itself. An independently supplied `LiveGrant` binds
   original operation/attempt/authorization, startup, config, deadline and fixed
   selection. Wall and monotonic checks preserve the original at-most-90-second
   admission budget. The bootstrap defaults to no consumer and refuses delivery.
3. The attempt is fenced before an OS effect. Failed spawn, late grant invalidation
   or lost acknowledgement cannot cause automatic reinjection. A running process
   keeps its credentials through grant expiry/Catalog rotation until its owner
   stops it. A new startup needs new validation and grant identities.
4. The only non-fixture CLI connects to the fixed Linux
   `/run/taki-hindsight/bootstrap.sock`; there is no production pipe/TCP fallback,
   command/path option or arbitrary environment map. Actual UID, modes, retained
   directory/leaf identity, absolute private I/O deadlines and stop cancellation
   are implemented. Unknown old sockets and unsafe permissions refuse.
5. Status is at most 16 KiB, uses fixed safe fields/reasons and always has
   `deploymentReady: false`. Submitter failure output uses nil/zero placeholders
   instead of reflecting rejected private-frame IDs. Raw exception/child output
   and values never become status fields.
6. The fixed **test-only** consumer maps all seven slots to `TAKI_C1B_FAKE_*` names,
   starts with a minimal environment and `DEVNULL` stdio, and verifies its real
   command line (`GetCommandLineW` on Windows, `/proc/self/cmdline` on Linux).
   The fixture exercises the actual AST-extracted `load_dotenv_for_entrypoint`
   function against an isolated poison `.env`, without importing Native's engine.
   This does not prove the real wrapper/provider startup matrix.
7. Windows tests own a real leaf process and verify exit/reaping. Linux source
   owns a session/process group and subreaper, uses TERM with an independent
   30-second graceful budget, then KILL/wait/reaping. The Linux graceful fixture
   takes 12 seconds to expose accidental shortening by private I/O timeouts.
8. `FakeRestartObserver` only receives inspect/authorize/submit adapters. It retains
   the original resource/operation/config, checks after awaits, requires fresh
   attempt/authorization IDs, fences submission and recovers unknown outcomes by
   original IDs. It has bounded/cancellable waits and single-flight reconciliation.
   Its 64-startup cap fails closed without forgetting consumed identities.

Custody locked/rotated scenarios in C1b use independent grant or fake-adapter
state; they do not reread a real Catalog or OS key store. The production C1a
custody path remains separately reviewed. The observer is not reachable from
`main.ts`; `scripts/build.ts` therefore excludes it from the installed payload.
No C1a artifact rebuild was required or performed for this unconnected file.

## Final checks and full failure history

All checks were serialized under the sole heavy-check slot. The complete 21-entry
[check log](./c1b-check-log.json) retains command, timestamps, exit code and complete
captured output, including initial failures and focused repairs.

| Final check | Result |
| --- | --- |
| Native `unittest discover`, `test_managed_bootstrap*.py`, actual Windows Python | 30 discovered: **23 PASS**, **7 Linux SKIP**; 13 protocol/admission and 10 real subprocess tests passed |
| Scoped Native Ruff | PASS |
| Scoped Native Ruff format check | PASS, 14 Python files formatted |
| Native `ty` with standalone source path and `--python-platform all` | PASS; cross-platform static evidence only |
| `pnpm --filter @taki/hindsight-host typecheck` | PASS |
| ESLint for the two observer files | PASS |
| Observer Vitest with `--maxWorkers=1` | **20 PASS** |

Earlier results are not conflated with the final run:

- The initial protocol/admission run passed 12 tests before the final UUID case.
- The first process run had one pass and eight import errors: Python `-I` excluded
  the fixture directory, so `fixed_consumer` could not import. An import-only
  minimization confirmed it. The isolated fixture import paths were made explicit.
- The next process run had eight passes and one error: the WMI command-line probe
  exceeded its four-second timeout. The fixture switched to the actual process's
  `GetCommandLineW`; that single case then passed in a focused rerun. The final
  10-case process run, including explicit owner stop, passed as a complete group.
- Initial Ruff found one import-order error; it was fixed and formatting applied.
- Initial `ty` had 14 diagnostics from the wrong source search root and Windows
  target's unavailable Linux members. The final explicit standalone search root
  and all-platform static target passed; Linux execution is not implied.
- Initial Host typecheck caught a test default UUID parameter inferred too
  narrowly. An explicit `string` parameter fixed it. Initial observer Vitest had
  19 passes; the final run includes the missing-submit-reply timeout case and has 20.

No full Core/Shared/Rust suite, SDK generation or installed-payload build was
repeated for C1b. This worker's final code checks preceded documentation-only edits.

## C1a preservation and cleanup

The accepted independent C1a manifest contains 128 inputs. Final comparison found
**126 identical hashes** and exactly two permitted documentation additions:
`apps/hindsight-host/README.md` and `apps/hindsight-host/src/index.md`. No C1a code,
platform Catalog check, Rust/Shared parity fix or custody spec changed. The full
comparison and accepted-manifest hash are embedded in the C1b source manifest.

[Cleanup evidence](./c1b-cleanup-evidence.json) records the final readback at
`2026-10-13T11:38:39.7612724Z`: no `taki-c1b-*` directories remained under the
actual `G:/Temp/` temporary root, and no Python process matched any of the five
owned fixture entrypoint names. Tests waited for exact recorded child/bootstrap
PIDs, closed streams and cleaned their marked directories. Readback performed no
additional deletion. No Linux cleanup claim is made because that suite did not run.

## Remaining review and platform gates

- Independent review of the complete C1b source/process boundary is pending.
- All seven Linux-only cases remain unexecuted: kernel UID/modes/socket path,
  changed startup/config, trickle deadline, cancellation during partial input,
  process-group/grandchild reaping and independent graceful shutdown budget.
- Root has an unanswered authorization question about starting the existing
  Ubuntu environment. This worker did not start it or infer approval from time.
- Once an existing Linux Python 3.11+ and `python-dotenv` environment is explicitly
  authorized, run from its Native checkout:

  ```bash
  python3 -B -m unittest discover -s docker/standalone/tests -p test_managed_bootstrap_linux.py -v
  ```

  The suite needs AF_UNIX, SO_PEERCRED, `/proc/self/fd`, process groups, local
  subreaper support and writable owned temporary storage. It needs no root,
  dependency installation, Docker, database, credentials or models.
- Actual Native wrapper/provider release-start wiring, the installed observer
  lifecycle and durable resource registry remain C2/C3 work. C2a still owns real
  isolated Docker no-TTY delivery, container/daemon restarts, inspect/config/log/
  file scans, fresh tmpfs and graceful database shutdown/readiness evidence.
- Supported Ubuntu/systemd custody and final Windows installer/manual acceptance
  remain distinct from this fake-process evidence. No manual AC was marked passed.

**SOURCE + CHECK SLOT RELEASE.** No worker-owned process, test or source mutation
remains active after this handoff; wait for Root's independent review scheduling.
