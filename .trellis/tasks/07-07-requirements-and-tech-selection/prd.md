# PRD: Requirements Discussion and Tech Selection

**Status: DONE.** This task records the completed requirements/tech-selection phase (grill-with-docs sessions, 2026-07-06/07). All decisions live in canonical docs — this file is the entry point, not a copy.

## What was decided

### Product

TakiAgent (repo: ShiinaTaki) — a Windows-native, companion-oriented desktop pet whose core is a local LLM agent runtime (OpenClaw/Hermes-like). Agent runtime first, pet shell second.

- Positioning: personal-first, architected for open-source release (config via in-app settings panel)
- Companion behavior: periodic Sampling (window titles/process names default-on; screenshots default-off) + rate-limited Proactive Utterances; all parameters user-tunable; Privacy Pause switch; tiered sensitivity
- Permissions: read-heavy. Typed capabilities (screenshot, process list, clipboard, shell-open, workspace file RW) + general `exec` behind allowlist/approval. Keyboard/mouse simulation and kill-process excluded from v1
- TTS: reserved interface in v1, VPS-hosted backend, OpenAI-compatible contract
- Mobile: Android node (read-only signals + avatar + notifications), later phase, protocol-ready from day one

### Architecture & stack

Three-process split: TS Agent Core (Node 24, AI SDK ^7 per ADR 0003 amendment, headless, WS JSON-RPC hub, SQLite single-owner) + Rust Shell (Tauri 2, all system capabilities, Permission Gate) + Pet UI (React 19 + Vite + Tailwind 4 + PixiJS 8 + Live2D). pnpm workspaces monorepo.

Live2D: renderer spike (untitled-pixi-live2d-engine vs @naari3/pixi-live2d-display) with hard acceptance = render one Cubism 2 + one Cubism 3 model from the BanG Dream set in `./models`. Generic Cubism import is the compatibility baseline; `.zst` collection archives via adapter.

## Canonical documents (source of truth)

| Document | Content |
| --- | --- |
| `CONTEXT.md` | Domain glossary (16 terms) |
| `docs/index.md` | Documentation index |
| `docs/adr/0001` | TS core + Rust shell + WebView UI split |
| `docs/adr/0002` | Exec in v1 behind the Rust Permission Gate |
| `docs/adr/0003` | Vercel AI SDK 6 as agent engine |
| `docs/adr/0004` | JSON-RPC/WS protocol with device pairing |
| `docs/TECH-STACK.md` | Full stack table, character/model import, mobile data pattern |
| `docs/TTS-INTERFACE.md` | Reserved TTS wire contract and client design |

## Open items deferred to implementation

- Live2D renderer library: decided by spike at Pet UI milestone start
- Sampling/proactivity parameter defaults: config-driven, tuned after first runnable build
- Bun single-file packaging: re-evaluated at distribution time
