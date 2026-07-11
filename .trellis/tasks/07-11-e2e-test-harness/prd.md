# PRD — Headless e2e test harness + dev scripted approver

Manual smoke of the capability system relied on a human clicking native dialogs, but most verification signals (logs, agent reply, file landing, audit content, credential presence) are machine-readable and the one human step — clicking the approval dialog — is replaceable because `Approver` is an injectable trait. Goal: a REUSABLE headless test capability so future scenarios are a new test file, not a new manual session. "Add a test = add a file", minimal human intervention (only visual dialog-rendering checks remain).

## Design (three layers, each a reuse building block)

### A — dev scripted approver (Rust)
A `ScriptedApprover` implementing `Approver`, selected at the gate-construction seam by env, so the native dialog is scripted.
- **Double-gated**: `#[cfg(debug_assertions)]` AND the `TAKI_GATE_AUTOAPPROVE` env var. In release the type does not exist / is never selected — a gate bypass must NEVER ship. (Security-critical: this is a permission-gate bypass; the guards are non-negotiable.)
- Directives: `allow-once | allow-session | allow-always | deny | timeout`, with optional per-capability overrides (`screenshot=allow-once,exec=deny`; a bare value is the default for all).
- **Announces itself loudly** on startup and on every answer via `tracing::warn!` — never a silent bypass.
- Selected in `lib.rs` (and the future `build_node`) where `TwoStepDialogApprover` is constructed today.

### B — capability-agnostic e2e fixture (Vitest)
A `withStack` fixture that boots the full stack once and exposes capability-agnostic helpers, so scenarios don't re-plumb setup/teardown/assertions.
- Boots: core (child process, ephemeral `TAKI_WS_PORT`, temp `TAKI_DATA_DIR`) + a node process (auto-approve env, temp app-data dir). Tears down + kills the tree on exit; captures both processes' stdout/stderr.
- Helpers: `trigger(capability, input)` (L1 governance drive), `agentSay(text)` (L2 agent drive), `audit()` (parsed audit.jsonl lines), `screenshots()`/`workspaceFile(name)` (filesystem assertions), `coreLog()`/`nodeLog()` (captured log lines with matchers), `readClipboard()` etc. as needed.
- Content matchers assert metadata only; the fixture never depends on logged content (honors the no-content-in-logs invariant).

### C — headless node binary (the CI/reuse keystone)
Extract the node runtime assembly (gate + capabilities + ws_client — today's `build_client`) into a Tauri-optional `build_node`, and add a headless `taki-node` binary that runs it WITHOUT `tauri::Builder`/a window.
- With the scripted approver, no dialog is needed → no Tauri window → runs headless (CI, no display).
- screenshot (xcap)/clipboard (arboard)/exec/process-list don't need the window; the real dialog approver (which needs an AppHandle) is simply not used in headless mode.
- Aligns with ADR 0007 (a node can run without a Pet UI — the VPS-split future).

## Two driving levels (both in the fixture)

- **L1 governance (deterministic, no LLM)** — a dev-gated trigger sends a capability.request through the core→node path directly (no model). Tests routing, gate, approver, capability exec, audit, file landing. The regression workhorse: fast, no API cost, repeatable.
- **L2 agent (real LLM)** — drive via the operator chat channel; keyed on API-key presence (skipped otherwise), run occasionally. Covers "did the agent actually invoke the tool" — i.e. the current bug's H2 candidate.

## Immediate payoff — self-diagnose the screenshot session bug

With A + the observability logging (task 07-11-observability-permission-trace), reproduce the screenshot-after-"This session" symptom headlessly: L2 shows whether the agent invoked the tool (H2); L1 shows whether routing returns NO_NODE (H1). No human run required.

## Reuse target — shrink the manual list

Of the 23 manual-checks, ~19 become L1/L2 e2e assertions (screenshot allow/once/session/always/deny, reconnect, audit fields, clipboard roundtrip, process-list, workspace RW + escape, exec auto-run/blocklist/timeout/cwd/audit-command/deny, credential via `cmdkey /list`). Only ~4 stay human: the VISUAL confirmation that the native dialog renders and shows the correct text verbatim (items 1 panel, 10/17/18 dialog text) — and even those assert the prompt string at the unit level via `RecordingApprover`.

## Rulings / constraints

- R1 — the scripted approver is debug+env double-gated, loud, and never selectable in release. This is the one hard security rule.
- R2 — no production behavior change: in normal runs (no env), the real dialog approver is used, unchanged.
- R3 — `build_node` extraction must not change the Tauri app's behavior (the app calls `build_node` then adds its window/UI); main.rs stays a shim.
- R4 — the fixture/harness lives in test scope; no test-only code leaks into production modules beyond the env-gated approver selection + the reusable `build_node`.
- R5 — honors the no-content-in-logs invariant; assertions are on metadata, not logged content.
- R6 — gates green; the headless bin compiles and runs; at least one L1 e2e (screenshot allow-once → file + audit) and one reconnect e2e pass headlessly.

## Sequencing

Depends on 07-11-observability-permission-trace (logging) landing first — both touch `lib.rs`; serialize to avoid conflict. Order: A (approver + build_node extraction) → C (headless bin) → B (fixture + first scenarios) → convert the 19 automatable manual-checks.

## Out of scope

The actual H1/H2 fix (this harness reproduces + pinpoints it; the fix is a follow-up). Porting ALL 23 checks at once (start with screenshot + reconnect + one exec scenario; grow incrementally). CI wiring of the e2e suite (design headless-capable; wiring is a follow-up).
