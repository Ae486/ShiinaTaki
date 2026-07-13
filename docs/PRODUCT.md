# TakiAgent — Product Definition (v1)

A desktop AI companion living on your Windows desktop: an animated Live2D character with a persona, real memory, awareness of what you're doing, hands to help, and the sense not to interrupt. The agent is referred to as **taki**; the v1 Character is Shiina Taki (椎名立希).

Engineering counterparts: `TECH-STACK.md` (stack), `MEMORY-DESIGN.md` (memory), `adr/` (foundational decisions), `CONTEXT.md` (vocabulary).

## Core features (user-facing)

- **Living avatar**: Live2D character, transparent always-on-top, per-pixel click-through; blinks, tracks your cursor, reacts to clicks; visible states (thinking / working / sleeping). Import any generic Cubism model or the BanG Dream collection; character = model + persona card + voice, freely combinable.
- **Real memory**: remembers events from weeks ago; promises and rules are never forgotten (pinned, never truncated); has unsaid thoughts that surface when the mood fits; all memory is readable/editable markdown on your disk, offline-safe. (Layered: global user profile + activity records; per-character relationship/episodes/intentions — see MEMORY-DESIGN.)
- **Considerate proactivity**: knows roughly what you're up to (light sensing by default; screenshots opt-in); speaks up only with a reason, rate-limited, quiet hours; one-click Privacy Pause (she visibly sleeps).
- **Capable hands, gated**: bring your own OpenAI-compatible API; can view the screen, list processes, open URLs/files/apps, use the clipboard, run commands — every action crosses the Permission Gate (allowlist / approval dialog / blocklist / audit trail). Extensible via MCP servers and skill packs.
- **Always alive**: closing the pet window doesn't stop the agent — memory, schedules, and reminders keep running headless.
- **Voice (reserved)**: VPS-hosted TTS with lip-sync, contract fixed, ships later.
- **Phone (later)**: Android node — same companion, chat, notifications, real-time sync of desktop activity.

## v1 scope decisions (grill session 2026-07-07, Q8-Q11)

| Decision | Outcome |
| --- | --- |
| Characters | Single character (Shiina Taki); multi-character architecture kept open, not built |
| Memory ownership | Layered: `profile`/`activity` global; `relationship`/`episodes`/`intentions` per-character; layers are registry data, not code (MEMORY-DESIGN) |
| Conversation | One continuous timeline per character, no session list (ADR 0005); two entries — quick bubble input on the pet + full chat window, same stream |
| Screenshots | Retained by default with configurable window + master switch; dual-threshold retention (age + disk cap); entry outlives image; sensitive-process skip list (MEMORY-DESIGN, activity pipeline) |
| Activity cards | Thumbnail (click-to-open) + time + process snapshot + taki's interpretation, written in one pass at capture time |

## Settings panel v1 scope

| Group | In panel (v1) | Config-file / deferred |
| --- | --- | --- |
| Model | API base URL, key (Credential Manager), model name | advanced sampling params |
| Sensing | master switch, interval, screenshot toggle, screenshot retention days + disk cap, sensitive-process skip list | randomness/action-trigger fine-tuning |
| Proactivity | quiet hours, daily cap, cooldown | trigger probability tuning |
| Permissions | exec policy mode, allowlist editor, per-capability switches, grant management (revoke "always allow"), read-only audit log viewer | — |
| Character | model import (dir/zip/.zst), character & costume picker **with embedded live preview canvas**, persona preset editor (default read-only preview), TTS fields (endpoint/key/voice) | multi-character management |
| Presentation | scale, opacity, position reset, render quality profile, idle-motion switch, random-motion switch, head/gaze tracking switch, click-feedback mapping (motion/expression with preview buttons, personality presets), default motion/expression | mutual gaze, group movement (multi-char) |
| Extensions | MCP servers: list CRUD (stdio command/args/env or HTTP URL/headers, enable toggle), connection status + test, discovered-tools count, secret fields stored in Credential Manager (ADR 0006); Skills: installed list from workspace/skills (name/description from SKILL.md), per-skill enable toggle, open-folder button | MCP OAuth flows, skill editor, marketplace/discovery |
| General | autostart, Privacy Pause (also in tray) | WS port, token budgets, memory layer registry |

Preview note: the settings window reuses the web renderer component for an embedded preview canvas — pick a costume or a click-motion and see it play immediately (cheaper for us than BandoriPet's preview-on-pet approach, which we can add later).

## Roadmap

| Version | Ships |
| --- | --- |
| v1 | Full desktop companion (all-local): avatar + interaction, chat (bubble + window), layered memory, capabilities + Permission Gate, reason-gated proactivity, settings panel above |
| v1.5 | Nightly diary (readable panel), intention surfacing polish, memory consolidation, memory/activity album; **VPS-hosted core deployment mode** (taki persistently online; desktop and phone become frontends) |
| v2 | Paraphrase-association memory (hybrid vector RAG), TTS + lip-sync live, Android node |
