# C2a recovery first-attempt diagnosis

Date: 2026-10-15. Reviewer: `/root/c2_design_check`.

**The first attempt remains FAIL. The identified defect is in the task fixture's live local-file
scan, not the production resource lock or an established duplicate deployment/credential effect.**

Launcher exit: **1**, outer elapsed **98.478 seconds**; fixture elapsed **97.126 seconds**.
`failureStage=final-effect-and-containment-check`, `ownedRuntimeCleanup=true`,
`deploymentReady=false`. This report does not edit or reinterpret `casePassed=false`.

## Exact failure localization

The consumed launcher has SHA-256
`f7c907eda8a156da8ca20be9d199c2d6ac5eb35ac84b01625ace6a50f608493e`.

`recoveryCase` executes the final `inspectExecs` at line 535, `scanTree()` at line 536,
then assigns `report.effectCounts` at line 537. The retained JSON contains `finalEngineEvents`
and the updated 19-entry `execEvidence`, assigned at the end of `inspectExecs` after its
assertions, but no `effectCounts`. The failure is therefore **the line-536 scanTree call**.
It is not one of the final event-count or exec-metadata assertions.

The scan's `readFileSync(path)` at line 580 includes
`R/state/deployment.lock` while the replacement Shell remains live.
`hindsight_windows/objects.rs:134-147` opens that leaf for reading with **share mode 0**.
`hindsight_windows/deployment.rs:19-51` retains its handle for the complete resource-owner lifetime.
Another data read of the same leaf conflicts with that intentional Windows exclusive lock.
This is a definite sequencing defect in the new fixture; weakening production sharing would
break the intended ownership boundary.

Cleanup follows the compatible order: lines 591-593 reap all recorded process owners/helpers,
then line 628 runs the same complete scanner before removing R. That scan succeeded over
**827 files / 103,461,077 bytes, zero sentinel hits**, and R was removed.

The original catch at line 681 discards the exception. Consequently, the failed call and the
inevitable active-lock conflict are identified from control flow and source, but the original
earliest failing leaf, errno and stack were **not captured**. No exact EBUSY/EPERM message or
kernel trace is claimed. The earlier static PASS missed this scanner/lifetime-lock interaction;
retain that historical review as a consumed input rather than rewriting it.

## Findings (fixed)

None. This assignment permits diagnosis and these reports only; no fixture, production code,
task metadata or raw evidence was changed.

## Findings (not fixed)

- File: `docker-recovery/run-recovery.ts:536`
- Issue: A full local content scan runs before the live Shell releases its exclusive deployment lock.
- Minimal correction: After Root hands off ownership, remove this redundant live scan. Keep the
  existing mandatory complete scan after process/helper reaping and before R removal. Keep the
  lock exclusive, retain all scan assertions, and continue failing on cleanup/scan errors.
- Status: Awaiting the separately assigned correction. No rerun or new resource was started.

## What the preceding assertions established

These are scoped findings from the failed run, not aggregate acceptance.

| Check | Retained evidence and assessment |
| --- | --- |
| Exact outer Host completion loss | One matching inject completion was held/dropped. Its request ID and complete control equal the original registry injection. Core returned public `outcome-unknown`; original Run/Attempt remained `outcome_unknown` before interruption, after reopen and after the new startup. |
| Original child survives Host/Core interruption | Original Native child **PID 49 / start ticks 646886**, startup `2f4a80ec-2548-414e-9198-e187de1991b3`, is identical before termination, after termination and after reopen. |
| Real process replacement and persisted inputs | Original Core/Shell/helper IDs **40492 / 27940 / 9560** were replaced by **41580 / 38976 / 27464**. Helper creation identities and fixed executable/argv checks passed. The persisted-file equality check and direct new-Core/token connection completed. |
| One original-resource restart | Captured events show one container create, one volume create, **two starts and one restart**, all for the original CID/volume. The restart yielded startup `96047de8-b418-4978-ae82-1e3d49235c41`, unbound/waiting with no child and the old child marker stopped. |
| Filesystem markers | Both seeded markers had SHA-256 `eb605de43add7bc273b70a0ab44ae893bcacd60616d88d06d7359df0419c255f`. The volume marker remained, and the tmpfs marker disappeared. This establishes filesystem behavior only. |
| Explicit fresh resume | New Run `81ccfff0-bdbd-4ff1-95a7-3fab0b6bc8fb` completed with the expected startup idempotency key. New child **PID 85 / start ticks 650795** ran under the new startup. Host request/checkpoint/authorization, Run/Attempt/Effect and C1 snapshot/boot/mapping identities changed as required; Catalog/configuration facts stayed stable. |
| Original history and duplicate calls | The original three attempts/steps/plan/container/volume remain identical; one new observed inject entry was appended. Registry revision changed from 13 to 24, which is permitted. The repeated original start and repeated resume equality checks completed without an additional registry attempt. Intermediate duplicate replies/pins are established by the consumed source's completed assertions, not separately retained full raw transcripts. |
| Captured exec metadata | **19 distinct** retained exec records have exit 0, `Running=false`, `tty=false`, stdin open and the original CID. Exactly **two captured submitter execs** have IDs `c284b5a490af5aca34f30ac0db4e5acbee0502aecb2f34f6c4a3866ab16ee105` and `82d256937fad9bd276330ecaed48d9eaa62ba4467f13879641c5485632719a82`. Probe/control records are not grant counts. |
| Containment and cleanup | All retained public/status/registry/probe/metadata/log scans report zero sentinel hits. The failed live local scan was incomplete; the successful local scan is the later post-reap cleanup result. Root independently verified the exact owned resources and tracked processes absent, with the original seven containers unchanged. |

Original deployment: `08143c21-4b1a-4c71-96aa-ddccd20ed0fb`.
CID: `75579434fd5b0d0da4f5409848db7152143bd63b76c9f34f57fef75c6c159d11`.
Original volume: `taki-c2a-08143c21-4b1a-4c71-96aa-ddccd20ed0fb-data`.

The event counts are bounded to the retained windows: before-restart until
`2026-10-15T10:15:30.641Z`, final until `2026-10-15T10:15:48.895Z`, both since
`2026-10-15T10:14:42.531Z`. They are not an exhaustive transcript of every later probe or
cleanup exec, and no later Engine query was made by this reviewer. The available facts do not
establish a product duplication or credential-containment defect.

## Evidence bindings and next action

Evidence root:
`G:/TakiAgent-c2a-docker-acceptance/recovery-f217a02f-f8a5-466f-ab59-0e97940debe0`.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `recovery.json` | 182384 | `22075fc1db3122b682056be6c99dedfb237d606e9ffefbcb46e24ff0c79d3551` |
| `launcher-command.json` | 757 | `c58d0d76cac1f9d9976c4b5484ec81570932a3c91a7ad88f6f680110606e021c` |
| `commands.jsonl` | 20294 | `94821254e0853eb0eb6c4db94e09f0a724b42c67f62b8667e517a23c0cd59c80` |
| `prepared-inputs.json` | 3566 | `dd759c1ca2f9ad04a78f0da635573fd882ace5530c91cc88f3040c4071bdb974` |
| `root-post-run-readback.json` | 2759 | `c70b7f208b69480d16b4e23545d8e2ea36da119613dc0ff311b9ee4c233626da` |

Root's readback at `2026-10-15T10:20:05.882Z` confirms the pinned engine, the original seven
container IDs/states/start times/restart policies, and absence of the owned CID, volume, tag,
protected C: root and six tracked process IDs. Root owns final freezing/archive/staging cleanup;
this reviewer did not delete or change G: staging.

Freeze this first failure and its inputs, apply only the separately assigned scan-order correction,
then review the changed fixture and relevant static checks. A later complete case, if Root runs
one, must use its separately frozen fresh token. No additional production fix, generic defense,
framework, broader test matrix or rerun is justified by this diagnosis.

## Verification

- Read-only comparison of the retained identities, first three registry attempts, freshness/stability
  fields, event counts, exec records and zero-hit scans: **PASS** within the limits above.
- Lint / TypeCheck: **not rerun**, no executable file changed.
- Tests / Docker / WSL / application / fixture / build / Git lifecycle: **not run** by this reviewer.
- First attempt: **FAIL remains unchanged**. Inner Native ACK loss, other effect-loss points,
  daemon restart, custody rotation, database, C1 service, C2b and manual acceptance remain separate.

See [the concise machine-readable diagnosis](c2a-recovery-first-attempt.json) for derived checks.

