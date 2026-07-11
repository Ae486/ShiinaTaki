# PRD — Observability + permission-flow tracing (diagnose the screenshot session bug)

A manual smoke of #10 item 3/4 surfaced: after a "This session" screenshot grant, subsequent screenshots produce NO console output, NO dialog, NO audit line, NO file — yet the agent claims success. Root-cause is blocked by an observability hole, not (yet) confirmed in the permission module. This task rebuilds observability so the flow is traceable end-to-end, closes silent-failure gaps, fixes confirmed defects, and lets the user re-run to pinpoint the residual.

## Confirmed defects (found by code read)

- **D1 — Shell tracing is never initialized.** `Cargo.toml` has `tracing = "0.1"` but no `tracing-subscriber`; `main.rs`/`lib.rs` never call an init. Every `tracing::info/warn/error` in the Shell (gate, audit, ws_client) is dropped — the Shell console is dark. The permission flow lives Shell-side, so it is currently unobservable.
- **D2 — Core logs are single-line JSON, no pretty formatting.** `logger.ts` is bare `pino({ level })`; level defaults to `info`. Hard to scan (user complaint).
- **D3 — Silent failure paths.** `screenshot-tool.ts` (and the other capability tools) `return routed` on a `routeCapability` failure (e.g. NO_NODE) WITHOUT logging; the broker's "capability requested" also never fires. A routing/node failure is invisible in the core console.

## Residual symptom — two candidates the instrumentation must disambiguate

The absence of a core "capability requested" log for the failed screenshot means `broker.request` was never called. Either:
- **H1**: `routeCapability` returned NO_NODE (node/capability-registration issue on reconnect) — a real bug, currently silent (D3).
- **H2**: the agent (LLM) did not invoke the screenshot tool at all (hallucinated success) — an agent-loop/prompt issue, NOT the permission module.
The Shell-side memory logic is correct (verified: session stored in-memory as `Remembered::Always`; `get` returns it; gate auto-allows + audits). So the break is upstream of the Shell gate.

## Rulings

- **R1 — Shell: add `tracing-subscriber` (env-filter + fmt) and initialize it once at the top of `run()`** (before the Tauri builder). Default level `info`, overridable via `RUST_LOG`. Dev-friendly compact fmt to stderr. This is the single highest-value fix — it lights up the entire Shell side.
- **R2 — Core: human-readable dev logs.** Add `pino-pretty` as a **devDependency**; the logger uses the pretty transport ONLY in dev (guard on a TTY / `NODE_ENV !== "production"` / a config flag) and keeps raw JSON in production (the Ubuntu VPS ingests JSON — invariant 8). Do not change the default level (`info`).
- **R3 — Seam instrumentation, bounded + metadata-only.** Add concise log lines so the request lifecycle is traceable:
  - Core capability tools: on execute entry `"tool invoked: <capability>"`; on a routed failure log at `warn` with the code (closes D3 — NO_NODE etc. must appear). Keep the existing success log.
  - Core broker: keep "capability requested"; add a terminal `"capability responded"` line with `{ requestId, capability, ok }` (NOT the output).
  - Shell `ws_client.dispatch`: `"capability.request received"` `{ capability, requestId }`.
  - Shell gate: one line per decision — `{ capability, decision }` (auto-allowed / allowed-once|session|always / denied / auto-denied). For exec, decision only — never the command.
  - Shell capability execute: success (screenshot `{width,height}`, exec `{exitCode,timedOut}`) / failure `{code}`.
- **R4 — NEVER log content.** No screenshot bytes, clipboard text, exec command/args/stdout/stderr, file content, shell-open target, or the dialog `detail`. Only metadata (capability, requestId, decision, dimensions, exit code, byte counts, error codes). This is the existing logging invariant; the new lines must honor it. The exec command stays in the audit line only (ruling 9), never in a tracing log.
- **R5 — Verify + fix the approver dialog mapping.** `approver.rs` maps the second dialog via `MessageDialogResult::Custom(label)`. Verify against tauri-plugin-dialog v2 docs whether `YesNoCancelCustom(a,b,c)` returns `Custom(label)` for each button or `Yes`/`No`/`Cancel` by position. If the latter, "This session"/"Always" are mis-mapped to Once — fix the mapping so each scope is correct. This is a real Shell-side suspect for a broken session/always grant independent of H1/H2.
- **R6 — No behavior change beyond logging + the R5 mapping fix.** The gate/policy/capability logic is unchanged. Gates stay green.

## Deliverable / verification

- Both consoles readable: core pretty (dev), Shell tracing visible.
- The user re-runs #10 item 3 (session) and item 4 (restart): the logs now show, per request, whether (a) the agent invoked the tool, (b) the core routed + requested, (c) the Shell received + gated + executed — pinpointing H1 vs H2.
- Gates: `pnpm -r typecheck && pnpm lint && pnpm -r test`; `pnpm --filter @taki/desktop build`; `cargo clippy --all-targets -D warnings`; `cargo test`.
- New deps justified: `tracing-subscriber` (essential companion to `tracing`; the Shell cannot log without it), `pino-pretty` (dev-only readability). Both standard, not gratuitous.

## Out of scope

The actual H1/H2 fix (pending the re-run evidence). If H1 (NO_NODE on reconnect) is confirmed, a follow-up fixes the routing/registration; if H2 (agent not invoking), a follow-up addresses the agent loop/prompt. This task delivers the observability + the confirmed-defect fixes only.
