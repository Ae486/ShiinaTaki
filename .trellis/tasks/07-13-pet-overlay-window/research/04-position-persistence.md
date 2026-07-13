# Research: Window position persistence across restarts — the design decision

- **Query**: evaluate (a) `tauri-plugin-window-state`, (b) persist via Agent Core over WS, (c) small Tauri-side config file; frame the "state of record vs local window-manager state" tension for the leader to rule on
- **Scope**: mixed (crate/npm verification + repo architecture invariants)
- **Date**: 2026-07-13
- **NOTE**: this file lays out options; it does NOT decide. The leader decides.

## The core tension

Is the pet's on-screen position **state of record** (→ Agent Core DB, per CLAUDE.md invariant 2 "one writer" + frontend spec "durable state belongs to the Agent Core, not localStorage") or **local window-manager chrome** (→ OS/Tauri-side, like any app remembering where its window was)?

- Argument it's **local WM state**: it's per-display, per-machine, meaningless to the agent's reasoning, and semantically identical to "where did I last drag my window" — exactly what every desktop app stores locally. The Agent Core is explicitly OS-neutral (invariant 8, must run on headless Ubuntu VPS) and has no concept of monitors/DPI. Pushing pixel coords through the WS protocol pollutes an OS-neutral core with display-manager concerns.
- Argument it's **state of record**: the frontend spec says "no localStorage for durable state; durable state belongs to the Agent Core." A saved position survives restart → it's durable. Invariant 4 says the Pet UI is disposable; disposable clients shouldn't own persistence.

These pull opposite ways. The resolution hinges on whether "durable state belongs to Agent Core" was meant to cover **display-manager state** or only **domain state** (sessions, memory, config). My read: the spec's examples ("sessions, memory, config") are all agent-domain; window geometry is a different category. But this is the leader's call.

---

## Option (a) — `tauri-plugin-window-state` (official Tauri plugin)

**Verified exists for Tauri 2.** Crate `tauri-plugin-window-state`, npm `@tauri-apps/plugin-window-state`, **latest v2.4.1** (published Oct 2025), license MIT OR Apache-2.0, part of the official `tauri-apps/plugins-workspace` (`v2` branch). Min Rust 1.77.2 (repo is on 1.95 — fine).

- **What it persists**: window position, size, and (via `StateFlags`) maximized/fullscreen/visible/decorations state. Relevant flags: `POSITION`, `SIZE`.
- **Where it stores**: a JSON file (`.window-state.json`) in the app config dir (`app_config_dir`), managed entirely by the plugin. Not the Agent Core DB, not localStorage.
- **How it works**: register the plugin; by default **all** windows auto-save on close and auto-restore on launch. Rust:
  ```rust
  tauri::Builder::default()
      .plugin(tauri_plugin_window_state::Builder::default().build())
  ```
  Manual control via traits (verified from docs):
  ```rust
  use tauri_plugin_window_state::{AppHandleExt, WindowExt, StateFlags};
  app.save_window_state(StateFlags::all());        // AppHandleExt
  window.restore_state(StateFlags::all());          // WindowExt
  ```
  JS: `import { restoreStateCurrent, saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state'`.
- **Scoping to one window**: the plugin Builder supports a denylist/allowlist and skip-initial-state options so you can persist only the `pet` window (e.g. exclude `main`). (Exact builder method names — `with_denylist` / `skip_initial_state` — appear in the plugin's builder; verify against installed source when wiring, since it is NOT yet a dependency.)
- **Cost**: adds a Cargo dep + an npm dep + a capability permission (`window-state:default` or similar — regenerate schema and check). Currently **NOT installed** (confirmed: no `node_modules/@tauri-apps/plugin-window-state`, not in `Cargo.toml`).
- **Pros**: zero custom code, battle-tested, handles DPI/monitor edge cases and off-screen-restore clamping, purpose-built. **Cons**: introduces a plugin that lives only in `apps/desktop` (fine — Windows-specific layer); stores outside the Agent Core, so if the leader deems position "state of record" this violates the single-writer intent.

## Option (b) — persist via Agent Core over WS

The overlay reads its position (`outerPosition()`), sends it to the Agent Core over the existing WS protocol on move/close; the Core writes it to its SQLite DB (the one sanctioned writer); on launch the overlay requests it and calls `setPosition(...)`.

- **What it requires**:
  1. A new WS method pair in `@taki/shared` (zod schema — protocol types defined once) e.g. `pet.savePosition` / `pet.getPosition`, mirrored in Rust serde.
  2. A DB table/column in the Agent Core for pet geometry.
  3. Core handler + registry entry (features are pluggable modules — invariant 7).
  4. Shell/UI wiring: debounce `onMoved`, send on change; on launch fetch + `setPosition`.
- **Pros**: single source of truth, consistent with "durable state → Agent Core"; survives even if the config file is wiped; positions could theoretically sync if the pet ever runs against a remote core. **Cons**: heaviest option; puts pixel/monitor coordinates into an OS-neutral core (invariant 8 tension — the Ubuntu VPS core would store Windows display coords it can't interpret); a restore-before-first-paint requires the position to arrive over WS before the window shows (ordering/latency risk → possible visible jump); reimplements off-screen clamping and DPI handling the plugin already solves.

## Option (c) — small Tauri-side config file

A minimal Rust-side read/write of a JSON file (e.g. under `app_config_dir`) holding `{x, y}`, written on `onMoved`/close, read on setup and applied via `setPosition`.

- **Pros**: no new plugin dep, no protocol change, keeps geometry out of the Core; full control. **Cons**: you hand-roll exactly what option (a) already provides (debounce, off-screen clamp, DPI, atomic write) — reinventing a solved wheel; more code to maintain than (a).

---

## Framing for the leader (recommendation)

**Recommended: option (a) `tauri-plugin-window-state`, treating position as local window-manager state.**

Rationale: window geometry is display-manager chrome, not agent-domain state of record; it is per-machine and meaningless to an OS-neutral core; the official plugin solves the hard parts (DPI, multi-monitor, off-screen clamping, atomic save) that options (b) and (c) would force us to re-implement. It lives cleanly in the `apps/desktop` (Windows) layer where OS-specific concerns belong (invariant 8), and it does not touch the WS protocol or the Core's single-writer DB.

**The one thing that would flip the decision to (b):** if the leader rules that the frontend spec's "durable state belongs to the Agent Core" is categorical (covers *any* persisted value, including geometry), then (b) is mandated and (a)/(c) are spec violations. That is a spec-interpretation call only the leader can make. If (b) is chosen, budget for the restore-before-first-paint ordering problem (show the window only after the position arrives, or start `visible:false` and show post-restore).

**(c)** is the fallback if the leader wants geometry kept local (agrees with a's philosophy) but wants to avoid adding a plugin dependency — at the cost of hand-rolling clamping/DPI.

## Caveats / Not Found

- Exact `tauri-plugin-window-state` v2 Builder method names for per-window filtering (`with_denylist` / `skip_initial_state`) are stated from the plugin's public API but NOT verified against installed source (plugin is not installed). Verify when wiring.
- The capability permission identifier the plugin requires (e.g. `window-state:default`) will only appear in `gen/schemas` after the plugin is added and schema regenerated — not verifiable now.
- Whether the pet window's launch position must be restored *before first paint* to avoid a visible jump is a UX detail to confirm in smoke, and it disproportionately penalizes option (b) (WS latency).

## Sources

- Plugin: https://v2.tauri.app/plugin/window-state/ ; crate https://docs.rs/crate/tauri-plugin-window-state/2.4.1 ; npm https://registry.npmjs.org/@tauri-apps/plugin-window-state (v2.4.1); repo https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/window-state
- Repo architecture: `CLAUDE.md` invariants 2, 4, 7, 8; `.trellis/spec/frontend/state-management.md`
- Confirmed not installed: no `@tauri-apps/plugin-window-state` in node_modules; not in `apps/desktop/src-tauri/Cargo.toml`
