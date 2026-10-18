# C2a offline extraction and first-start design review

Date: 2026-10-15. Reviewer: `/root/c2_design_check`.

**PASS for the small task-only implementation and its subsequent reviewed execution.**
The existing owner approval covers this isolated prerequisite. The exact supervisor still needs
the byte/hash-bound static review already required by the plan; this report is not a runtime result.

Reviewed plan: [c2a-database-extraction-plan.md](c2a-database-extraction-plan.md), SHA-256
`9996da457893c5bc42505f3aad234ff3937e47c8ef0bd2c7ae84c14fa9b0aa1d`.

## Findings (fixed)

None. This read-only design review found no concrete blocker requiring a plan or production edit.
Only this report was added.

## Findings (not fixed)

None within the proposed experiment. The four raw PostgreSQL utilities, offline initialization,
actual postmaster ownership and checked shutdown remain unproved runtime prerequisites. Resolving
those unknowns is the purpose of this one execution; no additional generic inventory probe is needed.

## Decisive review

| Concern | Conclusion |
| --- | --- |
| Source and cached artifact | The preserved metadata result pins the actual pg0 0.15.0 CLI and matching Python wrapper. Official source at commit `b8b8451956f13dbb4b00a553c8a6cc8afb320af9` supports the proposed flags and extraction behavior. Source correspondence is not a reproducible-build attestation; actual CLI/tool output remains required. |
| Offline extraction and exact paths | `main.rs:216-248` derives the base from HOME/.pg0 and writes instance metadata. `464-543` extracts the bundled archive into installation/version and installs runtime libraries; `856-874` trusts that exact installation. Thus HOME=R, Q, A and the nested metadata path in the plan agree. Network none, no pull and no fallback keep the experiment on its pinned local inputs. |
| Minimal launch and environment | One new marked container/volume and one pg0 start are sufficient. Empty writable UID-1000 seed, read-only rootfs, private network and explicit data/socket/log/tmp paths keep effects within the new resource. Clearing the environment before importing psycopg2 avoids inherited DB/provider settings. The fixed public password is explicitly nonsecret. |
| Interface and versions | The CLI subcommand declares the proposed flags at `main.rs:65-100`; `versions.env:1` and `build.rs:12-38` select 18.1.0. Help/version checks may fail this prerequisite without another container, version, PATH or download. `check_shared_libraries` tolerates unavailable ldd at `664-674`; actual raw-tool execution and SQL establish usability. |
| Process and readiness | `main.rs:934-972` records the real postmaster PID and forgets the PostgreSQL owner on exit. CLI success is therefore insufficient. The SQL backend-to-postmaster parent link, PID/start ticks, exact executable, data_directory and cluster identifier provide the required live evidence. Recording actual PPID/PGID/session avoids assuming detachment behavior. |
| Graceful shutdown | The exact raw pg_ctl fast stop, reaped original postmaster, absent PID file and matching pg_controldata identifier/state establish the intended result. The source pg0 stop has a SIGKILL fallback at `main.rs:1043-1093`; excluding it is appropriate. Forced or unknown cleanup remains failed evidence. |
| Ownership and release | Fresh token/name/volume, original create CID, exact image/config/mount/label validation, unmounted-volume removal and canonical marked staging cleanup preserve the existing scope. No admitted resource, image build, daemon operation, original data, C2b receipt or production change is introduced. |

## Implementation bindings

The following are concrete applications of the plan's existing requirements, not added probe stages:

1. Use one monotonic 60-second deadline from the single start dispatch through the first successful
   SQL result. Cap connection attempts and subprocess/file operations by the remaining budget.
   Keep the four tool-version checks and evidence work within the complete 180-second run bound.
   An alarm/watchdog must remain effective during blocking SQL, hashing and log handling; pg0's
   internal 600-second setup timeout cannot be the enforcing clock.
2. Capture the CLI's `/proc` identity, command line and executable while it is live, at Step 3
   immediately after Popen. Retain those facts for Step 4: `/proc/<cli-pid>` need not exist after
   the required successful CLI exit. Keep the SQL connection open until the backend parent/identity
   has been captured; then close clients before the checked stop.
3. Share one monotonic 25-second deadline across pg_ctl execution/reap, postmaster exit/reap and
   pg_controldata. The component caps of 17, 5 and 3 seconds cannot each reset the overall clock.
   Likewise, Docker `stop --time 45` sets a container grace interval; it does not bound the Docker
   client itself. Root's existing runner must also enforce the remaining 60-second cleanup budget.
4. On initialization/timeout/signal failure, retain the original failure even if cleanup succeeds.
   No PID-file deletion or second start is permitted. If exact raw-stop identities cannot be
   established, report failed/unknown supervision and use only the already specified owned-container
   cleanup. A stopped container cannot retroactively establish graceful database shutdown.

These bindings can be implemented directly in the forthcoming single supervisor. They require
no additional product decision, container, inspector, dependency, general framework or user approval.

## Verification

- Plan SHA-256 matched the released input.
- Read the preserved metadata result/preservation manifest and the prior accepted database design.
  The completed metadata probe was not rerun.
- Independently read the exact official commit's source text; observed SHA-256:
  - `src/main.rs`: `04fa9dcca83152150ed5e7cc76ec0acdc374fa396c3f13471bd291debe53095a`
  - `versions.env`: `07dfafab8885a8d7bc45284b48961ed1bcb776a9ce5f7735e23b7204306daca2`
  - `build.rs`: `2051d35cf3b26c41df136ffd6ea3c627de6305dd365f71f57bd6090d9fa424f8`
- Lint / TypeCheck / Tests: **not run**, because this assignment permits design/source reads and
  this Markdown report only.
- No Docker/WSL, application/fixture lifecycle, build/install, runtime asset download, production
  edit or Git lifecycle action occurred. Official source was read as text only.

A future PASS proves only this offline/raw-tool/first-start prerequisite. The admitted task-specific
database child, original-volume restart/persistence, C2b, Native API/provider, C1 service and manual
acceptance remain separate. `deploymentReady` remains false. This report is released to Root.

