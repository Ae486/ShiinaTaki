# C2a recovery independent implementation review

- Reviewer: `/root/c2_design_check`
- Scope: Recovery Stage 2, task-only launcher/probe/instructions
- Decision: **PASS for Root's controlled execution**
- Runtime: **NOT RUN**; `deploymentReady: false`

## Findings (fixed)

None. No concrete implementation defect was found, and the three released fixture files are unchanged.

## Findings (not fixed)

None within the reviewed implementation scope. Actual runtime acceptance remains pending.

## Review evidence

| Contract | Static conclusion |
| --- | --- |
| Exact completion loss | `loseHostCompletion` matches the inject request ID, complete control and resource/startup tuple. The unchanged relay clears its mutator slot before invoking it. Its `close()` terminates both sockets synchronously, before `forwardToCore` can send/queue the returned completion. This is outer Host completion loss. |
| Unknown outcome and interruption | The launcher requires public `outcome-unknown` and canonical Run/Attempt `outcome_unknown` before terminating Core. The Core owner settles before returning, and startup recovery explicitly skips terminal unknown Runs. Later observation must preserve that history. |
| Process and persisted state | The captured resident must be the exact Shell child, copied runtime and fixed installed argv. The fixture kills/waits on its recorded process trees and verifies helper creation identity has gone. Reopen retains the database, Catalog, installation and Node token, uses the new Core URL, and pairs only a new operator. |
| Original resource recovery | The probe compares startup marker, PID and `/proc/<pid>/stat` start ticks before termination, after termination and after reopen. Read-only calls preserve original attempts/steps/plan/resources while allowing registry revision to advance. |
| Restart and fresh authorization | One restart targets only the verified original CID with the accepted timeout. A new unbound waiting startup, no child, preserved volume marker and absent tmpfs marker are required before explicit resume. Fresh Run/Attempt/Effect/request/checkpoint/authorization/C1 mapping and stable Catalog/configuration facts match the actual producer. Repeated calls only observe. |
| Effect counts and cleanup | Pre-restart exec metadata is captured before the daemon can retire it. Actual resource events and no-TTY exec metadata establish one volume/container creation, two starts and two submitters. Probe/control execs are not counted as grants. Cleanup validates original identities and exact owned paths, leaves unknown failures visible, and never claims shared daemon/cache cleanup. |
| Evidence limits | Native inner ACK loss, inner create/start/submit faults, custody rotation, daemon restart, database correctness, C1 service, C2b and real data/model/manual acceptance remain separate. The two markers establish filesystem behavior only. |

The detailed references are retained in [the machine-readable review](c2a-recovery-review.json).
Direct source checks included the unchanged relay/process helpers, Core deployment owner/recovery
coordinator, Host registry/owner/Docker adapter, Shell resident command/authentication paths and the
Native fake-child marker lifecycle. No production/template contract changed, so no
`.trellis/spec/` synchronization is needed.

## Verification

- Lint: **PASS**, reusing scoped ESLint `--no-ignore` and Native-config Ruff `check --no-cache`.
- TypeCheck: **PASS**, reusing the final single-entry `noEmit` result with `diagnostics: []`.
- Node syntax, Python AST and Ruff format: **PASS**, reused.
- Tests: **NOT RUN**; no runtime, build, dependency or Git lifecycle command was executed.

All eleven raw self-check records were examined, including the resolved initial TypeScript errors
and the six final successful results. Reuse is bound to the independently verified, unchanged
fixture hashes below and `c2a-recovery-self-check.json`
(`25224a0c7befd75b1f91b95d95693c1cbb2b19c29e5641ab1fc8f8677aa568fc`).
No static command was repeated because no executable input changed. Root's unchanged accepted
109-file source baseline and 182 source cases were not rehashed/rerun.

## Released fixture hashes

Before and after hashes are identical.

| File | SHA-256 |
| --- | --- |
| `docker-recovery/run-recovery.ts` | `f7c907eda8a156da8ca20be9d199c2d6ac5eb35ac84b01625ace6a50f608493e` |
| `docker-recovery/recovery-probe.py` | `e3e49ad25888b34332184775f3193a47ad9e3c0c4943fd08e3dc7b3611119b29` |
| `docker-recovery/README.md` | `08643e9afef9600213a0570faed2058bcb74ead8acea99d61159d83b4f4831be` |

Only this report and its JSON companion were added. Ownership of all three fixture files is
released to Root. Root may prepare the fixed unique resources and execute once under the existing
authorization, preserving first-failure evidence and exact owned cleanup. This decision does not
accept any runtime criterion.

