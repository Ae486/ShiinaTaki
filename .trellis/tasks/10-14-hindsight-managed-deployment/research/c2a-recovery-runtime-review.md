# C2a recovery R2 independent runtime review

Date: 2026-10-15. Reviewer: `/root/c2_design_check`.

**PASS for this bounded actual recovery case.** Launcher exit **0** in **117.079 seconds**;
fixture elapsed **116.348 seconds**. `casePassed`, `ownedRuntimeCleanup` and
`protectedTreeScannedAfterStop` are true. `deploymentReady` remains false.

No rerun, additional Docker query, source change or R1 edit was performed.

## Findings (fixed)

None required during this runtime review. The previously reviewed scan-order repair completed
successfully: all owned process/helper lifetimes ended before the unchanged full local scan.

## Findings (not fixed)

None within the executed scope. The broader recovery/database criteria listed below remain open.

## Decisive facts

| Contract | Independent evidence assessment |
| --- | --- |
| Reviewed inputs | All seven `reviewed-fixture/` copies match `prepared-inputs.json` and the accepted R2 hashes. Runtime launcher SHA-256 is `869146af78a9cde99cf70af2c857049548c3c097aedd09f63c95d779c8d11017`. |
| Exact outer reply loss | One matching Host inject completion was dropped. Its request/control equals the original registry entry. Public status is `outcome-unknown`; original Run/Attempt stays `outcome_unknown` before interruption, after reopen and after fresh resume. |
| Original resource recovery | Native child **PID 49 / start ticks 765911** remains identical across Core/Shell/helper termination and persisted-state reopen. The replacement helper has a new verified process identity. Original plan/resources/steps and the first three attempts remain unchanged. |
| One container restart | One new waiting startup has no bound old authority or child. The original volume marker survives, the tmpfs marker disappears, and the original child marker is stopped. |
| Explicit fresh resume | Startup `ab643a72-373b-4533-a1bd-3110a12044b4` receives new Run/Attempt/Effect/request/checkpoint/authorization/C1 identities. New child **PID 86 / start ticks 770538** runs. Catalog/configuration facts remain stable; repeated calls preserve original effect history. |
| Effect evidence | Retained resource windows contain **1 container create, 1 volume create, 2 starts, 1 restart and 2 submitters**. All **19** retained exec records have the original CID, no TTY, exit 0 and `Running=false`. Probe/control exec counts are not grant counts. |
| Complete scan | After process reaping, the full protected-tree scan passed: **827 files / 103,461,077 bytes / 0 hits**. The required after-stop flag is true; all other retained sentinel scans also report zero hits. |
| Owned cleanup | Root's independent readback at `2026-10-15T10:47:08.776Z` passes all seven checks. Raw command outputs confirm the exact CID/volume/tag absent and all six tracked process IDs absent. The original seven container IDs/statuses/start times/restart policies equal the pre-run baseline. |

Deployment: `6b0cd1fc-c3a5-409c-90cf-edf60132b553`.
CID: `471463f70caae62d43cb9d7aee396832e0eb6fd7b715d27d6a2300f9134a6b92`.
New startup Run: `ce542ff1-8fb3-49ff-8f2a-e8747f5bdc85`.
The exact derived comparisons and remaining safe identities are in
[the JSON review](c2a-recovery-runtime-review.json).

## Evidence and boundaries

Evidence root:
`G:/TakiAgent-c2a-docker-acceptance/recovery-775da07b-2b69-44a3-868c-2604423dac11`.

| Input | SHA-256 |
| --- | --- |
| `recovery.json` | `c4505082e2b777692cd521b5e38fa3c0c79f464dec963b31e7b9a3de57c2b1f8` |
| `launcher-command.json` | `6b332957a46c0d0c24fe0b735a512de42cbf3406b757de66ef9354c0226dcda8` |
| `prepared-inputs.json` | `eeae9b9f85bae894962023dad5c516ec6b0f04eb40c306923dac1d7f7ff04101` |
| `commands.jsonl` | `d2f9aab83faf44f1b965959279723b3c1ce3c095bb4019b30a71c0993ec6a709` |
| `root-post-run-readback.json` | `f69b2c4e69223e864a632f34de4c573ebef3e089ea4b33e079e25411830411e4` |
| `original-before-containers.json` | `c4667b5486b3ab64f761f6393845248518f4178026d162173d4e4d269d8fc079` |

The retained event windows begin at `2026-10-15T10:36:02.644Z`; the before-restart cutoff is
`10:37:03.805Z`, and the final cutoff is `10:37:26.074Z`. Counts apply to those records and
their captured exec metadata, not an exhaustive later-probe/daemon transcript. Persisted-file and
duplicate-call equalities also rely on completed assertions in the hash-bound executed launcher;
not every intermediate reply/hash was separately exported.

This case proves **outer Host completion loss and the controlled original-container restart**
with a fixed fake consumer. It does not prove inner Native ACK loss, inner create/start/submit
faults, custody rotation/unavailability, daemon restart, database correctness, C1 service, C2b or
real model/business-data/manual acceptance. Filesystem markers do not mint a trusted receipt.

R1 remains FAIL in its Root-verified 72-entry archive
`c2a-recovery-first-attempt-evidence.zip`, SHA-256
`fb0d5afca5f04df4d800c25d831db49c218a2d3233a07c919f5baa55e11b795d`.
R2 does not overwrite or relabel that first failure.

## Verification and release

- Runtime evidence: **PASS within the stated scope**, independently recomputed from existing records.
- Lint / TypeCheck: accepted R2 static PASS reused; no source changed or check reran.
- Additional tests / Docker / WSL / builds: **not run** by this reviewer.
- Only this Markdown and its JSON companion were added.

Ownership is released to Root for R2 archive verification and owned staging removal. The runtime
resources are already confirmed absent; the retained G: evidence is not yet claimed archived or
removed by this review. Root may close this bounded recovery slice and proceed to the already
reviewed database prerequisite after preserving R2. Broader task criteria remain open.

