# Research: T4 Clock Layer — croner scheduling infrastructure (closes D5)

- **Query**: croner-based scheduling infra for a proactive desktop-companion agent + persistence, missed-fire policy, and the `schedule_task` tool surface
- **Scope**: mixed (installed-library verification / local codebase / external survey)
- **Date**: 2026-07-26
- **Status of the dependency**: **croner is NOT installed in this repo.** Verified: no `croner*` entry in `node_modules/.pnpm`, and no `croner` dependency in `package.json` (root) or `packages/core/package.json`. It is listed in `CLAUDE.md` §Pinned stack as `croner ^10` (Scheduler) but never added. T4 must run `pnpm --filter @taki/core add croner`.
- **How the API below was verified**: `npm view croner version` → **`10.0.1`** (latest, satisfies `^10`). The `croner@10.0.1` tarball was downloaded, extracted, and **executed** under this machine's Node **v24.18.0**. Every claim in §1 is either read from `dist/croner.d.ts` / `dist/croner.js` of that exact tarball or produced by a runtime probe. Runtime-probed claims are marked **[probed]**. Nothing here is from training memory.

---

## 1. croner 10.0.1 — verified API

### 1.1 Package shape

From `package/package.json` (10.0.1): `"type": "module"`, dual exports — ESM `./dist/croner.js` (types `croner.d.ts`), CJS `./dist/croner.cjs` (types `croner.d.cts`), browser UMD. `"engines": {"node": ">=18.0"}`. **Zero dependencies.** License MIT.

```ts
import { Cron, CronDate, CronPattern, scheduledJobs } from "croner";
```

Those four are the entire public surface (`export {E as Cron, m as CronDate, C as CronPattern, w as scheduledJobs}` — last line of `dist/croner.js`).

### 1.2 Constructor

`croner.d.ts:541`:

```ts
constructor(
  pattern: string | Date,
  fnOrOptions1?: CronOptions<T> | CronCallback<T>,
  fnOrOptions2?: CronOptions<T> | CronCallback<T>,
)
```

Arguments 2 and 3 are order-insensitive (each is sniffed for function-ness). The callback type is `CronCallback<T> = (self: Cron<T>, context: T) => void | Promise<void>` (`croner.d.ts:510`) — **[probed]** arg 1 is the `Cron` instance, arg 2 is `options.context`.

**A `Cron` built without a callback arms no timer** — **[probed]** `_states.currentTimeout === undefined`. This makes `new Cron(pattern)` a safe **pure pattern evaluator** (critical for the catch-up scan in §6). Attach the function later with `job.schedule(fn)` — `croner.d.ts:655` is `schedule(func?: CronCallback<T>): Cron<T>`. *(The npm README shows `job.schedule(job, context) => {})`; that is a README typo. The `.d.ts` signature is authoritative and **[probed]** correct.)*

### 1.3 Pattern syntax

`CronPattern.parse` (`dist/croner.js`) accepts **5, 6, or 7** space-separated fields, else `TypeError`.

| Fields | Layout | Normalization |
| --- | --- | --- |
| 5 | `min hour dom mon dow` | seconds prepended as `"0"`, year appended as `"*"` |
| 6 | `sec min hour dom mon dow` | year appended as `"*"` |
| 7 | `sec min hour dom mon dow year` | — |

**[probed]** `"0 9 * * *"` (5-field) and `"0 0 9 * * *"` (6-field) both resolve to 09:00:00 — the same instant.

OCPS extras: `L` (last day of month / last-weekday `LW`), `W` (nearest weekday, dom only), `#` (nth weekday, dow only), `+` prefix on dow = AND logic, `?` = `*`.

Nicknames — **[probed]** `@daily`/`@midnight` → `0 0 * * *`, `@hourly` → `0 * * * *`, plus `@yearly`/`@annually`/`@monthly`/`@weekly`. **`@reboot` throws** `TypeError: CronPattern: @reboot is not supported in this environment.` — croner offers **no startup/boot trigger**; catch-up on launch is entirely our problem.

### 1.4 Options (`CronOptions`, `croner.d.ts:163-274`) — defaults verified at runtime

| Option | Type | Real default **[probed]** | Notes |
| --- | --- | --- | --- |
| `name` | `string` | `undefined` | registers into the exported `scheduledJobs` array; **duplicate name throws** |
| `paused` | `boolean` | `false` | start paused |
| `catch` | `boolean \| (e, job) => void` | `false` | see §1.6 |
| `unref` | `boolean` | `false` | unref the internal timer |
| `maxRuns` | `number` | `Infinity` | |
| `interval` | `number` (seconds) | **`0`** | minimum spacing between triggers |
| `protect` | `boolean \| (job) => void` | `undefined` | over-run protection, see §1.6 |
| `startAt` / `stopAt` | `string \| Date \| CronDate` | `undefined` | window bounds |
| `timezone` | `string` (IANA) | `undefined` | host-local when unset |
| `utcOffset` | `number` (minutes) | `undefined` | **mutually exclusive with `timezone`** |
| `domAndDow` | `boolean` | `false` | `false` = dom OR dow (standard cron) |
| `legacyMode` | `boolean` | `true` | deprecated inverse of `domAndDow` |
| `dayOffset` | `number` (days) | `0` | shifts every computed run by N days |
| `mode` | `CronMode` | `"auto"` | `"auto"\|"5-part"\|"6-part"\|"7-part"\|"5-or-6-parts"\|"6-or-7-parts"` |
| `alternativeWeekdays` | `boolean` | `false` | Quartz numbering (Sun=1) |
| `sloppyRanges` | `boolean` | `false` | permit `/10`, `5/5` stepping forms |
| `context` | `T` | `undefined` | passed as callback arg 2 |

> **Typings doc bug — do not trust it.** `croner.d.ts:196-200` annotates `interval` with `@default 1`. Both the source (`s.interval = s.interval === void 0 ? 0 : parseInt(...)` in `normalizeOptions`) and **[probed]** `new Cron("0 9 * * *").options.interval === 0` show the real default is **`0`**. The published docs table also says 0. A second, cosmetic `.d.ts` defect: the JSDoc block for `dayOffset` (lines 229-237) is glued onto `legacyMode`'s `@deprecated` note.

### 1.5 Introspection & control (`croner.d.ts:548-667`)

```ts
job.nextRun(prev?): Date | null            // next run; null when none remains
job.nextRuns(n, from?): Date[]             // next n
job.previousRun(): Date | null             // when the previous run STARTED (runtime state)
job.previousRuns(n, reference?): Date[]    // previous n SCHEDULED slots, reverse-chronological
job.msToNext(prev?): number | null
job.currentRun(): Date | null              // start of the in-flight (or last) run
job.match(date): boolean                   // does this date match the pattern
job.getPattern(): string | undefined       // undefined for run-once jobs
job.getOnce(): Date | null                 // the run-once date, else null
job.isRunning(): boolean                   // scheduled & armed (false while paused)
job.isStopped(): boolean                   // permanently stopped
job.isBusy(): boolean                      // callback currently executing
job.runsLeft(): number | undefined
job.trigger(): Promise<void>               // force a run now
job.pause(): boolean                       // false if already stopped
job.resume(): boolean                      // false if already stopped
job.stop(): void                           // TERMINAL; clears timer, deregisters name
job.schedule(fn?): Cron
```

**[probed]** details that matter:
- `previousRuns(3)` on a `0 9 * * *` job returned the last three 09:00 slots, most-recent-first, and `match()` on each is `true`. **This is the missed-fire enumeration primitive.**
- A `paused` job still computes `nextRun()` (useful for showing "next run" on a disabled panel row) while `isRunning()` is `false`.
- After `stop()`: `resume()` returns `false`, `nextRun()` returns `null`, and the job is spliced out of `scheduledJobs`.
- `runsLeft()` is `undefined` when the job was constructed with no options object.
- `interval: 3` on a `* * * * * *` pattern fired at ms `[963, 3952, 6963]` — spacing honored.

### 1.6 Over-run / concurrency: **SKIP, never queue**

`_checkTrigger` (dist source): `blocked = this._states.blocking && this.options.protect`; when due-and-blocked it only invokes the `protect` callback — the run is **dropped**, and `maxRuns` is **not** decremented (the decrement lives in the fire branch).

**[probed]** every-1s pattern, 3.5s async body, 8s window → **2 fires, 6 `protect` callbacks**. Confirmed skip semantics. Without `protect`, croner happily runs overlapping invocations.

`catch` — **[probed]** catches both synchronous `throw` and **awaited async rejection** (`_trigger` does `await this.fn(...)` inside the try). In both cases the schedule **survives** and keeps firing.

### 1.7 System sleep, clock drift, and process death

Three distinct cases; only the first is handled by croner.

**(a) Process alive but suspended (OS sleep / event-loop freeze) → SINGLE LATE FIRE, backlog dropped.**
`dist/croner.js` defines `var W = 30*1e3` and `schedule()` does `t > W && (t = W)` — the internal `setTimeout` is **capped at 30 000 ms** and re-armed on every tick via `_checkTrigger → this.schedule()`. `_checkTrigger` fires whenever `new Date().getTime() >= target`. So a wall-clock jump is noticed within ≤30 s and the pending occurrence fires late, exactly once; intervening occurrences are never replayed.
**[probed]** `msToNext()` ≈ 42 389 582 ms → armed `setTimeout` delay was exactly `30000`; a 1 s job with the event loop frozen 5 s produced **2** fires, not 6.

**(b) Process not running at fire time → nothing at all.** croner is explicitly in-memory ("Operates in-memory, with no need for a database or configuration files" — croner.56k.guru overview). It has no store and no `@reboot`. **[probed]** a `0 0 * * *` job constructed at 15:12 reports `nextRun()` = tomorrow and `previousRun()` = `null`; today's midnight is simply gone.

**(c) A past one-shot never fires.** **[probed]** `new Cron("2020-01-01T10:00:00", {timezone})` → `nextRun()` is `null`, `isRunning()` is `false`. **This is the "remind me at 9am while the PC was off" failure mode, and croner will not save us.** Catch-up must live in our layer.

### 1.8 Error surfaces (matters for tool validation)

- Bad field count → `TypeError: CronPattern: invalid configuration format (...)`.
- Illegal characters → `TypeError`.
- Out-of-range value → `RangeError: CronPattern: Invalid value for hour: 99`.
- `mode` mismatch → `TypeError: CronPattern: mode '5-part' requires exactly 5 parts, but pattern '...' has 6 parts.`
- `timezone` + `utcOffset` together → `Error: CronOptions: Combining 'utcOffset' with 'timezone' is not allowed.` (thrown from the constructor).
- **Invalid IANA timezone is thrown LATE.** **[probed]** `new Cron("0 9 * * *", {timezone: "Not/AZone"})` **does not throw** when no callback is passed; the `TypeError: CronDate: Failed to convert date to timezone ...` surfaces on the first `nextRun()`. With a callback it throws from the constructor (the ctor self-schedules). → **Validation recipe: construct AND call `nextRun()`, both inside one try/catch.**

### 1.9 `scheduledJobs` named-job registry

**[probed]** naming a job pushes it into the module-global exported `scheduledJobs` array; a second job with the same name throws `Cron: Tried to initialize new named job 'x', but name already taken.`; `stop()` removes it. Recommendation in §6: **do not use `name`** — own the id→job map ourselves.

---

## 2. Missed-fire semantics — survey and recommendation

The sharp question: the companion's host is a personal Windows desktop that is off, asleep, or simply not running the app for most of the day. "Remind me at 9am" while the PC boots at 11am.

### 2.1 What comparable systems do

| System | Policy when the process/host was down at fire time | Cutoff / knob | Source |
| --- | --- | --- | --- |
| **croner** | **Skip.** No persistence, no boot trigger, past one-shots never fire. (Only in-process suspend gets a single late fire — §1.7a.) | none | verified §1.7 |
| **node-cron** | **Skip**, explicitly: "Schedules live in memory. If the process restarts, pending runs are lost and node-cron does not 'catch up' runs it missed while down." Has `missedExecutionTolerance` (default **1000 ms**) purely for *drift* — "always capped to the gap to the next run, so it can never run a slot twice." Emits an `execution:missed` event. | 1000 ms drift only | [node-cron usage rules](https://www.nodecron.com/usage-rules.html), [scheduling options](https://www.nodecron.com/scheduling-options.html) |
| **Unix `cron`** | **Skip.** "cron will never ever start a job when the system is off when the time for the cron job passed." | none | [askubuntu 629942](https://askubuntu.com/questions/629942/cron-execution-question) |
| **`anacron`** | **Run-once catch-up, coalesced.** Per-job timestamp file in `/var/spool/anacron`; on start, if the job has not run within `period` **days**, run it after `delay` minutes and rewrite the stamp. Day granularity only; explicitly "does not assume that the machine is running continuously." | period in days + startup delay in minutes | [anacron(8)](https://man7.org/linux/man-pages/man8/anacron.8.html) |
| **systemd timers `Persistent=true`** | **Run-once catch-up, coalesced.** "the time when the service unit was last triggered is stored on disk. When the timer is activated, the service unit is triggered **immediately if it would have been triggered at least once** during the time when the timer was inactive." Defaults to `false`; `OnCalendar=` only; subject to `RandomizedDelaySec=`. | unbounded (no staleness cutoff); jitter knob | [systemd.timer(5)](https://www.freedesktop.org/software/systemd/man/systemd.timer.html) |
| **Windows Task Scheduler** `StartWhenAvailable` ("Run task as soon as possible after a scheduled start is missed") | **Opt-in run-once catch-up, deliberately delayed.** Default **False**. Missed tasks "are queued in the Task Scheduler service's queue of tasks and they are started after a delay. The default delay is **10 minutes**." Applies **only** to time-based tasks with an end boundary or infinite repetition — **one-time tasks are not caught up, by design**. | 10-minute post-boot delay | [TaskSettings.StartWhenAvailable](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-startwhenavailable), [MS troubleshoot](https://learn.microsoft.com/en-us/troubleshoot/windows-server/system-management-components/scheduled-task-not-run-upon-reboot-machine-off) |
| **OpenClaw** (龙虾) | **Skip on startup for isolated agent turns**: "On Gateway startup, overdue isolated agent-turn jobs are **rescheduled instead of replayed immediately**, keeping model/tool bootstrap work out of the channel-connect window." One-shots auto-delete after success. | — | [OpenClaw cron docs](https://docs.openclaw.ai/automation/cron-jobs) |
| **Hermes** (马) | **Run-once catch-up with a computed grace window** (see §2.2). | grace = ½ period, clamped **[120 s, 7200 s]**; one-shot grace **120 s** | `references/hermes-agent-main/cron/jobs.py` |
| **Letta / Letta Code** | **Skip with a short staleness cutoff**: "One-shot tasks that are **more than 5 minutes late** are marked as missed." Schedules are device-bound; "Tasks only execute while `letta server` is connected." Cap of **50 active tasks per agent**. | 5 min for one-shots | [Letta scheduling docs](https://docs.letta.com/letta-agent/scheduling) |
| **Community consensus shape** | An independent project frames the exact 3-way choice as `skip` / `run-once` / `run-all`, choosing "**Default policy: `run-once` (safe middle ground)**" plus a "Max catch-up window: don't execute tasks missed more than N hours ago (configurable, **default 24h**)" and an audit flag distinguishing catch-up runs from normal ones. | 24 h | [catalyst#137](https://github.com/catalystctl/catalyst/issues/137) |

**Nobody does run-all.** Every catch-up implementation above **coalesces** an arbitrary backlog into a single execution. systemd words it precisely: fire once "if it would have been triggered **at least once**". This is the strongest cross-source signal in the whole survey.

### 2.2 Hermes' grace window, verbatim

`references/hermes-agent-main/cron/jobs.py:686-717`:

```python
def _compute_grace_seconds(schedule: dict) -> int:
    """Compute how late a job can be and still catch up instead of fast-forwarding.
    Uses half the schedule period, clamped between 120 seconds and 2 hours."""
    MIN_GRACE = 120
    MAX_GRACE = 7200  # 2 hours
```

Applied at `jobs.py:2038-2072`: when `next_run_dt <= now` and the job is `cron`/`interval` and lateness exceeds grace, it logs "*missed its scheduled time … Running now; next run provisionally set to …*", fast-forwards `next_run_at` off `now`, and then **falls through to `due.append(job)` — "skip accumulated missed runs but still execute once now to avoid deferring indefinitely."** So grace controls *re-anchoring*, not *whether* to run.

One-shots are stricter — `ONESHOT_GRACE_SECONDS = 120` (`jobs.py:102`); `_recoverable_oneshot_run_at` (`jobs.py:656-683`) returns eligible only if `run_at >= now - 120s` **and** `last_run_at` is unset ("Once a one-shot has already run, it is never eligible again"), and `create_job` outright rejects a one-shot more than 120 s in the past (`jobs.py:1204-1212`).

### 2.3 Recommendation for a companion agent

**Default policy: `catch-up-once` with a per-entry staleness cutoff; never replay a backlog; never fire silently-stale reminders.**

Rationale, weighted for *this* product rather than for a server:

1. **Skip (croner/node-cron/cron/OpenClaw/Letta default) is wrong for a companion.** The whole premise of "remind me at 9am" is that the user gets reminded. A pet that silently ate the reminder because the laptop booted at 11am is a broken promise — the failure is invisible and erodes trust exactly where the feature's value lives.
2. **Run-all is unambiguously wrong.** A `0 * * * *` job after a weekend off would open 48 agent turns, each costing tokens and each potentially speaking. No surveyed system does this.
3. **Catch-up-once + cutoff is what every system that cares about downtime converged on** (anacron, systemd `Persistent=`, Windows `StartWhenAvailable`, Hermes, and the catalyst framing), and its failure mode is benign: at worst one late message.
4. **The cutoff is the thing that makes late delivery socially acceptable.** A 9am reminder delivered at 11am is helpful; delivered at 4pm next Tuesday it is noise. Hermes' half-period rule is the best-sourced formulation because it self-scales: a 5-minute job that is 3 minutes late catches up, the same job 40 minutes late does not; a daily job tolerates up to 2 hours.
5. **Deliver late runs with an explicit lateness marker.** Both Windows (10-minute delay) and catalyst (audit flag distinguishing catch-up runs) separate catch-up from on-time. For us the marker should reach *the prompt*, so the agent says "早上九点该提醒你的,你的电脑当时没开" instead of pretending it is 9am. We already have `renderWallClock` reserved and a fenced-context convention for exactly this kind of injected fact.

**Concrete defaults** (all four numbers are sourced above, not invented):

| Entry kind | Cutoff | On expiry |
| --- | --- | --- |
| recurring (`cron` / `every`) | `graceMs = clamp(period/2, 120_000, 7_200_000)` — Hermes `_compute_grace_seconds` | fast-forward `next_run_at`, **do not** run |
| one-shot (`at`) | **2 h** (a desktop that was off is the normal case, not the error case; Hermes' 120 s and Letta's 5 min are tuned for always-on hosts) | mark `missed`, do not run, keep the row visible in the panel so the user can see it lapsed |

Deviation from Hermes, deliberate: Hermes **still runs once** past its grace window; we **skip** past cutoff. Hermes' hosts are servers/VPS where lateness means minutes; ours is a desktop where lateness means days, and a day-late "记得吃早饭" is worse than silence. Both retain catch-up-once inside the window.

Two more rules borrowed with citation:
- **Stagger the post-boot burst.** systemd applies `RandomizedDelaySec=` to persistent catch-ups precisely to avoid a thundering herd ("RandomizedDelaySec= is a technique to avoid thundering herd timer storms" — [systemd PR #11608](https://github.com/systemd/systemd/pull/11608)); Windows imposes a flat 10-minute delay; OpenClaw defers overdue jobs to keep "model/tool bootstrap work out of the channel-connect window". **Run the catch-up scan a few seconds after Core is fully wired, and serialize catch-up turns.**
- **Coalesce.** If N occurrences of the same entry are inside the window, run **one**.

---

## 3. Schedule persistence

### 3.1 Where comparables store it

- **OpenClaw**: "Job definitions, runtime state, and run history persist in OpenClaw's **shared SQLite state database**, so restarts do not lose schedules." Legacy `~/.openclaw/cron/jobs.json` + `jobs-state.json` + `runs/*.jsonl` are one-way migrated into SQLite; malformed rows are quarantined to `jobs-quarantine.json`. Run history keeps the newest 2000 terminal rows per job. ([OpenClaw cron docs](https://docs.openclaw.ai/automation/cron-jobs))
- **Hermes**: JSON job list behind a lock (`load_jobs()` / `save_jobs()` under `_jobs_lock()`, `cron/jobs.py:1259-1262`), with a separate `cron/executions.py` for run records.
- **Letta**: local task store; schedules are **device-bound** and only fire while `letta server` is connected.

OpenClaw's trajectory (JSON → SQLite) is a direct precedent for us: we already have SQLite with a migration runner and a single writer.

### 3.2 The rule this must satisfy in our repo

`docs/devlog/m5.md:38` (自定义与社区化三原则 #1):

> **面板权威,双入口一存储**:可视设置面板是唯一权威管理面;对话中 agent 调配置接口写**同一份存储**,面板必然可见可改可删。任何 agent 可写配置,面板必有对应可视条目。

and `docs/devlog/m5.md:39` (#2):

> agent 自习惯的产物=**结构化配置行**(cron 条目/带 {schedule, condition, prompt, 沉默条件} 的清单项),触发层永远是确定性引擎代码(croner 节拍/到期门控/activity 条件预判由代码判定,零 token),LLM 只管判断与措辞。

Consequences that constrain the design, not merely advise it:
- One table. The `schedule_task` tool and the #26 settings panel are two **entry points to the same rows**. No agent-private store, no "agent schedules" vs "user schedules" split.
- The row must carry everything the panel needs to render a complete, editable, deletable item **without** consulting the LLM — human-readable name, human-readable schedule, enabled flag, last/next run, and provenance.
- Agent Core is the only writer (invariant 2, ADR 0004). The panel edits by WS method, not by touching the DB.

### 3.3 Stored-entry shape

Hermes' record (`cron/jobs.py:1214-1252`) is the most complete real example; fields relevant to us:
`id`, `name`, `prompt`, `schedule` (`{kind: "once"|"interval"|"cron", + run_at|minutes|expr, display}`), `schedule_display`, `repeat {times, completed}`, `enabled`, `state` (`scheduled|paused`), `paused_at`, `paused_reason`, `created_at`, `next_run_at`, `last_run_at`, `last_status`, `last_error`, `deliver`, `origin`, `model`/`provider` (+ `*_snapshot` pinned at creation), `skills`, `enabled_toolsets`, `workdir`.

Two ideas worth stealing explicitly:
- **`schedule_display`** — a pre-rendered human string stored alongside the machine form. The panel must never have to parse cron to show "每天 09:00".
- **`origin`** — provenance of the row. We need this for the panel's "这条是谁建的" and for any future bulk-revoke of agent-created entries.

### 3.4 Our schema (fits `packages/core/src/db/migrations/`)

Follow the existing conventions exactly — numbered TS constant, `STRICT` table, appended to `MIGRATIONS` in `index-list.ts`, 3-6 line header (`003-memory-auto-state.ts` is the model).

```sql
CREATE TABLE schedules (
  id                TEXT PRIMARY KEY,          -- "sch_<random>"
  character_id      TEXT NOT NULL,             -- owner; every other table is per-character
  name              TEXT NOT NULL,             -- panel label
  kind              TEXT NOT NULL,             -- 'cron' | 'every' | 'at'
  pattern           TEXT NOT NULL,             -- cron string | ISO-8601 local | interval spec
  timezone          TEXT,                      -- IANA; NULL = host local
  display           TEXT NOT NULL,             -- pre-rendered human schedule
  prompt            TEXT NOT NULL,             -- the payload handed to the turn seam
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_by        TEXT NOT NULL,             -- 'agent' | 'user'
  created_at        INTEGER NOT NULL,          -- epoch ms
  updated_at        INTEGER NOT NULL,
  next_run_at       INTEGER,                   -- epoch ms; NULL = exhausted/none
  last_run_at       INTEGER,                   -- epoch ms of the last ATTEMPT
  last_status       TEXT,                      -- 'ok' | 'error' | 'missed' | 'skipped'
  last_error        TEXT,
  run_count         INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX schedules_due ON schedules (enabled, next_run_at);
```

- Epoch-ms integers, matching how the rest of core passes time (`current-time-tool.ts` returns `epochMs`; `renderDayDate/renderCurrentTime` take `number | Date`).
- `last_run_at` + `next_run_at` are **the catch-up state** — the direct analogue of anacron's timestamp file and systemd's on-disk last-trigger record. They are why catch-up is possible at all; croner contributes nothing here.
- `created_by` satisfies "面板必有对应可视条目" auditability; it must never gate *visibility* (the panel shows everything) — only labeling.
- Run history: **defer** a `schedule_runs` table for v1. `last_status`/`last_error`/`run_count` cover the panel. If deferred, log it in `docs/deferred-decisions.md` per the standing rule.

Repo/method naming to match existing files: `packages/core/src/scheduler/schedule-repo.ts` (cf. `db/timeline-repo.ts`, `db/memory-auto-repo.ts`), WS methods `schedule.list` / `schedule.create` / `schedule.update` / `schedule.delete` under `server/methods/schedule-list.ts` etc. (cf. `character-list.ts`, `media-clear.ts`), zod schemas in `packages/shared/src/schedule-schema.ts` (invariant 3).

---

## 4. The `schedule_task` tool family

### 4.1 How comparables expose it to the LLM

**Hermes — one compressed multi-action tool.** `references/hermes-agent-main/tools/cronjob_tools.py:970-994`:

```python
CRONJOB_SCHEMA = {
  "name": "cronjob",
  "description": """Manage scheduled cron jobs with a single compressed tool.
Use action='create' to schedule a new job from a prompt or one or more skills.
Use action='list' to inspect jobs.
Use action='update', 'pause', 'resume', 'remove', or 'run' to manage an existing job.
...""",
  "parameters": {"properties": {
     "action": {"type": "string",
       "description": "One of: create, list, update, pause, resume, remove, run. ..."},
     "job_id": {"description": "Required for update/pause/resume/remove/run"},
     ...
```

**OpenClaw — same shape.** "The agent `cron` tool returns compact job summaries (`id`, `name`, `enabled`, `nextRunAtMs`, `scheduleKind`, `lastRunStatus`) from `cron(action: "list")`; use `cron(action: "get", jobId: "...")` for one full job definition."

**Letta — no tool at all; a built-in skill wrapping a CLI.** PR ["feat(skills): add scheduling-tasks built-in skill"](https://github.com/letta-ai/letta-code/pull/1714): "Teaches agents how to use `letta cron` to create, list, and delete scheduled tasks — so users can say 'remind me at 9am to walk the dog' and the agent handles it via the CLI."

**Anthropic — Claude Code Routines**, referenced from `references/hermes-agent-main/hermes-already-has-routines.md:3`, exposes three trigger types (scheduled/GitHub-event/API) as a product surface with a hard cap of "**5 routines per day** on Pro, **25 on Enterprise**" (ibid. line 117) — i.e. the published pattern pairs self-scheduling with a **quota**.

### 4.2 How the schedule is expressed

Nobody makes the LLM emit only raw cron. All three accept a **union of forms in one string field**:

- Hermes `parse_schedule` (`cron/jobs.py:512-601`) accepts `"every 30m"` → interval, `"0 9 * * *"` → cron (validated through `croniter`), `"2026-02-03T14:00"` → one-shot, `"30m"` → one-shot relative. Tool description (`cronjob_tools.py:1006`): *"'30m', 'every 2h', '0 9 * * *', or ISO timestamp … You MUST include this field when action=create."*
- OpenClaw: positional schedule accepting `"0 9 * * 1"`, `"every 1h"`, `"20m"`, or an ISO timestamp; kinds `at`/`every`/`cron`/`on-exit`/`stream`; `--tz` for timezone.
- Letta: mutually exclusive `--every` / `--at` / `--cron`, and `--at` takes natural language (`"3:00pm"`, `"in 45m"`).

Validation is **deterministic and at write time**, never LLM-judged: Hermes runs `croniter(schedule)` and raises `ValueError(f"Invalid cron expression '{schedule}': {e}")`; Letta rejects with *"invalid cron expression … Needs 5 fields."* and forbids `--once` with `--cron`.

### 4.3 Runaway self-scheduling prevention

Four distinct mechanisms, all sourced:

1. **Prompt-level prohibition.** Hermes `cronjob_tools.py:988`: *"Important safety rule: cron-run sessions should not recursively schedule more cron jobs."*
2. **Creation-time deterministic guard.** `references/hermes-agent-main/cron/lifecycle_guard.py` rejects job specs whose prompt or script contains a gateway-lifecycle command, because an agent scheduling `hermes gateway restart` produces "a SIGTERM-respawn loop every ~10 seconds until manually broken." Its design note is worth transplanting: the pattern is *command-shaped*, anchored on concrete command identifiers, because "A cron `prompt` is fed to a future LLM, not a shell, so an over-broad substring match on English … would produce a high false-positive rate." It is explicitly "a defence-in-depth layer" on top of execution-time blocking.
3. **Hard quotas.** Letta: "up to **50 active tasks per agent**". Claude Code Routines: 5–25/day. OpenClaw: `maxConcurrentRuns` default 8, and trigger schedules carry a "configurable minimum interval (**30 seconds** by default)".
4. **Privilege separation.** OpenClaw: "All cron mutations (`add`/`create`, `update`/`edit`, `remove`, `run`) require `operator.admin`", and command-payload cron "is an operator-admin Gateway automation surface, not an agent `tools.exec` call."

### 4.4 Shape for us

**One tool, `schedule_task`, with an `action` enum** — not a family of 4-5 tools. Grounds:
- Both reference implementations (Hermes 龙虾-adjacent, OpenClaw 马-adjacent — our two BANGCLAW north-star references) independently converged on the compressed form.
- `.trellis/spec/backend/tool-design.md` rule D3 (描述即 prompt 预算) — five near-identical tool descriptions would burn budget for one concept.
- Our own `parameters ≤ 3` cap is a *guideline against god-tools*, not a mandate to fragment one coherent CRUD surface; the compressed form has one required discriminator plus per-action fields, which is what Hermes/OpenClaw ship.

D36 compliance is structural and holds: the tool writes **structured config rows only**. `prompt` is natural-language text that a *future deterministic turn* feeds to the LLM — it is never executed, never a script, never a skill/hook file. The trigger layer (croner tick, cutoff gate, enable check) is engine code at zero token cost. This is exactly `m5.md:39`'s 结构化配置行 category.

Actions: `create` | `list` | `update` | `delete` | `pause` | `resume`. `list` returns compact rows (OpenClaw's field set: `id, name, enabled, display, nextRunAt, lastStatus`) so a listing does not blow the context.

Anti-runaway for v1, all four layers, each already justified above:
- description carries the recursion prohibition (Hermes wording);
- **a scheduled turn's tool set excludes `schedule_task`** — the structural version of Hermes' prompt rule, and cheap for us because tools are already assembled per-turn in `main.ts:312-320` (`extraTools`);
- per-character cap (**50 enabled entries**, Letta's number) and a **minimum interval floor** (reject patterns firing more often than every 60 s) — both deterministic, both rejected with an actionable error per tool-design rule R (错误可行动化);
- deletion/edit is always available from the panel (三原则 #1), which is the ultimate circuit breaker.

Confirmation before persisting: **no separate approval gate.** `m5.md:42` red line — 自然语言授权=既有 Approval 流程,零新机制. Writing a row into our own DB is not an OS crossing, so it does not touch the Permission Gate. The user-visible confirmation is the agent's natural-language read-back plus the panel row.

---

## 5. Timezone & DST

### 5.1 What croner does — measured, not inferred

`timezone` takes an IANA name and is implemented via `Intl.DateTimeFormat(..., {timeZone})` (`dist/croner.js`, function `g`). `utcOffset` (minutes) is the fixed-offset alternative and the docs warn it "does not take care of daylight savings time, you probably want to use option `timezone` instead."

**[probed]** with `America/New_York` around the 2026 US transitions:

| Case | Pattern | Result |
| --- | --- | --- |
| **Spring forward** — 02:30 does not exist on 2026-03-08 | `30 2 * * *` | `2026-03-07 02:30 GMT-5` → **`2026-03-08 03:30 GMT-4`** → `2026-03-09 02:30 GMT-4`. Fires **once**, shifted into the hour after the gap. Not skipped, not doubled. |
| **Fall back** — 01:30 occurs twice on 2026-11-01 | `30 1 * * *` | `2026-10-31 01:30 GMT-4` → **`2026-11-01 01:30 GMT-4` (05:30 UTC)** → `2026-11-02 01:30 GMT-5`. Fires **once**, on the **first (earlier, pre-shift)** occurrence. |

This matches the source: `fromTZ` has an explicit ambiguity branch that probes `instant - 3600000` and returns the earlier match. So croner's DST behavior is **exactly-once per wall-clock day, earliest instant on ambiguity, shifted forward on nonexistence** — which is the correct and desirable semantic for a companion. A 2:30am job on a DST-shift night neither vanishes nor doubles.

### 5.2 The real DST/timezone hazards are ours, not croner's

1. **Persisting an absolute instant for a wall-clock intent.** `next_run_at` as epoch-ms is a *cache*. If the user travels, changes Windows' timezone, or a DST boundary passes while the app was closed, the cached instant no longer means what the pattern means. Hermes hit this exactly and documents the fix at `cron/jobs.py:643-653`:
   > *"Cron schedules express local wall-clock intent. If Hermes/system local time changes after next_run_at was persisted, an old offset can make a future wall-clock run look due at the converted absolute time (for example 21:00+10 becomes 13:00+02). Comparing naive wall-clock values lets us distinguish that migration case from a genuinely missed run whose scheduled wall time has already passed."*
   **→ The pattern (+ optional timezone) is the source of truth; `next_run_at` is derived and MUST be recomputed from the pattern on every startup, never trusted across a restart.** This single rule dissolves the whole class.
2. **Naive ISO strings for one-shots.** Hermes anchors a naive timestamp to the *configured* zone, not the server zone, at parse time (`jobs.py:568-582`) — otherwise "a naive '20:07' … the stored instant would land hours off from the user's wall-clock intent — far enough that one-shots never become due." OpenClaw's counter-example is a documented gotcha: "`at` schedules without timezone are treated as **UTC**."
3. **Late timezone validation** (§1.8) — a bad IANA string can survive construction and explode on first evaluation.

### 5.3 Safe pattern for us

- Store `pattern` + `timezone` (nullable). **`timezone` NULL = host local** — the right default for a desktop pet, since the user's wall clock *is* the intent and it follows them when Windows' zone changes. Only set `timezone` when the user explicitly names one.
- **Never** use `utcOffset` (docs: no DST handling).
- **Recompute `next_run_at` from the pattern at every startup**, before the catch-up scan. Compare **wall-clock**, not the stale absolute, when deciding "was this genuinely missed?" (Hermes `_stored_wall_clock_is_future`).
- Interpret one-shot ISO input in the **entry's** timezone (host-local by default) at creation time, and persist both the ISO text and the resolved instant.
- Validate at write time by constructing **and** calling `nextRun()` inside one try/catch (§1.8).

---

## 6. §Recommendations for OUR stack — concrete v1

### 6.1 Module layout

New `packages/core/src/scheduler/` (invariant 7: pluggable module + one registry entry), all OS-neutral (invariant 8 — no Windows-only anything; croner is pure JS):

| File | Role |
| --- | --- |
| `schedule-repo.ts` | `schedules` SQL: list / listEnabled / get / insert / update / delete / markRun. Zod-parse at the row boundary (cf. `timeline-repo.ts`). |
| `schedule-pattern.ts` | Pure: parse a user/LLM schedule string → `{kind, pattern, timezone, display}`; `computeNextRun`; `enumerateMissed`. **The only croner importer for evaluation.** |
| `scheduler.ts` | Lifecycle: hydrate from DB → arm one `Cron` per enabled entry → `stop()`/re-arm on edit → `shutdown()`. Owns the `Map<id, Cron>`. |
| `catch-up.ts` | Startup scan; cutoff policy; emits the same fire event as a live tick. |
| `schedule-task-tool.ts` | The `schedule_task` AI-SDK tool (one tool per file, `x-tool.ts`, exports `scheduleTaskTool` — naming table). |
| `index.md` | Folder index, per the file-headers rule. |

Plus: migration `005-schedules.ts` + one line in `db/migrations/index-list.ts`; `packages/shared/src/schedule-schema.ts`; `server/methods/schedule-{list,create,update,delete}.ts` + method-table entries; one line in `main.ts`'s `extraTools`.

### 6.2 croner usage shape

```ts
// ARMING (one Cron per enabled entry) — options verified in §1.4
const job = new Cron(entry.pattern, {
  timezone: entry.timezone ?? undefined,   // NEVER utcOffset (no DST handling)
  protect: true,                           // §1.6: overlapping fires are SKIPPED, not queued
  catch: (err) => logger.error({ err, id: entry.id }, "schedule callback threw"),
  mode: "5-or-6-parts",                    // reject 7-part/ambiguous LLM output early
  // no `name`: the global `scheduledJobs` registry throws on duplicates (§1.9) — own the map
}, () => void onFire(entry.id, { late: false }));
jobs.set(entry.id, job);
```

- `protect: true` is mandatory: an agent turn can run minutes, far longer than a short interval. Verified skip-not-queue.
- `catch` is mandatory: verified to swallow both sync throws and async rejections **and keep the schedule alive** — matches our "a failing tool call must degrade into a structured error, never a crash" rule.
- Edit = `job.stop()` + construct fresh (`stop()` is terminal; `pause()`/`resume()` only for the enabled flag).
- One-shots: use the ISO/`Date` constructor form, then delete or mark the row on success (OpenClaw: "One-shot jobs (`--at`) auto-delete after success by default").
- **Evaluation vs. arming are separate instances.** `schedule-pattern.ts` uses fn-less `new Cron(pattern, {timezone})` for `nextRun()`/`previousRuns()` — verified to arm no timer, so it is safe to construct freely during scans and validation.

### 6.3 Startup / catch-up algorithm

```
on Core start (after DB + agent wiring, before/parallel with WS accept):
  for each enabled entry:
    evaluator = new Cron(pattern, { timezone })            // fn-less, no timer
    freshNext = evaluator.nextRun()                        // recompute, never trust stored (§5.3)
    if (freshNext === null) { mark exhausted; continue }

    // was a slot missed while we were down?
    anchor  = last_run_at ?? created_at
    missed  = evaluator.previousRuns(1)[0]                 // most recent scheduled slot
    if (missed && missed.getTime() > anchor) {
      lateBy = now - missed.getTime()
      if (lateBy <= cutoffFor(entry))  enqueueCatchUp(entry, { late: true, scheduledFor: missed })
      else                             markStatus(entry, "missed")
    }
    write next_run_at = freshNext ; arm the Cron
  run the catch-up queue SERIALLY, after a short settle delay
```

- `previousRuns(1)` (verified §1.5) is the whole mechanism; `last_run_at` is the anacron timestamp file.
- **Exactly one** catch-up per entry regardless of backlog depth — the coalescing rule every comparable follows.
- `cutoffFor`: recurring → `clamp(period/2, 120_000, 7_200_000)` from `nextRuns(2)` spacing (Hermes); one-shot → 2 h (§2.3).
- Serial + delayed, per OpenClaw/systemd/Windows staggering rationale.

### 6.4 The fire → agent-turn seam (interface I need; the turn seam itself is another agent's research)

The scheduler must not know how a turn runs. It needs exactly this injected callback:

```ts
/** Injected into createScheduler(); implemented by the turn-execution layer (T4 heartbeat work). */
export interface ScheduledTurnRunner {
  run(input: {
    scheduleId: string;
    characterId: string;
    prompt: string;         // the stored payload, verbatim
    scheduledFor: number;   // epoch ms of the SLOT (not now) — so late runs can say so
    firedAt: number;        // epoch ms of actual execution
    late: boolean;          // true only for catch-up runs
  }): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
}
```

Requirements on the implementer of that seam, each with a reason already established:
1. **Serialize with chat turns.** `agents/turn-queue.ts` is a per-`characterId` async mutex and a scheduled turn is a turn — it must `acquire(characterId)`. Otherwise a 9am reminder interleaves with a live conversation.
2. **Label the write context.** Per m5 A2 (`m5.md:26`), a scheduled turn is not a primary conversational turn; it must carry its own write-context tag so it does not sediment as if the user said it.
3. **Fence nothing, but mark lateness in-prompt.** `prompt` is user/agent-authored config, not untrusted observation, so `untrusted-fence.ts` does not apply. But `late: true` must reach the prompt (a `renderWallClock`-style line: scheduled 09:00, now 11:24) so the agent phrases it honestly.
4. **Never throw.** Return the structured error; the scheduler writes `last_status`/`last_error` and keeps the schedule armed (croner's `catch` already guarantees survival, but the seam should not rely on it).
5. **Respect quiet hours / Privacy Pause / 频控** at delivery (`m5.md:34`), not at trigger — the scheduler fires deterministically; suppression is the proactivity layer's call.

### 6.5 Tool surface

`schedule_task` (one file, one export), per §4.4:

```
action:   "create" | "list" | "update" | "delete" | "pause" | "resume"   (z.enum — rule S1)
id:       string           (required for update/delete/pause/resume)
schedule: string           (required for create — "0 9 * * *" | "every 2h" | "30m" | ISO)
prompt:   string           (required for create)
name:     string           (optional)
```

- Deterministic validation at write: parse → construct → `nextRun()`; on failure return an actionable error naming the accepted forms (rule R, Hermes/Letta precedent), never a throw.
- `list` returns compact rows only.
- Excluded from a scheduled turn's tool set (anti-recursion, §4.4).
- Caps: 50 enabled per character; reject sub-60 s patterns.
- Classified **informational**, NOT presentation — must not enter `PRESENTATION_TOOL_NAMES` (the 1c rule recorded in `agents/index.md` and `.trellis/spec/backend/tool-design.md` B).

### 6.6 Panel parity checklist (三原则 #1)

Every field in §3.4 is panel-visible; `schedule.list/create/update/delete` mirror the tool actions 1:1 over WS; `created_by` labels but never hides. If a future field is agent-writable and has no panel control, that is a violation, not a backlog item.

---

## 7. §OMITTED — considered and deliberately left unsourced/undecided

These are flagged rather than recommended, because I could not source them or they exceed v1:

- **`schedule_runs` history table** — OpenClaw keeps 2000 terminal rows/job and Hermes has `cron/executions.py`, so the precedent exists, but nothing in the M5 task table requires per-run history for #26. Left out of v1; needs a `docs/deferred-decisions.md` entry if the implementer agrees.
- **Randomized jitter on catch-up** — systemd's `RandomizedDelaySec` rationale is sourced, but our expected entry count (tens, not hundreds) makes a thundering herd hypothetical. I recommend serial + settle-delay instead; actual jitter is unjustified at our scale.
- **Whether the 2 h one-shot cutoff is right.** It is my reasoned interpolation between Hermes (120 s), Letta (5 min) and catalyst (24 h) for a *frequently-off desktop*. No source states a desktop-companion number. **This is the one number in §2.3 an owner should rule on.**
- **Natural-language schedule parsing** ("每天早上九点" → cron). Letta's `--at` accepts `"3:00pm"`/`"in 45m"`, but no surveyed system parses free-form NL deterministically — they all rely on the LLM emitting a canonical form. I did not research an NL-date library and make no recommendation.
- **Wake-the-machine-to-fire** (systemd `WakeSystem=`, Windows "Wake the computer to run this task"). Real capability, but it requires an OS crossing from the Rust Shell and is a Permission Gate design in its own right. Out of scope for D5.
- **Condition-gated entries** (`{schedule, condition, prompt, 沉默条件}` from `m5.md:39`; OpenClaw's `on-exit`/`stream`/trigger-script kinds). The clock layer should expose the fire event cleanly so the heartbeat/清单 layer can add conditions; I did not design that here.
- **Multi-process / lock coordination.** node-cron warns each replica schedules independently. Irrelevant to us (single Core, invariant 2) — noted only so nobody imports a lock they do not need.
- **`interval` option as a rate limiter.** Verified working (§1.5), but it is a *minimum spacing* on an existing pattern, not a quota; our anti-runaway story is the caps in §4.4, not this.

---

## Caveats

- **croner is not installed**; §1 is verified against `croner@10.0.1` fetched from the npm registry and executed locally, not against a repo lockfile. If T4 resolves a different `^10` patch, re-run the probe before trusting the option defaults (they are the likeliest thing to drift).
- The `.d.ts` `@default 1` for `interval` is **wrong** (real default `0`) — a reminder that this package's typings JSDoc is not authoritative. Prefer `dist/croner.js` or a runtime probe when a default matters.
- `mcp__exa__get_code_context_exa`, `context7`, and `deepwiki` were **not available** in this session (only `mcp__exa__web_search_exa`). Library verification was done by executing the real package instead, which is stronger evidence than any of them.
- Hermes citations are line-referenced against the local `references/hermes-agent-main` checkout; that tree is git-ignored and unversioned here, so line numbers are only valid for the current local copy. Hermes is MIT but the default stance applies — patterns only, clean-room rewrite.
- Probe scripts live in the session scratchpad (`probe.mjs` … `probe4.mjs`) and are disposable; nothing was written outside this file.
