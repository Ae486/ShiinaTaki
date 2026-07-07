# PRD: Reference Research — Live2D Presentation, Nocturne Memory, Ecosystem Gaps

**Type: research-only task.** Deliverables are research documents under `research/` plus a buy-vs-build (连 vs 造) recommendation per topic. No implementation, no trellis-implement/check cycle. The `00-bootstrap-guidelines` task stays open in parallel (requirements discussion not fully closed).

## Questions to answer

### 1. BanG Dream pet Live2D presentation (`references/BANDORI-PET-REV-main`)

Its README claims a self-built LuaJIT render core (Live2D-v2-Lua, 6x faster than live2d-py). It is a Python/Qt stack — not directly reusable. Answer:

- What presentation features did it actually build beyond raw rendering? (head/eye tracking, click hit areas + reactions, motion presets, emotion-driven expressions, lip-sync, drag physics, idle behavior, quality/SSAA handling)
- For each feature: does our web stack (PixiJS 8 + untitled-pixi-live2d-engine / @naari3 fork) already provide it (连), or must we build it (造)? What is the build cost on our stack?
- Which of its design patterns (not code — GPLv3) are worth porting?

### 2. Nocturne Memory (`references/nocturne_memory-main`)

A Python backend with MCP server, SQLite DB, and (curiously) a `desktop_pet/` directory. Answer:

- What is its memory model (schema, retrieval, write path)? What interfaces does it expose (MCP tools, REST)?
- 连: can we run it as an external MCP server (local or VPS) consumed by our `@ai-sdk/mcp` client with zero code? Deployment cost, resource footprint, Windows compatibility?
- 造: how much of it would a native TS implementation in `packages/core/src/memory/` need to replicate? Compare against our current plan (markdown + FTS5, OpenClaw-style).
- Recommendation with reasoning.

### 3. Ecosystem gap scan (cautious — only high-confidence wins)

For gaps in our stack where mature glue exists: Rust↔TS type generation (tauri-specta / ts-rs), Live2D lip-sync helpers, window click-through helpers, anything else clearly load-bearing. Reject anything speculative.

## Constraints

- References are GPLv3 / study-only: patterns and architecture may be learned; code may never be copied.
- All findings persisted to `research/*.md` with file-path evidence (for local repos) and URLs (for external).
- Executed by opus-model sub-agents per user instruction.
