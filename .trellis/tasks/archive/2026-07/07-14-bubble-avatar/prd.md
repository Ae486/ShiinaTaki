# PRD — Bubble conversation + LLM-driven avatar expressions/motions (GitHub issue #16)

The biggest M4 slice: click taki → bubble input → reply streams into a bubble on the SAME timeline; the LLM drives expressions/motions via `avatar.*` tools whose valid names come from the loaded model's manifest; gaze follows the cursor; click-region reactions (tsundere preset). Spans backend (avatar tools + persona injection — leader implements per 2a) and frontend (bubble + gaze + reactions). Blocked-by #14, #5 — done. Research verified all seams (`research/00`–`07`, cite file:line).

## Locked decisions (user-ratified 2026-07-14)

- **A. Manifest→enum = Option A.** avatar tools take `name: z.string()` (structured tool call, NOT a baked enum); Pet UI reports its loaded model's `{motions, expressions}` via `avatar.report` on load; Core injects the valid names into turn instructions via `instructionsExtra` (the skills-list seam); Pet UI validates on receipt, degrades gracefully (log + no-op) on unknown name. Three layers of safety: tool schema → prompt vocab list → Pet UI fallback.
- **B. Avatar channel = new `@taki/shared` avatar-schema.** Fire-and-forget push (NOT a capability-gate tool, NO Rust serde mirror — Pet UI connects as operator directly to Core like the CLI). Clone the `timeline.appended` fan-out verbatim.
- **C. CANCELLED — no D1 touch.** Expression/motion表现力 comes entirely from the LLM proactively calling `avatar.*` tools (guided by prompt: give an expression/motion before acting, switch before replying). The thinking/working state machine stays a UI-LOCAL fallback (a default "thinking" micro-motion on submit, handed over the moment an LLM avatar command arrives) — ZERO backend turn-runtime change. Rationale: most use is companion chat + occasional passive glances; "real work" is rare and not worth touching the D1-hardened loop.
- **P3. Local connection = no pairing.** Pet UI connects as operator to the loopback Core (`ws://127.0.0.1:<port>`) with auto-trust — localhost needs no pairing (correct final behavior, not a dev shortcut; interactive pairing-code UI is a v2/remote concern, D23). One-click unified startup is release engineering (D24), not #16.
- **Presentation gate + TTS seam (D21).** Expression command + text bubble flow through ONE presentation gate (not each on its own path), so #16 leaves a "ready" slot that #31 fills with "audio ready" → expression+bubble+voice sync becomes automatic. **#16 writes ZERO TTS code** — only the gate structure + the reserved slot (v1: ready = immediate). High-cohesion/low-coupling.
- Persona `>` editorial note block is STRIPPED on injection (it's human-editor meta-guidance, not persona content).

## BACKEND (leader implements, 2a — additive modules, do NOT touch the D1 turn runtime)

### B1. Persona injection (`assembler.ts` refactor)
- Replace `PERSONA_PLACEHOLDER` (`assembler.ts:14,47`) with two on-disk cards: `sections = [assistantLayer, persona, EMOTION_CAPSULE]` (assistant FIRST, per `prompt/README.md`). `EMOTION_CAPSULE` STAYS (D9/3a).
- Inject a `PersonaProvider` dep into `createAssembler` (`memory-engine.ts:39`). **`assemble()` is synchronous + per-turn hot path** → cards must be PRE-LOADED at boot; provider exposes sync `assistantLayer()` + `persona(characterId)` with a safe built-in fallback string if a file is missing (never throw in a turn).
- Strip the leading `>` blockquote note when loading each card.
- Path: new `server-config.ts` field `promptDir` (env `TAKI_PROMPT_DIR`, default repo `prompt/`), resolved with `path.join` (OS-neutral, invariant 8). Reads `<promptDir>/system/assistant-layer.md` + `<promptDir>/characters/<characterId>/persona.md`.
- Add prompt guidance to the assistant layer / persona so the LLM knows it CAN and SHOULD use `avatar.*` tools to emote (give an expression/motion before acting, switch before replying) — this is what replaces decision C.
- Tests: `persona-provider.test.ts` (reads both files, order, missing-persona fallback, missing-dir degradation, note-strip); update `assembler.test.ts` with a stub provider.

### B2. `@taki/shared` avatar protocol (invariant 3 — new schema, no barrel)
New `packages/shared/src/avatar-schema.ts` + explicit re-exports in `index.ts`:
```ts
AVATAR_METHODS = { subscribe:"avatar.subscribe", report:"avatar.report", command:"avatar.command" }
AvatarSubscribeParamsSchema = { characterId }
AvatarSubscribeResultSchema = { status:"ok" }
AvatarReportParamsSchema = { characterId, motions: string[], expressions: string[] }
AvatarReportResultSchema = { status:"ok" }
AvatarCommandSchema = { characterId, kind:"expression"|"motion", name, priority?:"idle"|"normal"|"force", loop?:boolean }
```
No Rust mirror (operator-only, webview↔core direct). Add a `protocol-fixtures` round-trip test entry.

### B3. Avatar tools + channel (Core — new `avatar/` module, invariant 7 registry)
- `packages/core/src/avatar/avatar-subscriptions.ts` — line-for-line clone of `server/timeline-subscriptions.ts`, typed to `AvatarCommand`.
- `packages/core/src/avatar/avatar-vocabulary.ts` — per-character `{motions, expressions}` store, fed by `avatar.report`, read by `instructionsExtra`.
- `packages/core/src/avatar/set-expression-tool.ts` + `play-motion-tool.ts` — AI SDK `tool({description, inputSchema, execute})`, one per file, `createAvatarTools(deps)->ToolSet`; `execute` calls `subscriptions.publish({characterId, kind, name, ...})`, returns `{ok:true}` (fire-and-forget). Bind `characterId` per-turn next to `memory.createTools(characterId)` (`chat-agent.ts:64` precedent).
- `packages/core/src/server/methods/avatar-subscribe.ts` + `avatar-report.ts` — clone `timeline-subscribe.ts` (role `["operator"]`, `ctx.onClose` auto-unsubscribe); report writes into the vocabulary store.
- Wire in `main.ts`: create subscriptions + vocabulary, pass publisher into avatar tools → `extraTools`, register the two methods, extend `instructionsExtra` to append the active character's avatar vocabulary (mirror the skills-list append at `main.ts:218`).
- Tests: tool `execute` publishes the right command; vocabulary store; subscribe fan-out; instructionsExtra includes reported names.

## FRONTEND (consumes the above)

### F1. WS client (net-new — Pet UI's first Core connection)
- `apps/desktop/src/lib/ws-client.ts` — browser-native `WebSocket` (NOT the `ws` npm pkg), mirroring `apps/cli/src/chat-client.ts` (`json-rpc-2.0` `JSONRPCServerAndClient`, zod-validate inbound). Connect as operator `{ deviceId, deviceName, role:"operator", capabilities:[] }` to `ws://127.0.0.1:<port>` — **localhost auto-trust, no pairing (P3)**. Needs a device identity (mirror the CLI's `device-identity.ts`, persisted locally). All wire data zod-parsed at this boundary (type-safety spec).
- Routes: `chat.delta`→bubble accumulate, `chat.complete`/`chat.error`→finalize, `avatar.command`→avatar controller (F3), optional `timeline.appended`. Hooks are the ONLY components' touchpoint to ws-client (hook-guidelines).

### F2. Chat bubble (`features/chat-bubble/`)
- `use-chat-bubble.ts` (send + delta accumulation, exposes `{error}`), `chat-bubble.tsx` (input + streaming text), small `chat-bubble-store.ts` (Zustand, one domain). Click OPAQUE taki (reuse `isOpaqueAt` from #15) WITHOUT drag (dead-zone guard) opens the input. **Coordinate precedence with F4 click reactions** (e.g. body-click opens bubble, head-click reacts, or a modifier — decide + document). Reply flows through the **presentation gate** (D21 seam): `chat.delta`→gate→bubble text; the gate has a reserved "ready" slot (v1 immediate).
- Timeline sharing is automatic (server-side `timeline.appended` fan-out) — the bubble does NOT own persistence.

### F3. Avatar command consumer (framework-free renderer + thin bridge)
- On model load, read `model.internalModel.motionManager.definitions` + `expressionManager.definitions` (already used `idle-behavior.ts:15`), send via `avatar.report`.
- `avatar.command` push → renderer plays `model.motion(name, priority, loop)` / `model.expression(name)` (verified engine APIs). Unknown name → log + no-op (graceful). Renderer stays framework-free; the WS→renderer wiring is a hook/bridge.
- This command + the bubble text both pass the **presentation gate** so they surface together (TTS-ready seam).

### F4. Gaze + click-region reactions (UI-local, no LLM)
- Gaze: `model.focus(x, y, instant?)` (verified `index.d.ts:4562`) on throttled cursor move; reuse #14's governor budget; clamp reach (BANDORI 600px) + micro-delta gate.
- Click-region: 7-region bucketing (head/upper_body_{l,c,r}/lower_body_{l,c,r}) + a fuzzy tag→motion/expression resolver (exact→prefix→char-prefixed→regex) porting the BANDORI pattern (`live2d-presentation-analysis.md` §4, clean-room). Default preset = **tsundere/cool** (fits taki + the arbeit costume's serious/shame/pui/angry vocab). Framework-free in `renderer/live2d/`; the preset default ships as data (a character-scoped file, prep for the M5 #24 settings picker — do NOT hardcode into logic, invariant 7). Settings UI is M5 #24, not here.

## Acceptance criteria (issue #16 + increments)
- [ ] Clicking taki opens a bubble input; sending streams a reply into a bubble
- [ ] Bubble messages read/write the same per-character timeline as the chat window (server-side sharing)
- [ ] `avatar.set_expression`/`avatar.play_motion` driven by the LLM; param names from the model manifest (Option A — no hardcoded names)
- [ ] Gaze follows the cursor; clicking a hit region triggers its configured motion/expression (tsundere preset)
- [ ] Thinking/working reflected in the avatar during tool loops (UI-local fallback + LLM-driven avatar commands — no D1 touch)
- [ ] Persona: assistant layer + taki persona loaded from `prompt/` and injected (assistant first), replacing the placeholder
- [ ] Presentation gate: expression + bubble surface through one gate with a reserved TTS-ready slot (zero TTS code)
- [ ] [v1/M4] Click-region personality presets (7-region + fuzzy resolver)
- [ ] [v1/M4] Emotion→window micro-animation coupling (hop/shake/settle) driven by the same signal — LIGHT: wire the seam, minimal set
- [ ] Tests: manifest→enum (report→vocabulary→instructionsExtra); bubble↔timeline write path; persona provider; avatar tool publish; click-region resolver

## Constraints
- **Do NOT touch the D1-hardened turn runtime** (`chat-agent.ts` stream loop / persistence / abort). All backend work is additive new modules + the assembler injection + main.ts wiring. If something seems to need a turn-runtime change, STOP and flag (it shouldn't — decision C was cancelled precisely to avoid it).
- Protocol types defined once in `@taki/shared` (zod), invariant 3. `characterId` threaded everywhere, invariant 7 (no hardcoded single character — taki is data).
- Never code external APIs from memory — engine `focus/motion/expression`, AI SDK `tool()`, `json-rpc-2.0` client shapes verified in research; re-confirm against node_modules when wiring.
- Anti-sprawl: TS ≤300/fn≤50/≤3 params; INPUT/OUTPUT/POS headers; update touched dirs' index.md; no barrels; no `any`; discriminated unions; renderer/ framework-free; components reach ws-client/tauri only via hooks.
- Manual checks (bubble visuals, streaming feel, gaze, actual expression changes, click reactions) → queue to `docs/devlog/manual-checks.md`; automate the pure/logic parts (vocabulary, resolver, provider, publish, timeline write).
- This is a large slice — implement in dependency order: B2 (schema) → B1+B3 (backend) → F1 (ws-client) → F2/F3/F4 (frontend). May warrant multiple implement passes; keep each pass gate-green.

## Research inputs (verified, read first)
- `research/00-overview-and-decisions.md` (decision surface) + `01`–`07` (per-topic detail with file:line)
- `prompt/README.md` (injection order), `.trellis/spec/frontend/live2d-renderer.md` (renderer conventions), `docs/TTS-INTERFACE.md` (presentation-gate seam)
