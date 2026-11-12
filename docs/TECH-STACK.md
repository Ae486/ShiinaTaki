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
| Memory | Provider-neutral runtime with one active Memory Authority; canonical Local and Hindsight/Replica contracts | ADR 0009 and the active migration/runtime selection govern current behavior; legacy Markdown storage is not the Heartbeat integration contract |
| Scheduler and initiative | Existing `croner` Scheduled provider; typed Core-owned Interaction Patterns and shared Signal/Wake Policy for Heartbeat | Initiative development reuses RunService, ChatAgent and the existing Monitor; no mutable HEARTBEAT.md authority or separate Agent loop |
| Config | Core-owned sparse SQLite settings overlay with zod validation; explicit environment > stored > default | Existing operator settings API owns writes; secrets stay outside this value store |
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
| Click-through | Tauri `setIgnoreCursorEvents` (sets `WS_EX_TRANSPARENT｜WS_EX_LAYERED` under the hood) + global-cursor poll via `cursorPosition()` vs a per-frame cached canvas alpha mask | Solved in #15 — NO `windows` crate needed (Tauri's API already does the WS_EX toggle); crate is only an optional latency fallback |
| Audit log | JSONL via `tracing` | Every Permission Gate decision |

## Pet UI (WebView2)

| Concern | Choice | Notes |
| --- | --- | --- |
| UI framework | React 19 + Vite | Settings panel, bubbles, overlays |
| State | Zustand ^5 | One store per domain; state of record stays in Agent Core |
| Renderer | PixiJS v8 | |
| Live2D | **LOCKED (spike #13, 2026-07-13): `untitled-pixi-live2d-engine@1.3.1` + `pixi.js@8.19.0`, Cubism Core 5.1.0** — see decision record below | Hard requirement met: renders Cubism 2 (`.model.json`/moc) AND Cubism 3+ (`.model3.json`/moc3) — the BanG Dream model set mixes both |

### Live2D renderer decision (research 07-07, task `live2d-renderer-selection`)

Five candidates evaluated across adoption / performance / stack fit / extensibility / Android WebView (full matrix in the task's `research/renderer-comparison.md`). Decisive fact: **no library spans Cubism 2→5 except `untitled-pixi-live2d-engine`** — every alternative drops one end (`@naari3` and the official Cubism Web SDK have NO Cubism 2; guansss/RaSan147 forks have no Cubism 5).

- **Primary (A)**: `untitled-pixi-live2d-engine` — full Cubism 2-5, native PixiJS 8 render pipe, bundled lip-sync (serves TTS v2) + texture LOD (serves big BanG Dream atlases and mobile memory). Lineage de-risked: same family tree as guansss/RaSan147 forks, so downgrade migration is cheap.
- **Fallback (C)**: `pixi-live2d-display-lipsyncpatch` (RaSan147) — the AI-vtuber ecosystem's battle-tested choice (`model.speak` lip-sync), but pins PixiJS 7 and has no Cubism 5.
- **Spike outcome (issue #13, executed 2026-07-13): A LOCKED — `untitled-pixi-live2d-engine@1.3.1`, `pixi.js@8.19.0`, Cubism Core 5.1.0.** Both a moc (`taki/arbeit`, 43 motions/30 expressions) and a moc3 (`taki/live_01`, 63 motion groups/33 expressions) loaded and rendered under PixiJS 8 with motion + expression playback, raw-parameter round-trip on both generations, and the `model.speak` lip-sync API present; Cubism Core 5.1.0 drives the moc3 with no version block, so the fallback branch was never needed. `hitTest` returns `[]` on both — BanG Dream manifests define no SDK hit areas (only BandoriPet-custom fields), confirming #16's custom hit-area increment. Layout scale 1.0 on both (no moc3 framing compensation needed so far). Evidence: `.trellis/tasks/07-13-live2d-renderer-spike/research/` (spike-report.md, runtime-evidence.md, spike-screenshot.png). Caveat: runtime proof captured on headless Edge/SwiftShader (same Chromium engine as WebView2, software GL); in-WebView2 GPU visual + idle-cost checks remain queued in `docs/devlog/manual-checks.md`.
- **Runtime vendoring**: Cubism Core (`live2dcubismcore.min.js`) and the Cubism 2.1 runtime (`live2d.min.js` — survives only on unofficial mirrors) are proprietary: vendored locally via a download script, git-ignored, NEVER committed or hotlinked.
- **Mobile note**: no candidate has published Capacitor/Android evidence; WebGL2 (not WebGPU) is the mobile plan, and the Android node work (v2) starts with a real-device render spike. A's texture LOD is the best hedge against WebView large-atlas OOM.
| Cubism Core | User-supplied download (license) | Never bundled |
| Avatar control | Typed tools in Agent Core (`avatar.set_expression`, `avatar.play_motion`, ...) forwarded as WS events to Pet UI | LLM drives expressions via ordinary tool calls; idle/thinking/working states are UI-local, no LLM involved |

## Repo layout

pnpm workspaces monorepo: `packages/shared` (protocol + zod), `packages/core` (Agent Core), `apps/desktop` (Tauri shell + Pet UI). Vitest for TS tests.

## Mobile (later phase, architecture-ready)

Phone connects as a presentation/operator frontend to the same Core over the authenticated API (pairing and role separation in ADR 0004), including when Core runs on a VPS. It does not run a second Core or imply an Execution Host. Android remains the later target; Capacitor wrapping the Pet UI web code is a candidate, not a selected implementation. Any future notification-listener, usage-signal or other device capability provider is a separate, explicitly governed Node role rather than a requirement of the phone frontend.

Cross-device data access follows the single-owner pattern: the Agent Core is the only reader/writer of the database; every client (Shell, Pet UI, phone) queries and subscribes over the WS API. Desktop-sampled data reaches the phone as a server-push event the moment it is stored — no shared database file, no sync engine, no conflict resolution, because there is exactly one writer. Phones receive extracted summaries, not raw screenshots (bandwidth + privacy).

Deployment topologies (clarified 2026-07-07; the rule in both: **the database always colocates with the Agent Core — never split across a network**):

- **All-local** (development, and the v1 ship shape): Core + DB on the desktop; everything on localhost.
- **VPS-hosted core** (production target, v1.5): the user runs a 24/7 VPS (4C/24G) — Core + DB + Workspace memory + TTS live there; taki is persistently online. The desktop becomes Pet UI frontend + capability node (Shell connects over the same WS protocol, unchanged role); the phone is a pure frontend. Desktop off = screen sensing and desktop capabilities unavailable (tools return structured "node offline" errors), while chat, memory, heartbeat, and MCP/network tools keep running.
- Deltas the VPS mode needs (all small, none architectural): transport security (Tailscale preferred — zero TLS management; public WSS + device tokens as fallback, pairing already in ADR 0004), a per-OS secrets backend for the core (Credential Manager on Windows; restricted-permission file/env on Ubuntu headless), a headless Linux packaging target (systemd unit), and node-offline degradation wording in tool descriptions.
- **Cross-platform guarantee**: `packages/core` + `packages/shared` must run on Windows AND Ubuntu (architecture invariant 8, CLAUDE.md). Enforced by CI from M1: test matrix `windows-latest` + `ubuntu-latest` runs core/shared typecheck + tests on every push — platform drift is caught at commit time, not at deployment time.

User Presence clarification (owner, 2026-09-08): Core uptime, an authenticated connection, User Presence, message presentation and Execution Host availability are distinct. Core needs a fresh, evidence-backed view of the user across clients so absence is not misclassified as ignored messages or readiness to handle a user-dependent step. Reserve authenticated per-client reports, expiry, cross-device aggregation and explicit unknown states in the Heartbeat design. A background phone connection or push route proves reachability only; a fresh phone interaction may establish User Presence while the desktop Host remains unavailable. Core-only work allowed by policy may continue during user absence. The current planning record is `.trellis/tasks/09-08-t4-heartbeat/`; this is a contract reservation, not a claim that presence reporting or the phone application is implemented.
