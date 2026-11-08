**1. Outcome — done (assigned R1/R2 scope)**

R1 and R2 are implemented and verified. R1 refuses unreconstructible rebinding Memories before emergency admission. R2 consumes the current retry at claim, preserves retry requests made during the run across successful settlement, and keeps the earliest pending retry time. The failure/backoff path is unchanged. [source packages/core/src/memory/transitions/transition-local-projection.ts:41] [source packages/core/src/db/hindsight-replica-scheduler-repo.ts:129] [source packages/core/src/db/hindsight-replica-scheduler-repo.ts:173] [source packages/core/src/db/hindsight-replica-schedule-state.ts:68]

The leader authorized the narrow Shared refinement in the follow-up: consumed retry metadata with `retryDueAt: null` is valid only while a run is active. Idle-state validation, all fields and the database schema remain unchanged. Fresh follow-up checks pass: Core 281 tests, Shared 14 tests, both package typechecks and scoped ESLint. The earlier nine broad-run failures remain leader-owned; they were not investigated again. [source packages/shared/src/memory-replica-schedule-schema.ts:107] [run artifact G:/taki-codex-work/tmp-u/r2-core-green.log] [run artifact G:/taki-codex-work/tmp-u/r2-shared-green.log]

Initial handoff (historical): [p1u-report.md](G:/taki-codex-work/tmp-u/p1u-report.md)

Exact delta: [p1u.patch](G:/taki-codex-work/tmp-u/p1u.patch)

**2. Changes**

The combined delta covers 19 files including this report. Each file was copied to the requested baseline directory before its first edit; earlier R1 baselines were retained. The R1 changes remain:

- Shared reconstruction/admission predicate in `transition-local-projection.ts`; used by `memory-transition-surviving-policy.ts`. `rebind_required` now refuses before source withdrawal. [source packages/core/src/memory/transitions/transition-local-projection.ts:41] [source packages/core/src/db/memory-transition-surviving-policy.ts:27]
- Real paired-replica rebinding fixture and tests covering preview, both admission plans, and unchanged source/no capture/no incident. [source packages/core/src/testing/memory-transition-emergency-service-fixtures.ts:38] [source packages/core/src/memory/transitions/transition-emergency-service.test.ts:156]
- Explicit mixed `bound`/verified-predecessor `binding_missing` eligibility assertion. [source packages/core/src/db/memory-transition-surviving-policy.test.ts:53]
- Emergency spec’s binding-state rule, module headers and three single-line folder-index updates. [source .trellis/spec/backend/memory-transition-emergency.md:43]

R2 additions:

- `hindsight-replica-scheduler-repo.ts` consumes the due timestamp for every claim trigger while retaining backoff metadata; success preserves a new non-null retry timestamp and its kind, resets its attempt to one, or clears consumed metadata when no new request exists. [source packages/core/src/db/hindsight-replica-scheduler-repo.ts:124] [source packages/core/src/db/hindsight-replica-scheduler-repo.ts:173]
- `hindsight-replica-schedule-state.ts` keeps the earliest existing request, lease expiry and requested time during a run. [source packages/core/src/db/hindsight-replica-schedule-state.ts:68]
- `memory-replica-schedule-schema.ts` admits only the authorized active consumed-retry state; Shared tests cover durable/status parsing, legacy active due times, unchanged idle/failed rules and incomplete metadata rejection. [source packages/shared/src/memory-replica-schedule-schema.ts:107] [source packages/shared/src/memory-replica-schedule-schema.test.ts:22]
- Repository regressions cover consumed retry success, new requests during interval/manual/catch-up/retry runs, exact subsequent retry timing/kind, unchanged failure and lost-lease backoff, and both request orders plus lease-expiry precedence. The composed scheduler test holds an active run, requests recovery, settles success, then observes the timer dispatching the later retry. [source packages/core/src/db/hindsight-replica-scheduler-repo.test.ts:45] [source packages/core/src/db/hindsight-replica-scheduler-repo.test.ts:60] [source packages/core/src/db/hindsight-replica-scheduler-repo.test.ts:87] [source packages/core/src/db/hindsight-replica-scheduler-repo.test.ts:103] [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.test.ts:122]
- `memory-replica-sync.md` records coverage for rows admitted after the final Pending summary. Updated the three changed production module headers and individual lines in the DB, Hindsight and Shared folder indexes. [source .trellis/spec/backend/memory-replica-sync.md:302] [source packages/core/src/db/index.md:64] [source packages/core/src/memory/hindsight/index.md:56] [source packages/shared/src/index.md:53]

The exact file list is retained in `G:/taki-codex-work/tmp-u/owned-files.txt`; `p1u.patch` is the combined R1/R2/report delta against those pre-edit working files, not against HEAD. [run artifact G:/taki-codex-work/tmp-u/owned-files.txt]

**3. Evidence and checks**

All checks used `TEMP=TMP=G:/taki-codex-work/tmp-u`; Vitest used `--pool=threads --maxWorkers=2`, with one Vitest invocation at a time. Environment: Node v24.18.0, pnpm 10.22.0, Vitest 4.1.10. The initial R1 evidence is retained below:

| Check | Result |
|---|---|
| Focused R1 red | **3 failed, 13 passed**: preview incorrectly eligible; neither admission plan refused. |
| Focused R1 green | **16 passed**, including mixed-policy takeover. |
| Initial requested five Vitest filters | **366 passed, 9 failed** across 41 files; historical, leader-owned failures. |
| Core typecheck | Passed. |
| Scoped ESLint | Passed. |
| `git diff --check` on assigned files | Passed. |
| Patch reverse-application check | Passed; no patch applied. |

[run artifact G:/taki-codex-work/tmp-u/r1-red.log] [run artifact G:/taki-codex-work/tmp-u/r1-green.log] [run artifact G:/taki-codex-work/tmp-u/scoped-vitest.log] [run artifact G:/taki-codex-work/tmp-u/core-typecheck.log] [run artifact G:/taki-codex-work/tmp-u/eslint.log] [run artifact G:/taki-codex-work/tmp-u/diff-check.log]

Five broad-run failures also reproduce with both production files loaded from their pre-edit baselines. They are inherited boot/status assertions expecting full proof traversal. Four process-test failures have missing child output or null exit status; an independent minimal spawn probe returns `EPERM`. Their individual OS errors remain UNKNOWN because those fixtures do not record `spawnSync.error`. [run artifact G:/taki-codex-work/tmp-u/baseline-boot.log] [run artifact G:/taki-codex-work/tmp-u/baseline-loaded.log] [run artifact G:/taki-codex-work/tmp-u/spawn-probe.log]

The initial R2 SQLite probe reproduced erased retries and the overwrite of an earlier request. It is pre-fix evidence, not current behavior. [run artifact G:/taki-codex-work/tmp-u/r2-probe.json]

The R2 regressions were added before production edits. Failure modes were fixed in advance of implementation: consumed retry metadata must clear on plain success; a newly requested retry must survive and dispatch at its due time; failure/lost-lease backoff must remain unchanged; later requests must not postpone an earlier request; only active runs may retain consumed metadata.

| Follow-up check / command | Result |
|---|---|
| Core red: `pnpm --filter @taki/core exec vitest run src/db/hindsight-replica-scheduler-repo.test.ts src/memory/hindsight/hindsight-replica-scheduler.test.ts --pool=threads --maxWorkers=2` | **9 failed, 43 passed**; failures cover consumed claims, success erasing requests across every trigger, competing requests and the active composed scheduler. Failure/recovery backoff cases already passed. |
| Shared red: `pnpm --filter @taki/shared exec vitest run src/memory-replica-schedule-schema.test.ts --pool=threads --maxWorkers=2` | **1 failed, 13 passed**; the active consumed-retry state was rejected. |
| Core green: `pnpm --filter @taki/core exec vitest run hindsight-replica hindsight-memory-writes hindsight-pending hindsight-memory-subsystem transition-emergency --exclude src/testing/memory-transition-emergency-process.test.ts --pool=threads --maxWorkers=2` | **281 passed in 23 files**, 138.26s. Only the matching leader-owned process suite was excluded; no other exclusion. |
| Shared green: same Shared command | **14 passed**, 568ms. |
| `pnpm --filter @taki/core typecheck` and `pnpm --filter @taki/shared typecheck` | Both passed. |
| `pnpm exec eslint` with all 11 changed TypeScript paths explicitly listed | Passed. |
| `git diff --check --` with all 19 assigned paths; `git apply --reverse --check G:/taki-codex-work/tmp-u/p1u.patch` | Passed; patch check only, no application. |

[run artifact G:/taki-codex-work/tmp-u/r2-core-red.log] [run artifact G:/taki-codex-work/tmp-u/r2-shared-red.log] [run artifact G:/taki-codex-work/tmp-u/r2-core-green.log] [run artifact G:/taki-codex-work/tmp-u/r2-shared-green.log] [run artifact G:/taki-codex-work/tmp-u/r2-core-typecheck.log] [run artifact G:/taki-codex-work/tmp-u/r2-shared-typecheck.log] [run artifact G:/taki-codex-work/tmp-u/r2-eslint.log] [run artifact G:/taki-codex-work/tmp-u/r2-diff-check.log] [run artifact G:/taki-codex-work/tmp-u/r2-patch-check.log]

The completed field-reader audit found:

| Reader | Result |
|---|---|
| All claim triggers | Share `claim`, which consumes the retry timestamp while retaining backoff metadata. The new-request tests exercise interval, manual, catch-up and retry claims. |
| `succeed` | Retains a new retry timestamp/kind with attempt one; otherwise clears consumed metadata. It still clears failure diagnostics and schedules normal intervals from success. |
| `recover` / failure | Backoff depends on retained attempt and run kind, not the previous due time. |
| `failManual` | Requires no active run; no active-run due dependency. |
| `configureReplicaSchedule` | Automatic mode preserves fields; disabling clears them. |
| `requestCatchUp` | Explicitly requires `run === null`. |
| `replicaScheduleDue` | Refuses while running; existing priority remains applicable. |
| `replicaNextWake` / retry request | Running wake remains lease expiry. The retry request helper now also considers an existing pending retry; the earliest of it, expiry and requested time survives. |
| Status | Uses the same Shared schema, now accepting consumed retry metadata only during a run. Both direct status-schema tests and the composed scheduler pass. |
| Foreground reconnect | Reads non-null retry due; clearing it suppresses the trigger for that active Bank, which catch-up already refuses. |
| Home | Checks `bank.run` first and displays “执行中”; no running-display dependency on retry due. |

[source packages/core/src/db/hindsight-replica-scheduler-repo.ts:74] [source packages/core/src/db/hindsight-replica-schedule-state.ts:30] [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:248] [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:112] [source apps/desktop/src/windows/home/pages/operations/memory-authority-state.ts:85]

**Healthy-transition answer:** a guarantee exists. Native calls `rebind_transition_application` inside the final proof transaction immediately before capturing the application snapshot. It rebinds existing artifacts to current versions and refuses an unsuccessful commit; source locks span capture/publication. Thus a preceding consolidation change is rebound before proof capture. [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/transition_certificate.py:67] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/transition_application_rebind.py:29] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/logical_snapshot.py:455]

If that rebinding fails, failure precedes Core publication and source retirement. Core resumes the source after a positively confirmed abort; failed release instead retains an unknown fenced operation requiring original-identity recovery. [source packages/core/src/memory/transitions/transition-healthy-execution.ts:77] [source packages/core/src/memory/transitions/transition-healthy-execution.ts:212]

**Never-bound invalidated Memory answer:** yes, one such head without exact predecessor policy blocks emergency takeover. Ordinary sync keeps skipping it. A healthy transition can establish initial policy/history while preserving invalidation; a supported revert followed by binding can also change eligibility. [source packages/core/src/memory/hindsight/hindsight-application-binding-collector.ts:70] [source packages/core/src/memory/hindsight/hindsight-application-policy.ts:71]

Native can create this through normal retain followed by curation with `state=invalidated`: it archives the unit, increments its revision and publishes an authoritative upsert; application capture retains `binding_missing` when no artifact existed. There is no minimum age or Core-binding prerequisite. Both operations can occur consecutively before the next six-hour poll; exact elapsed seconds are UNKNOWN, not measured. This is not a claim that consolidation automatically archives facts. [source H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4068] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:9851] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:9915] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/publication.py:166] [source packages/shared/src/memory-replica-schedule-schema.ts:16]

**4. Trade-offs**

- R1 preserves strict policy correspondence at the cost of offline takeover availability for rebinding Memories.
- Invalidated, never-bound Memories remain preserved and potentially blocking.
- Preserving R2 retries can require an additional recovery pass. No alternative timestamp encoding or process-local retry state was introduced.
- An active retry retains the earliest lease expiry/request time, so a request later than the lease can be scheduled earlier, as authorized. Successful settlement resets the pending retry's attempt to one; subsequent failures use the unchanged backoff progression.
- The accepted running state is broader; consumers require the matching Shared validator. No fields, migration, idle-state rule, failure behavior or Home implementation changed.

**5. Open items / UNKNOWN**

- No assigned R1/R2 implementation or scoped check remains unfinished. Both requested spec updates are present.
- The nine historical broad-run failures remain with the leader for outside-sandbox validation. They were not investigated further, rerun or treated as a green full-repository gate in this continuation.
- No real-service, journey or manual acceptance is claimed.
- The task-owned report at `research/emergency-retry-impl-20261107.md` is the current record; the G: initial report and probe remain historical artifacts.

**6. Outside scope and disposition**

During the initial R1 run, the requested process suites hard-coded synthetic roots under `H:/.trellis/.runtime`, bypassing `TEMP/TMP`. That run’s four identified directories were moved to the requested G: scratch area; their path mapping is retained. Earlier fixtures were untouched. Per the follow-up, no test artifacts were moved again and no process-suite investigation was repeated. [run artifact G:/taki-codex-work/tmp-u/process-artifact-paths.json]

All owned check/probe commands finished. No standalone Core, Native or PG service was started. Leader records, prompts/templates, curator files, Home, Native, deferred decisions and Git/task lifecycle were untouched.

