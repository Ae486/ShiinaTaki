# TakiAgent Tech Stack (v1)

Selection principle: glue mature components, build only the domain-specific parts (Permission Gate, companion behaviors, protocol). Decisions marked ADR have a record in `docs/adr/`.

## Agent Core (TypeScript, Node 24 LTS)

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime | Node 24 LTS | No Bun-specific APIs; Bun single-file compile re-evaluated at distribution time |
| Agent engine | Vercel AI SDK (`ai@^7`, `@ai-sdk/mcp@^2`) | ADR 0003 (decided on SDK 6; v7 is current stable — see ADR amendment). ToolLoopAgent + built-in tool approval wired to Permission Gate |
| LLM providers | OpenAI-compatible as the default and primary path (`@ai-sdk/openai-compatible@^3`, user-supplied base URL + key) | User's real-world setup. Other `@ai-sdk/*` providers are config away, no code |
| Logging | `pino@^10` (structured JSON) | Audit log is separate (JSONL, Shell-side) |
| MCP client | `@ai-sdk/mcp` (stable since SDK 6) | stdio + HTTP transports; OAuth supported |
| Skills | SKILL.md folders (OpenClaw/Claude Code convention) | Loader lists descriptions in prompt, loads full content on demand |
| WS API | `ws` + JSON-RPC 2.0 + zod schemas in shared package; `json-rpc-2.0` (npm) as envelope library | ADR 0004. Device identity + pairing from day one. Envelope lib is transport-agnostic, composes with `ws` + zod (per ecosystem scan 07-07) |
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
| Official plugins | `single-instance` + `autostart` (must-have), `positioner` (should-have); `updater`/`notification` planned | Ecosystem scan 07-07 |
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
| State | Zustand ^5 | One store per domain; state of record stays in Agent Core |
| Renderer | PixiJS v8 | |
| Live2D | **Primary: `untitled-pixi-live2d-engine`** — the only candidate with documented Cubism 2/3/4/5 coverage (+ bundled lip-sync, parallel motion, texture LOD). Research (07-07-reference-research) found `@naari3/pixi-live2d-display` is **Cubism 5 only**, failing the mixed-format requirement | **Hard requirement from reference assets: must render Cubism 2 (`.model.json`/moc) AND Cubism 3+ (`.model3.json`/moc3)** — the BanG Dream model set mixes both. Spike still validates before lock-in: one moc + one moc3 model rendering with motions/expressions |
| Cubism Core | User-supplied download (license) | Never bundled |
| Avatar control | Typed tools in Agent Core (`avatar.set_expression`, `avatar.play_motion`, ...) forwarded as WS events to Pet UI | LLM drives expressions via ordinary tool calls; idle/thinking/working states are UI-local, no LLM involved |

## Repo layout

pnpm workspaces monorepo: `packages/shared` (protocol + zod), `packages/core` (Agent Core), `apps/desktop` (Tauri shell + Pet UI). Vitest for TS tests.

## Mobile (later phase, architecture-ready)

Phone connects as a read-only `node` over the same WS protocol (pairing built in, ADR 0004). Android confirmed as target: notification listener + usage signals are feasible. App shell candidate: Capacitor wrapping the Pet UI web code (Live2D reuse). Off-LAN transport via VPS relay — out of v1 scope.

Cross-device data access follows the single-owner pattern: the Agent Core is the only reader/writer of the database; every client (Shell, Pet UI, phone) queries and subscribes over the WS API. Desktop-sampled data reaches the phone as a server-push event the moment it is stored — no shared database file, no sync engine, no conflict resolution, because there is exactly one writer. Phones receive extracted summaries, not raw screenshots (bandwidth + privacy).

Deployment topologies (clarified 2026-07-07; the rule in both: **the database always colocates with the Agent Core — never split across a network**):

- **All-local** (development, and the v1 ship shape): Core + DB on the desktop; everything on localhost.
- **VPS-hosted core** (production target, v1.5): the user runs a 24/7 VPS (4C/24G) — Core + DB + Workspace memory + TTS live there; taki is persistently online. The desktop becomes Pet UI frontend + capability node (Shell connects over the same WS protocol, unchanged role); the phone is a pure frontend. Desktop off = screen sensing and desktop capabilities unavailable (tools return structured "node offline" errors), while chat, memory, heartbeat, and MCP/network tools keep running.
- Deltas the VPS mode needs (all small, none architectural): transport security (Tailscale preferred — zero TLS management; public WSS + device tokens as fallback, pairing already in ADR 0004), a per-OS secrets backend for the core (Credential Manager on Windows; restricted-permission file/env on Ubuntu headless), a headless Linux packaging target (systemd unit), and node-offline degradation wording in tool descriptions.
- **Cross-platform guarantee**: `packages/core` + `packages/shared` must run on Windows AND Ubuntu (architecture invariant 8, CLAUDE.md). Enforced by CI from M1: test matrix `windows-latest` + `ubuntu-latest` runs core/shared typecheck + tests on every push — platform drift is caught at commit time, not at deployment time.
