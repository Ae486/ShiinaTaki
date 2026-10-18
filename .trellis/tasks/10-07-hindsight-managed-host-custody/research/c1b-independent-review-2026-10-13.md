# C1b and complete C1 foundation independent review — 2026-10-13

## Verdict

**PASS for the C1b SOURCE and permitted Windows process gate.** The complete C1 foundation's source-level
review is also complete, reusing the accepted, unchanged C1a code/evidence. One concrete C1b finding was
reproduced, fixed, and covered by a passing regression. No unresolved source finding remains.

**Linux process execution remains pending.** The owner explicitly authorized starting the existing Ubuntu
environment for isolated C1b tests with existing dependencies. Actual prerequisite readback found Python
3.10.12 and no python-dotenv, so no Linux test ran and no dependency/runtime was installed. This is a source
verdict with recorded platform limits, not whole-C1 deployment, service, installer, Docker, or model acceptance.
Every public result still has `deploymentReady: false`.

Workspace heads remain:

- Taki: `H:/TakiAgent`, `main`, `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
- Native: `H:/hindsight`, `main`, `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.

The implementer explicitly released SOURCE and CHECK SLOT before this review. The reviewer worked directly,
without nested agents. Existing 5A/5B/C1a work was preserved. Root retained PRD/design/spec/leader/HANDOFF
ownership and made its own documentation updates. No Git lifecycle or archival action ran.

## Finding fixed: admission expiry hid a running process's original status

Files:

- `H:/hindsight/docker/standalone/managed_bootstrap/unix_socket.py`.
- `H:/hindsight/docker/standalone/tests/test_managed_bootstrap_protocol.py`.
- `H:/hindsight/docker/standalone/tests/test_managed_bootstrap_linux.py`.
- The local `managed_bootstrap/README.md`.

The real flow confirmed Root's queued observation. `Bootstrap.status()` correctly retained a running child
and its original binding after grant expiry. However, `_serve_connection` always derived the entire exchange
deadline from `bootstrap.remaining()`. Once that value reached zero, `socket_deadline` refused before sending
the initial status and the final deadline check returned without sending any frame. The original process
could remain alive while a later observer could no longer recover its status after a lost acknowledgement.

The independent regression used a real expiring `LiveGrant` and the actual exchange handler. Before the fix,
it failed with **zero calls to send the status frame**. Its socket and peer check are explicit test doubles;
this Windows-executable handler test does not claim Linux kernel evidence.

The correction takes the initial status once. A running child gets a fresh, bounded per-exchange I/O window;
pre-start input remains bounded by the original admission deadline. The existing `accept()` consumption fence
still rejects reinjection. No grant is renewed, credential refreshed, or process restarted. The regression now
observes the original running binding after expiry and confirms one consumption only.

A separate Linux process regression drops the original ACK, waits past admission expiry, reads the same
running binding, and verifies refusal of repeat submission. It is prepared but **unexecuted** with the other
Linux cases. The local README now distinguishes the two deadlines and records eight pending Linux tests.
Root's custody spec already expresses this same frozen admission-versus-observation rule.

## Reviewed boundaries

- **Private protocol:** one u32 LE length, strict UTF-8 JSON, 4 MiB cap and exact EOF; unique keys and fixed slots;
  supported inheritance only; bounded UTF-16/UTF-8 values; invalid scalars and NUL refuse. Structured parsing
  produces typed dataclasses, with credential values excluded from representations.
- **Authority:** a frame never installs its own `LiveGrant` or consumer. The independently supplied grant binds
  startup/config/original operation/attempt/authorization/deadline and exact ordered selection. Wall and
  monotonic checks govern admission. The attempt is fenced before any possible process effect.
- **Lifetime and failure:** duplicate submission, spawn uncertainty, late invalidation and lost ACK do not reopen
  the attempt. Running processes retain their credentials through expiry/rotation; future startup needs new
  authority. The Linux source retains the separate 30-second graceful TERM budget and subsequent reaping.
- **No secret channel expansion:** the only non-fixture CLI uses the fixed Linux socket without command/path/env
  options or a production TCP/pipe fallback. Safe statuses have closed reasons and original or nil/zero
  placeholder identities. Child stdio is DEVNULL, the environment is rebuilt, and dotenv is disabled.
- **Evidence limits:** the actual Native dotenv entrypoint helper is exercised by AST extraction in the fixed fake
  child, without importing the eager `hindsight_api` initializer/engine. The seven `TAKI_C1B_FAKE_*` variables
  are only fixture names. Real wrapper/provider environment mapping and model application are not established.
- **Observer:** the internal fake adapter can inspect/authorize/submit the original resource only. Its state
  machine fences dispatch, rechecks authority, bounds waits, preserves consumed IDs, recovers exact original
  attempts, and requests fresh attempts for new startup identities. It has no create/delete/real Docker adapter.
- **Packaging:** `main.ts` has no observer import. `scripts/build.ts` starts at `main.ts` and recursively compiles
  only reached imports. The unconnected prototype is therefore absent from the installed payload; unchanged
  C1a artifacts did not need rebuilding.
- **C1a continuity:** Shared/Rust parity, sole-writer TSC1, owner snapshots, final broker acceptance, Windows
  Catalog checks/rename compatibility, installed artifact protections and existing-instance operation retain
  their accepted code hashes. Their recorded tests and copied-install/Core-boot evidence were reused.

## Independent verification

The [17-record command log](./c1b-independent-check-log.json) retains the initial red regression and its
repaired complete suite, exact commands/exits, runtime readbacks and scoped static checks. Cleanup has a
separate exact command/result in its evidence file. Heavy checks ran serially; Vitest used one worker.
The existing Native Ruff/format/ty commands are the accepted scoped equivalent to the repository-wide
`lint.sh`, which would synchronize dependencies and run broad mutating jobs.

| Check | Actual result |
| --- | --- |
| Native Windows suite | 32 discovered: **24 PASS**, **8 Linux SKIP** |
| Protocol/admission/handler portion | **14 PASS**, including the repaired real-expiry handler regression |
| Real Windows anonymous-pipe subprocess portion | **10 PASS**, including seven slots, dotenv/argv/output/file checks, helper loss, lifetime and owned leaf exit |
| Fake observer Vitest | **20 PASS** |
| Native scoped Ruff and format check | PASS; 14 Python files formatted |
| Native scoped `ty --python-platform all` | PASS; static evidence only |
| Host typecheck and scoped ESLint | PASS |
| Native scoped / Taki tracked diff whitespace | PASS |
| Ubuntu prerequisite readback | Completed; requirements absent, so runtime tests did not start |
| Owned fixture/process cleanup readback | No residual test directories or matching fixture processes |

No full Core, Shared, Rust, SDK, copied-payload, service, provider or Docker gate was repeated for unchanged
inputs. The accepted C1a [independent report](./c1a-independent-review-2026-10-13.md) and its evidence remain
the source for those results; the implementation's [21-record C1b log](./c1b-check-log.json) retains its own
earlier failures and repairs. Those historical runs are not represented as new independent executions.

## PRD acceptance criteria mapped to evidence

The numbering below follows the existing PRD checkbox order. “Automated-pass” is a recommendation to Root
for the described automatic C1 criterion, not permission to mark a manual/environment gate passed. This
review did not change any PRD checkbox.

| AC | Criterion and actual evidence | Recommended status |
| --- | --- | --- |
| 1 | Outside-checkout compiled helper and pinned dependencies; actual Windows copied install, 794 manifest entries/795 files, tampered/missing runtime/adapter/dependencies refuse; Tauri resource-map build recorded in C1a. | **Automated-pass.** Final MSI/NSIS installation remains separate. |
| 2 | Actual Windows SID/DACL/NTFS/path/file-ID/parent-lock checks and same-byte replacement regression pass. Ubuntu effective-user/service-credential execution has not run. | **Partial / platform pending.** Do not check the combined Windows-and-Ubuntu criterion yet. |
| 3 | Fixed admitted Catalog/slots, unchanged TSC1, sole Core writer, get-only fake adapter, missing/locked/tampered/wrong-store/key refusal are covered by accepted C1a codec/Host/copied-install evidence. | **Automated-pass for the fake-credential contract.** Real OS keyring round-trip is not claimed. |
| 4 | Core successful-publication revision, same-millisecond/restore ABA, config/Host/policy/boot/installation post-await validation and current Catalog identity are covered by accepted C1a owner/broker/Windows tests. | **Automated-pass.** Stale attempts cannot silently refresh credentials. |
| 5 | Actual paired Core WebSocket Host route, final settled-effect provenance, one-use owner handles, forged/operator/diagnostic/replayed result refusal are accepted C1a evidence. | **Automated-pass.** No deployment receipt authority is created. |
| 6 | Shared/Rust strict protocol and missing-helper existing-instance paths pass; Windows installed invocation is real. Ubuntu release registration/service-custody path has source/build evidence only. | **Partial / Ubuntu service pending.** C1b process permission did not authorize that service gate. |
| 7 | 14 protocol/admission/handler and 10 real Windows process tests pass. Eight Linux cases cover actual Unix peer/modes, partial/trickle I/O, lost ACK after expiry, group/grandchild reaping and independent grace, but could not execute. | **Partial / Linux process pending.** Windows leaf proof is not process-group proof. |
| 8 | All Shared/Rust/Native/observer statuses retain `deploymentReady: false`; no real registry/Docker adapter or receipt producer is connected. Process fixtures cannot grant Docker readiness. | **Automated-pass for the refusal boundary.** C2a Docker proof remains unexecuted. |
| 9 | Twenty fake-observer tests cover original IDs, unknown outcomes, locked/stale authority, fresh attempts, single-flight waits and no replay/create. All provider inputs remain fake. | **Automated-pass for the explicit C1 fake-adapter contract.** Installed observer/durable resource lifecycle remains C2. |
| 10 | Independent C1a and C1b source/security/packaging reviews pass within recorded Windows/source scope, with original-environment and platform gaps explicit. | **Automated source-review pass.** This does not complete overall platform/manual acceptance. |

The whole C1 task remains in progress while the combined platform criteria are open. Source-level acceptance
does not mean the installed restart observer, real provider startup, C2 registry/Docker resource orchestration,
or C3 model apply/readback has been implemented or accepted.

## Runtime, source and cleanup evidence

[Runtime evidence](./c1b-independent-runtime-evidence.json) records:

- Windows: `H:/hindsight/.venv/Scripts/python.exe`, Python **3.11.5**, python-dotenv **1.2.2**; AF_UNIX absent.
- Authorized Ubuntu: **22.04.5 LTS**, WSL kernel **6.6.87.2-microsoft-standard-WSL2**, UID/EUID **0**,
  `/usr/bin/python3` **3.10.12**; python-dotenv unavailable. AF_UNIX/SO_PEERCRED/killpg/proc-fd exist.
- No Python 3.11/3.12/3.13/3.14 command, Linux project venv, or uv was found by the bounded prerequisite probe.
  No alternate container/service was started and no installation attempted.
- The only Ubuntu commands discovered the existing interpreter and read runtime metadata. No C1b fixture or
  test resource was created there. Final WSL readback showed **Ubuntu-22.04 Stopped** and
  **docker-desktop Stopped**. The reviewer did not issue distro termination or stop unrelated processes.

The [final source manifest](./c1b-independent-source-hashes.json) preserves the **34 released inputs** and
records the four Native files changed by this review. The original release-manifest SHA-256 was verified as
`29743a9e470beb0e9d69e7ff7ad1b30986ec30759339adfdc0de64280ccdb059`.
Relative to C1a's 128 inputs, **124 hashes remain identical**; the only four changes are the two accepted
C1b Host README/index additions and Root's two authorized custody-spec/index updates. No C1a code changed.

[Cleanup evidence](./c1b-independent-cleanup-evidence.json) records the actual `G:/Temp` readback:
no `taki-c1b-*` directories and no Python process using the exact owned fixture source directory remained.
Executed tests waited for their recorded owned PIDs and cleaned their temporary roots. The readback itself
deleted nothing. Cargo target/cache and original data/credentials/permissions were preserved.
H: free space at the recorded cleanup readback was **14,581,972,992 bytes**.

## Remaining gates and handoff

No source finding remains unfixed. Actual Linux runtime proof is blocked by the two recorded prerequisites:
an existing Linux Python >=3.11 and python-dotenv. Once an appropriately provisioned, authorized environment
exists, the prepared scoped command is:

```bash
python3 -B -m unittest discover -s docker/standalone/tests -p test_managed_bootstrap_linux.py -v
```

Actual C1a Ubuntu/systemd custody, final Windows installer and real keyring/manual checks are separate.
C2a still requires actual isolated Docker no-TTY delivery, inspect/config/log/file scans, container and daemon
restart, fresh tmpfs and database shutdown/readiness evidence. C2/C3 own real Native wrapper/provider/start,
durable registry and installed observer wiring. No source/process result enables those capabilities.

Code, affected checks, evidence and owned cleanup are complete. The reviewer will explicitly release
**SOURCE + CHECK SLOT** to Root with this report; Root owns final metadata/AC updates and downstream scheduling.
