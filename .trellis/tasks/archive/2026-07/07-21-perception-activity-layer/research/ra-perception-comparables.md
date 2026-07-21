# Research: Low-sensitivity foreground-activity perception — comparables survey (T3a)

- **Query**: How do authoritative/comparable systems design low-sensitivity foreground-window perception (sampling cadence, dwell/coalescing, category mapping, continuous-observation permission UX, data shape) for an agent's activity layer?
- **Scope**: mixed (local reference repos + repo anchors + exa web)
- **Date**: 2026-07-21
- **Hard rule honored**: every adopted recommendation carries a citation (URL or local `file:line`); unsourced ideas quarantined in §OMITTED.

## Citation keys

| Key | Source |
|---|---|
| [SURVEY] | `.trellis/workspace/pleia/m5-proactivity-survey.md` (local, with line numbers) |
| [BP-DS] | `references/BANDORI-PET-REV-main/desktop_state.py` (local; **GPLv3 — pattern reference only, never copy code**) |
| [BP-SA] | `references/BANDORI-PET-REV-main/screen_awareness.py` (local; GPLv3, pattern-only) |
| [H-PERM] | `references/hermes-agent-main/acp_adapter/permissions.py` (local, MIT) |
| [H-CUA] | `references/hermes-agent-main/tools/computer_use/cua_backend.py` (local, MIT) |
| [T2B-RA] | `.trellis/tasks/archive/2026-07/07-20-capability-governance/research/ra-permission-capability-governance.md` (local) |
| [GOV] | `apps/desktop/src-tauri/src/gate/governance.rs` (local) |
| [DEC] | `apps/desktop/src-tauri/src/gate/decisions.rs` (local) |
| [AW-CFG] | ActivityWatch configuration docs — https://docs.activitywatch.net/en/latest/configuration.html |
| [AW-HB] | ActivityWatch data model / heartbeats — https://docs.activitywatch.net/en/latest/buckets-and-events.html |
| [AW-HB-SRC] | `aw_transform.heartbeat_merge` source — https://docs.activitywatch.net/en/latest/_modules/aw_transform/heartbeats.html |
| [AW-AFK-CFG] | aw-watcher-afk defaults — https://github.com/ActivityWatch/aw-watcher-afk/blob/master/aw_watcher_afk/config.py |
| [AW-AFK-64] | aw-watcher-afk issue #64 (pulsetime = poll_time + timeout) — https://github.com/ActivityWatch/aw-watcher-afk/issues/64 |
| [AW-WATCHERS] | ActivityWatch watchers page — https://docs.activitywatch.net/en/latest/watchers.html |
| [AW-CAT] | ActivityWatch categorization — https://docs.activitywatch.net/en/latest/features/categorization.html |
| [AW-FAQ] | ActivityWatch FAQ (local-first) — https://github.com/ActivityWatch/docs/blob/master/src/faq.rst |
| [AW-23] | aw-watcher-afk issue #23 (event model: timestamp+duration contiguity) — https://github.com/ActivityWatch/aw-watcher-afk/issues/23 |
| [SP-GH] | screenpipe README — https://github.com/screenpipe/screenpipe |
| [SP-CAP] | screenpipe event-driven capture source — https://github.com/screenpipe/screenpipe/blob/main/crates/screenpipe-engine/src/event_driven_capture.rs |
| [SP-CHG] | screenpipe changelog (retention default) — https://screenpipe.com/changelog |
| [WT-FAQ] | WakaTime FAQ (heartbeats, keystroke timeout) — https://wakatime.com/faq |
| [WT-VSC] | WakaTime VS Code heartbeat internals — https://deepwiki.com/wakatime/vscode-wakatime/3.1-heartbeat-generation |
| [MS-RECALL] | Windows Recall privacy & control — https://support.microsoft.com/en-us/windows/privacy/privacy-and-control-over-your-recall-experience |
| [MS-RECALL2] | Retrace your steps with Recall — https://support.microsoft.com/en-us/windows/ai/ai-features/retrace-your-steps-with-recall |
| [MS-RECALL3] | Recall filtering — https://support.microsoft.com/en-us/windows/ai/ai-features/filtering-apps-websites-and-sensitive-information-in-recall |
| [MAC-MONTHLY] | macOS Sequoia monthly screen-recording re-prompt — https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/ |
| [MAC-TIDBITS] | TidBITS critique of Sequoia re-prompts — https://tidbits.com/2024/09/23/how-to-avoid-sequoias-repetitive-screen-recording-permissions-prompts/ |
| [MAC-DOT] | Sequoia 15.1 purple screen-capture indicator — https://developer.apple.com/forums/thread/769968 |
| [WIN-ICONS] | Windows taskbar mic/location in-use indicators + 7-day recent-activity audit — https://www.makeuseof.com/important-windows-taskbar-privacy-icons-meaning/ |

---

## 1. Local-first findings

### 1.1 m5-proactivity-survey.md — perception/activity-supply extract

The survey is heartbeat/delivery-centric; its perception-relevant content:

- **OpenClaw's trigger surface includes file-system change monitors and system events** as agent wake sources — perception feeding proactivity is event/sensor-shaped, decoupled from the LLM turn ([SURVEY:74-80]). Completed background work enqueues a system event that wakes the heartbeat ([SURVEY:78-80]) — the pattern "sensing layer posts state; heartbeat consumes it" (matches our T3a→T4 seam, B7 [SURVEY:303-312]).
- **OpenClaw has NO ambient window/screen sampler** anywhere in the survey's mechanism map ([SURVEY:34-111]): its "context" is inbox/calendar/file sweeps done BY the agent during heartbeat turns, not an OS observation layer. Our foreground sampler is an extension beyond the OpenClaw stack, not a borrow from it.
- **Sensing is called out as the sharp privacy edge**: "window titles and especially screenshots are sensitive… Sensitivity Tier (screenshots off by default, opt-in) + sensitive-process skip list + Privacy Pause are the mitigations. Borrow Hermes's PII redaction before any sensed text enters a prompt" ([SURVEY:377-381]).
- **Prompt injection via sensed content is a named trap**: "A malicious window title or a poisoned memory entry is untrusted input… treat all sensed/recalled content as data, never instructions" ([SURVEY:382-383]) — the A1-minimal mandate. Hermes security-scans memory entries before persisting ([SURVEY:204-205]).
- **Cost/annoyance framing** that binds the activity layer's consumer: heartbeat default cadence 30m, skip-when-empty, quiet hours, rate limits ([SURVEY:61-68, 361-372]) — the activity layer must be cheap, deterministic, zero-LLM supply (matches PRD L3 "all deterministic code, zero LLM").

### 1.2 Reference repos — what exists locally

`references/` contains exactly: `ATRI-main`, `BANDORI-PET-REV-main`, `hermes-agent-main`, `nocturne_memory-main`. **There is NO local OpenClaw checkout** — T2b's `[OC-*]` citations were docs.openclaw.ai web sources, only `[H-*]` were local files ([T2B-RA:15-31]).

**Hermes (`hermes-agent-main`, MIT)** — has NO ambient foreground-activity sampler. Window awareness exists only inside the on-demand `computer_use` tool: it tracks an `_active_window_id` per automation session ([H-CUA:1187]), captures "the frontmost on-screen window or an exact known target" ([H-CUA:1444]), and deliberately REFUSES silent frontmost-fallback when a filter was specified: "Don't silently fall back to the frontmost window when the filter [doesn't match]" ([H-CUA:1988-1995]) and won't "select Visual Studio Code merely because it is frontmost" ([H-CUA:1365]). Transferable norms: (a) window identity = app + window id, resolved explicitly, never guessed; (b) an observation tool that can't satisfy its stated target fails loud, not loose. Hermes proactivity is cron + memory, no perception loop ([SURVEY:238-244]).

**BANDORI-PET-REV (`GPLv3` — learn patterns, never copy)** — a desktop pet with a shipped low-sensitivity foreground-awareness layer; the closest existing implementation of T3a's exact shape:

- **Sampling unit = foreground window only**: `GetForegroundWindow` → `GetWindowThreadProcessId` → `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` → `QueryFullProcessImageNameW` for the owning exe path ([BP-DS:196-245]). This confirms the PRD's assumed Win32 API shape (GetForegroundWindow/GetWindowThreadProcessId) and adds the least-privilege process-open flag (`PROCESS_QUERY_LIMITED_INFORMATION = 0x1000`, [BP-DS:234]). No process enumeration anywhere — foreground-first, structurally excluding system processes (same ruling our owner ratified).
- **Idle/AFK detection**: `GetLastInputInfo` + `GetTickCount64`, default threshold **180 s** ([BP-DS:15, 247-266]) — identical to ActivityWatch's default (§2.1).
- **Deterministic exe→category mapping, zero LLM**: static process-name sets (coding/terminal/browser/chat/media/writing/game, [BP-DS:30-108]) plus title-substring hints ([BP-DS:110-146]), classified into a state with a confidence and a human-readable reason ([BP-DS:169-193]); fallback ladder ends at "desktop / using the computer" (0.45) and "unknown" (0.20) ([BP-DS:191-193]).
- **Title hygiene**: titles whitespace-normalized and truncated to **140 chars** ([BP-DS:16, 274-278]).
- **Privacy defaults for what enters the prompt**: `include_process_name` defaults **true**, `include_window_title` defaults **false** ([BP-SA:66-69]) — process name is treated as low-sensitivity, raw title as opt-in.
- **LLM-visible awareness cadence is heavily clamped**: screen-awareness interval clamped to 5–120 min, default 30 min ([BP-SA:9-20]) — the expensive LLM-facing tier runs orders of magnitude slower than any OS-level sampling.
- **Fail-soft**: any Win32 failure returns an empty dict, never crashes ([BP-DS:216-217, 53]) — degradation matches our "structured error, never crash" bar (ours must be structured, not silent).

**ATRI** (Android chat app) and **nocturne_memory**: no foreground/activity sensing (grep negative; ATRI hits were UI focus state only).

### 1.3 Repo anchors that bind the design

- Governance registry: `CapabilityGovernance { name, cells, floor_classes }`, `GovernanceRegistry::factory()` rows ([GOV:33-37, 114-116]); the FIXED_RISK family already carries `process-list` as `{strict: Ask, standard: Ask, relaxed: Auto, persist: true}` ([GOV:96-105], test [GOV:228-234]).
- Decision memory: `Scope::Once/Session/Always`; session decisions in memory, always-decisions persisted ([DEC:59-70]) — the machinery an "ask" posture over a polled capability composes with (§3).
- Level/posture wire contract: `PermissionLevelSchema = strict|standard|relaxed`, `PermissionPostureSchema = auto|ask|deny` (`packages/shared/src/permission-level-schema.ts:20-25`).
- T2b NL-authorization red lines: agent can never write a decision or flip a Level; conversation grants are inert until the ordinary Approval flow ([T2B-RA:151-154]).

---

## 2. Comparable open-source activity trackers (concrete numbers)

### 2.1 ActivityWatch (the canonical open-source window/AFK watcher)

- **Sampling cadence**: `aw-watcher-window` polls the active window every `poll_time` seconds; observed default **1.0 s** ([AW-CFG]; startup log "Running watcher with poll time 1.0 seconds" — https://github.com/ActivityWatch/aw-watcher-window/issues/33). `aw-watcher-afk`: `poll_time = 5`, `timeout = 180` (**3 min to AFK**) ([AW-AFK-CFG]; [AW-WATCHERS] "an inactive period of at least 3 minutes is flagged as AFK").
- **Coalescing = heartbeat merging with `pulsetime`**: "A merge of two events A and B is done if their `data` is identical and their timestamps are within the `pulsetime` window. The resulting event will have the earlier timestamp, and a duration to match the difference" ([AW-HB]). Implementation: same-data check, `pulseperiod_end = last.timestamp + last.duration + pulsetime`, duration extended via `max(old, new)` so late heartbeats can't shorten an event ([AW-HB-SRC]). If data differs → new event; if outside pulse window → new event ([AW-HB]). The watcher chooses pulsetime slightly larger than its reporting gap — aw-watcher-afk uses `poll_time + timeout` as pulsetime ([AW-AFK-64] maintainer comment). Heartbeats exist "to save on storage space and disk IO"; a single heartbeat has duration zero and durations emerge from merging ([AW-HB]).
- **Granularity**: event data = active `app` + window `title` (+ URL on some browsers) ([AW-WATCHERS]); a title change is a data change → new event (coalescing is per (app, title) identity, [AW-HB]).
- **AFK gating**: window events are only counted as active time when overlapping `not-afk` events; the window watcher expects an AFK watcher running alongside it (aw-watcher-window README — https://github.com/activitywatch/aw-watcher-window).
- **Category mapping**: user-editable **regex rules** matched against the `app` and `title` values; category tree with parent/child; deepest matching sub-category wins; editable in the Settings UI; only rule types are "Regex" and "No rule" ([AW-CAT]). Categorization is applied at query/visualization time (`$category` computed by `aw_transform.classify`, not stored on the event — https://docs.activitywatch.net/en/latest/_modules/aw_transform/classify.html).
- **Privacy defaults**: local-first — "all your time tracking data is stored on your own device and is never sent to any server", SQLite in the data directory ([AW-FAQ]). Titles ARE captured by default; `exclude_title` is an opt-out flag ("Don't track window titles") ([AW-CFG]).

### 2.2 screenpipe (Rewind/Recall-alike, source-available)

- **Capture model**: event-driven, not fixed-FPS — triggers on app switch, click, typing pause, scroll, clipboard; idle fallback captures periodically when nothing happens ([SP-GH]). Defaults: `min_capture_interval_ms = 200` (debounce), **`idle_capture_interval_ms = 30_000` (30 s ambient floor)**, visual-change check every 3 s at 5% frame-diff threshold ([SP-CAP] `Default` impl).
- **Privacy/scoping**: `allow-apps` / `deny-apps` / `deny-windows` glob filters, content-type restriction, time-of-day and day-of-week restrictions; per-agent data permissions enforced deterministically "at the OS level, not prompt-based" ([SP-GH]).
- **Storage/retention**: local SQLite + JPEG frames, ~5-20 GB/month; retention system "defaults to on for new app installs, off for cli" ([SP-GH]; [SP-CHG]).

### 2.3 WakaTime (heartbeat-native time tracking)

- Heartbeats sent when the focused file changes, on save, and **every 2 minutes** of activity in the same file (`TIME_BETWEEN_HEARTBEATS_MS = 120000`) ([WT-FAQ]; [WT-VSC]).
- Raw editor events are debounced 50 ms; heartbeat buffer flushed at most every 30 s ([WT-VSC]).
- **Durations are joined from heartbeats using the keystroke timeout, default 15 min** — gaps shorter than the timeout merge into one duration ([WT-FAQ]).
- Privacy: only tracks inside the editor; plugins stop when typing stops ([WT-FAQ]).

### 2.4 Windows Recall (the OS vendor's ambient-observation precedent)

- **Opt-in, off by default**: "If you don't choose to opt in, it will be off by default and snapshots will not be saved" ([MS-RECALL]).
- Cadence: "a snapshot of your active screen will be saved every few seconds and when the content of your active window changes" ([MS-RECALL2]) — change-driven + slow ambient tick, same family as screenpipe.
- **Persistent tray indicator with state**: a system-tray icon shows when snapshots are being saved / paused / filtered (filter badge); the icon is absent when the feature is off ([MS-RECALL]; [MS-RECALL3]).
- **One-click pause**: "Pause until tomorrow" from the tray; resume requires Windows Hello re-auth; settings changes require Windows Hello ([MS-RECALL2]).
- **Structural exclusions on by default**: private-browsing windows auto-filtered in major browsers; sensitive-information filter (passwords, credit cards) enabled by default; user-editable app/website filter lists; DRM content never stored ([MS-RECALL3]).
- All local, encrypted, per-user ([MS-RECALL]).

---

## 3. Continuous-observation permission UX

A 30 s poll cannot raise a dialog per tick. What the industry actually does:

- **One-time explicit toggle grant** is the baseline for continuous observation: Recall's opt-in toggle ([MS-RECALL]) and macOS TCC's Screen Recording toggle (System Settings switch, granted once) are both standing grants, not per-capture dialogs.
- **A persistent "observation is on" indicator** is the consensus affordance: macOS shows a purple menu-bar/Control Center indicator whenever any app captures the screen ([MAC-DOT]); Windows shows mic/location tray icons while in use, plus a 7-day per-app "recent activity" audit in Settings ([WIN-ICONS]); Recall keeps a stateful tray icon the whole time snapshots are on ([MS-RECALL]).
- **Periodic re-confirmation exists but is contested**: macOS Sequoia re-prompts monthly ("Allow For One Month") for screen recording ([MAC-MONTHLY]); this drew sustained criticism as nagging with confusing buttons, and Apple then reduced dialog frequency for regularly-used apps ([MAC-TIDBITS]; https://9to5mac.com/2024/10/07/macos-sequoia-screen-recording-popups/). Treat expiring grants as optional hardening, not the default.
- **One-click pause** complements the standing grant (Recall "pause until tomorrow" [MS-RECALL2]; our Privacy Pause concept [SURVEY:371-372]).
- **Grant grains for the ask flow** are standardized: Hermes ACP exposes `allow_once / allow_session / allow_always / deny / deny_always`, with timeout→deny fail-closed ([H-PERM:22-26, 114-127]; [T2B-RA:30]).

### Three sourced shapes for a polled capability × ask posture (inside our per-cell model)

Composition rule common to all three: **the gate consults the cell posture on every tick; memory is what makes ask silent; deny means Core never schedules the poll** (fail-closed and quiet — Recall's off state has no tray icon and takes no snapshots [MS-RECALL]; a denied poll must not spam denial errors).

- **S1 — ask-once-per-session, then auto for the session.** First tick under `ask` raises the Approval dialog; a "this session" answer lands in `Scope::Session` memory ([DEC:66-68]) and silences every subsequent tick until Core restarts. Direct analog: Hermes `allow_session` ([H-PERM:23, 50]); session-bounded like Recall's day-bounded pause-inverse ([MS-RECALL2]). Cheapest to ship: zero new machinery — posture + existing decision memory already compose this way.
- **S2 — standing toggle grant ("always") + persistent indicator + one-click Privacy Pause.** The first ask offers "always"; `Remembered::Always` persists ([DEC:69-70], cell `persist: true`), making the grant a de-facto settings toggle — the Recall/macOS-TCC shape ([MS-RECALL]; [MAC-DOT]). The sourced obligation that comes WITH this shape: while sampling is live, the Pet UI/tray shows an observing indicator, and pause is one click ([MS-RECALL]; [WIN-ICONS]; [SURVEY:371-372] — indicator itself is T3b UI, but the grant shape lands in T3a).
- **S3 — expiring grant (re-ask after N days/sessions).** macOS Sequoia's monthly "Allow For One Month" ([MAC-MONTHLY]). Sourced but documented as UX-hostile ([MAC-TIDBITS]); if adopted at all, only for `strict` Level, and never as a per-tick prompt. Recommend: note as deferred hardening, don't ship in T3a.

Recommended: **S2 as the target shape, S1 as its built-in first-run behavior** (they are the same dialog — the user picks session vs always; both scopes already exist in `DecisionStore` [DEC:59-70]). This stays entirely inside the T2b projection model: no new posture kind, no timer machinery.

---

## 4. Activity-layer data shape and retention norms

- **ActivityWatch event** (the minimal norm): `{ timestamp, duration, data }` where window data = `{ app, title }` and AFK data = `{ status: afk|not-afk }`; consecutive events tile time (`e0.timestamp + e0.duration == e1.timestamp`) ([AW-HB]; [AW-23]). Buckets are per-watcher-per-host ([AW-23]). Category is NOT stored — computed at read time from user rules ([AW-CAT]; classify source). Heartbeat merging exists specifically to keep storage/IO bounded ([AW-HB]).
- **WakaTime heartbeat**: `{ entity, timestamp, is_write, project, language, lineno, cursorpos }` — instantaneous points; durations derived server-side by the timeout join ([WT-FAQ]; https://wakatime.com/help/creating-plugin).
- **BANDORI-PET state** (pet-shaped, no history): a single current-state dict `{ state, label, confidence, reason, foreground_title, process_name, app_name, idle_seconds, idle_threshold_seconds, captured_at }` ([BP-DS:155-166]) — a rolling "now" rather than a log; what enters the prompt is filtered by the two include flags ([BP-SA:57-70]).
- **Retention norms**: recorders that serve search keep everything locally and bound by size/policy — screenpipe local SQLite with a retention system on by default for app installs ([SP-CHG]; [SP-GH]); Recall stores locally, encrypted, with disk-space-managed snapshots and user delete controls ([MS-RECALL]; Recall overview — https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/recall/). ActivityWatch keeps data locally with user export/delete but documents no automatic pruning ([AW-FAQ]) — see §OMITTED.

---

## 5. §Recommendations mapped to OUR constraints

Constraints recap: Core is OS-neutral and the single DB writer (inv.2/inv.8); the Windows sampler is a Rust-Shell capability behind the Gate (inv.1); new capability = registry descriptor in `factory()` ([GOV:114-116]); T4 heartbeat is the consumer ([SURVEY:61-68]).

| Default | Value | Source / derivation |
|---|---|---|
| Capability name + sampling unit | `foreground-window`, returns `{ processName, windowTitle }` (+ optional `processPath`-derived app name), foreground window ONLY | Win32 chain `GetForegroundWindow → GetWindowThreadProcessId → OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION) → QueryFullProcessImageNameW` [BP-DS:196-245]; single-window sampling is the AW unit [AW-WATCHERS]; owner-ratified foreground-first (prd.md:15-19) |
| Poll cadence (Core→Shell over WS) | **30 s** default, operator-configurable | 30 s is screenpipe's ambient idle-capture floor [SP-CAP]; Recall's ambient tick is "every few seconds" + change-driven [MS-RECALL2]; AW's 1 s [AW-CFG] is time-accounting fidelity we don't need — our consumer is a ≥30-min heartbeat [SURVEY:61], so 30 s already oversamples it 60×. Derived-with-reasoning from the cited spectrum (1 s trackers ↔ 5-min LLM tiers [BP-SA:9-20]); 30 s matches the PRD's working assumption (prd.md:63-65) |
| Coalescing rule | ActivityWatch heartbeat-merge semantics: merge consecutive samples iff `(processName, windowTitle)` identical AND new sample within `pulsetime` of the previous event's end; extend duration with `max()`; different data or gap → new event | Merge-iff-identical-data-within-pulsetime [AW-HB][AW-HB-SRC]; max-duration guard [AW-HB-SRC] |
| Pulsetime (gap tolerance) | `2 × poll interval` (60 s at default cadence) | Norm = pulsetime slightly exceeds the reporting gap: afk watcher uses `poll_time + timeout` [AW-AFK-64]; exact window-watcher constant unsourced this session (§OMITTED), so derive: one missed/failed tick must not split an event → 2× |
| Dwell debounce (what T4 may see as "an activity") | An entry becomes reportable at **≥ 2 consecutive merged samples (≥ ~60 s)**; shorter stints stay raw | Derived from cited norms: WakaTime treats 2 min same-file as the continuous-activity quantum [WT-FAQ][WT-VSC]; screenpipe debounces raw triggers [SP-CAP]. No comparable publishes an exact "min dwell" for reporting — flagged derived |
| AFK gate | `GetLastInputInfo`-based idle ≥ **180 s** marks the stream idle (samples still coalesce, entry labeled idle) | 180 s is the default in BOTH aw-watcher-afk [AW-AFK-CFG][AW-WATCHERS] and BANDORI [BP-DS:15]; Win32 recipe [BP-DS:247-266]. If owner scopes AFK out of T3a MVP, log in deferred-decisions with T3b trigger |
| Title hygiene at the sampler | Whitespace-normalize + truncate to **140 chars** in the Rust handler before it crosses the WS | [BP-DS:16, 274-278]; also caps the injection surface A1 must fence (prd.md:35-37) |
| exe→category mapping | MVP: small deterministic exe-name→category map + title-hint fallback, confidence-free (or BANDORI-style confidence), zero LLM; user-editable regex rules deferred to settings panel (#26) following the AW model | Static-set pattern [BP-DS:30-108, 169-193]; user-editable regex-on-app+title with deepest-match-wins is the AW end-state [AW-CAT]; category computed at read time, not stored on events [AW-CAT] |
| Activity-layer store + retention | OS-neutral Core module; **in-memory rolling window, bounded** (default: keep coalesced entries covering the last ~2 h, hard entry cap); no DB persistence in T3a | Bounded-by-merging is the AW rationale for heartbeats [AW-HB]; retention-on-by-default precedent [SP-CHG]; window sized to span several heartbeat intervals (default 30 m [SURVEY:61]) — size itself derived (§OMITTED); persistence deferral must be logged per Defer-explicitly rule |
| Event shape | `{ startedAt, durationMs, processName, windowTitle, category?, idle? }` (zod in `@taki/shared`, serde-mirrored) | AW `{timestamp, duration, data{app,title}}` [AW-HB][AW-23]; BANDORI adds state/idle fields [BP-DS:155-166]; contiguity property testable per [AW-23] |
| Prompt exposure defaults | Process name + category always usable; raw title crossing into a prompt goes through the A1 fence (XML-delimited + untrusted-source label) — and consider title-inclusion as the future strict-Level knob | BANDORI defaults: process name in, title out [BP-SA:66-69]; AW ships `exclude_title` as the privacy knob [AW-CFG]; fence mandate [SURVEY:382-383]; Hermes XML-delimits untrusted content in its smart-review [T2B-RA:154, citing H-APR:2585-2602] |
| Governance descriptor | `foreground-window` as a FIXED_RISK-family cell: **`{ strict: Ask, standard: Ask, relaxed: Auto, persist: true }`** | Exact precedent: `process-list` (same observation family, no argClasses) [GOV:96-105, 228-234]; opt-in-by-default for ambient observation is the Recall stance [MS-RECALL]; `persist: true` is what makes ask compose with polling as a standing toggle grant (§3 S2, [DEC:59-70], [H-PERM:22-26]) |
| Ask-over-poll behavior | First tick raises ONE dialog offering session/always ([DEC] scopes); until answered, ticks resolve deny-quiet (no repeat prompts); `deny` posture disables scheduling entirely | Grant grains [H-PERM:22-26]; timeout→deny fail-closed [H-PERM:114-127][T2B-RA:137]; observation-off = fully silent [MS-RECALL] |
| Error degradation | Sampler failure → structured error over WS (`{code, message}`), Core records a gap (no fake idle), agent-readable | BANDORI fails soft-empty [BP-DS:216-217] — we adopt the never-crash property but must surface structure per CLAUDE.md error rule; Hermes fail-loud-not-loose norm [H-CUA:1988-1995] |
| L2 (open-apps enumeration) | Defer out of T3a MVP; foreground-only satisfies the reason-gate supply | No surveyed comparable's ambient layer enumerates windows: AW samples the active window [AW-WATCHERS], Recall snapshots the active screen [MS-RECALL2], BANDORI reads one window [BP-DS:196]; Hermes enumerates only inside explicit computer-use automation [H-CUA:1444] |

---

## 6. §OMITTED (thought of, could not source — quarantined)

- **Exact `aw-watcher-window` pulsetime constant** (believed `poll_time + 1.0` from memory of its `main.py`): not verified against a fetchable source this session — only the afk watcher's `poll_time + timeout` rule is cited [AW-AFK-64]. The adopted "2× poll" is therefore a derivation, not that constant.
- **ActivityWatch retention default**: docs confirm local storage and manual export/delete [AW-FAQ] but I found no authoritative statement of an automatic retention/pruning default. "No auto-pruning" is an inference; do not cite it as a norm.
- **The 2-hour rolling-window size and the hard entry cap number**: no comparable publishes an ambient-context retention window for a reason-gate consumer; the value is pure sizing reasoning (cover ≥4 heartbeat intervals). Owner should treat the number as tunable, not sourced.
- **"Reportable at ≥2 consecutive samples" dwell threshold**: constructed from WakaTime's 2-min quantum + debounce norms; no system publishes a min-dwell-for-reporting figure.
- **Posture-linked title redaction** (strict Level strips titles, standard includes them): composed from BANDORI's include-flags + AW's `exclude_title`, but no surveyed system ties title granularity to a permission LEVEL — the linkage is our idea.
- **Browser-URL capture** (AW captures URLs on Chromium/Safari [AW-WATCHERS]): noted as a future higher-sensitivity cell; no design proposed — it needs its own governance ruling (closer to T3b).
- **A "sampling is active" indicator inside the Pet UI in T3a**: the indicator NORM is sourced (§3), but any concrete T3a-scope UI is unsourced against our T3b boundary (prd.md:100 puts the activity UI card in T3b); flagged for the owner's MVP-boundary call.
