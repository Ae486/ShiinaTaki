# Research: Tool-reply discipline (1c — the priority)

- **Query**: Stop the ToolLoopAgent from forcing a padded generation step after a fire-and-forget avatar tool call.
- **Scope**: mixed (installed `ai@7.0.17` types + code + external agent-runtime conventions)
- **Date**: 2026-07-18

## Verified mechanism (do not re-derive)

`packages/core/src/agents/chat-agent.ts:88` sets `stopWhen: isStepCount(deps.maxSteps ?? 10)`. Per the SDK
(`ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling`): "When `stopWhen` is set and the model generates a tool call,
the AI SDK will trigger a **new generation** passing in the tool result **until there are no further tool calls or the
stopping condition is met**." So an `avatar_set_expression`/`avatar_play_motion` call ends a step with
`finishReason: "tool-calls"` (`play-motion-tool.ts:29` / `set-expression-tool.ts:26` return `{ok:true}`), which forces
another generation. With nothing substantive left, the model pads (filler "嗯。") and continues from its OWN last
utterance (self-conversation drift). Confirmed doc note: **"The `stopWhen` conditions are only evaluated when the last
step contains tool results."** — exactly the avatar case, so a custom predicate here is cheap and targeted.

## (a) Levers table — verified API surface (`node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/index.d.ts`)

| Lever | Exact signature / location | Fires when | Fit for 1c |
| --- | --- | --- | --- |
| `StopCondition<TOOLS,RC>` | `(options: { steps: Array<StepResult<TOOLS,RC>> }) => PromiseLike<boolean> \| boolean` — `d.ts:1748` | evaluated only when last step has tool results | **primary** — inspect the just-finished step and stop |
| `stopWhen` (Arrayable) | `stopWhen?: Arrayable<StopCondition<...>>` — `d.ts:5056`; doc: "When the condition is an array, **any** of the conditions can be met to stop." | construction-time | array `[isStepCount(n), custom]` = OR |
| `isStepCount(n)` | `declare function isStepCount(n): StopCondition` — `d.ts:1757`; impl `({steps})=>steps.length===n` | after N completed steps | existing cap, keep as element 0 |
| `hasToolCall(...names)` | `d.ts:1771`; impl `steps.at(-1)?.toolCalls?.some(c=>names.includes(c.toolName))` | last step called ANY named tool (`.some`) | **too aggressive** — would stop even when a real tool (screenshot) was co-called; need `.every` |
| `StepResult.text` | `readonly text: string` — `d.ts:1415` ("empty string if the model has not generated any text") | — | detect "already spoke" |
| `StepResult.toolCalls` | `readonly toolCalls: Array<TypedToolCall<TOOLS>>` (`.toolName`) — `d.ts:1438` | — | classify the tail |
| `StepResult.finishReason` | `readonly finishReason: FinishReason` — `d.ts:1462` | — | not needed (loop already gates on it) |
| `prepareStep` | `PrepareStepFunction` — `d.ts:1621`; returns `{activeTools?,toolChoice?,instructions?,messages?}` per step — `d.ts:1672` | before each step | **secondary** — per-turn avatar-call budget (drop avatar tools after use); does NOT stop the padding text, so not the 1c fix |
| `activeTools` | `activeTools?: ActiveTools<TOOLS>` — `d.ts:5071` | construction | blunt (removes tools for the whole turn) |
| `toolChoice` | `toolChoice?: ToolChoice<TOOLS>` — `d.ts:5049` | — | not applicable |

`StopCondition` cross-checked against upstream source (`github.com/vercel/ai .../stop-condition.ts`) — identical shape;
array evaluation is `isStopConditionMet` = `Promise.all(...).some(r=>r)`.

## External conventions (verified, quoted)

- **Prompt-only suppression is unreliable — you need a structural loop fix.** QwenPaw issue #4838 (agentscope):
  *"Instructions like 'only use the tool, don't write text' are consistently ignored by LLMs across providers (Qwen,
  GPT, Claude)... Prompt engineering is unreliable across models."* Their accepted fix intercepts the ReAct loop to
  **suppress the final response when tool calls were made this round** — the structural analogue of our `stopWhen`.
- **Industry taxonomy for fire-and-forget tools = a null/no-reply result.** LiveKit Agents `FunctionToolsExecutedEvent`:
  `function_call_outputs: list[FunctionCallOutput | None]` — *"A `None` output means the function call did not produce a
  value that should be sent back to the LLM"* (e.g. a tool raising `StopResponse`); plus `cancel_tool_reply()` /
  `has_tool_reply`. This is the exact "presentation (fire-and-forget) vs informational" split to sediment into spec.
- Note: AI SDK tool `execute` **must return a value** (our tools return `{ok:true}`); the SDK has no `None`/`StopResponse`
  escape, so the loop-stop must be done via `stopWhen`, not by returning "nothing". This is why 1c is a `stopWhen` fix,
  not a tool-result-shape fix.

## (b) Ranked fix options

### Option 1 — Structural `stopWhen` predicate (RECOMMENDED core of the fix)

New file `packages/core/src/avatar/presentation-stop.ts` (owns the avatar tool-name set; keeps `chat-agent` avatar-
agnostic — invariant 7). Exact code:

```ts
/**
 * INPUT:  the ToolLoopAgent step list (via a StopCondition the chat agent composes into stopWhen)
 * OUTPUT: PRESENTATION_TOOL_NAMES + presentationTailStop — stop the loop after a spoken, presentation-only step
 * POS:    core/avatar — the fire-and-forget stop lever (1c); injected into the chat agent, no coupling back to it
 */
import type { StopCondition, ToolSet } from "ai";

/** Avatar tools whose result carries nothing to read back (their execute returns {ok:true}). */
export const PRESENTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "avatar_set_expression",
  "avatar_play_motion",
]);

// Stop when the just-finished step called ONLY presentation tools AND the turn already produced text: the model has
// both spoken and emoted, so the SDK's forced next generation would only pad. The `spoke` guard preserves
// express-first-then-talk (a tool-only step with no prior text does NOT stop — the reply still comes). A step that
// also called a real tool (screenshot, memory) is NOT presentation-only, so its result is still read back.
export const presentationTailStop: StopCondition<ToolSet> = ({ steps }) => {
  const last = steps.at(-1);
  if (!last || last.toolCalls.length === 0) return false;
  const presentationOnly = last.toolCalls.every((call) => PRESENTATION_TOOL_NAMES.has(call.toolName));
  if (!presentationOnly) return false;
  return steps.some((step) => step.text.trim().length > 0);
};
```

Wiring (2 edits, both construction-level → **D1-freeze compliant**, see analysis below):

- `chat-agent.ts` — add to `ChatAgentDeps` (near line 55): `stopConditions?: StopCondition<ToolSet>[];` and import
  `type StopCondition` from `"ai"` (line 9 already imports from `"ai"`). Change line 88 to:
  `stopWhen: [isStepCount(deps.maxSteps ?? DEFAULT_MAX_STEPS), ...(deps.stopConditions ?? [])],`
- `main.ts` — in the `createChatAgent({...})` call (line 276-304) add `stopConditions: [presentationTailStop],` and
  import it from `./avatar/presentation-stop.ts`.

Why the `spoke` guard (not the brief's "stop when tool call + no text"): stopping on a *tool-only* step would truncate
the legitimate express-first-then-talk sequence (emote in step 0, reply in step 1). The bug shape is the opposite —
**text + presentation tail** then padding — so we stop once text has appeared with a presentation-only tail.

### Option 2 — Prompt rules in the avatar vocabulary section (RECOMMENDED companion)

Add the discipline to `avatar-vocabulary.ts` `render()` output (travels WITH the vocabulary; absent when no costume is
worn — no wasted tokens). Append after the name lines (exact English text):

```
How to use these avatar tools:
- Express in the SAME reply: call avatar_set_expression / avatar_play_motion together with the words you are already
  saying, not as a separate message.
- These tools are fire-and-forget — they change what is on screen and return nothing to read. After calling one, do NOT
  send another message just because the tool ran.
- Once you have both spoken and expressed, you are done: stop. Never reply to your own previous message.
- Do your real work (reading the screen, files, memory) first; express your reaction alongside your final reply.
```

### Option 3 — Tool-description tweak (RECOMMENDED, one line each)

`play-motion-tool.ts:14-18` and `set-expression-tool.ts:14-18` — append to each `description` after the existing
"Fire-and-forget" sentence: `" After calling it, add a follow-up message only if you have new substantive content to say — never filler."`

### Option 4 — Per-turn avatar-call budget via `prepareStep` (NOT recommended for 1c)

`prepareStep` can drop avatar tools from `activeTools` after they've been used N times. It caps emote-spam but does NOT
stop the padding *text*, so it does not fix 1c; note it as a possible T4 hardening, not now. Extra construction
complexity for no 1c benefit.

## (c) ONE recommended combination

**Option 1 (structural `stopWhen`) + Option 2 (vocabulary prompt rules) + Option 3 (tool-description one-liners).**
Structural is the guarantee (prompt-only is unreliable per QwenPaw); the prompt/description rules bias the model to put
text and emote in one step so the structural stop fires cleanly on step 0 and nothing leaks. Skip Option 4.

## (d) Taxonomy to sediment into `.trellis/spec/`

No tool-design guide exists yet (backend spec index lists agent-runtime / error-handling / permission-authorization /
server-push / e2e-harness / logging / database / directory / quality). **Recommendation: add a new section
`## Fire-and-forget presentation tools vs informational tools` to `.trellis/spec/backend/agent-runtime.md`** (it already
owns "the chat loop" per the index; the stop lever lives in the same runtime) and add one index row. Paragraph to write
(via the `update-spec` skill, not by the research agent):

> Classify every tool by whether its result must be read back. **Informational** tools (screenshot, files_read, memory
> recall) return data the model reasons over — the loop must continue after them. **Presentation / fire-and-forget**
> tools (`avatar_set_expression`, `avatar_play_motion`) act on the world and return only `{ok:true}`; the model must not
> be forced to generate again just because one ran. AI SDK `execute` cannot return "no reply" (unlike LiveKit's
> `None`/`StopResponse`), so a presentation tool's non-continuation is enforced by a `stopWhen` predicate
> (`presentationTailStop`): stop after a step whose tool calls are ALL presentation tools once the turn has produced
> text. Keep the `spoke` guard so express-first-then-talk is preserved. Prompt rules alone are unreliable across models
> (QwenPaw #4838) — ship the structural stop as the guarantee and the prompt rules as the bias.

## (e) Tests (defined; RED before the fix)

Harness note: `scriptedModel` (`testing/mock-language-model.ts:125`) makes text and tool calls SEPARATE steps and cannot
emit text+tool in one step. Add a `ScriptStep` variant to reproduce the bug faithfully (touched file → allowed):
`{ kind: "textTool"; deltas: string[]; toolCallId: string; toolName: string; input: unknown }` whose stream is
`stream-start, text-start, text-delta*, text-end, tool-call, finish(tool-calls)`.

1. **Unit** `packages/core/src/avatar/presentation-stop.test.ts` — feed synthetic `steps`:
   - text+presentation tail (`[{text:"hi",toolCalls:[{toolName:"avatar_set_expression"}]}]`) → **true**
   - presentation tool-only, no text (`text:""`) → **false** (spoke guard)
   - mixed tail (`toolCalls:[avatar_set_expression, screenshot]`) → **false** (`.every` fails)
   - text-only tail, no tool calls → **false**
   - empty steps → **false**
2. **Integration** `packages/core/src/agents/chat-agent-presentation.test.ts` — model script
   `[{textTool: "你好呀！" + avatar_set_expression}, {text: "嗯。"}]`; wire `characterTools: createAvatarTools(...)` +
   `stopConditions: [presentationTailStop]`. Assert `model.doStreamCalls` has length **1** and the persisted assistant
   turn contains "你好呀！" and NOT "嗯。". RED proof: drop `stopConditions` → 2 calls, "嗯。" persisted → fails.

## D1-freeze compliance analysis

The frozen regions (agent-runtime.md #17): the stream `for await` loop, `persistTurn`, abort wiring, `toolApproval` —
byte-identical. The brief confirms "agent construction ~line 84-93 ... stopWhen ... is EDITABLE." Option 1 touches only
line 88 (the `stopWhen` value in the `new ToolLoopAgent({...})` constructor) and the `ChatAgentDeps` interface — pure
construction, no frozen body edited. The stop predicate changes WHEN the loop ends, not HOW the loop/persist/abort code
runs, so persistTurn and the cancel matrix are unaffected. No test in the 2×2 cancel matrix is touched.

## Files (for the impl agent)

| File | Action |
| --- | --- |
| `packages/core/src/avatar/presentation-stop.ts` | NEW — the set + predicate (code above) |
| `packages/core/src/agents/chat-agent.ts` | add `stopConditions?` dep (~L55) + import; edit L88 stopWhen to array |
| `packages/core/src/main.ts` | pass `stopConditions: [presentationTailStop]` (L276-304) + import |
| `packages/core/src/avatar/avatar-vocabulary.ts` | append the discipline prose to `render()` |
| `packages/core/src/avatar/play-motion-tool.ts` + `set-expression-tool.ts` | one-line description append |
| `packages/core/src/testing/mock-language-model.ts` | add `textTool` ScriptStep variant |
| `packages/core/src/avatar/index.md` | add `presentation-stop.ts` row |
| tests | `presentation-stop.test.ts` + `chat-agent-presentation.test.ts` |

## Caveats

- `steps.at(-1)` needs Node 24 (project baseline) — fine.
- Residual leak: if the model emits a *leading* tool-only step then filler, one filler segment can slip before the
  spoke guard flips; `isStepCount` still caps it and the prompt rules discourage leading tool-only steps. Acceptable.
</content>
</invoke>
