# Backend Directory Structure

## `packages/core` (Agent Core, TS)

```
packages/core/src/
├── agents/                # ToolLoopAgent definitions (one agent per file)
│   └── companion-agent.ts
├── tools/                 # ONE tool per file, kebab-case + `-tool` suffix
│   ├── screenshot-tool.ts # exports screenshotTool; execute() delegates to capability client
│   └── exec-tool.ts
├── capabilities/          # WS client stubs that forward Capability requests to the Shell
├── mcp/                   # MCP client management (@ai-sdk/mcp)
├── skills/                # SKILL.md loader
├── memory/                # markdown files + SQLite FTS index
├── scheduler/             # croner jobs + heartbeat
├── server/                # WS JSON-RPC server: connection, pairing, routing, event push
├── db/                    # SQLite wrapper + migrations (the ONLY module importing node:sqlite)
├── config/                # config file load/validate (zod)
└── index.ts               # package entry (named re-exports only)
```

Rules:
- Tool files are thin: schema + description + delegation. Business logic lives in the domain module it belongs to.
- Only `capabilities/` talks to the Shell; only `db/` talks to SQLite; only `server/` owns sockets.
- `packages/shared` holds every cross-process type (zod). If core and shell both need it, it goes there.

## `apps/desktop/src-tauri` (Shell, Rust)

```
src-tauri/src/
├── main.rs                # thin shim only — DO NOT add logic
├── lib.rs                 # run(): Builder, plugins, single generate_handler![], setup()
├── commands/              # one module per domain (window.rs, tray.rs) — thin controllers
├── capabilities_impl/     # Capability executors: screenshot.rs, processes.rs, clipboard.rs, exec.rs
├── gate/                  # Permission Gate: policy.rs, approval.rs, audit.rs
├── ws/                    # WS client to Agent Core (tokio-tungstenite), reconnect, node handshake
├── services/              # shared business logic
├── state.rs               # managed state structs
└── models.rs              # serde structs mirroring @taki/shared schemas
```

Rules:
- Module files: `foo.rs` + `foo/` directory style; **never `mod.rs`**.
- Every Capability executor is called ONLY from `gate/` — no direct command → executor path.
- Tauri window permission files (`src-tauri/capabilities/*.json`): separate files for pet window vs settings window.
