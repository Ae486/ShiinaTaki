# Research: Ecosystem Gap Scan (cautious 谨慎权衡)

- **Query**: PRD Q3 — high-confidence, mature glue for TakiAgent stack gaps; adopt/reject/defer per candidate
- **Scope**: external (web)
- **Date**: 2026-07-07

Verdict discipline: recommend ONLY mature, actively-maintained glue that removes real build cost and does not duplicate a decision already in TECH-STACK/ADRs. Everything speculative → reject or defer.

---

## Compact verdict table

| # | Gap | Candidate | Version / signal | Verdict |
|---|---|---|---|---|
| 1 | Rust↔TS type sync | tauri-specta | v2.0.0-**rc.25** (2026-05-08), still no stable | **DEFER/REJECT** |
| 1 | Rust↔TS type sync | ts-rs | 12.0.1 (2026-01-31), stable, MSRV 1.88 | **REJECT** (wrong direction) |
| 1 | Rust→zod codegen | zod_gen / serde-zod | zod_gen 1.3.0 (2025-07); serde-zod (partial) | **REJECT** (inverts source of truth) |
| 1 | zod→Rust codegen | (none mature) | — | n/a — manual serde mirror stays |
| 2 | Per-pixel click-through | tauri-plugin-polygon | Tauri 2, Win/Linux/macOS ✅ | **DEFER** (polygon only, not alpha) |
| 2 | Alpha hit-test | custom setIgnoreCursorEvents + mouse poll | community pattern, no plugin | **BUILD** (already in TECH-STACK) |
| 3 | JSON-RPC 2.0 over WS | json-rpc-2.0 (npm) | transport-agnostic, mature | **ADOPT** (envelope only) |
| 3 | JSON-RPC 2.0 over WS | rpc-websockets | v10.0.1, active | **REJECT** (bundles own ws) |
| 4a | Live2D lip-sync | built-in `attachAnalyzer` / `model.speak` | in Sekai-World + RaSan147 forks | **ADOPT** (comes with spike lib) |
| 4b | .zst read in Node | node:zlib zstd (built-in) | Node ≥ 22.15 / 23.8 | **ADOPT if confirmed** on Node 24 |
| 4b | .zst read fallback | fzstd + tar-stream | fzstd 8kB pure-JS, streaming | **ADOPT (fallback)** |
| 5 | SKILL.md loader | agentskills.io convention | many TS refs (deepagents, agentos) | **BUILD tiny** (reject deps) |
| 6 | Tauri single-instance | official plugin | maintained | **ADOPT (must)** |
| 6 | Tauri autostart | official plugin | maintained | **ADOPT (must)** |
| 6 | Tauri positioner | official plugin | maintained | **ADOPT (should)** |
| 6 | Tauri updater / notification | official plugins | maintained | **PLAN-FOR** |

---

## Findings

### 1. Rust↔TS type synchronization (vs ADR 0004: zod is source of truth)

**tauri-specta** — https://github.com/specta-rs/tauri-specta · https://crates.io/crates/tauri-specta
- Latest: `2.0.0-rc.25` (2026-05-08). Repo 689★, last push 2026-03. **Still a release candidate** after 4 years; the upstream `specta` v2 release note (rc.25) says stable "drops mid next month" but that has been repeatedly slipped ("put on hold multiple times"). Not yet stable as of 2026-07.
- Direction: generates **Rust → TypeScript** (`.ts` bindings from `#[derive(specta::Type)]`). Also emits typed command/event wrappers.

**ts-rs** — https://crates.io/crates/ts-rs · https://lib.rs/crates/ts-rs
- Latest: `12.0.1` (2026-01-31), MSRV 1.88 (matches our Rust ≥1.88). Genuinely stable, 12 major releases, 51 contributors. Emits `.ts` type declarations from `#[derive(TS)]`, serde-compatible, via a generated `cargo test`.
- Direction: also **Rust → TypeScript** only.

**Rust → zod tools** (found, but note direction):
- `zod_gen` 1.3.0 (2025-07) — https://crates.io/crates/zod_gen — `#[derive(ZodSchema)]` → `z.object(...)` + `z.infer` type, full serde rename/enum-representation support.
- `serde-zod` — https://github.com/shakyShane/serde-zod — partial (`rename_all` unimplemented).

**Critical verdict**: ADR 0004 makes **zod the single source of truth**, with Rust mirroring via serde. Every mature tool here runs the **opposite** direction (Rust → TS or Rust → zod), which would make Rust authoritative and demote the zod schemas to generated artifacts — a direct architecture inversion. There is **no mature zod→Rust generator** (specta's `specta_zod` exporter is listed "Planned", not shipped: https://github.com/specta-rs/specta). Given a small protocol surface in `@taki/shared`, hand-written serde structs mirroring the zod schemas remain the correct, lowest-risk path. **Reject codegen now.** Only reconsider tauri-specta if (a) it ships stable AND (b) the team ever decides to flip the source of truth to Rust — neither is true today.

### 2. Per-pixel click-through / transparent overlay (Tauri 2, Windows)

Tauri has **no built-in transparent-area hit-testing** and the maintainers have explicitly declined to implement Electron-style `setIgnoreMouseEvents(forward)` alpha detection (tracking issues #2090, #6164, #13070). The supported primitive is `WebviewWindow.setIgnoreCursorEvents(bool)` (whole-window toggle).

Two real options:
- **tauri-plugin-polygon** — https://github.com/houycth/tauri-plugin-polygon — Tauri 2 plugin, Windows/Linux/macOS ✅ (no mobile). Define polygon hit regions in normalized coords; plugin toggles cursor events + emits click events for unregistered areas. Good fit **if** the pet's interactive region can be approximated by polygons. Small project, verify maintenance before committing.
- **Custom alpha hit-test** (the TECH-STACK "hardest module" plan): Rust captures global cursor position (or window preview bitmap), reads the alpha at the cursor pixel, and calls `set_ignore_cursor_events(alpha == 0)` on a ~16ms loop. Working community implementations exist (Xinyu-Li-123/tauri-clickthrough-demo hitbox pattern; the `use_mouse_through` Rust snippet in issue #2090 does exactly capture-preview → decode → per-pixel alpha → toggle).

**Verdict**: For true per-pixel Live2D silhouette click-through, custom Win32/`windows`-crate alpha hit-test remains the path (matches TECH-STACK; budget the spike). **Defer** tauri-plugin-polygon as a possible simpler substitute if polygon regions prove acceptable — do not adopt blind.

### 3. JSON-RPC 2.0 over WebSocket for Node

- **json-rpc-2.0** — https://www.npmjs.com/package/json-rpc-2.0 — **transport-agnostic** (HTTP/WS/TCP/anything), tiny, no runtime type-checking (we add zod). Because it does not own the socket, it composes cleanly with our already-chosen `ws` server and per-message zod validation. Handles request/response correlation, notifications, error envelopes.
- **rpc-websockets** 10.0.1 — https://www.npmjs.com/package/rpc-websockets — mature/active but **bundles its own WebSocket server/client**, duplicating the `ws` decision and fighting our ADR-0004 pairing/identity handshake. Reject.
- **typed-rpc** 6.1.2 — type-only, no batch, no runtime validation, 2.2K weekly downloads. Lighter than needed.

**Verdict**: **Adopt json-rpc-2.0 for the envelope/correlation layer only** (or hand-roll ~1 small module — the envelope is trivial), keeping `ws` as transport and zod as the validation gate. This preserves the shared-schema architecture: zod validates the `params`/`result` payloads; json-rpc-2.0 handles id/method plumbing. Reject any lib that owns the socket.

### 4. Live2D auxiliaries

**4a. Lip-sync from audio amplitude** — this ships **inside** the Live2D lib the spike will pick, so no separate dependency:
- Sekai-World/pixi-live2d-display — https://github.com/Sekai-World/pixi-live2d-display — "Live Lipsync"; `motionManager.attachAnalyzer(analyzer)` drives `ParamMouthOpenY` from a Web Audio `AnalyserNode`, works for realtime mic/streamed audio too; `stopSpeaking()` releases it.
- RaSan147/pixi-live2d-display (lipsync fork) + `pixi-live2d-display-advanced` — add `model.speak(audioUrl, {volume, expression, onFinish})`. PR #122 extracted a reusable `LipSync` class.
- Note: amplitude-only (not phoneme/vowel MotionSync). Good enough for a companion; TTS→amplitude path is straightforward via `AudioContext.createAnalyser`. **Adopt whatever the spike lib provides; build nothing extra.**

**4b. Reading `.zst` (tar+zstd) in Node** for the BanG Dream import pipeline:
- **First choice — `node:zlib` built-in zstd.** Node added native Zstandard to `node:zlib` (`zstdCompress`/`zstdDecompress` + streaming `createZstdDecompress`) around v22.15 / v23.8. We target **Node ≥ 24**, so this likely removes the dep entirely — pair with `tar-stream` (or `node-tar`) for the tar layer. **Verify the exact API against installed Node 24 docs before relying on it** (do not code from memory per CLAUDE.md).
- **Fallback — `fzstd`** — https://github.com/101arrowz/fzstd — pure JS, 8kB, **supports streaming** (important: WASM ports need decompressed size up-front and can't stream). Decompress-only, which is all the importer needs. Pair with `tar-stream`.
- Other WASM options (`@bokuweb/zstd-wasm`, `zstandard-wasm`, `zstd-wasm-decoder`) are faster but heavier and mostly non-streaming. `@xingrz/decompress-tarzst` bundles tar+zst but is **alpha** — reject.

**Verdict**: Prefer built-in `node:zlib` zstd (zero deps) if confirmed on Node 24; else `fzstd` + `tar-stream`. Both keep to the "keep the `.zst` as source, extract on import" v1 plan.

### 5. SKILL.md loader

The convention (YAML frontmatter `name`/`description` + markdown body in a per-skill dir) is codified at **agentskills.io/specification** and implemented in many open TS loaders:
- langchain-ai/deepagentsjs `skills/loader.ts` — https://github.com/langchain-ai/deepagentsjs — clean reference: `parseSkillMetadata`, dir scan, user/project precedence, symlink/path-traversal + size guards. (Apache-2 — study, don't copy given our GPLv3-avoidance discipline anyway.)
- framerslab/agentos `SkillLoader.ts`, Link-Reverie/skill-toolbox, ivanzwb/agent-skills (three-level L0→L1→L2 progressive loading), claude-world/skill-universal.

**Verdict**: The loader is ~100 lines (frontmatter parse + directory walk + description injection). It is exactly the "OpenClaw/Claude Code convention" already in TECH-STACK, and pulling a dep would add a moving target for trivial logic. **Build our own tiny loader in `packages/core/src/skills/`**, using the deepagents/agentos structure and the agentskills.io field set (`name`, `description`, optional `license`/`compatibility`/`allowed-tools`, max-lengths, path-safety) as design references. Reject adding a library.

### 6. Tauri 2 official plugins to plan for now

All from https://github.com/tauri-apps/plugins-workspace (official, actively maintained; https://v2.tauri.app/plugin/):
- **single-instance** — must-have; a desktop pet must not spawn duplicates. Must be registered **first** to run before other plugins.
- **autostart** — must-have; companion should launch at system boot (`enable`/`disable`/`isEnabled`, needs `autostart:allow-*` capabilities).
- **positioner** — should-have; place the pet at corners / tray-relative locations (`moveWindow(Position.TopRight)`; tray-relative needs the `tray-icon` feature + `on_tray_event` wiring).
- **updater** — plan-for; needed for distribution (requires Rust ≥1.77.2, signed static JSON or update server).
- **notification** — plan-for; native toasts for agent messages/permission prompts.
- (opener already chosen in TECH-STACK.)

**Verdict**: Adopt single-instance + autostart now (day-one desktop-pet correctness), positioner when window placement is built, updater/notification when distribution/notifications land. Each needs a matching entry in `src-tauri/capabilities/*.json` (per CLAUDE.md gotcha).

## Caveats / Not Found

- tauri-specta stable ship date is unverified — the "mid next month" claim in rc.25 (2026-05) had not materialized as a stable crate release at time of search; treat as still-RC.
- Native `node:zlib` zstd API on **Node 24 specifically** was inferred from Node's zstd landing (v22.15/v23.8) but the exact exported names/streaming class must be confirmed against the installed Node 24 docs before implementation.
- tauri-plugin-polygon maintenance depth (single-author, star/release count) was not fully quantified — verify before adopting.
- Whether polygon regions vs true per-pixel alpha is acceptable for the pet UX is a product decision, not resolved here.
