# C2a database persistence accepted; C2b is next

## 2026-10-18 admitted database persistence result

The Windows-clock defect is fixed and the admitted two-generation database case now PASSES.
`run-persistence.ts` derives both `since` and `until` from the Docker Engine clock
(`docker info --format {{.SystemTime}}`) with calendar-exact UTC validation; the previous failure
had excluded the second stop/die because Engine time ran ~2.4 s ahead of the Windows clock.
Two independent exact-byte reviews closed the fix (round 1 found the lenient `Date.parse`
calendar check, round 2 PASS). Read
[c2a-database-persistence-exact-byte-review-round2-1b05d2f6.md](c2a-database-persistence-exact-byte-review-round2-1b05d2f6.md).

Run `b5c5fb7f-cd8a-402a-bd11-92839d191e98` is the accepted case: `casePassed=true`, 79.204 s,
generation 1 seeded one 4 KiB logged row (`sha256 c60fc4e1...`), generation 2 read the same row
without reseeding, both stops were `stopped/checked`, container exit 0, no OOM, and owned
container/volume/tag/W/S were removed. Evidence:
[run-b5c5fb7f](c2a-database-persistence-run-b5c5fb7f/report.md) and its `evidence-hashes.json`.
`deploymentReady` remains false; this is not a Native API or C2b receipt.

Two failed task-fixture attempts remain preserved and did not indicate product defects:
`1b05d2f6` failed at `start_and_sql` with a `PermissionError` from `/proc` enumeration
([run-1b05d2f6](c2a-database-persistence-run-1b05d2f6/persistence.json)); an instrumented
diagnostic copy then passed and the reviewed fixture passed again on rerun, so the race is
unproven and did not recur in two subsequent runs. `13f04d85` (the pre-fix clock failure) is
archived at `c2a-database-persistence-run-13f04d85/`. All three staging trees are removed and the
eight pre-existing containers were unchanged throughout.

C2a's remaining scope is the broader Docker fault matrix (inner Native ACK/effect faults,
shared-daemon restart). C2b planning must still supply the actual API producer and definition-only
managed setup. Keep `deploymentReady: false` and managed setup refused.

---

# Previous snapshot (2026-10-15)

Updated 2026-10-15 after accepted isolated recovery and the first real PostgreSQL prerequisite.
The owner approved isolated C2a recovery, disposable-database shutdown/persistence with generated
data, then C2b. Do not request the same project-scoped authorization again.

Recovery R1 `f217a02f-f8a5-466f-ab59-0e97940debe0` remains FAIL because its full local scan ran
while Shell held the exclusive deployment lock. Its 72-entry archive and diagnosis remain intact.
The narrow task-only fix retains the complete scan after process reaping; production is unchanged.
R2 `775da07b-2b69-44a3-868c-2604423dac11` then passed in 117.079 seconds, including cleanup.
The [independent runtime review](c2a-recovery-runtime-review.md) accepts outer Host completion loss,
Core/Shell/helper reopen, original-container restart, fresh authorization and original-volume/tmpfs
behavior. It confirms one container/volume creation, two starts, two submitters, 19 successful no-TTY
exec records and 827 fully scanned protected files with zero sentinel hits. Inner ACK/effect faults,
shared-daemon interruption and database persistence remain separate.
Root verified all original seven containers unchanged and all owned runtime resources absent.
Both recovery staging trees are removed after complete archive verification; use
[R1 preservation](c2a-recovery-first-attempt-preservation.json) and
[R2 preservation](c2a-recovery-second-attempt-preservation.json), never their consumed G: paths.

The reviewed offline first-start supervisor executed once with token
`fd3e5b9c-c0f8-4fd8-b1d1-17a8dd1cce7e`: real PostgreSQL 18.1, one pg0 start, actual SQL/durability
and exact raw tools passed. The postmaster/logger exited and were reaped with code 0; raw control
state is `shut down`. The payload took 2.226 seconds and used 113,951,227 peak logical bytes.
The container/volume are removed and the original seven containers are unchanged.
[Independent runtime review](c2a-database-extraction-runtime-review.md) passes; Root verified all
24 entries in [the archive](c2a-database-first-start-evidence.zip) and removed its G: stage.
See [preservation](c2a-database-first-start-preservation.json); do not use the consumed token/paths.
This proves the offline/raw-tool/first-start prerequisite, not logged-data restart persistence.

The [admitted persistence plan](c2a-database-persistence-plan.md) and
[independent design review](c2a-database-persistence-design-review.md) are PASS. The first
[implementation review](c2a-database-persistence-implementation-review.md) passed scoped static
checks, but actual persistence R1 `20d996bf-64b6-47c7-908d-730ebdb371c4` failed after 66.767 seconds
(68.170 seconds for the outer launcher). Its pre-injection waiting/no-DB check passed in 784 ms.
The [diagnosis](c2a-database-persistence-first-attempt-diagnosis.md) establishes a task-fixture
assertion error: create/start resource fences become verified while their attempt phase remains
admitted; only inject reaches observed. Requiring observed on every attempt fails the normal path.
The original raw failed registry/exception was not retained; do not invent it or claim SQL proof.

Root independently verified all exact runtime resources, image tag, protected root and tracked/
protected processes absent, with all seven original containers and start times unchanged.
All 55 files were preserved and verified in [the R1 archive](c2a-database-persistence-first-attempt-evidence.zip),
531,237 bytes, SHA-256 `049a9a614ddf2f109698afbd73296ee28c0e4a780361514223fe26f1732bfcd9`.
Its [preservation record](c2a-database-persistence-first-attempt-preservation.json) confirms the old
G: stage was removed; do not reuse its token or paths. No runtime command remains pending.

`c2a_database_implement` (high) released the narrow R2 fixture assertion/evidence-retention repair,
fresh-token substitutions, README and [R2 self-check](c2a-database-persistence-r2-self-check.md).
Its scoped TS checks pass; both Python files differ from frozen R1 only by the new token.
The [independent R2 byte review](c2a-database-persistence-r2-review.md) passed without further fixes.
Root has prepared and started the single R2 case; do not reuse its consumed run fence. Token is
`13f04d85-ee84-408e-890c-88922e36c69e`, stage
`G:/TakiAgent-c2a-database/persistence-13f04d85-ee84-408e-890c-88922e36c69e`, protected root
`C:/taki-c2a-db-persistence-13f04d85-ee84-408e-890c-88922e36c69e` and tag
`taki-c2a-db:13f04d85-ee84-408e-890c-88922e36c69e`. Preparation passed; the sole build took 2.453
seconds and produced `sha256:53f3be182e02deaab48d20ee424b440b5200b1aac3373e920a6e54d9fe296226`.
The runtime result/cleanup are pending in the new stage's `persistence.json`.
Retain the original deadlines, first-stop bytes, streaming checks and existing Native subreaper;
no production supervisor change is released. R2 still requires actual runtime acceptance.
`c2a_recovery_implement` (xhigh) released the revised `c2b-plan.md`, SHA-256
`0e4bdf03c903d6bbdca4d0bbfc187de14bb6c9fd8119b816bbfa7e69db0cd803`.
Before C2b implementation/check, read [the full plan](c2b-plan.md) directly; its 41,862 bytes
exceed the 32 KiB context-injection cap. This handoff routes the full read without truncating it
or changing the reviewed document/hash. Do not implement from an injected partial plan.
The [targeted follow-up design review](c2b-design-r2-review.md) is PASS and released, despite a
subsequent agent service/rate-limit error. Do not repeat this completed review.
The [first design review](c2b-design-review.md) required the pre-plan hold correction: use the already
proposed connection capsule until real Bank/snapshot facts permit atomic transfer to the existing
immutable plan/hold. Complete the offline artifact gate and real API producer before broad setup
integration. [C2b source research](c2b-readiness.md) and
[actual Native producer research](c2b-native-producer-readiness.md) identify the missing API/endpoint
producer and the old import path's model refresh. New managed initialization must reuse the existing
definition-only template producer, with no fabricated readiness or real model calls. No C2b source
implementation is released. Both 34-entry context manifests passed validation in this continuation.
`c2a_recovery_implement` (xhigh) may prepare only the task-local offline image inventory packet and
concise resource manifest under `research/docker-native-api/`; no Docker/API or production effect
is released by that preparatory assignment. The actual C2b run remains after database acceptance.
Root owns runtime, preservation and task metadata; heavy runs stay serial.
The C2a source checkpoint and the first bounded actual Docker fake-consumer case both pass.
The overall task remains `in_progress`: the remaining Docker recovery matrix, disposable database and
C2b receipt criteria are open. Keep `deploymentReady: false` and managed setup refused.

## Task and authorization

- Current task: `.trellis/tasks/10-14-hindsight-managed-deployment`.
- Session: `codex_01a1309f-e374-7241-ab38-4e50f040d985`; `task.py current --source` confirms this binding.
- Parent: `08-09-memory-operations-ui`; sibling C1 `10-07-hindsight-managed-host-custody` remains `in_progress`.
- Taki: `H:/TakiAgent`, `main`, HEAD `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
- Native: `H:/hindsight`, `main`, HEAD `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.

The owner approved C2 task creation, design/review and direct source/fake-data work on 2026-10-14, then
the Docker startup/preflight and the reviewed project-owned probe/build/container/volume case with exact
cleanup. The owner also authorized continuing project-scoped work that does not affect unrelated processes
or environments, and explicitly requested interruption recovery with Docker startup if necessary. Do not
request these same approvals again. The shared daemon and unrelated workloads must remain unaffected;
original data/keys, real models and Git lifecycle actions remain outside this experiment.

All preceding source, first-case fixture and report ownership was released. The original xhigh
`c2_design_check` completed that final evidence review with no new blocker. Current new-slice ownership
is listed above; no runtime command is pending. Continue from the remaining gates instead of redispatching
accepted work. The owner's continuation approval covers project-owned isolated effects and cleanup;
do not repeat an approval request for that scope.

## Accepted source

Read [source acceptance](c2a-source-acceptance.md), [independent source review](c2a-source-review.md),
[independent evidence](c2a-independent-source-evidence.json) and [Root preservation](c2a-root-final-readback.json).
All six source criteria pass. The independent gate passed 182 tests: Core/adapter/registry 28, Host 17,
Native 4, Shared 121, Rust 10 plus golden wire 1, and copied-install 1. Four older C1 manual fixtures remain
ignored. Required types, scoped TS/Native checks and strict all-target Clippy pass. The unchanged 42-case
Core/C1 compatibility result is reused separately. These checks were not rerun for Docker evidence closeout.

The final 109 source files (99 Taki, 10 Native) have source-tree SHA-256
`b0e7896be6c5e49c7d588fb59a537787c1614c6bc302cacda30372c001eca2f9`.
Task-specific patches and the 91-file source evidence archive are retained; the three source/check/Root
G: staging trees were removed after preservation. Existing Rust targets and T4 evidence remain. The actual
Docker work changed only task-local fixtures and evidence, not this accepted production source.

## Accepted first actual Docker case

Read [runtime acceptance](c2a-docker-first-case-acceptance.md) and the
[final independent runtime review](c2a-docker-runtime-review.md). The review SHA-256 is
`789724a9e7366564947b9217fd13d5870071e2ad1d8808a57df43abd098b0f64`.

The first attempt `fa25c42b-1dbc-4f15-bc50-224bca0b03a1` passed the cached-base probe and local build,
then failed before deployment admission because the isolated debug Shell lacked the existing
`TAKI_GATE_AUTOAPPROVE=allow-once` fixture setting. An actual-binary probe confirmed exit 2. Its
[failure and cleanup](c2a-docker-first-attempt.md) remain preserved. The xhigh reviewer made the minimal
task-local correction and released a fresh R2 token; the production Gate was not changed.

R2 `8378a950-87c8-44e3-a909-d213a284f113` completed on 2026-10-15 at 00:25 Asia/Shanghai, before the
later interruption. Launcher exit 0 took 98.198 seconds; the internal case took 95.176 seconds including
cleanup. Actual Core/Shell/Gate, copied Host, Docker and Native grant/private delivery reached the fixed
fake child. Same-key repeat and original observation preserved identity with create/start/inject each once.
Five actual exec records (four control, one submitter) were no-TTY and exit 0; both Linux sockets were
UID/GID 1000 and mode 0600. Sixteen scan categories, 827 protected files, the new volume and argv had zero
fake-sentinel hits. The volume's single 84-byte marker is not database evidence.

| Binding | Value |
| --- | --- |
| Core deployment/original Run | `330899ae-6175-40c2-af31-b806d1b96357` |
| Container | `9b378419b65aa8fdd9102d132081f627bfba8bb717e05ba056f4beacba3b1412` |
| Native startup | `305b354f-436e-406d-aac7-0a1186464c3e` |
| Fixed Linux engine | `93e8319e-24b7-4a7d-88f1-60923ad681e0`, Docker 29.0.1 |
| Endpoint | `npipe:////./pipe/dockerDesktopLinuxEngine` |
| Cached base | `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db` |
| R2 result image | `sha256:33775ce3a851b7ababa87d140a65da422302a403ee2bfbe03a84bf9064f8d42a` |
| R2 runner SHA-256 | `8aa4bd9d91ccb884fec2488d5ba55d3c22d2d88a46fd719c44ce827ec9342e94` |

The [R1 archive](c2a-docker-first-attempt-evidence.zip) retains 42 files / 56,397 bytes; the
[R2 archive](c2a-docker-second-attempt-evidence.zip) retains 43 files / 60,128 bytes. Their preservation
records and independent review verify all 85 entries. R2 includes the exact reviewed fixture, executed
assertions, safe identities/scan counts and interruption readbacks. Inner Docker replies were not all
retained verbatim; this is not a complete raw API trace or a second independent execution.

## Cleanup and recovered environment

Both cases' exact processes, C: fixtures, test resources/image tags and G: staging trees are removed.
The two G: removals reclaimed 1,623,326 and 1,644,418 logical bytes after archival. Do not reuse either
consumed token or removed helper/adapter path. The source fake-key adapter remains available at
`apps/hindsight-host/test-fixtures/fake-key-adapter.rs` for a separately prepared fresh fixture.

Root restarted the absent pinned Docker Desktop on 2026-10-15 at 16:17 Asia/Shanghai under the existing
authorization. Post-recovery readback confirmed the same engine, absent test container/volume/tag and
unchanged cached base. The successful case was not rerun. Docker remains running; seven original container
IDs remain and `redis` / `arboris-app` are running with new start times. `gpt-load` was already absent before
the first Docker mutation. No active stop/restart/delete command targeted unrelated containers. Because
the test resources were gone before the interruption, this is not daemon-restart recovery acceptance.

The closeout readback confirms about 12.00 GiB free on H:, 134.46 GiB on G: and 29.14 GiB on C:.
The earlier 14.998 GiB H: cleanup is complete; do not repeat it. No new Rust target or H: build output was
created. Build-cache/VHDX reclamation is not claimed. Historical preflight inventories and removed staging
paths in [the Docker proposal](c2a-docker-acceptance-plan.md) are snapshots, not current execution inputs.

## Remaining work

Continue with the concrete admitted database child and same-container/volume logged-data persistence
case, then C2b's actual API producer and trusted-reference/template consumer. Reuse accepted recovery
and offline first-start evidence. Inner Native ACK/effect faults and daemon interruption remain open;
the shared daemon cannot be interrupted while unrelated workloads would be affected. Do not extend
filesystem markers or the standalone database prerequisite to admitted persistence, API/model readiness
or trusted receipts. Keep the three broader PRD checkboxes open.

C1a's approved Ubuntu preflight found systemd 249.11-0ubuntu3.22 without `/usr/bin/systemd-creds`; service
AC2/6 remain open. The real Docker socket result does not replace that service acceptance. C1 source and
eight actual Linux process cases remain accepted within their original boundaries.

Use high/xhigh agents, one heavy check at a time, at most two Vitest workers and G: staging. A fresh small
protected C: fixture may follow the established C1 pattern because G:'s ancestor ACLs are unsuitable;
do not repair existing drive ACLs or weaken verification. Avoid new frameworks/dependencies, broad cleanup,
repeated unchanged checks, original-data/key/model access, commit/push/reset/rebase or finish/archive.
