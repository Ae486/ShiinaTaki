# Research: cargo test conventions for this repo (short)

- **Query**: cargo test story for src-tauri — table-driven gate tests, tempdir fixtures, WS-boundary mocking, current CI rust job
- **Scope**: internal (CI workflow, scaffold, TS test conventions to mirror)
- **Date**: 2026-07-10

## Verdicts (first)

1. **CI today runs clippy ONLY, not `cargo test`** (`.github/workflows/ci.yml` `rust-checks`: checkout → pnpm install → `pnpm --filter @taki/desktop build` → `cargo clippy -- -D warnings`). Issue #10's AC demands gate tests, so **`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` must be ADDED to rust-checks** (after the frontend build, for the same `generate_context!` reason). Flag for the leader (D11).
2. **Test placement**: Rust convention + this repo's colocated-test rule → `#[cfg(test)] mod tests` at the bottom of each module (`gate.rs`, `audit.rs`, `protocol.rs`, ...). No separate `tests/` integration dir needed for v1 (nothing to integration-test without launching the app); golden protocol fixtures may live under `tests/fixtures/` if D5 lands them there.
3. **Table-driven gate tests**: plain Rust — a `const CASES: &[Case]` array of `(switch, remembered, answer) -> expected (decision, audited-as, persisted)` looped in one `#[test]`, or one `#[test]` per row for granular failure names. Mirrors `decision-store.test.ts`/`approval-gate.test.ts` case coverage: once-not-persisted, session-in-memory-only, always-durable, deny+always==never, corrupt-file→warn+empty, fail-closed default (flip-it-and-a-test-fails).
4. **Tempdir fixtures**: add `tempfile = "3"` under `[dev-dependencies]` — `tempfile::tempdir()` gives an auto-cleaned dir for audit-JSONL and decision-file tests (assert exact file contents after each gate decision). This is the standard crate; not yet in the tree (probe lockfile has no tempfile), dev-dep only, no shipping weight.
5. **Mock the WS boundary with a trait seam, not a socket**: the gate/handler modules take `&dyn` (or generic) traits — e.g. `Approver` (dialog), `SecretStore` (keyring), `CapabilityExec` (xcap), and a `RespondSink` for outbound frames — so tests inject deterministic fakes; NO test opens a WebSocket or shows a dialog. The real `tokio-tungstenite` loop is thin wiring verified by the live smoke, same division as the TS side (ws-server.test.ts uses real sockets on port 0 — the Rust side does not need an equivalent in v1; if one is ever wanted, `tokio_tungstenite::accept_async` on a `tokio::net::TcpListener` bound to port 0 works in-process).
6. **Keyring tests**: do NOT hit Credential Manager in unit tests (machine-global state, CI runners) — test against a fake `SecretStore`; the real store is smoke-verified. (keyring-core has a `sample`/mock store behind the `cli` feature, but a 3-line in-memory fake is simpler than pulling that feature.)

## Findings

- `rust-checks` job (`.github/workflows/ci.yml:24-42`): `windows-latest`, `dtolnay/rust-toolchain@stable` + clippy component, `swatinem/rust-cache` scoped `apps/desktop/src-tauri`, frontend build precedes clippy because `generate_context!` embeds `../dist`. The same precondition applies to `cargo test` (compiling the crate at all requires `dist/`).
- Crate lints: `[lints.clippy] too_many_lines = "warn"` already set (`Cargo.toml:21-22`); CLAUDE.md caps Rust fn ≤ 100 lines, file soft cap 500, no `mod.rs` (use `foo.rs` + `foo/`).
- TS precedent for the corruption-asymmetry test (`decision-store.test.ts`) and fail-closed default tests (`approval-gate.test.ts`) — port these case tables to the Rust gate.
- Edition mismatch note: the scaffold crate is `edition = "2021"`; the probe used 2024 without issue on rustc 1.88. Keep the scaffold at 2021 (no reason to churn it in this task).

## Leader decisions needed

- **D11 (CI)**: add `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` to the `rust-checks` job (after the frontend build). Also decide whether clippy should gain `--all-targets` so test code is linted.
