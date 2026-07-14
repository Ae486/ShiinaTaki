# Research: Issue #16 Overview + Framed Decisions

- **Query**: Map the backend (avatar tools + persona injection) and frontend (bubble + gaze + click reactions) architecture for #16
- **Scope**: mixed (internal repo code + installed engine types + model manifests)
- **Date**: 2026-07-14

This file is the leader's decision surface. Per-topic detail lives in `01`–`07`.

---

## Scope shape (what #16 adds, and the ONE sensitive touch)

Everything in #16 is **additive new modules** EXCEPT one optional edit to the D1-hardened
turn loop (Topic 7). Concretely:

| Piece | Nature | Touches D1 runtime? |
|---|---|---|
| Avatar tools (`avatar.set_expression` / `avatar.play_motion`) | new `capabilities/`-style tool family, added to `extraTools` | No |
| Avatar event channel (`avatar.command` push) | new `@taki/shared` schema + new Core subscriptions module + new WS method | No |
| Persona injection | inject a pre-loaded reader into `createAssembler` | No (assembler only) |
| Bubble UI + WS client | new `apps/desktop/src/lib/ws-client.ts` + `features/chat-bubble/` | No (frontend) |
| Gaze follow + click-region reactions | new framework-free `renderer/live2d/` modules | No (frontend, no LLM) |
| **Thinking/working avatar states (precise)** | **new lifecycle emit inside `chat-agent.ts` stream loop** | **YES — see Topic 7** |

The turn-runtime is hardened (D1). The only place #16 would touch it is the *precise*
thinking-vs-working signal. A **coarse** thinking→idle needs **zero** backend change.

---

## DECISION 1 — Manifest → tool-enum architecture (the subtle one; Topic 3)

**Problem**: the AC says avatar-tool param values come from the loaded model's manifest
(no hardcoded motion names). But the **Core runs the LLM** while the **Pet UI owns the
model**, and the two extracted taki costumes have *different* vocabularies:
- `arbeit` (Cubism 2, the one loaded today — `load-taki-model.ts:14`): motions `smile01..04`,
  `angry01..04`, `thinking01`, `serious01/02`, `shame01/02`, `sad01..03`, `pui01`, `kime01`…;
  expressions `default`, `smile0x`, `angry0x`, `shame0x`…
- `live_01` (Cubism 3): motions `mtn_smile01_C/L/R`, `mtn_angry01_*`, `mtn_thinking01_*`…;
  expressions `exp_smile05`, `exp_shy03`, `exp_serious01`…

**Recommendation: Option A — free-string param + Pet-UI-reported vocabulary injected into
the system prompt** (mirrors the existing skills-list pattern exactly).
- Avatar tool `inputSchema` takes `name: z.string()` (NOT a baked `z.enum`).
- On model load the Pet UI reads `model.internalModel.motionManager.definitions` (motion group
  names) + `...expressionManager.definitions` (expression names) and **reports them to the
  Core** over WS.
- The Core holds a per-character "avatar vocabulary" and injects the valid names into the turn
  instructions via `instructionsExtra` — the same seam the skills list already uses
  (`main.ts:218` `instructionsExtra: () => skillsLoader.renderList()`).
- The Pet UI validates the name on receipt and **degrades gracefully** (log + no-op) on an
  unknown name; the tool's `execute` always returns `ok` (fire-and-forget).

Why not the alternatives:
- **Option B (dynamic `z.enum`)**: tools today are built once at boot (`main.ts`), `extraTools`
  is fixed; a live enum would need a per-turn tool factory threaded with a mutable vocab, and
  `z.enum` needs ≥1 value (an unloaded/closed Pet UI breaks it). More coupling for no real gain.
- **Option C (Core reads the manifest file)**: violates invariant 8 — the Core is OS-neutral and
  must not own model assets (`models/` is git-ignored, loaded by the Pet UI via Tauri asset
  protocol, #18). Rejected.

Full tradeoffs + verified API in `03-manifest-enum-architecture.md`.

---

## DECISION 2 — The exact `@taki/shared` protocol additions (Topics 1 & 2)

Avatar commands are **NOT** capability-gate tools. Capability tools route through
`routeCapability` → broker → a connected **node** (the Rust Shell) and require the Permission
Gate (`route-capability.ts:30`, needs `findNodeForCapability`). Avatar commands instead **push a
fire-and-forget event to the Pet UI (an operator)**, reusing the `timeline.appended` fan-out
pattern verbatim.

New file `packages/shared/src/avatar-schema.ts` (+ named re-exports in `index.ts`):

```ts
export const AVATAR_METHODS = {
  subscribe: "avatar.subscribe",   // operator → core: start receiving this character's commands
  report:    "avatar.report",      // operator → core: Pet UI reports its model's vocab (Topic 3)
  command:   "avatar.command",     // core → operator: play this expression/motion NOW
} as const;

export const AvatarSubscribeParamsSchema = z.object({ characterId: z.string().min(1) });

// Topic 3: Pet UI reports the loaded model's available names on load / model-swap.
export const AvatarReportParamsSchema = z.object({
  characterId: z.string().min(1),
  motions: z.array(z.string()),      // motion group names (Object.keys(definitions))
  expressions: z.array(z.string()),  // expression names
});

// Core → Pet UI push (mirrors TimelineAppended). kind picks the engine call.
export const AvatarCommandSchema = z.object({
  characterId: z.string().min(1),
  kind: z.enum(["expression", "motion"]),
  name: z.string().min(1),
  // optional motion knobs (engine motion() supports priority + loop)
  priority: z.enum(["idle", "normal", "force"]).optional(),
  loop: z.boolean().optional(),
});
```

**No Rust serde mirror is required.** Invariant 3 mirrors only protocol shapes the Rust Shell
actually handles (it mirrors connect/capability/approval because it is a **node**). `avatar.*`
is **operator-only, webview↔core direct** — the Pet UI webview opens its own loopback WS to the
Core (exactly as `apps/cli` does), so the Rust Shell never sees these frames. This matches how
`chat.*` and `timeline.*` already have no Rust mirror. (Confidence high; see Topic 2 for the
connection-topology evidence.)

Core-side additions (all new files, invariant 7 registry pattern):
- `packages/core/src/avatar/avatar-subscriptions.ts` — fan-out registry, a line-for-line mirror
  of `server/timeline-subscriptions.ts`.
- `packages/core/src/avatar/avatar-vocabulary.ts` — per-character store fed by `avatar.report`,
  read by `instructionsExtra` (Topic 3).
- `packages/core/src/capabilities/…` or `packages/core/src/avatar/set-expression-tool.ts` +
  `play-motion-tool.ts` — the tools; `execute` calls `avatarSubscriptions.publish(command)`.
- `packages/core/src/server/methods/avatar-subscribe.ts` + `avatar-report.ts` — mirror
  `timeline-subscribe.ts`.
- Wire in `main.ts`: create the subscriptions + vocabulary, pass the publisher into the avatar
  tools, add them to `extraTools`, register the two methods, extend `instructionsExtra`.

---

## DECISION 3 — The one D1 turn-runtime touch (Topic 7), or skip it

The state machine (`renderer/state-machine.ts`: idle/thinking/working/sleeping) exists but is
unfed ("Real WS-driven events land in #16"). Signals an operator gets **today**: `chat.delta`
(text), `chat.complete`, `chat.error` — plus the `chat.send` ack. There is **no** turn- or
tool-lifecycle event; tool-call/tool-result parts flow through `result.stream` but are **not**
surfaced (the loop yields only `part.text`, `chat-agent.ts:88`).

- **Coarse (zero backend change)**: Pet UI derives `think` on submit → `rest` on first
  `chat.delta`/`chat.complete`. Cannot distinguish "working" (tool running) from "thinking".
- **Precise (recommended, but a D1 touch)**: emit a lifecycle notification from inside the
  `chat-agent.ts` stream loop when a `tool-call`/`tool-result` part passes by, via the **existing**
  `turn.notify` handle (`TurnContext.notify`, `chat-agent.ts:18` — already used for MCP approvals).
  This does not change the `AsyncIterable<string>` text contract, the persistence path, or the
  abort logic — it adds one branch to the `for await` at `chat-agent.ts:87`. Still the D1 zone;
  **leader must sign off**.

Recommendation: ship the **coarse** version if #16 must avoid the D1 runtime entirely; otherwise
take the minimal `turn.notify` touch for a real thinking↔working distinction.

---

## AC feasibility flags

- **Bubble ↔ timeline**: the Pet UI has **no WS client yet** (no `@taki/shared` import anywhere in
  `apps/desktop/src`). #16 must add `lib/ws-client.ts` (browser-native `WebSocket`, mirroring
  `apps/cli/src/chat-client.ts`). This also means #16 owns the **first Pet UI ↔ Core handshake**,
  including device identity + pairing (`connect` issues a pairing code, `main.ts:198`). Real cost;
  see Topic 5.
- **Persona from disk**: `assemble()` is **synchronous** (`assembler.ts:45`, `memory-engine.ts:61`).
  Persona files must be **pre-loaded at boot** (sync `get(characterId)`), not read inside
  `assemble`. See Topic 4.
- Everything else is cleanly meetable with the additive modules above.
