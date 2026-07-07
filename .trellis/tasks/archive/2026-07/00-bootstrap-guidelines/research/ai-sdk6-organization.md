# Research: Vercel AI SDK 6 Project Organization Patterns

- **Query**: Documented patterns for organizing agents/tools in AI SDK 6 codebases
- **Scope**: external
- **Date**: 2026-07-07

## Findings

### 1. Officially recommended file structure (from vercel/ai repo skill)

Source: https://github.com/vercel/ai — `skills/use-ai-sdk/references/type-safe-agents.md` (Vercel's own agent-facing reference):

```
lib/
  agents/
    my-agent.ts        # Agent definition + inferred type export
  tools/
    weather-tool.ts    # ONE tool per file
    calculator-tool.ts
```

- **One tool per file**, kebab-case filename with `-tool` suffix; the tool file exports:
  - the tool itself (`export const weatherTool = tool({ description, inputSchema, execute })`)
  - its typed UI invocation: `export type WeatherToolInvocation = UIToolInvocation<typeof weatherTool>;` — so UI components import **only the type**, never the tool implementation.
- Agent file exports the agent + inferred message type:

```ts
export const myAgent = new ToolLoopAgent({
  model: '...', instructions: '...',
  tools: { weather: weatherTool, calculator: calculatorTool },
});
export type MyAgentUIMessage = InferAgentUIMessage<typeof myAgent>;
```

- Tool rendering split into one component per tool (`components/weather-tool.tsx`), switched on `part.type === 'tool-weather'` in the message renderer.

### 2. Agent abstraction (AI SDK 6)

Sources: https://ai-sdk.dev/docs/agents/overview , https://ai-sdk.dev/docs/agents/building-agents , https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent

- In v6, `Agent` is an **interface**; `ToolLoopAgent` is the production default implementation. Design intent: "Define agents once and use them across your application" (API routes, jobs, streaming UIs) — i.e. agent definitions are shared modules, not inline route code.
- Tool names = the string keys of the `tools` object (camelCase or snake-free words are typical: `weather`, `calculator`); tool `description` fields are load-bearing for model tool selection — write what it does / when to use / what it returns.
- Default loop limit: `stopWhen: isStepCount(20)` (20 steps).
- Context separation: `runtimeContext` (shared loop state) vs `toolsContext` (per-tool secrets/permissions declared via each tool's `contextSchema`) — a documented reason to keep tool definitions modular with their own schemas.
- `zod` is the standard `inputSchema` mechanism for tools (https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk).
- Use core `generateText`/`streamText` + explicit control flow for deterministic structured workflows; `ToolLoopAgent` for autonomous loops.

### 3. File-organization rules from Vercel's own agent codebase

Source: https://github.com/vercel-labs/open-agents/blob/main/AGENTS.md — anti-god-file rules (full quotes captured in `anti-monolith-conventions.md`): do not append to existing files by default; one primary responsibility per file; extract distinct clusters of state/handlers into colocated files; schemas and data-access helpers get their own files.

### 4. Adjacent data point: filesystem-derived agent layout (vercel/eve)

Source: https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md — Vercel's experimental agent framework derives identity from paths: `agent/tools/get_weather.ts` → tool `get_weather`; one connection/tool/schedule per file; `subagents/<name>/` self-contained packages. Not AI SDK core, but shows the direction Vercel is standardizing: **one artifact per file, name derived from filename**.

## Caveats / Not Found

- AI SDK docs do not mandate a directory layout; `lib/agents/` + `lib/tools/` is the only structure Vercel itself publishes (in the repo skill reference), and it aligns with community practice.
- AI SDK 6 was still evolving (some APIs marked `experimental_`); verify `ToolLoopAgent` / `InferAgentUIMessage` names against the installed version before encoding in specs.
