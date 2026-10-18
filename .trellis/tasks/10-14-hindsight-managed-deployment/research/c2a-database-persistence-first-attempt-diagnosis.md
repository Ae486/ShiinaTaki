# C2a database persistence first-attempt diagnosis

Date: 2026-10-15. Investigator: `/root/c2a_database_implement`.

**A task-launcher assertion contradicts the actual Host owner contract.** It requires every
create/start/inject attempt to have `phase: observed`; the owner retains create/start at
`admitted` and records completed resource effects in `steps: verified`. Only injection advances
its attempt phase to `observed`. This assertion fails even for the valid successful owner path.
No production fix is indicated. The first attempt remains FAIL; SQL/persistence/checked-stop
acceptance is not established by this run.

This is read-only diagnosis plus these two report files. Root expressly excluded reruns and
frozen-source edits. Accordingly the diagnosis uses retained runtime output and exact source
control flow, not a new runtime reproduction. No Docker, app, build, test, source change or
resource query was performed. Root owns independent live cleanup verification and preservation.

## Retained evidence and limits

Original evidence root: `G:/TakiAgent-c2a-database/persistence-20d996bf-64b6-47c7-908d-730ebdb371c4`.
These are read locations at diagnosis time; later archive/removal is Root-owned.

| Retained fact | Observed result |
| --- | --- |
| `persistence.json` | 30,385 bytes; SHA-256 `50e1eaff879108199ba3b069d7b5e7406cf7ef0742984aa12d99aec2f0bc8c41`. |
| `launcher-command.json` | SHA-256 `b7eedd6e25cc1891b58b3f3da7addafe131c9cdd5478266ff40b20f1cac43b0c`; exit 1, empty stderr, no outer runner failure. |
| Time | Inner fixture `elapsedMs=66767`; outer launcher `elapsedMs=68170`. They measure different intervals. |
| Result | `casePassed=false`, `failureStage=pre-injection-observation-and-start`, `ownedRuntimeCleanup=true`. |
| Before injection | Native waiting; no wrapper/PG, marker, cluster, intent or manifest. Exact execute capture-to-release interval 784 ms. |
| Last pre-cleanup scan entries | `status-4`: 434 bytes / zero hits, followed by `registry-5`: 9,674 bytes / zero hits. No later database reader entry. |
| Missing later evidence | No `initialRun`, `firstGeneration`, first/final stop report or SQL result. `reapedHelpers=[]`. |
| Cleanup output | Exact owned container stop/inspect/rm, unmounted-volume removal and unique image removal are retained; stopped container exit 0, no OOM. These do not prove checked database shutdown. |

Original deployment: `3b9bf3dc-108d-4d10-8542-77140dad9034`.
CID: `da00d1272f1b8646a00068cec19c9a775ce52682f82da37171e257bbd98c504d`.
Volume: `taki-c2a-3b9bf3dc-108d-4d10-8542-77140dad9034-data`.
Native startup: `a0876a02-34ed-4890-9273-77abf26bf97c`.

The raw 434-byte status and 9,674-byte registry were scanned, but their content was not retained
at those points. The scan counts are not substitutes for those bytes. Source control flow plus
the next `registry-5` entry shows that the initial start passed its running/release assertions;
that is a source-coupled inference, not a newly recovered raw status. No precise exception,
stack, kernel error or actual create/start phase values are invented here. Deleted W/container/
volume contents cannot be reconstructed from the cleanup booleans.

## Exact source mismatch

The executed launcher hash is
`46a1b0b3f13816bbd56b46b1c279724ef7e52bdf75453d7addd8eda6cb01f7b0`.
The current file matches it. Relevant owner/injection source hashes also match the frozen
implementation source manifest consumed by that launcher.

| Current source | Decisive contract |
| --- | --- |
| `research/docker-database/run-persistence.ts:563-567` | After initial running status and registry read, requires `original.attempts.every(a => a.phase === "observed" && ...)`; `captureHelper` is the next statement. |
| `apps/hindsight-host/src/deployment-owner.ts:137-143` | `addAttempt()` initializes every new action with `phase: "admitted"`. |
| `apps/hindsight-host/src/deployment-owner.ts:67-111` | Create/start publish resource step fences, invoke effects and return `observe()`; they do not change attempt phase. |
| `apps/hindsight-host/src/deployment-owner.ts:188-204` | `recoverResources()` sets volume/container/start steps to `verified` based on inspected resources. |
| `apps/hindsight-host/src/deployment-injection.ts:61-67` | Injection advances its own attempt from `submit-dispatched` to `observed` after actual submission. |
| `research/docker-recovery/run-recovery.ts:353-356` | Accepted recovery fixture checks action order, only `attempts[2].phase === "observed"`, and each attempt's Effect/Core-attempt identities. |
| `research/docker-database/run-persistence.ts:734-738` | Catch retains only the old stage and cleanup status, discarding the failed assertion's code/context. |

The new universal phase check accidentally flattened two different progress mechanisms. The
unchanged owner deliberately uses per-resource steps for create/start and injection phases for
private delivery. Therefore `admitted, admitted, observed` with all required resource steps
`verified` is the valid completed history; making production advance every phase would change
the contract merely to satisfy a wrong fixture expectation.

This incorrect compound assertion is a source-established deterministic blocker and fits the
retained execution boundary exactly. The missing raw registry/exception means the report does
not claim which individual conjunct the runtime evaluated first. Helper capture and initial
Run inspection occur after this assertion and are not required to explain the failure.

## Ranked alternatives

| Candidate | Assessment / discriminating evidence |
| --- | --- |
| Universal `observed` assertion | Confirmed invalid by owner source; it precedes every missing subsequent observation. Highest confidence causal explanation. |
| Helper identity/capture failure | Empty helper capture alone would allow this possibility, but the known-invalid earlier assertion blocks the ordinary owner path before capture. No helper command error was retained. |
| Initial Run or SQL failure | Not supported as the launcher failure point: no successful helper capture, initial Run evidence or second database reader appears. The wrapper could have progressed independently, but its SQL/stop facts were not copied. |

There is no evidence for a PostgreSQL durability defect, Native grant failure, ten-second hold
timeout or cleanup ownership defect. This diagnosis does not establish their success either.

## Minimal proposed repair, after Root release

1. **Correct only the launcher predicate.** Preserve exact action order, original CID/volume/plan,
   Effect/Core-attempt identity checks and injection `observed`. Check volume/container/start
   `steps` are `verified`; require `observed` only for the inject entry. Do not change Host owner,
   registry schema, Native wrapper or accepted earlier fixtures to fit the erroneous assertion.
2. **Retain safe facts before asserting.** Immediately retain the parsed public start status and
   a bounded registry projection: original deployment/container/volume/config IDs, steps and
   each action/phase plus request/Run/Core-attempt/Host-attempt/Effect/startup correlation IDs.
   Exclude authorization objects, custody payloads, raw private frames and key material. The
   existing in-memory `original` record already supplies this; no extra resource operation is needed.
3. **Make this failure interval actionable.** Set distinct closed stages before initial resource
   checks, helper capture, initial Run read and SQL readiness. Use a small allowlisted assertion
   code (for example `INITIAL_RESOURCE_CONTRACT`) and preserve the first code/stage before cleanup.
   For helper capture, retain bounded owned-child PID/parent/creation facts and expected-executable/
   argv-match booleans before asserting; no arbitrary process command line or environment dump.
   This needs no trace framework or general logger.
4. **Preserve the existing fixed child evidence on failure before deletion.** Where the original
   CID/ownership is already known and it is still running, at most one existing fixed reader call
   can retain current safe wrapper/process/report facts. Keep its existing five-second payload/
   bounded client contract. After the same cleanup stop and stopped-state verification, before
   `rm`, copy only the existing fixed `R/c2a-db/last-stop.json` to one case-owned failure-report
   path, <=128 KiB and <=10-second client budget, then parse/bind/scan/hash its actual bytes.
   Missing, invalid, oversized or unavailable output is an explicit secondary diagnostic outcome;
   it never replaces the original failure or authorizes a restart, inspector, SQL retry or new
   path selector. Keep all collection inside the existing cleanup budget. The stop report may
   record termination during initialization caused by early fixture failure; do not relabel that
   as an independently observed database defect.

Freeze this failed attempt before any change, then use a fresh Root token/staging for a reviewed
rerun. Only changed-launcher lint/noEmit/syntax and the narrow reviewed assertions need revisiting;
no production change or repeated 182-case suite follows from this diagnosis. Python algorithms
and their accepted static/scanner checks need not be rerun for an unchanged wrapper/reader.

Only this Markdown and its [JSON companion](c2a-database-persistence-first-attempt-diagnosis.json)
were created. Frozen sources and original runtime evidence remain unchanged. Waiting for Root's
explicit implementation release and fresh token; this report performs no repair or rerun.
