# Research: AI SDK v7 tools + ToolLoopAgent loop mechanics (ai@7.0.17)

- **Query**: Tool definition API, loop/stream behavior with tools, per-turn instructions, mock recipe — for the first tools integration (memory tools) into our chat loop
- **Scope**: installed .d.ts (primary) + empirical probes (mock model, output pasted trimmed; scripts under `research/tmp/`, deleted)
- **Date**: 2026-07-10
- **Prior verified base**: `.trellis/tasks/archive/2026-07/07-08-walking-skeleton/research/ai-sdk-v7-api.md` (incl. the CORRECTION addendum: iterate `result.stream`, never `textStream`) — still accurate, not repeated here.

Evidence roots (installed):

- `AI_DTS` = `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/index.d.ts`
- `PU_DTS` = `node_modules/.pnpm/@ai-sdk+provider-utils@5.0.5_zod@4.4.3/node_modules/@ai-sdk/provider-utils/dist/index.d.ts`
- `PROV_DTS` = `node_modules/.pnpm/@ai-sdk+provider@4.0.2/node_modules/@ai-sdk/provider/dist/index.d.ts`
- `AI_TEST_DTS` = `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/test/index.d.ts`

## Verdicts (short)

1. `tool()` from `'ai'` (re-export of provider-utils, `AI_DTS:8`); **zod 4.4 accepted natively** (`ZodSchema = z3.Schema | z4.core.$ZodType`, `PU_DTS:875-877`, imports `zod/v4` at `PU_DTS:6`).
2. Per-turn instructions: **NOT a per-call param** — solve via `prepareCall` + `callOptionsSchema` (verified) or construct the agent per turn (verified: 10k constructions = 3.9 ms).
3. Our chat-send pump (handles only `text-delta` + `error`) is **safe with tools**: post-tool continuation text arrives as ordinary `text-delta`; every tool failure mode self-heals inside the loop without emitting an `error` part.
4. Loop auto-continues after `execute` returns; final-turn persistence via accumulated text-deltas is correct (nuance in §4).
5. Mock recipe: `doStream: [step1, step2]` array — one `LanguageModelV4StreamResult` per LLM call (`AI_TEST_DTS:113-119`).

## 1. Tool definition API

```ts
import { tool } from "ai";
import { z } from "zod";

const memorySearch = tool({
  description: "search long-term memory",
  inputSchema: z.object({ query: z.string() }),           // zod 4 object, natively accepted
  execute: (input, options) => {                          // may return value, Promise, or AsyncIterable
    // options: { toolCallId: string; messages: ModelMessage[]; abortSignal?: AbortSignal; context; ... }
    return { ok: true, hits: [...] };                     // any JSON-serializable value
  },
});
```

- `inputSchema: FlexibleSchema<INPUT>` (`PU_DTS:1678`); `execute: (input, options) => AsyncIterable<OUTPUT> | PromiseLike<OUTPUT> | OUTPUT` (`PU_DTS:1587`); `ToolExecutionOptions` fields at `PU_DTS:1553-1583`. `tool()` overloads at `PU_DTS:1860-1866` (with `execute` narrows to `ExecutableTool`).
- **Error convention** (matches `.trellis/spec/backend/error-handling.md`): `execute` should catch everything and RETURN `{ ok: false, code, message }`. Verified (probe B2): the structured object reaches the model verbatim as `output: { type: "json", value: { ok: false, code: "IO_ERROR", message: "..." } }` and the loop proceeds normally (`tool-result` part, next step, finishReason `stop`).
- **If `execute` throws anyway** (probe B1): the loop does **NOT crash**. Sequence `... tool-call, tool-error, finish-step, start-step, text-delta..., finish`; the model receives `output: { type: "error-text", value: "Error: disk on fire" }` (String(error) — message only, no stack) and the loop **auto-continues** (2nd model call happened, finishReason `stop`). So a stray throw degrades acceptably — but `error-text` loses the machine-readable code, so the spec's return-shape rule stands.
- Two more self-healing defenses (verified): model calls an **undeclared tool** (probe B3) -> invalid dynamic `tool-call` part + `tool-error`, model told `AI_NoSuchToolError ... Available tools: ...`, loop continues; model sends **malformed JSON input** (probe B4) -> `AI_InvalidToolInputError` as error-text, loop continues. Nothing in the tool path kills the turn.

## 2. ToolLoopAgent wiring + loop termination + per-turn instructions

```ts
const agent = new ToolLoopAgent({ model, instructions, tools: { memory_search: memorySearch } });
```

- `tools` is a name->tool record on `ToolLoopAgentSettings` (via `RequestOptions`, `AI_DTS:5022`); `toolChoice` default `'auto'` (`AI_DTS:5049`).
- **Loop ends when** (class doc `AI_DTS:5212-5221`): finish reason != `tool-calls`, OR a called tool has no `execute`, OR approval is required, OR `stopWhen` met — **default `isStepCount(20)`** (`AI_DTS:5054-5056`). For memory tools a lower bound is sane (e.g. `stopWhen: isStepCount(5)`); on limit-stop the turn simply ends after that step (no error part).
- **`instructions` is constructor-only**: `ToolLoopAgentSettings.instructions` (`AI_DTS:5032`); `AgentCallParameters` (`AI_DTS:4582-4685`) has ONLY `prompt|messages`, `abortSignal`, `timeout`, lifecycle callbacks, `options: CALL_OPTIONS`. System messages inside `messages` stay rejected by default (`allowSystemInMessages`, `AI_DTS:5041`). Two sanctioned per-turn paths, both verified:
  1. **`prepareCall` + call options** (the SDK's intended "templates based on call options" mechanism, `AI_DTS:5189,5205`):
     ```ts
     const agent = new ToolLoopAgent({
       model, tools,
       callOptionsSchema: z.object({ system: z.string() }),
       prepareCall: ({ options, ...rest }) => ({ ...rest, instructions: options.system }),
     });
     await agent.stream({ options: { system: assembledContext }, messages });
     ```
     Probe C: two `stream()` calls on ONE agent produced `system: "TURN ONE persona"` then `system: "TURN TWO persona+memory"` in the respective provider calls.
  2. **Construct per turn**: `new ToolLoopAgent({ model, instructions: assembled, tools })` inside `stream()`. Probe D: constructor just stores settings — 10,000 constructions in 3.9 ms. Zero meaningful cost.
  Either is fine; (2) is less API surface, (1) keeps a single long-lived agent object. Implementer's choice.

## 3. Stream parts with tools (pump safety — load-bearing)

Full `TextStreamPart` union (`AI_DTS:2944-3064`): `text-start | text-delta | text-end | reasoning-start | reasoning-delta | reasoning-end | custom | tool-input-start | tool-input-delta | tool-input-end | source | file | reasoning-file | tool-call | tool-result | tool-error | tool-output-denied | tool-approval-request | tool-approval-response | start-step | finish-step | start | finish | abort | error | raw`.

Empirical part sequence for a tool turn (probe A, mock: step1 = tool-call, step2 = text):

```
start, start-step, tool-call, tool-result, finish-step,
start-step, text-start, text-delta, text-delta, text-end, finish-step, finish
```

- ai-level `tool-call` part carries **parsed** `input` (object — `{"query":"拉面"}`), unlike the provider chunk (JSON string). `tool-result` carries `output` (the raw execute return). Shapes: `TypedToolCall`/`StaticToolCall` (`AI_DTS:1108-1153`), `TypedToolError` (`AI_DTS:1210-1233`).
- **Ignoring everything except `text-delta`/`error` is safe**: continuation text after tools arrives as plain `text-delta` (verified); no tool failure mode produced an `error` part (B1-B4). The `error` part still appears for provider-level failures and for a model stream that ends without a `finish` chunk (`AI_NoOutputGeneratedError` — observed; also rejects `result.finishReason` etc., which our pump never awaits). Current `chat-agent.ts` loop needs **no change to stay correct**.
- Parts worth surfacing later (M3 approval/UI): `tool-call`, `tool-result`, `tool-error`, and the approval pair (`tool-approval-request`/`-response`, shapes at `AI_DTS:1156-1207`) — additive `else if` branches in the same pump.

## 4. Multi-step mechanics + what to persist

- **Auto-continue confirmed**: after `execute` resolves, the SDK issues the next model call itself (probe A: `doStreamCalls.length = 2`). Second call's prompt = `[system, user, assistant(tool-call), tool(tool-result{type:'json',value})]` — history assembly is internal per turn; we do NOT feed tool messages back ourselves.
- `responseMessages` for the turn = `[assistant(tool-call), tool(tool-result), assistant(text)]` (3 messages, probe A). We do **not** persist these; our conversation-store keeps user/assistant **text** rows only.
- **Text accumulation nuance** (probe 2c): if the model emits text BEFORE calling the tool ("让我查一下…"), those deltas also stream through the pump; accumulated text = **concatenation of all steps' text** ("让我查一下记忆…你吃过豚骨拉面。"), while `result.text` = **final step only** ("你吃过豚骨拉面。"). For v1 the accumulated concatenation is the right thing to persist — it equals exactly what the user saw streamed. Tool internals need no timeline rows in this slice; next-turn replay (text-only history) is unaffected because tool messages were never part of our store.

## 5. Mock recipe for a tool-loop test (two-step)

`MockLanguageModelV4.doStream` accepts an **array of `LanguageModelV4StreamResult`** — element N answers the Nth LLM call (`AI_TEST_DTS:113-119`); assert call count/prompts via `doStreamCalls`. Provider-level chunk shapes (`PROV_DTS:2576-2635`; tool-call content at `PROV_DTS:2358-2387` — note `input` is a **stringified-JSON string** here):

```ts
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 10, text: 10, reasoning: undefined } };
const model = new MockLanguageModelV4({
  doStream: [
    { stream: simulateReadableStream({ chunks: [
        { type: "stream-start", warnings: [] },
        { type: "tool-call", toolCallId: "call-1", toolName: "memory_search",
          input: JSON.stringify({ query: "拉面" }) },
        { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
    ]}) },
    { stream: simulateReadableStream({ chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "想起来了，你吃过豚骨拉面。" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
    ]}) },
  ],
});
```

Ran verbatim in probe A (step-1 `finishReason.unified: "tool-calls"` is what makes the loop continue). Optional streamed-input realism (`tool-input-start/-delta/-end` chunks before `tool-call`) is not required — the bare `tool-call` chunk works. **Gotcha from probe: a consumed `simulateReadableStream` cannot be reused** — build fresh stream objects per test (a shared `const step = {...}` across two agent runs yields "stream ended without finish chunk" -> `AI_NoOutputGeneratedError` as an ai-level `error` part).

Assertions that proved most useful: part-type sequence from `result.stream`; `model.doStreamCalls.length` (loop count); `doStreamCalls[1].prompt` last message = tool result the model saw (`output.type: 'json' | 'error-text'`); accumulated text.

## Caveats / Not Found

- `ToolExecutionOptions.abortSignal` is present in types but was `undefined` in probes when no signal was passed to `stream()` — pass ours through when we wire cancellation.
- Did not probe `toolChoice`, parallel tool calls in one step, `AsyncIterable` (streaming) tool outputs, or tool approval flow (M3) — out of scope for this slice.
- `dynamicTool` / MCP tools not touched here (ADR 0006 later).
