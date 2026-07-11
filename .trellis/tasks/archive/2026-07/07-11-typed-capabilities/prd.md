# PRD — Typed capabilities: process list, clipboard, shell-open, workspace files

**GitHub issue**: #11 (M3). Parent: #1. Blocked by: #10 (DONE).
**Trellis task**: `07-11-typed-capabilities`
**Research** (docs-verified for pinned crate versions; confirm signatures against `cargo doc` when the dep lands): `research/sysinfo-clipboard.md`, `research/shell-open.md`, `research/workspace-files.md`, `research/capability-tiers.md`

## 1. Goal

Breadth on the #10 gate path — four typed capabilities, no new architecture:
- **process-list** (Shell, sysinfo 0.39, read-only snapshot),
- **clipboard** read + write (Shell, arboard 3.6, text-only),
- **shell-open** (Shell, tauri-plugin-opener free fns, URL/path launch),
- **workspace-files** read + write (**Core-side TS**, Workspace-confined — see ruling 1).

Each capability = its own module + one registry entry (invariant 7), its own structured errors, its own tests (happy + denied + escape).

## 2. Leader rulings (settled — evidence in research; do not re-litigate)

1. **workspace-files executes CORE-SIDE (TS), NOT a Shell gated capability.** Evidence (convergent): invariant 2 (Core is the single Workspace writer — screenshot-store precedent: Shell returns bytes, Core writes), invariant 8 (VPS topology: Shell is a different machine; a Shell-side file cap would touch the wrong FS), and the memory engine already reads/writes the Workspace directly, ungated. So workspace-files = two plain core-side AI SDK tools (`read-file-tool.ts`/`write-file-tool.ts`) with a TS confinement check — NO `CapabilityExec`, NOT in the Shell's declared `capabilities`, NOT behind the Rust gate. This is the correct realization of ADR 0002's list even though it diverges from the issue's "all four on the gate path" wording. **Read + write are auto-allowed within the Workspace** (it's the agent's own scratch space, like memory) — no approval dialog, no core-side gate in v1.
2. **CapabilityOutput generalizes via Option A (opaque payload).** The wire `output` becomes `z.unknown()` / serde `serde_json::Value` on the `capability.respond` Ok arm — symmetric with `input` (already `z.unknown()`). Each capability owns its output schema: Shell-mirrored ones (`ScreenshotOutput`, `ProcessListOutput`, `ClipboardReadOutput`, plus the ack shapes) live in `@taki/shared` (one per capability, mirrored in Rust serde, invariant 3) and are `.parse()`d by the core tool; the screenshot output schema MOVES out of the channel core into its own per-capability schema. The `CapabilityRespond` Ok/Err envelope + `CapabilityErrorCode` union (`DENIED|EXEC_FAILED|UNSUPPORTED_CAPABILITY`) stay unchanged. Golden fixtures at the channel layer keep asserting the envelope (ok/requestId/error); per-capability output fixtures assert each payload.
3. **shell-open input = explicit `{kind: "url"|"path", target: string}`** (no heuristic detection). Exec matches `kind` → opener `open_url` vs `open_path`. URL scheme allowlist at the exec layer: `http`, `https`, `mailto` permitted; all others → `EXEC_FAILED` "unsupported url scheme" (reject `file:`, `javascript:`, custom schemes in v1). path target is NOT Workspace-confined (it must be able to open real files/apps) — its safety rests on the gate + dialog visibility (ruling 4). No app-override (`with: None` — always system default). Use tauri-plugin-opener 2 FREE fns (no `.plugin(init())`, no AppHandle — confirm exported callable at implement time); add `tauri-plugin-opener = "2"`.
4. **Approval dialog must show the target for shell-open (close the visibility gap).** Today `approver.rs` shows only the capability name — for shell-open that is a real security-UX hole (the user must see WHAT is being launched). Ruling: extend the gate ask path to carry an optional human-readable **detail** string. `Gate::evaluate(request_id, capability, detail: Option<&str>)` (or a small `GateRequest` struct — implementer's call, keep ≤3 params) → `Approver::ask(capability, detail)` renders "Agent wants to use: shell-open — open https://…". For capabilities with no detail (screenshot/process-list/clipboard), pass `None` (name-only, unchanged). The detail is derived Shell-side from the capability input by the handler (e.g. shell-open handler formats `{kind} {target}`); it is NOT logged (dialog-only, like the CLI approval input display in #8). This is a deliberate, minimal signature change — flag it as touching the #10 gate seam.
5. **process-list**: sysinfo per-call `System::new()` (stateless, matches screenshot exec — KISS), `refresh_processes_specifics(All, true, nothing().with_memory().with_cmd(OnlyIfNotSet))`. Output fields v1: `pid, name, parentPid, memoryBytes, startTime` — **EXCLUDE `cmd`/argv** (leaks URLs/tokens; keeps tier Medium not High; add behind a flag in a later slice). `memoryBytes` is `u64` → `z.number()` (may exceed 2^32). Read-only by construction: `Process::kill` is never called or exposed.
6. **clipboard**: arboard 3.6, create-use-drop inside the blocking `run` (Windows global-clipboard pattern; already off-reactor via spawn_blocking). Text-only v1. **Empty clipboard → `{text:""}` success** (not an error — "nothing on the clipboard" is a clean answer). clipboard-write input `{text}` is content — never logged (broker already treats input as content).
7. **Tiers are descriptive only in v1** — the gate stays enable/disable + remember (no per-tier auto-allow). Every Shell capability is enabled + always-asks until the user picks "always". Do NOT build the #23 policy table now (KISS). Record the tier table in a code comment / devlog for #23.
8. **workspace-files confinement (the security core)**: canonicalize BOTH the Workspace root (once, at tool construction) and the resolved target via `fs.realpath`; for a not-yet-existing write target, realpath the PARENT and re-append the validated leaf. Confinement check via `path.relative(root, real)` → reject if `startsWith("..")` or `isAbsolute`. **Reject BEFORE resolving**: any absolute input, any input containing `:` (drive/ADS), any `..` leaf, Windows reserved names (CON/NUL/PRN/AUX/COM1-9/LPT1-9). Symlink defense IS the reason for realpath (lexical normalize is insufficient). Structured error `{ok:false, code:"OUTSIDE_WORKSPACE"|"INVALID_PATH"|"IO_ERROR"|"TOO_LARGE"}`. Scope = whole Workspace root (not a sub-subtree). Confinement scope root = `join(dataDir,"workspace")` — the same root memory/ and screenshots/ live under.
9. **workspace-files limits**: read cap 256 KiB → beyond it return `{...truncated:true}` with the first 256 KiB (UTF-8 safe boundary); write cap 1 MiB input → beyond it `TOO_LARGE`. Binary/non-UTF8 READ: attempt UTF-8, on failure return `{ok:false, code:"NOT_TEXT"}` (v1 is text-only; base64 deferred — note for a later slice). Paths on the wire are ALWAYS Workspace-relative (never leak the absolute `~/.takiagent` prefix to the model).
10. **Six new agent tools** (each mirrors `screenshot-tool.ts`: `execute` never throws, closed codes, route→shape). Four Shell tools route `deps.broker.request(CAP, input, node.notify)`; two file tools do local `node:fs` with the confinement check (no broker/node/gate). All registered via `extraTools` in `main.ts`.
11. **Shell registration**: each of the 3 new Shell capabilities (process-list, clipboard-read, clipboard-write, shell-open — actually 4 capability strings) gets a `capabilities_impl/<name>.rs` (`CapabilityExec`), one `handlers.register(...)` line, one entry in the node's declared `capabilities: vec![...]`. Note clipboard is TWO capability strings (`clipboard-read`, `clipboard-write`) for independent gating.
12. **Zero new npm deps.** New Rust deps: `sysinfo = "0.39"`, `arboard = "3.6"`, `tauri-plugin-opener = "2"` (all CLAUDE.md-pinned except opener which is Tauri-official and joins the dialog plugin). Record resolved versions in Cargo.lock.

## 3. Capability inventory

| Capability | Side | Crate/API | Input | Output (own schema) | Gate |
|---|---|---|---|---|---|
| process-list | Shell | sysinfo 0.39 | `{}` | `{processes:[{pid,name,parentPid,memoryBytes,startTime}],count}` | ask (name-only dialog) |
| clipboard-read | Shell | arboard 3.6 | `{}` | `{text}` | ask |
| clipboard-write | Shell | arboard 3.6 | `{text}` | `{ok:true}` | ask |
| shell-open | Shell | tauri-plugin-opener 2 | `{kind,target}` | `{ok:true,opened}` | ask (dialog shows target — ruling 4) |
| file-read | **Core** | node:fs | `{path}` | `{path,content,bytes,truncated}` | none (auto-allow, confined) |
| file-write | **Core** | node:fs | `{path,content}` | `{ok:true,path,bytes}` | none (auto-allow, confined) |

## 4. File map

**Shared:**
```
packages/shared/src/capability-schema.ts        # EDIT: output -> z.unknown() on respond Ok (Option A); keep envelope
packages/shared/src/capability-outputs.ts (+test) # per-capability output schemas (screenshot moved here + process-list/clipboard/shell-open)
packages/shared/fixtures/protocol/*.json         # EDIT: respond fixtures use opaque output; ADD per-capability output fixtures
packages/shared/src/index.ts                     # EDIT: export new schemas
```

**Core (TS):**
```
packages/core/src/capabilities/process-list-tool.ts (+test)
packages/core/src/capabilities/clipboard-read-tool.ts (+test)
packages/core/src/capabilities/clipboard-write-tool.ts (+test)
packages/core/src/capabilities/shell-open-tool.ts (+test)
packages/core/src/workspace/workspace-paths.ts (+test)     # the confinement algorithm (ruling 8) — its OWN module, security core
packages/core/src/workspace/read-file-tool.ts (+test)
packages/core/src/workspace/write-file-tool.ts (+test)
packages/core/src/workspace/index.md
packages/core/src/capabilities/screenshot-tool.ts          # EDIT: parse opaque output via ScreenshotOutputSchema
packages/core/src/main.ts                                  # EDIT: register 6 tools into extraTools; pass workspace root to file tools
packages/core/src/capabilities/index.md
```

**Shell (Rust):**
```
apps/desktop/src-tauri/src/capabilities_impl/process_list.rs   # sysinfo snapshot -> Value
apps/desktop/src-tauri/src/capabilities_impl/clipboard.rs      # arboard read+write (two CapabilityExec or one keyed by capability())
apps/desktop/src-tauri/src/capabilities_impl/shell_open.rs     # opener free fns + scheme allowlist + detail formatting
apps/desktop/src-tauri/src/capabilities_impl.rs                # EDIT: register the new execs
apps/desktop/src-tauri/src/gate.rs                             # EDIT: evaluate() gains optional detail; thread to approver
apps/desktop/src-tauri/src/gate/approver.rs                    # EDIT: ask(capability, detail) renders target
apps/desktop/src-tauri/src/ws_client.rs                        # EDIT: handler computes detail, passes to gate; dispatch new caps
apps/desktop/src-tauri/src/lib.rs                              # EDIT: declared capabilities vec + register calls
apps/desktop/src-tauri/src/protocol.rs                         # EDIT: output payload -> Value (Option A); per-cap output structs if mirrored
apps/desktop/src-tauri/Cargo.toml                              # EDIT: sysinfo, arboard, tauri-plugin-opener
```
Headers + index.md everywhere touched.

## 5. TDD plan

| Cycle | Tests |
| --- | --- |
| A shared | T1 capability-schema respond Ok carries opaque output (parses arbitrary payload); envelope invalid cases still reject; T2 per-capability output schemas valid/invalid; T3 fixture sweep updated (vitest) — envelope + per-cap payloads |
| B core Shell tools | T4 process-list-tool: broker returns snapshot Value → parsed/shaped; T5 clipboard-read/write tools; T6 shell-open tool (kind/target passthrough); T7 each degrades broker failure → {ok:false,code}; never throws |
| C core workspace (SECURITY) | T8 workspace-paths table-driven ESCAPE tests: `../..`, absolute `C:\...`, drive-relative `C:foo`, `:`-ADS, reserved name `NUL`, symlink-out (create a symlink in a tempdir → realpath rejects), valid nested path accepted; T9 read-file happy + truncated (>256KiB) + NOT_TEXT + OUTSIDE_WORKSPACE; T10 write-file happy + creates parent? (decide: no auto-mkdir beyond existing dir — reject missing parent as INVALID_PATH or mkdir; ruling: mkdir within workspace OK) + TOO_LARGE + escape rejected; T11 relative paths on the wire (no abs leak) |
| D rust protocol | T12 golden-fixture sweep still green with opaque output; per-cap output serde round-trip |
| E rust execs | T13 process_list: fake/real snapshot → shape (pid/name/memory present, NO cmd field); T14 clipboard exec set→get round-trip (real arboard in a Rust test is acceptable — it's the Shell, Windows CI; if flaky, trait-fake); T15 shell_open: scheme allowlist (https ok, javascript rejected), detail string formatting; NO real launch in tests (inject a fake opener fn) |
| F rust gate detail | T16 evaluate(_, "shell-open", Some("open https://x")) → approver receives the detail; screenshot → None; existing gate tests still green (detail defaulted) |

## 6. Constraints (restate verbatim)

Standing standards (headers, index.md, size caps TS 300/50/3 + Rust fn ≤100, kebab TS / snake Rust, no mod.rs, closed unions, why-only comments, logs carry names/ids/counts NEVER content — clipboard text, file content, shell-open target, process argv are content; the shell-open dialog detail is dialog-only not logged). Zero new npm deps; Rust deps only the three named. Never code sysinfo/arboard/opener/tauri APIs from memory — research cites docs.rs; confirm exact signatures via `cargo doc`/rust-analyzer once deps land (esp. sysinfo `name()->&OsStr`, `cmd()->&[OsString]`, `memory()` bytes; opener free-fn path + no-init; arboard empty-read Err). Protocol shapes ONLY in @taki/shared + serde mirrors. The Shell never writes the Workspace / touches the DB; workspace-files is Core-side and is the ONLY new Workspace writer (mirrors screenshot-store's sanction). All existing tests stay green (389 TS + 17 Rust). `pnpm --filter @taki/desktop build` before ANY cargo command. Windows builds slow + host OOM'd: build frontend once, iterate `cargo check`, run cargo test/clippy sequentially, no parallel heavy builds. If booting core: non-default TAKI_WS_PORT, direct node, kill the tree after.

## 7. Verification

```bash
pnpm -r typecheck && pnpm lint && pnpm -r test
pnpm --filter @taki/desktop build
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Leader live smoke (queue GUI parts to manual-checks): via CLI ask the model to (1) list processes → snapshot returned after dialog; (2) read/write clipboard → dialog, round-trips; (3) open https://example.com → dialog SHOWS the URL → launches; open javascript: → rejected without launch; (4) write then read a Workspace file → no dialog (auto-allowed), content round-trips; (5) attempt to read `../../../Windows/System32/drivers/etc/hosts` → OUTSIDE_WORKSPACE, model degrades gracefully.

AC mapping: AC1←T13 (read-only, no kill) · AC2←T5/T14 · AC3←T6/T15 (+smoke launch) · AC4←T8/T9/T10 (escape rejection — the table-driven security AC) · AC5←ruling 7 (per-cap gate entry + audit; T16 detail) + each tool's structured errors (T7/T9) · AC6←T4-T10 happy+denied+escape.
