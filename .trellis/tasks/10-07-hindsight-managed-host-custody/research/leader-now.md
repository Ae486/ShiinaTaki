# C1 source and Linux process accepted; service/platform gates remain open

Current authority (2026-10-14): the owner authorized continuation beyond accepted Stage 5B, C1 source work,
isolated fake-credential verification and the bounded temporary G: Python environment for Linux tests.
Independent C1a/C1b SOURCE reviews pass, and the subsequent actual Linux run passes **8/8** with owned
cleanup complete. No unresolved source finding remains. The task stays `in_progress` for Ubuntu
service/platform criteria 2 and 6; installer, Docker, real-model and manual acceptance remain separate.

Later continuation (2026-10-14): the owner approved a separate C2 task and the C1a Ubuntu read-only preflight.
The [preflight](c1a-ubuntu-preflight-2026-10-14.md) found PID1 systemd, version 249.11-0ubuntu3.22 and no
`/usr/bin/systemd-creds`; it stopped without installation/service/credential effects. AC2/6 await a compatible
environment. This does not block C2 source work. Root's current session target is now
`10-14-hindsight-managed-deployment`, still in progress after C2a SOURCE PASS. All six source criteria pass;
independent checks pass 182 tests with four older C1 fixtures ignored. Source/check ownership is released,
and Root preserved task-only patches/evidence before completing owned staging cleanup. The owner approved
Docker Desktop startup and read-only preflight after cleanup; it passed with a Linux engine/cached Native
candidate and three unrelated running containers left untouched. Actual Docker consumer/database acceptance
and this C1 service/platform acceptance remain separate. Read the C2 sibling's `research/leader-now.md`.

The [Linux check report](c1b-linux-check-2026-10-14.md) and its JSON evidence retain three complete runs,
two timing probes, the test-only corrections and final cleanup. Root matched all 34 released inputs:
32 retain their prior hashes; only the Linux test and Native README changed. Production code/limits did not.
The temporary runtime and all 26 suite/probe directories are gone, with no owned process left. H: has
14,312,681,472 bytes (13.33 GiB) free; Ubuntu-22.04 and docker-desktop were observed naturally stopped.
Do not repeat the completed cleanup or unchanged accepted checks.

## Workspace and released ownership

- This C1 task remains `.trellis/tasks/10-07-hindsight-managed-host-custody`, `in_progress` for AC2/6.
- The session `codex_01a1309f-e374-7241-ab38-4e50f040d985` now targets the authorized C2 sibling
  `.trellis/tasks/10-14-hindsight-managed-deployment`; do not create a replacement C1 task.
- Taki: `H:/TakiAgent`, `main`, HEAD `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
- Native: `H:/hindsight`, `main`, HEAD `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.
- Core migration is 059; Native migration is e62a3d0b9c54 and build is
  `taki-memory-hindsight-0.9.0-template-backup-v1`. C1 adds no migration or ordinary API/SDK change.
- `c1a_implement` and `c1a_check`, both `xhigh`, explicitly released SOURCE + CHECK SLOT. No agent owns
  an active source/check task. `native_independent` also finished its earlier Windows support assignment.
- The historical agents are not attached to the current team. The new `c1b_linux_check` used `high` effort,
  finished the approved runtime/test/cleanup assignment and explicitly released SOURCE + CHECK SLOT.
  It also completed/released the later C1a read-only preflight; no service fixture was created.
- Root owns task/spec/AC/handoff updates. Do not redispatch C1a/C1b source implementation or repeat cleanup.
  Reuse existing agents when still available; otherwise create one scoped high/xhigh checker, without nested
  duplication. The 2026-10-14 temporary-runtime permission applies only to its recorded plan.

## Accepted evidence

Read `research/c1a-independent-review-2026-10-13.md` and `research/c1b-independent-review-2026-10-13.md` first.

- C1a fixed actual Windows Catalog owner/DACL/path/file-identity checks and Rust/Shared optional-null parity.
  Catalog leaf reads close immediately; retained immediate Catalog directory guards allow READ|WRITE sharing
  but deny DELETE. Immutable installed-file locks remain unchanged. Actual publication and rename tests pass.
- Independent C1a results: Windows 10/10, Shared golden 91/91, Rust golden 1/1, affected types, root lint,
  strict all-target Clippy and copied-install readback pass. The 794-entry/795-file copied payload and actual
  Core main/WS/Tauri resource-map evidence remain valid for their recorded scope. Unchanged suites were reused.
- C1b fixed admission expiry hiding a running process's original status. Running observation now gets its own
  bounded I/O window; pre-start admission and the one-use fence still use the original grant. A real-expiry
  handler regression failed before the fix and passed after it. Its socket/peer substitutes are not Linux proof.
- Independent C1b results: **24 Native Windows PASS** (14 protocol/admission/handler + 10 actual subprocesses),
  **20 fake-observer PASS**, scoped Ruff/format/all-platform static ty, Host types/ESLint and diff checks pass.
  Its 2026-10-13 run skipped eight Linux cases. The 17-record independent log retains the initial red regression.
- Subsequent Linux results (2026-10-14): **8 PASS / 0 FAIL / 0 SKIP**, exit 0, 69.093 seconds. Measured DrvFS
  imports required test-only startup/positive-case budget corrections; the initial 2/6 and intermediate 5/3
  pass/fail runs remain recorded. One-second expiry, half-second trickle, cancellation, exact identities and
  the independent 30-second production grace are preserved. Scoped Ruff/format/all-platform ty pass.
- Root matched all **34 final C1b inputs** against the independent manifest, whose SHA-256 is
  `f69ca93f675bf3513ef687952c357c0be0004a305e1ff46ecc91c21d12033c17`. Four Native files changed in review.
  C1a retains **124 of 128 identical hashes**; only its two Host README/index additions and Root's two
  custody-spec/index updates differ. No C1a code changed. The original C1b self-check manifest is historical.
- The 2026-10-13 Root evidence is `research/c1b-root-final-readback.json`. It records the 17-check log, original
  repository/task identities, empty fixture readback and final documentation pins. Both 19-entry context
  manifests validate. No Source/fixture PASS is a trusted deployment receipt.
- Latest Linux evidence: `research/c1b-linux-check-evidence-2026-10-14.json`, SHA-256
  `b49dd5092f6e63c13f48514d797f72fb3622c1172cded852fd3981b7e3063146`. Root verified this file, its report
  and the final source hashes after the checker released ownership. Prior evidence remains unchanged.

PRD automatic source/fake-contract criteria **1, 3, 4, 5, 7, 8, 9 and 10** are checked. Combined platform criteria
**2 and 6** stay open. Manual/original-environment acceptance remains unconfirmed.

## Linux attempt and remaining platform proof

The owner allowed starting existing Ubuntu-22.04 solely for isolated C1b tests with existing dependencies.
The reviewer performed only prerequisite discovery: Ubuntu 22.04.5 / WSL2 6.6.87.2, UID/EUID 0,
`/usr/bin/python3` 3.10.12, no python-dotenv, no Python 3.11+ on PATH, no Native Linux `.venv/bin/python`,
and no uv. AF_UNIX/SO_PEERCRED/killpg/proc-fd support exists, but the Python prerequisites are missing.

That first attempt stopped without installing a runtime/dependency or creating a Linux fixture. On 2026-10-14
the owner separately approved the [temporary-runtime plan](c1b-linux-runtime-plan-2026-10-14.md). Its
CPython 3.11.17 and locked python-dotenv 1.2.2 ran all eight Linux cases successfully from G:. The exact
temporary root used 113,112,994 bytes before removal, below the 512 MiB cap. System Python remains 3.10.12
without dotenv. The final readback confirms both distros stopped without termination. This permission did
not include systemd/credential-service, Docker or original-data/model work.

In an appropriate existing or separately authorized Linux Python >=3.11 + python-dotenv environment, run:

```bash
python3 -B -m unittest discover -s docker/standalone/tests -p test_managed_bootstrap_linux.py -v
```

The eight passed cases cover actual socket modes/kernel peer UID, changed identity, absolute/trickle deadlines,
partial-input cancellation, lost ACK and original status after admission expiry, process-group/grandchild
reaping and the independent 30-second graceful budget. A static platform target or Windows skip cannot accept
these cases. No repeat is needed for unchanged inputs. Actual C1a Ubuntu service credentials and final Windows
installer/keyring acceptance are separate. Prepare a concrete environment plan before requesting those effects.

## Frozen C1 boundary and next stages

Native bootstrap remains boot-free, with an independent code-owned LiveGrant, strict u32-LE/UTF-8/EOF framing,
4 MiB private input, seven fixed slots, original startup/config/operation/fresh-attempt/deadline binding,
16 KiB safe status, disabled dotenv and controlled child output. The production consumer is not wired.

The seven `TAKI_C1B_FAKE_*` names are test-only; Native embedding/reranker require actual provider-specific
mapping later. Do not invent generic provider variables or expose caller commands/env maps. The fake observer
is not imported by `main.ts`; the builder's reachable-import traversal excludes it from the installed payload.

C2a owns the durable real-resource registry, Docker observer and actual isolated no-TTY delivery, inspect/
config/log/file, container/daemon restart, fresh tmpfs and database-shutdown proof before real delivery or
trusted receipts. C2b consumes accepted ledger references. C3/C4/5D own actual model and populated-data/candidate
acceptance. Real wrapper/provider/installed-observer wiring remains C2/C3. `deploymentReady` stays false.

Next work must respect these platform/environment gates. Original data/keys/services, real models, further runtime/
service installation, Docker startup and Git lifecycle (commit/push/reset/rebase/finish/archive) remain excluded
unless separately authorized. Preserve prior 5A/5B evidence; no broad provider matrix or generic broker/framework.

## Storage and check discipline

`research/storage-cleanup-2026-10-13.md` records **14.998 GiB reclaimed** before development resumed, with four
Git states and T4 evidence preserved. The latest H: readback is **14,312,681,472 bytes / about 13.33 GiB free**.
The independent copied C1a fixture is absent; no C1b temporary runtime/directory or owned fixture process remains.

Use one heavy check at a time, at most two Vitest workers and one Rust target per repository. Retain the reused
target and T4 evidence. Future necessary Rust commands use dev/test debug 0 and incremental 0 while preserving
debug assertions. Native scoped existing Ruff/format/ty checks are the approved serial equivalent to its broad
mutating/syncing lint script. Do not repeat unchanged full Core/SDK/build gates without a concrete reason.
