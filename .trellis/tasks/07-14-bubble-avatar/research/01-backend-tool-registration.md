# Research: Tool Definition + Registration Pattern (Topic 1)

- **Query**: Exact pattern to add a new tool family; where avatar tools should register; do they cross the capability gate or take a new seam?
- **Scope**: internal
- **Date**: 2026-07-14

## Findings

### Files Found

| File Path | Description |
|---|---|
| `packages/core/src/capabilities/screenshot-tool.ts` | Canonical Shell-backed tool (route→broker→persist) |
| `packages/core/src/capabilities/clipboard-write-tool.ts` | Minimal Shell-backed tool (route→broker) |
| `packages/core/src/capabilities/route-capability.ts` | Shared route→broker step; requires a connected **node** |
| `packages/core/src/agents/chat-agent.ts` | The turn loop; merges `extraTools` into the `ToolLoopAgent` |
| `packages/core/src/main.ts` | Composition root; builds every tool and wires `extraTools` |

### The tool shape (AI SDK v7 `tool()`)

One tool per file, `x-tool.ts`, exporting `createXTool(deps) -> ToolSet` (naming per CLAUDE.md).
Verified shape (`screenshot-tool.ts:18-45`, `clipboard-write-tool.ts:15-38`):

```ts
import { tool, type ToolSet } from "ai";
import { z } from "zod";

export function createClipboardWriteTool(deps): ToolSet {
  const log = deps.logger.child({ mod: "capability" });
  return {
    clipboard_write: tool({
      description: "Replace the text contents of the user's clipboard. ...",
      inputSchema: z.object({ text: z.string() }),
      // execute NEVER throws — every failure degrades to a structured result the model can read.
      execute: async ({ text }) => {
        try { /* ... */ return { ok: true as const }; }
        catch (error) { return { ok: false as const, code: "INTERNAL_ERROR", message }; }
      },
    }),
  };
}
```

Invariants confirmed by both tools:
- The tool object key (`screenshot`, `clipboard_write`) is the **name the LLM calls**.
- `execute` is a thin controller — it delegates and **never throws**; it returns a closed
  `{ ok: true, ... } | { ok: false, code, message }` union (error-handling spec).
- Business logic is not inline: the Shell tools delegate to `routeCapability`.

### How tools reach the LLM

Merge point — `chat-agent.ts:64` (per turn, inside `runTurn`):
```ts
tools: { ...memory.createTools(characterId), ...(deps.extraTools ?? {}) },
```
`extraTools` is a **stable `ToolSet` fixed at construction** (`ChatAgentDeps.extraTools`,
`chat-agent.ts:35`). It is assembled once in the composition root — `main.ts:211-217`:
```ts
extraTools: {
  ...createLoadSkillTool(skillsLoader),
  ...capabilityTools,      // the six Shell-routed tools, one bag (main.ts:173-180)
  ...readFileTool, ...writeFileTool,
  ...mcpManager.tools(),
},
```
So **adding a tool family = build it in `main.ts` and spread it into `extraTools`**. No other
change is required for the LLM to see it. (`memory.createTools(characterId)` is the only
per-turn, character-bound tool source; everything else is boot-stable.)

### The seam decision: avatar tools do NOT use the capability broker

`routeCapability` (`route-capability.ts:30-48`):
- calls `deps.registry.findNodeForCapability(capability)` and returns `NO_NODE` if **no node**
  advertises it (`:37-41`);
- otherwise does a **request/response** round-trip through the broker to the node, which is
  Permission-Gate-authorized on the Rust Shell.

Avatar commands are structurally different:
1. **No OS action, no gate.** `avatar.play_motion` changes a webview animation; it is not a
   permissioned system capability, so it must not sit behind the Rust node/gate path.
2. **The Pet UI is a disposable client (invariant 4).** With no Pet UI connected, a capability
   tool would fail `NO_NODE`; an avatar tool must instead **succeed silently** (the emotion just
   isn't rendered) — closing the Pet UI cannot break a turn.
3. **Fan-out, not point-to-point.** The command should reach every operator subscribed to the
   character (mirror `timeline.appended`), not a single node.

**Right seam**: a new lightweight **avatar event path** — the tool's `execute` calls
`avatarSubscriptions.publish(command)` (a fan-out registry mirroring
`server/timeline-subscriptions.ts`) and returns `{ ok: true }`. It does **not** touch
`route-capability.ts`, the broker, or the Rust Shell. Full channel design in
`02-avatar-event-channel-protocol.md`.

### Suggested placement

- `packages/core/src/avatar/set-expression-tool.ts` → exports `createSetExpressionTool(deps)`
- `packages/core/src/avatar/play-motion-tool.ts` → exports `createPlayMotionTool(deps)`
- both take `{ subscriptions: AvatarSubscriptions, logger }` and one `characterId` binding at
  publish time; `execute({ name })` publishes an `AvatarCommand` and returns `{ ok: true }`.

(Colocating under a new `avatar/` folder keeps the "distinct concern → own module" rule and
avoids appending to `capabilities/`, which is specifically the Shell-gated family.)

## Caveats / Not Found

- Whether `avatar/` or `capabilities/` is the preferred folder is a naming call for the leader;
  functionally they are not capabilities (no gate), so a separate `avatar/` folder is cleaner.
- The tools are character-agnostic at construction but need the `characterId` at publish time.
  Because `extraTools` is boot-stable (not per-character), the `characterId` must ride the tool
  **call** or be bound per-turn. Simplest: the LLM turn already knows its `characterId`
  (`ChatSendParams.characterId`); bind it by constructing the avatar tools per-turn alongside
  `memory.createTools(characterId)`, OR include `characterId` server-side by having the publish
  use the turn's character. See Topic 2 for where the `characterId` binding is cleanest.
