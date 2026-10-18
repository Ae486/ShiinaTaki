# C2a first actual Docker attempt

Date: 2026-10-15 (Asia/Shanghai). Case: `fa25c42b-1dbc-4f15-bc50-224bca0b03a1`.
**The complete admitted case failed before deployment admission.** Retain this result when a corrected
fixture is executed. No production source or accepted 182-case source result changed.

## Observed results

- Fixed engine, built-in builder, cached base, binaries and fixture inputs matched their pins.
- The actual cached-base probe passed: Python 3.11.16, python-dotenv 1.2.2, UID/GID 1000, the expected
  venv, an empty owned data seed and effective dotenv suppression. The probe container was removed.
- One local fixture image build passed in 4.263 seconds using the cached base. The context was 57.24 kB;
  no dependency installation or image pull command ran. The retained log contains the non-blocking
  `InvalidDefaultArgInFrom` warning; the required `NATIVE_IMAGE` argument was explicitly supplied.
- The existing tiny fake-key adapter compiled with installed Rust/MSVC; no Cargo target or H: build output.
- The guarded launcher failed at `core-shell-operator` in 44.703 seconds including process startup.
  It did not reach the deployment start request, create a deployment container/volume or deliver values
  to the Native consumer. The provisional C: tree held 825 files / 102,753,595 bytes, within its limit.

## Confirmed fixture defect and next action

The task launcher omitted `TAKI_GATE_AUTOAPPROVE: "allow-once"` from its isolated debug Shell child.
The accepted installed fixture supplies it at
`apps/hindsight-host/test-fixtures/deployment-installed-fixture.ts:55`; the debug binary requires it at
`apps/desktop/src-tauri/src/bin/taki-node.rs:57` before assembling a Node or creating its state directories.
Root reproduced the omission with the actual pinned binary: exit 2 and
`TAKI_GATE_AUTOAPPROVE is required`; no files, Core or Docker resources were created by this minimized probe.

The original xhigh reviewer owns the one-setting correction and a fresh single-use fixture token,
`8378a950-87c8-44e3-a909-d213a284f113`. Actual Core Run/deployment IDs remain Core-generated. This is a
reviewed correction after a known pre-admission failure, not replay of an uncertain resource operation.
Reuse the unchanged valid base-probe evidence after rechecking the pinned base/engine. Keep the original
case marker, reports and reviewed source snapshot intact in the archive; do not reset or overwrite them.

## Cleanup and unrelated environment

The tested launcher stopped/reaped its two test processes and removed the protected C: tree and uniquely
labelled image tag. Root independently verified their absence and that all seven original container IDs,
states, start times and restart counts matched this attempt's before-state. `redis` and `arboris-app`
were running. The earlier `gpt-load` container was already absent from the inventory before this attempt's
first Docker mutation; it was neither restored nor changed by this test.

Root preserved and hash-verified 42 files, then removed the exact marked G: staging tree (1,623,326
logical bytes). Two rebuildable binary outputs are represented by hashes rather than retained copies.
The [archive](c2a-docker-first-attempt-evidence.zip) is 56,397 bytes, SHA-256
`b6564758888abd09bf8c4e3614e85cae8bf925a4dbd02bdc4c05ee93856da001`.
The [preservation record](c2a-docker-first-attempt-preservation.json) contains every retained/excluded
file hash and final free-space observations. Build-cache/VHDX reclamation is not claimed.

Real Native consumer/no-TTY/socket/duplicate-observation proof remains unexecuted at this checkpoint.
The broader Docker fault/restart matrix, database, C1 service AC2/6, C2b and real-model/data gates stay open.
