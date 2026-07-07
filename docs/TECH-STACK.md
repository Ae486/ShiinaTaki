# TakiAgent Tech Stack (v1)

Selection principle: glue mature components, build only the domain-specific parts (Permission Gate, companion behaviors, protocol). Decisions marked ADR have a record in `docs/adr/`.

## Agent Core (TypeScript, Node 24 LTS)

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime | Node 24 LTS | No Bun-specific APIs; Bun single-file compile re-evaluated at distribution time |
| Agent engine | Vercel AI SDK 6 (`ai`, `@ai-sdk/*`, `@ai-sdk/mcp`) | ADR 0003. ToolLoopAgent + built-in tool approval wired to Permission Gate |
| LLM providers | OpenAI-compatible as the default and primary path (`@ai-sdk/openai-compatible`, user-supplied base URL + key) | User's real-world setup. Other `@ai-sdk/*` providers are config away, no code |
| MCP client | `@ai-sdk/mcp` (stable since SDK 6) | stdio + HTTP transports; OAuth supported |
| Skills | SKILL.md folders (OpenClaw/Claude Code convention) | Loader lists descriptions in prompt, loads full content on demand |
| WS API | `ws` + JSON-RPC 2.0 + zod schemas in shared package | ADR 0004. Device identity + pairing from day one |
| Storage | `node:sqlite` behind a thin wrapper | Zero native deps; wrapper keeps better-sqlite3 swap trivial if stability disappoints |
| Memory | Markdown files in Workspace + SQLite FTS5 index | OpenClaw-proven pattern; vector search deferred |
| Scheduler | `croner` (cron) + heartbeat interval reading HEARTBEAT.md | |
| Config | JSON file + zod validation, edited via settings panel | Secrets NOT in config file — see keyring below |
| TTS (reserved) | `SpeechProvider` interface; wire contract = OpenAI-compatible `POST /v1/audio/speech` against user's VPS | See `docs/TTS-INTERFACE.md`. v1: interface + settings fields + playback path only |

## Character & model import

A **Character** = Live2D model + persona prompt + voice profile, three decoupled parts (BandoriPet-validated structure). Import pipeline accepts:

- **Generic Cubism models** (the compatibility guarantee): any folder/zip containing `model.json` (Cubism 2) or `*.model3.json` (Cubism 3+) — community and commissioned models work with no special casing. Motion/expression names are extracted from the model manifest at load time and injected into the avatar tools' parameter enums, so the LLM only sees what the loaded model actually supports.
- **BanG Dream collection archives** (`<character>.zst` = tar+zstd with embedded index): a collection adapter understands the character/costume two-level layout and `outfit.json`/`band.json` metadata. Import extracts only the chosen character/costumes into the Workspace models directory (keep the `.zst` as source; streaming-from-archive is a later optimization, not v1).

Dev assets: 47-character set already at `./models` (git-ignored — copyrighted, never committed, never bundled).

## Shell (Rust, Tauri 2)

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | Tauri 2 | |
| WS client | `tokio-tungstenite` + `serde` | Connects to core as role `node` with declared capabilities |
| Screenshot | `xcap` | |
| Process info | `sysinfo` | Read-only in v1 (no kill) |
| Clipboard | `arboard` | |
| Shell-open | Tauri opener plugin | |
| Secrets | `keyring` crate → Windows Credential Manager | API keys never in files |
| Click-through | `windows` crate, cursor hit-test vs canvas alpha mask | Hardest module; budget spike time |
| Audit log | JSONL via `tracing` | Every Permission Gate decision |

## Pet UI (WebView2)

| Concern | Choice | Notes |
| --- | --- | --- |
| UI framework | React 19 + Vite | Settings panel, bubbles, overlays |
| Renderer | PixiJS v8 | |
| Live2D | 1-day spike between `untitled-pixi-live2d-engine` and `@naari3/pixi-live2d-display` | **Hard requirement from reference assets: must render Cubism 2 (`.model.json`/moc) AND Cubism 3+ (`.model3.json`/moc3)** — the BanG Dream model set (ModelScope `HELPMEEADICE/BanG-Dream-Live2D`) mixes both. `untitled-pixi-live2d-engine` documents Cubism 2.1-5 on PixiJS 8; the naari3 fork confirms Cubism 5 but its Cubism 2 path is unverified. Spike acceptance: one moc + one moc3 model from that set rendering with motions/expressions. Reversible choice, no ADR |
| Cubism Core | User-supplied download (license) | Never bundled |
| Avatar control | Typed tools in Agent Core (`avatar.set_expression`, `avatar.play_motion`, ...) forwarded as WS events to Pet UI | LLM drives expressions via ordinary tool calls; idle/thinking/working states are UI-local, no LLM involved |

## Repo layout

pnpm workspaces monorepo: `packages/shared` (protocol + zod), `packages/core` (Agent Core), `apps/desktop` (Tauri shell + Pet UI). Vitest for TS tests.

## Mobile (later phase, architecture-ready)

Phone connects as a read-only `node` over the same WS protocol (pairing built in, ADR 0004). Android confirmed as target: notification listener + usage signals are feasible. App shell candidate: Capacitor wrapping the Pet UI web code (Live2D reuse). Off-LAN transport via VPS relay — out of v1 scope.

Cross-device data access follows the single-owner pattern: the Agent Core is the only reader/writer of the database; every client (Shell, Pet UI, phone) queries and subscribes over the WS API. Desktop-sampled data reaches the phone as a server-push event the moment it is stored — no shared database file, no sync engine, no conflict resolution, because there is exactly one writer. Phones receive extracted summaries, not raw screenshots (bandwidth + privacy).
