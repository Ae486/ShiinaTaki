# PRD — Rust Shell + Permission Gate + first Capability (screenshot)

**GitHub issue**: #10 (M3). Parent: #1. Blocked by: #4 (DONE).
**Trellis task**: `07-10-rust-shell-gate`
**Research** (verdicts probe/compile-verified — trust over memory): `research/tauri2-shell.md`, `research/rust-ws-protocol.md`, `research/gate-audit-keyring.md`, `research/rust-testing.md`

## 1. Goal

The security-architecture tracer bullet, end to end with ONE capability:

- **Rust Shell** (Tauri 2.11, existing scaffold): connects to the core over WS as a `node` declaring `["screenshot"]`, pairs once (token → keyring), reconnects with backoff.
- **Core**: gains the capability channel (`capability.request` notification → node, `capability.respond` node-role method back) + a `screenshot` agent tool. The tool persists the returned PNG under the Workspace and hands the model `{ok, path, width, height, bytes}` (text-only model — decision 8A).
- **Shell Permission Gate**: every capability request is policy-evaluated (auto-allow / auto-deny / ask via native two-step dialog — decision 1A), decisions remembered per once/session/always/deny-always, every decision appends a JSONL audit line in Shell-owned storage the agent can never reach.

## 2. Leader rulings (settled — do not re-litigate)

1. **Dialog UX = two-step native** (user-ratified 1A): step 1 `Allow screenshot? [Allow][Deny]`; if Allow → step 2 `Remember? [Only once][This session][Always]`; if Deny → step 2 `Remember denial? [Only once][Always]` may be SKIPPED in v1 — a plain Deny = deny-once; deny-always enters via policy later (#23 settings). Richer UI is #23's job (user directive logged there). Dialog = `tauri-plugin-dialog` v2, Rust-side only (no npm binding — D3), `MessageDialogButtons::OkCancelCustom`.
2. **Dialog concurrency (D2)**: run `blocking_show` inside `tauri::async_runtime::spawn_blocking`, await via the JoinHandle; NEVER on the main thread, never directly in the async WS task. 60s timeout → auto-deny (fail-closed, audited).
3. **Capability frames (D4)** in `@taki/shared` `capability-schema.ts`: `capability.request` = core→node **notification** `{requestId (uuid), capability, input}`; `capability.respond` = node-role **request** `{requestId, ok:true, output} | {requestId, ok:false, error:{code, message}}`. Correlation by `requestId`, NOT JSON-RPC id (mirror of #8 approval broker). Screenshot input = `{}` (primary monitor only, v1). Output = `{mediaType:"image/png", dataBase64, width, height}`. Wire error codes are a **closed shared union**: `DENIED | EXEC_FAILED | UNSUPPORTED_CAPABILITY`. Frame sizes: defaults fine (1080p base64 ≪ 64MiB tungstenite / 100MiB ws caps) — do NOT raise limits.
4. **Golden fixtures (D5)**: canonical home `packages/shared/fixtures/protocol/*.json` — valid AND invalid instances of every cross-language frame (connect req/result, app-error PAIRING_REQUIRED/AUTH_FAILED, client frames, capability.request/respond both arms). Asserted by BOTH a vitest test (zod parse / reject) AND a cargo test (serde parse / reject + serialize-back round-trip vs parsed Value — catches casing drift). Rust reads via `CARGO_MANIFEST_DIR/../../../packages/shared/fixtures/protocol`. This is the ONLY anti-drift guard for invariant 3 — it is not optional.
5. **Node token (D6)**: pairing-issued token persists via keyring (service `"TakiAgent"`, user `"node-token"`), behind a `SecretStore` trait (`NoEntry` → `Ok(None)`); unit tests use an in-memory fake, NEVER Credential Manager.
6. **Shell data root (D7)**: Tauri `app_data_dir()` (`%APPDATA%/cc.shiinataki.app/`) for `gate-decisions.json` + `audit.jsonl`. Outside the Workspace by construction. Decisions file: atomic tmp+rename, malformed = warn + empty (the codified corruption asymmetry — approvals are re-askable). `always` is durable AND revocable (revocation = entry removal; #23 renders the UI).
7. **Image handling (user-ratified 8A)**: Shell returns base64 over the wire; the CORE persists to `<workspace>/screenshots/<ISO-ts>.png` (Shell never writes the Workspace — invariant 2) and the tool returns `{ok:true, path, width, height, bytes}`. No `toModelOutput` image part in v1 (deepseek-v4-flash is text-only); the persisted path makes VLM description a zero-refactor add in #20.
8. **Session scope lifetime (D9)**: Shell-process lifetime (in-memory map in the gate). A WS reconnect does NOT wipe session grants; a Shell restart does.
9. **Audit (D10)**: direct fs append module `audit.rs` — `OpenOptions::append`, one `write_all` per line, reopen-per-append, single writer, no locking. Line: `{"ts","requestId","capability","decision"}`; decision vocabulary (closed Rust enum): `allowed-once|allowed-session|allowed-always|denied|auto-allowed|auto-denied|denied-timeout`. NO payload content, NO image bytes, NO paths. `tracing` stays diagnostics-only.
10. **Gate policy order** (mirror `approval-gate.ts`): capability disabled → auto-deny; remembered always → auto-allow; remembered never → auto-deny; else ask. v1: the per-capability switch exists in the policy table but is constant `enabled` (config lands with #23). **Fail-closed everywhere**: dialog unavailable / timeout / closed / channel error = deny; the deny default must be pinned by a flip-it-and-a-test-fails test.
11. **Timeouts**: Shell dialog 60s → auto-deny + respond `DENIED`; core broker backstop 90s → tool returns `{ok:false, code:"CAPABILITY_TIMEOUT"}` (core-internal code). Late/unknown `capability.respond` → `{accepted:false}`, never an error.
12. **Node routing (core)**: connection-registry selects the first authenticated `node` connection whose declared capabilities include the requested one; none → tool returns `{ok:false, code:"NO_NODE"}` (core-internal). The registry must expose per-connection notify for the broker (the seam its header comment already promises to M3).
13. **Pairing UX (net-new ruling — research gap)**: the Shell has no REPL, so the existing main window becomes a minimal **status + pairing panel**: Rust emits status events (`taki://status`: connecting / pairing-required / connected / disconnected), React listens and, on pairing-required, shows one input → `submit_pairing_code` command → mpsc channel into the WS task → connect retry with the code. Keep it < 100 lines of React; the `ping` command stays (reference), its demo button goes. Verify the event-listen permission in the capability JSON against the regenerated schema.
14. **Approval layering**: the screenshot tool is NOT an MCP tool — the #8 operator approval gate returns not-applicable for it by construction (not in the MCP set). Authorization for OS actions belongs to the SHELL gate alone (ADR 0002). Do not double-gate.
15. **Rust module discipline**: gate/audit/secrets/protocol/capability modules carry NO `tauri::` types in public signatures (unit-testable without the app); only lib.rs wiring + dialog impl touch Tauri. `main.rs` untouched. No `mod.rs`; `//! INPUT/OUTPUT/POS` headers; index.md in every touched src dir (including src-tauri/src). Rust fn ≤ 100 lines.
16. **CI (D11)**: `rust-checks` gains `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` AFTER the frontend build step (`generate_context!` embeds `../dist` — cargo anything needs dist first). Clippy stays `-D warnings`.

## 3. File map

**TS first (the contract the Rust side consumes):**
```
packages/shared/src/capability-schema.ts (+test)      # methods + request/respond/error schemas; export via index.ts
packages/shared/fixtures/protocol/*.json              # golden fixtures (valid + invalid per frame)
packages/shared/src/protocol-fixtures.test.ts         # vitest side of the dual assertion
packages/core/src/capabilities/capability-broker.ts (+test)   # pending map + 90s backstop + denyAll on node disconnect
packages/core/src/capabilities/screenshot-store.ts (+test)    # sanctioned Workspace write site: base64 -> screenshots/<ts>.png
packages/core/src/capabilities/screenshot-tool.ts (+test)     # agent tool: route -> broker.request -> persist -> {ok,path,...}
packages/core/src/capabilities/index.md
packages/core/src/server/methods/capability-respond.ts (+test)  # node-role method -> broker.resolve
packages/core/src/server/connection-registry.ts       # EDIT: expose node lookup by capability + per-connection notify
packages/core/src/main.ts                              # EDIT: wire broker + tool into extraTools
```

**Rust (consumes the fixtures):**
```
apps/desktop/src-tauri/src/protocol.rs                 # serde mirrors (untagged enums, deny_unknown_fields parity) + fixture tests
apps/desktop/src-tauri/src/ws_client.rs               # connect_async loop, split sink/stream, backoff, dispatch, pairing channel
apps/desktop/src-tauri/src/gate.rs                     # policy table + evaluate() + Approver trait consumption; table-driven tests
apps/desktop/src-tauri/src/gate/decisions.rs           # once/session/always/never store (file + memory), corruption-tolerant
apps/desktop/src-tauri/src/gate/approver.rs            # Approver trait + TwoStepDialogApprover (tauri-plugin-dialog impl)
apps/desktop/src-tauri/src/audit.rs                    # JSONL append + tests
apps/desktop/src-tauri/src/secrets.rs                  # SecretStore trait + KeyringStore + InMemoryStore (tests)
apps/desktop/src-tauri/src/capabilities_impl.rs        # handler registry: capability name -> handler (invariant 7)
apps/desktop/src-tauri/src/capabilities_impl/screenshot.rs   # xcap capture (spawn_blocking) -> PNG -> base64
apps/desktop/src-tauri/src/lib.rs                      # EDIT: plugin init, setup spawn, manage state, submit_pairing_code
apps/desktop/src-tauri/Cargo.toml                      # EDIT: tokio-tungstenite/futures-util/keyring/xcap/tokio/tauri-plugin-dialog; dev-dep tempfile
apps/desktop/src-tauri/capabilities/default.json       # EDIT: dialog + event permission tokens
apps/desktop/src/app.tsx                               # EDIT: status + pairing panel (drop demo button, keep ping command)
.github/workflows/ci.yml                               # EDIT: cargo test step in rust-checks
```
index.md + INPUT/OUTPUT/POS (`//!` in Rust) everywhere touched.

## 4. TDD plan

| Cycle | Tests |
| --- | --- |
| A shared | T1 capability schemas valid/invalid (both respond arms, closed error union); T2 vitest fixture sweep: every fixtures/protocol/*.json parses/rejects as named |
| B core broker | T3 request → notification payload + pending; resolve → output returned; T4 90s timeout → CAPABILITY_TIMEOUT (fake timers); T5 node disconnect → denyAll; late/unknown respond → {accepted:false}; T6 capability-respond method is node-role-gated (operator → FORBIDDEN) |
| C core tool | T7 screenshot-store: base64 → PNG file under workspace/screenshots (bytes verified); T8 tool happy path {ok,path,width,height,bytes}; T9 no node → NO_NODE; shell DENIED passthrough; T10 tool never throws |
| D rust protocol | T11 cargo fixture sweep: same files parse/reject + round-trip re-serialize equals parsed Value (casing drift trap) |
| E rust gate | T12 table-driven policy: (switch, remembered, answer) → (decision, audited-as, persisted) covering: always→auto-allow, never→auto-deny, ask→allow-once/session/always, deny, timeout→denied-timeout; **flip-the-default test** (approver error ⇒ deny); T13 decisions store: once not stored, session memory-only, always durable, corrupt file → warn+empty; T14 audit: one JSONL line per decision in tempdir, exact fields, no payload |
| F rust seams | T15 secrets: InMemory fake set/get/delete, NoEntry→None mapping contract; T16 screenshot handler wiring: fake exec returns bytes → respond frame shape (no real capture in unit tests) |

## 5. Constraints (restate to agents verbatim)

Standing engineering standards (headers, index.md, size caps TS 300/50/3 + Rust fn ≤100, kebab-case TS / snake_case Rust, no mod.rs, closed error unions, why-only comments, pino/tracing logs carry ids+names NEVER content — dataBase64 and paths beyond the capability name are content). Zero new npm deps; Rust deps only the pinned set + tauri-plugin-dialog + dev-dep tempfile. Never code tauri/tungstenite/keyring/xcap/serde APIs from memory — the research files cite installed sources; verify beyond them in `~/.cargo/registry` or docs.rs. Protocol shapes ONLY in @taki/shared + serde mirrors (never a third declaration). The Shell never touches the DB, never writes the Workspace. All 344 existing TS tests stay green. `pnpm --filter @taki/desktop build` before ANY cargo command (generate_context! needs ../dist). If you boot the core for a sanity check: non-default TAKI_WS_PORT, direct node launch, kill the process tree afterwards. Windows: cargo builds are slow — build once, iterate with `cargo check`, do not parallelize heavy builds (host OOM'd recently).

## 6. Verification

```bash
pnpm -r typecheck && pnpm lint && pnpm -r test
pnpm --filter @taki/desktop build
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Leader live smoke (needs human eyes for the dialog — queue what I cannot click myself): boot core → `pnpm --filter @taki/desktop tauri dev` → pairing panel appears → enter code from core console → status connected + token in Credential Manager → CLI asks the model to take a screenshot → native dialog on the Shell → Allow/Only once → PNG lands in workspace/screenshots, model reports path+dims → repeat with This session (no dialog second time) → restart Shell (session wiped, dialog again) → Always → restart Shell → no dialog → deny path → model degrades gracefully → audit.jsonl has one line per decision, correct vocabulary → kill core → Shell reconnect loop → core back → reconnects tokenless-free.

AC mapping: AC1←smoke+T11 (connect fixtures) · AC2←T3/T7/T8+smoke · AC3←T12/T13+smoke (once/session/always/deny) · AC4←T14+smoke (audit outside Workspace by D7 construction) · AC5←ruling 15 (main.rs untouched; executor only reachable via gate — T16 wiring) · AC6←T15+smoke (Credential Manager entry) · AC7←T12/T14.
