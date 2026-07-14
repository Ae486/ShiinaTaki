# Research: thinking/working States During Tool Loops (Topic 7)

- **Query**: The avatar reflects thinking/working while the agent runs a tool loop. The state machine exists (#14). What signal drives it — does the Core already emit turn-lifecycle events, or is that a needed addition?
- **Scope**: internal
- **Date**: 2026-07-14

## Findings

### Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src/renderer/state-machine.ts` | The FSM: idle/thinking/working/sleeping — waiting for #16 to feed it |
| `apps/desktop/src/stores/avatar-store.ts` | React mirror + `dispatch(event)` |
| `packages/core/src/agents/chat-agent.ts` | The D1-hardened turn loop; yields ONLY text deltas |
| `packages/core/src/server/methods/chat-send.ts` | Streams `chat.delta`/`complete`/`error` to the operator |
| `packages/shared/src/chat-schema.ts` | The chat event contract (no lifecycle event exists) |

### The FSM is built and unfed

`state-machine.ts:8-37`: states `idle | thinking | working | sleeping`, events
`think | work | rest | sleep | wake`, pure transitions + a `RenderActivity` tier for the governor.
Its header (`state-machine.ts:5`) and the store's (`avatar-store.ts:1`) both say *"Real WS-driven
events land in #16."* So #16 supplies the driving signal; the machine itself is done.

### What signals exist today (and the gap)

An operator receives, per turn: the `chat.send` ack (`{ messageId }`), then `chat.delta` (text),
`chat.complete`, `chat.error` (`chat-schema.ts:9-58`). There is **no** turn-lifecycle or
tool-lifecycle event.

Crucially, the turn loop **surfaces only text**. `chat-agent.ts:87-96` iterates `result.stream`
and handles exactly three part types:
```ts
if (part.type === "text-delta") { pendingStepText += part.text; yield part.text; }
else if (part.type === "finish-step") { pendingStepText = ""; }
else if (part.type === "error") { throw part.error; }
```
`tool-call` and `tool-result` parts **flow past unobserved** — they are never yielded or notified.
The agent's public surface is `AsyncIterable<string>` (`ChatAgent.stream`, `chat-agent.ts:25`), and
`chat-send.ts:84-85` forwards each string as a `chat.delta`. So an operator **cannot** tell
"thinking" (model deliberating) from "working" (a tool is running) from the current stream.

### Two options

**Coarse (ZERO backend change).** The Pet UI derives states from existing events:
- bubble submit / `chat.send` → `dispatch("think")`;
- first `chat.delta` arrives → still fine to stay thinking, or treat as talking;
- `chat.complete` / `chat.error` → `dispatch("rest")` (→ idle).
This gives thinking→idle but **cannot** show a distinct "working/tool-running" state.

**Precise (RECOMMENDED, but a D1-runtime touch).** Emit a lifecycle notification from inside the
turn loop when a tool part passes, using the **existing** `turn.notify` handle — `TurnContext.notify`
(`chat-agent.ts:16-22`) is already used for MCP approval asks, so the plumbing exists:
- add a branch in the `for await` at `chat-agent.ts:87`: on `part.type === "tool-call"` →
  `turn?.notify("chat.activity", { messageId, characterId, state: "working" })`; on the step
  finishing with no further tool call → `"thinking"`; on stream end → nothing (complete already
  fires).
- This does **not** change the `AsyncIterable<string>` text contract, the `persistTurn` path
  (`chat-agent.ts:99-127`), or the abort logic — it adds one notify branch. New `@taki/shared`
  `ChatActivitySchema` + a `chat.activity` method name.
- The Pet UI maps `chat.activity.state` → `dispatch("think" | "work")` and `chat.complete` →
  `dispatch("rest")`.

**Why this is the sensitive zone**: `chat-agent.ts` is the D1-hardened runtime (partial-text
persistence, abort-awareness, truthfulness floor). Any edit here — even additive — should get
explicit leader sign-off and a test that the abort/persist behavior is unchanged. It is the **only**
place #16 would touch the hardened turn runtime; every other piece is a new module.

### Relationship to the LLM-driven avatar tools (Topics 1–3)

These are **different signals**, do not conflate:
- Topic 7 (thinking/working) is **automatic**, derived from the tool-loop lifecycle — the avatar
  should look busy whenever a tool runs, regardless of what the LLM "feels".
- Topic 2/3 avatar tools are **LLM-improvised emotion** (decision 3a) — the model *chooses* to
  `play_motion("angry")`. That rides the `avatar.command` channel, not the FSM.
Both can be live at once: the FSM sets a base thinking/working posture (render tier + a subtle
motion) while an `avatar.command` overlays an expressive beat. Keep them on separate channels
(`chat.activity` vs `avatar.command`) so neither depends on the other.

## Caveats / Not Found

- I did not find an existing `turn-lifecycle`/`turn.state` event anywhere in `packages/shared` or
  the server methods — confirmed the precise path is net-new.
- Exact AI SDK v7 part-type names (`tool-call`, `tool-result`) should be re-verified against the
  installed `ai` types when implementing — `chat-agent.ts` only branches on `text-delta` /
  `finish-step` / `error` today, so the tool-part discriminants aren't yet referenced in-repo.
  (The stream clearly carries them — the comment at `chat-agent.ts:86-87` says "Tool/approval/abort
  parts flow by here" — but the precise string literals need a types check.)
- If the leader wants #16 to avoid the D1 runtime entirely, ship the **coarse** version; the FSM
  still animates thinking→idle with no backend change, and the precise working-state can be a
  follow-up once a turn-lifecycle event is designed deliberately.
