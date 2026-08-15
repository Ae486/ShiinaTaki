# Backend Directory Structure

## `packages/core` (Agent Core, TS)

```
packages/core/src/
├── agents/                # ToolLoopAgent definitions (one agent per file)
│   └── companion-agent.ts
├── capabilities/          # Host-routed capability tools, broker, canonical input binding, and routing
├── governance/            # Core policy repo/service/evaluator adapters and explicit Core-tool bindings
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
├── gate/                  # trusted Host classifiers, legacy/local constraints, and audit helpers
├── host_control_protocol.rs # strict v2 Host catalog/request/projection/evidence handling
├── host_session.rs        # per-connection request + per-capability policy lineage
├── ws_client.rs           # WS client to Agent Core: reconnect, catalog, governed request/terminal frames
├── services/              # shared business logic
├── state.rs               # managed state structs
└── models.rs              # serde structs mirroring @taki/shared schemas
```

Rules:
- Module files: `foo.rs` + `foo/` directory style; **never `mod.rs`**.
- Every Host Capability executor is reached only after Host-session control validation, trusted classification, and
  stricter-only posture composition. No direct command/WS branch may bypass that path.
- Tauri window permission files (`src-tauri/capabilities/*.json`): separate files for pet window vs settings window.
