# T3a Perception (#19): low-sensitivity foreground sampling -> activity layer + A1 fence (minimal)

## Goal

Give the agent low-sensitivity awareness of what the user is doing right now: sample the FOREGROUND
window (title + owning process name), roll it into an OS-neutral **activity layer** in Agent Core, and
fence that content on its way into any prompt (**A1 minimal**: XML delimiting + untrusted-source
labeling — this is the first time external-world content enters the prompt). T3a is the supply side of
proactivity: T4's heartbeat reason-gate consumes the activity layer.

## What I already know

* M5 blueprint (devlog/m5.md task table): T3a = "窗口/进程低敏采样 → activity 层; A1 注入围栏最小版".
  High-sensitivity screen sampling, Privacy Pause, sensitive-process skip, PII scrubbing are **T3b (#20)**.
* Owner-ratified capture stance (2026-07-21 conversation): **foreground-first** is the primary strategy —
  the sampling unit is the foreground window + its owning process, NOT a full process enumeration.
  System/background processes (svchost, dwm...) are structurally excluded (no foreground window, no
  user-visible title); no fragile system-process blocklist. Owner explicitly probed this and accepted
  foreground-first.
* Three-layer narrowing (shape agreed, details are research rulings):
  L1 foreground-only sample; L2 (only if "which apps are open" is needed) visible+titled+top-level
  window enumeration, never all processes; L3 activity-layer shaping in Core — dwell debounce,
  coalescing consecutive same-window samples ("on X for 12 min"), optional exe→category mapping.
  All deterministic code, zero LLM.
* Architecture invariants that bind this task:
  - inv.1: sampling is an OS action → it is a **capability** crossing the WS boundary to the Rust Gate.
  - inv.8: the Windows-specific sampler (Win32 foreground APIs) lives in `apps/desktop` (Rust Shell);
    the activity layer (OS-neutral) lives in `packages/core`.
  - inv.2: Agent Core is the only DB writer — activity data lands Core-side.
  - inv.7: pluggable module + registry entry (new capability = handler + registry row; activity layer =
    its own Core module).
* T2b governance is live and MUST be consumed, not bypassed: a new sampling capability gets a
  `CapabilityGovernance` descriptor (cells + per-Level postures) in `gate/governance.rs::factory()`;
  `process-list` already exists as a fixed-risk cell `{strict:Ask, standard:Ask, relaxed:Auto, persist:true}`.
* A1 (from the memory redesign six-piece set): the minimal version ships WITH T3 — sampled content
  (window titles are untrusted external input; a title saying "ignore all previous instructions" is an
  injection surface) must be XML-fenced + source-labeled from day one, before it ever reaches a prompt.
* Research bank to fold in: `.trellis/workspace/pleia/m5-proactivity-survey.md` (OpenClaw five-mechanism
  stack / perception supply; B1-B11 borrow ranking).
* Owner's hard rule for design work: every rule/design templated from authoritative sources
  (Anthropic/OpenAI/OpenClaw/Hermes/MCP/Claude Code/Codex) with citations; unsourced ideas go to
  §OMITTED. External APIs (Win32, crates) verified against current docs, never from memory.
* `sysinfo` 0.39 is already a pinned crate (used for process-list); foreground-window APIs are Win32
  (GetForegroundWindow/GetWindowThreadProcessId shape — MUST be verified by research, not coded from
  memory).

## Assumptions (resolved during brainstorm — kept for traceability)

* Pull-style sampling confirmed: Core polls over WS (Core asks, Shell answers) — poll beats
  SetWinEventHook (hook needs a message-pump thread; rb ruling).
* Capability name: `foreground-window` (kebab, matching `process-list`); three name sites must agree
  exactly (node.rs default_capabilities / handler capability() / governance cell key — rc §6.9).
* Activity layer is in-memory bounded rolling state; NO DB persistence in T3a (deferral logged).
* T4 consumes via an internal Core seam (activity-state read API); T3a only guarantees a readable,
  bounded state.

## Requirements

* `foreground-window` capability in Rust Shell: xcap focused-window → title + pid (+ sysinfo
  fallback for process name), GetLastInputInfo idle seconds, title normalize + truncate 140 chars;
  structured `{available:false}` no-sample when no focused window (pet window/desktop foreground);
  UWP reported as-is (ApplicationFrameHost + frame title). Zero new crates.
* Governance: one FIXED_RISK cell `{strict:Ask, standard:Ask, relaxed:Auto, persist:true}`; approval
  dialog discloses that titles are sampled; deny/unanswered → sampler deny-aware backoff, deny
  posture → no scheduling at all. ws_client routing unchanged (default evaluate_by_class arm).
* Protocol: `ForegroundWindowOutputSchema` (strictObject) in shared + serde mirror + fixture pair +
  both-sides golden tests (vitest sweep + cargo golden).
* OS-neutral `packages/core/src/activity/` module: `activity-state.ts` (heartbeat-merge coalescing on
  identical (processName, windowTitle) within pulsetime 2×poll; dwell-reportable >=2 merged samples;
  idle marking; bounded ~2h window + hard entry cap), `activity-sampler.ts` (30s setInterval(...).unref()
  loop → routeCapability → parse → push; NO_NODE/denied/timeout → skip tick + backoff, never crash).
* A1 minimal fence: `packages/core/src/agents/untrusted-fence.ts` (XML delimiting + untrusted-source
  label, reusable); activity context rendered through it and joined via the `instructionsExtra` seam.
* Structured error degradation on every path; index.md rows + module-contract headers per conventions.

## Open Questions

(none — all resolved; see Decisions)

## Decisions (owner-ratified 2026-07-21)

* **Scope = L1 foreground-only.** The sampling unit is the foreground window + owning process; NO L2
  visible-window-set enumeration in T3a (activity-layer design must not preclude adding it later).
  Research corroborates: no surveyed comparable's ambient layer enumerates windows (ra §5 L2 row).
* **No exe→category mapping in MVP.** T3a delivers raw signal (app name + title + dwell); category
  interpretation is left to the consumer (T4's LLM reads "Code.exe / <title>" natively). No mapping
  table to maintain; revisit only if T4 shows a concrete token/precision need. (Supersedes ra §5's
  mapping row, which was drafted before this ruling.)
* **Window title ENTERS the prompt by default — always inside the A1 fence** (XML-delimited +
  untrusted-source label + 140-char truncation). Rationale: with no category mapping, title carries
  most of the signal; the capability itself is explicitly granted (the approval dialog text MUST
  disclose that titles are included). Title-exclusion knob deferred to #26; sensitive-process skip +
  PII scrubbing harden in T3b. (Deviates from the BANDORI title-out default [BP-SA:66-69] — owner call.)
* **AFK/idle detection IS in T3a**: GetLastInputInfo-based idle, threshold 180s (ActivityWatch +
  BANDORI convergent default), reported by the same handler (e.g. `idleSeconds` field); the activity
  layer marks entries idle so T4 never sees "on X for 3h" while the user is away.

## Adopted design (research-converged; owner may veto)

* **Governance**: `foreground-window` joins the FIXED_RISK descriptor as one name-keyed cell
  `{strict: Ask, standard: Ask, relaxed: Auto, persist: true}` — the exact `process-list` precedent
  (governance.rs:96-105) and consistent with the owner's 2026-07-21 fixed-risk conservative ruling;
  ambient observation is opt-in by default (Recall stance [MS-RECALL]). Registry row-count test 19→20.
* **Continuous-observation UX = S2-with-S1-first-run** (ra §3): the FIRST sample tick under an ask
  posture raises ONE approval dialog offering once/session/always; a session/always answer silences
  subsequent ticks via existing DecisionStore — a de-facto standing toggle, zero new machinery.
  Deny posture (or explicit deny) = Core stops scheduling (quiet, no per-tick spam); an unanswered/
  denied tick triggers deny-aware backoff in the sampler (rc §6.2 hazard), never a re-prompt loop.
* **Defaults** (deterministic, config-ized later per D11; several values are reasoned derivations —
  flagged in ra §6 — treat as tunable): poll 30s; coalesce = ActivityWatch heartbeat-merge on
  identical (processName, windowTitle) within pulsetime 2×poll; dwell-reportable at >=2 merged
  samples (~60s); title whitespace-normalized + truncated to 140 chars in the Rust handler; activity
  state = in-memory bounded rolling window (~2h span + hard entry cap), NO DB persistence in T3a
  (log deferral).
* **Event shape**: `{ startedAt, durationMs, processName, windowTitle, idle? }` (zod in shared,
  serde-mirrored; category field omitted per no-mapping ruling).
* **Win32 (rb, doc-verified)**: zero new crates — xcap 0.9.6 `Window::all()` → `is_focused()` →
  title/pid, fallback to sysinfo for process name; no-focused-window (pet window/desktop foreground,
  xcap excludes own process + Progman) returns structured `{available:false}` no-sample, never an
  error; UWP reported as ApplicationFrameHost + frame title (defer unwrap — ActivityWatch parity);
  polling over SetWinEventHook (hook needs a message-pump thread, inverts our pull architecture).
* **Leader rulings (architectural)**: sampler is SYSTEM-initiated — calls `routeCapability` directly
  (rc §2.3; never wrapped in `tool()`, no LLM-facing tool in T3a); sampling loop follows the
  attachment-GC `setInterval(...).unref()` precedent (croner stays unused, D5 untouched); the A1
  fence helper lives in `packages/core/src/agents/untrusted-fence.ts` (fencing is a prompt-assembly
  concern; future consumers: T3b screen content, screenshot VLM description, T5 full A1) and the
  activity section enters the prompt via the `instructionsExtra` seam (main.ts:307-308, ruling 10 —
  never through the memory assembler); FIXED_RISK row (rc §1.4 Shape 1) over a new descriptor —
  extract a perception descriptor only when T3b actually adds cells/floors.

## Requirements (evolving)

* Foreground-window sampling capability in Rust Shell (Win32), behind the Permission Gate with a
  governance descriptor (T2b registry).
* OS-neutral activity layer module in `packages/core`: rolling window of samples, dwell debounce,
  same-window coalescing; bounded memory.
* A1 minimal fence: any sampled string entering a prompt is XML-delimited + labeled untrusted
  observation; fence lives at the injection seam, not scattered per-consumer.
* Structured error degradation on every capability path (failing sample = readable error, never crash).

## Acceptance Criteria

* [ ] Foreground sample crosses WS → Gate → handler and returns `{processName, windowTitle, idleSeconds,
      available}` on Windows; no-focused-window returns `{available:false}` (not an error).
* [ ] Governance: `foreground-window` cell projects `{strict:Ask, standard:Ask, relaxed:Auto}`,
      persist:true; registry fold count updated 19→20; unregistered-key fail-closed path untouched.
* [ ] Ask-over-poll: first tick raises ONE dialog; session/always answer silences later ticks
      (existing DecisionStore); denied/unanswered ticks back off — no re-prompt loop (unit-tested with
      a fake router in core).
* [ ] Activity layer produces coalesced "on (process, title) for N ms" entries with idle marking from
      synthetic sample streams (pure unit tests, no OS dependency); memory stays bounded (cap test).
* [ ] A1 fence: a hostile window title ("ignore previous instructions...") reaches the composed prompt
      only inside the fence with an untrusted label (unit test); activity section joins via
      instructionsExtra, absent when empty.
* [ ] `packages/core` stays OS-neutral (no Windows-only deps; all core tests OS-independent).
* [ ] Protocol fixtures parse/reject identically in vitest AND cargo golden tests.
* [ ] cargo test + clippy -D warnings + pnpm -r typecheck + pnpm lint + pnpm test all green.

## Definition of Done (team quality bar)

* Tests added (Rust sampler classify/deny paths; TS activity layer + fence).
* Research citations present for every adopted design rule; unsourced ideas quarantined in §OMITTED.
* Folder index.md files updated for touched dirs; module-contract headers on new files.
* Deferred items logged in docs/deferred-decisions.md with triggers (no bare TODOs).

## Out of Scope (explicit)

* Screen/screenshot sampling, Privacy Pause, sensitive-process skip, PII scrubbing, activity UI card → T3b (#20).
* Heartbeat/reason-gate consumption logic → T4 (T3a only provides the readable activity state).
* Settings-panel UI for sampling config → #26.
* Full A1 (streaming scrub, write-time threat scan) → T5; only the minimal fence ships here.

## Research References

* [`research/ra-perception-comparables.md`](research/ra-perception-comparables.md) — comparables survey
  (ActivityWatch/screenpipe/WakaTime/Recall/BANDORI/Hermes): cadence numbers, heartbeat-merge coalescing,
  continuous-observation UX shapes S1-S3, governance-cell proposal, §OMITTED-quarantined derivations.
* [`research/rb-win32-foreground-api.md`](research/rb-win32-foreground-api.md) — doc-verified Win32 path:
  zero new deps (xcap 0.9.6 + sysinfo 0.39.6), focused-window sequence, no-sample/UWP/encoding caveats,
  poll-over-hook ruling.
* [`research/rc-codebase-frontload.md`](research/rc-codebase-frontload.md) — end-to-end wiring map with
  file:line for every seam: 6 additive edits + 2 new files for the capability, activity module layout,
  routeCapability system-initiated precedent, fence-home candidates, risks (deny-backoff, name-site
  agreement, headless-test tolerance). NOTE its §6.7 "uncommitted T2b" caveat is stale — T2b landed
  (commits 111c81b..ddd21dd); on-disk line refs remain valid.

## Technical Notes

* Repo anchors: `apps/desktop/src-tauri/src/capabilities_impl/` (handler pattern),
  `gate/governance.rs` (descriptor registry), `packages/core/src/capabilities/` (Core-side clients),
  `packages/shared/src/` (protocol schemas, zod + serde mirror).
* Research bank: `.trellis/workspace/pleia/m5-proactivity-survey.md`.
* Win32 foreground APIs and any new crate MUST be doc-verified (context7/deepwiki/exa) before coding.
