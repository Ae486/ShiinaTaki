# Research: AI SDK 7.0.17 handling of invalid tool calls (D69)

- **Query**: How does the installed `ai@7.0.17` `ToolLoopAgent` / `streamText` / `generateText` loop treat a tool call whose input fails schema validation (out-of-enum or missing `name`) and a call to a non-existent tool; how does that interact with `presentationTailStop` (D69 hypothesis).
- **Scope**: internal (installed SDK source + project code) + one executable probe
- **Date**: 2026-09-19

## Evidence basis

| Item | Location |
|---|---|
| Installed SDK (what Core runs) | `packages/core/node_modules/ai` -> `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai` (`package.json` version `7.0.17`). Ships `src/` (TypeScript), `dist/index.js`, `dist/index.d.ts`, `docs/`. There is no `dist/index.mjs`; the ESM build is `dist/index.js`. |
| Companion packages resolved by that install | `@ai-sdk/provider-utils@5.0.5`, `@ai-sdk/provider@4.0.2` (via `ai/node_modules/@ai-sdk/*` symlinks); Core's provider is `@ai-sdk/openai-compatible@3.0.5` |
| Production loop | `packages/core/src/agents/chat-agent.ts:270-287` builds `new ToolLoopAgent({... stopWhen: [isStepCount(maxSteps ?? 10), ...stopConditions], onStepEnd ...})`; `:306` calls `agent.stream(...)` -> `streamText` (`ai/src/agent/tool-loop-agent.ts:261-322`). `main.ts:367` injects `stopConditions: [presentationTailStop]`. So the streaming loop is the production path; `generateText` is cross-checked below. |
| Probe | `.trellis/tasks/09-19-avatar-command-outcome/research/ai-sdk-invalid-tool-calls-probe.mjs` — runs against `packages/core/node_modules/ai` with `MockLanguageModelV4` (`ai/test`), a `z.enum(["default","smile"])` tool, and a verbatim copy of `presentationTailStop`. Run: `node .trellis/tasks/09-19-avatar-command-outcome/research/ai-sdk-invalid-tool-calls-probe.mjs` (Node 24.18.0 here). Imports no project code. |

Probe results (streaming path, `stopWhen: [isStepCount(3), recorder, ...]`):

| Case | Model step 0 | Extra stop | `doStream` calls | Key observation |
|---|---|---|---|---|
| A | text "你好呀！" + `avatar_set_expression{name:"not_in_vocab"}` | `presentationTailStop` | **1** | Loop ended on a step whose only tool call is `invalid: true`. No re-generation. |
| B | same as A | none | 2 | 2nd prompt contains the assistant `tool-call` + a `tool` message with `error-text` (full text below). |
| C | tool-only `avatar_set_expression{}` (no text yet) | `presentationTailStop` | 2 | Missing `name`; stop did not fire (spoke guard); model re-generated after reading the error. |
| D | text "你好" + `avatar_set_expresion{name:"smile"}` (typo) | `presentationTailStop` | 2 | `NoSuchToolError`; `toolName` keeps the typo, so it is not in `PRESENTATION_TOOL_NAMES`; stop did not fire. |
| E | valid call, `execute` returns `{ok:false,code,message}` | none | 2 | `tool-result` part; model sees `{"type":"json","value":{"ok":false,...}}` -> JSON verbatim. |
| F | valid call, `execute` throws `Error("renderer boom")` | none | 2 | `tool-error` part; model sees `error-text` `"Error: renderer boom"`. |
| G | as A + `experimental_repairToolCall` returning a fixed call | `presentationTailStop` | 1 | Repair invoked once with `error.name === "AI_InvalidToolInputError"`; call became valid, `execute` ran, `{ok:true}`. |
| H | as A + repair returning `null` | none | 2 | Falls back to the invalid path (identical to B). |
| I | valid call; capture `execute` options | none | 2 | Options keys: `toolCallId, messages, abortSignal, context, experimental_sandbox`. |

Stop-condition invocation count was exactly 1 in every case: it is only evaluated after a step that has client tool calls with all outputs present (never after a text-only step).

## Findings

### 1. An invalid call appears in `steps[i].toolCalls`, and a `tool-error` is fed back

Parse layer (shared by both loops), `ai/src/generate-text/parse-tool-call.ts`:
- `:163-201` `doParseToolCall`: unknown name -> `NoSuchToolError({ toolName, availableTools })` (`:180-183`); JSON parse/schema failure -> `InvalidToolInputError({ toolName, toolInput, cause })` (`:195-200`). Empty-string input is validated as `{}` (`:190-193`).
- `:94-114`: **every** failure is caught and returned as a tool-call part `{ type:'tool-call', toolCallId, toolName, input, dynamic: true, invalid: true, error }` where `input` is the parsed JSON if parsable, else the raw string. Nothing throws out of the loop (the `// TODO AI SDK 6: special invalid tool call parts` comment confirms this is the intended shape). Type: `DynamicToolCall` in `ai/src/generate-text/tool-call.ts:33-52` (`invalid?: boolean`, `error?: unknown`).

Streaming loop:
- `ai/src/generate-text/stream-language-model-call.ts:613-648`: the parsed tool-call is enqueued and pushed to `modelCallContent`; if `toolCall.invalid`, a second part `{ type:'tool-error', toolCallId, toolName, input, error: getErrorMessage(toolCall.error), dynamic: true }` is enqueued immediately (`error` is already a string here).
- `ai/src/generate-text/execute-tools-from-stream.ts:93-96`: `if (chunk.invalid) return;` — `execute` is never called for an invalid call.
- `ai/src/generate-text/stream-text.ts:1139-1148` records `tool-call` and `tool-error` parts into the step content; `:1273-1276` builds `response.messages` via `toResponseMessages`; `:1317-1325` pushes the step and resolves `stepFinish`.
- `ai/src/generate-text/step-result.ts:383-385`: `toolCalls = content.filter(part => part.type === 'tool-call')` — so **invalid calls are included** in `steps[i].toolCalls` with their original `toolName`; `staticToolCalls` excludes them (`dynamic === true`), `dynamicToolCalls` includes them (`:387-398`). `toolResults` (`:400-402`) contains only `tool-result` parts, so an invalid call has no entry there.

Non-streaming loop (`generateText`), same outcome: `ai/src/generate-text/generate-text.ts:1038-1041` skips invalid calls for `onInputAvailable`/approval; `:1139-1156` inserts a `tool-error` output with `error: getErrorMessage(toolCall.error!)`; `:1168-1174` executes only `!toolCall.invalid` calls.

What is sent to the model on the next step (`ai/src/generate-text/to-response-messages.ts`):
- Assistant message keeps the `tool-call` part; `:90-91` substitutes `{}` for the input only when it is not an object (i.e. unparsable JSON). An out-of-enum object such as `{name:"not_in_vocab"}` is sent back as-is (probe A/B).
- Tool message: `:185-206` maps a `tool-error` part with `errorMode: 'text'` -> `createToolModelOutput` (`ai/src/prompt/create-tool-model-output.ts:17-18`) -> `{ type:'error-text', value: getErrorMessage(error) }`.
- `getErrorMessage` (`@ai-sdk/provider/src/errors/get-error-message.ts:6-12`): strings pass through; `Error` instances become `error.toString()` = `"<name>: <message>"` (`AISDKError` sets `this.name`, `ai-sdk-error.ts:39`).
- Provider rendering for Core's provider: `@ai-sdk/openai-compatible/src/chat/convert-to-openai-compatible-chat-messages.ts:235-266` — `text`/`error-text` -> the string verbatim as `{ role:'tool', tool_call_id, content }`; `json`/`error-json`/`content` -> `JSON.stringify(value)`.

Exact model-visible text (probe A/B, out-of-enum; message from `invalid-tool-input-error.ts:17` wrapping `type-validation-error.ts:59-66` wrapping zod v4):

```
AI_InvalidToolInputError: Invalid input for tool avatar_set_expression: AI_TypeValidationError: Type validation failed: Value: {"name":"not_in_vocab"}.
Error message: [
  {
    "code": "invalid_value",
    "values": [
      "default",
      "smile"
    ],
    "path": [
      "name"
    ],
    "message": "Invalid option: expected one of \"default\"|\"smile\""
  }
]
```

Missing `name` (`{}`) produces the same shape with `Value: {}` (zod v4 reports the enum as `invalid_value` at path `name`, not a separate "required" code). Non-existent tool (probe D, `no-such-tool-error.ts:16-20`):

```
AI_NoSuchToolError: Model tried to call unavailable tool 'avatar_set_expresion'. Available tools: avatar_set_expression.
```

Docs confirm the intent: `ai/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx:1217-1218` "If you use multiple steps, those failed tool calls will be sent back to the LLM in the next step to give it an opportunity to fix it."

### 2. `experimental_repairToolCall` is still the hook; default path marks the call invalid

- Option name unchanged: `experimental_repairToolCall` on `generateText` (`generate-text.ts:250, 377-380`), `streamText` (`stream-text.ts:358, 496`), `ToolLoopAgentSettings` (docs `07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx:136`). Type `ToolCallRepairFunction` in `ai/src/generate-text/tool-call-repair-function.ts:21-32`: receives `{ instructions, system (deprecated), messages, toolCall (raw LanguageModelV4ToolCall, input is a JSON string), tools, inputSchema(), error: NoSuchToolError | InvalidToolInputError }`, returns a repaired raw call or `null`.
- Flow `parse-tool-call.ts:46-93`: called once per failing call, only for `NoSuchToolError`/`InvalidToolInputError`; a returned call is re-parsed once (`:89-92`), failure of that re-parse or a thrown repair (`ToolCallRepairError`, `:77-82`) falls into the invalid path; `null` re-throws the original error -> invalid path.
- Default (no hook): straight to `:94-114` -> invalid tool-call + tool-error, no `execute`, no throw, loop continues if nothing stops it.
- Core does not configure a repair hook anywhere (`packages/core/src` grep for `repairToolCall`: no hits). `experimental_refineToolInput` (`parse-tool-call.ts:117-134`) only runs on already-valid calls.

### 3. `stopWhen` interaction and the D69 hypothesis (confirmed)

Loop continuation, streaming (`stream-text.ts:2225-2235, 2277-2291`):
```ts
const clientToolCalls = stepToolCalls.filter(toolCall => toolCall.providerExecuted !== true);   // includes invalid calls
const clientToolOutputs = stepToolOutputs.filter(toolOutput => toolOutput.providerExecuted !== true); // includes the tool-error for them
...
if (((clientToolCalls.length > 0 && clientToolCalls.length === clientToolOutputs.length + deniedToolApprovalResponses.length)
     || pendingDeferredToolCalls.size > 0)
    && !(await isStopConditionMet({ stopConditions, steps: recordedSteps }))) { streamStep(next) } else { finish }
```
`generateText` mirrors this at `generate-text.ts:1340-1350`. `isStopConditionMet` (`ai/src/generate-text/stop-condition.ts:64-77`) ORs all conditions. Consequences:
- An invalid call counts as a client tool call **with** an output (its `tool-error`), so a step containing only invalid calls satisfies the "continue" precondition and the stop conditions **are** evaluated on it (probe: 1 invocation in A-D).
- The stop condition receives `recordedSteps` after the step has been pushed with `response.messages` already containing the tool-error (`stream-text.ts:1317-1325`, awaited at `:2223`), but the SDK passes only `steps`; whether an error occurred is visible to a condition only through `steps[i].toolCalls[j].invalid` / `steps[i].content` `tool-error` parts.

`packages/core/src/avatar/presentation-stop.ts:18-24`:
```ts
const presentationOnly = last.toolCalls.every((call) => PRESENTATION_TOOL_NAMES.has(call.toolName));
if (!presentationOnly) return false;
return steps.some((step) => step.text.trim().length > 0);
```
- For an out-of-enum or missing-`name` `avatar_set_expression` call, `toolName` is still `"avatar_set_expression"` (parse-tool-call.ts:104), `invalid` is not inspected, so `presentationOnly === true`. If any step of the turn already has text, the condition returns `true`, the loop finishes, and **no further model call happens in this turn** — the validation error is built and persisted but never read by the model in that turn. Probe A: 1 `doStream` call, `steps[0].toolCalls[0] = { toolName:"avatar_set_expression", dynamic:true, invalid:true, error: AI_InvalidToolInputError }`, `steps[0].toolResults = []`, and `steps[0].response.messages[1]` is the tool message carrying the `error-text` above.
- Boundaries of the effect: no text yet in the turn (express-first, probe C) -> stop does not fire -> the model reads the error on the next step; wrong tool **name** (probe D) -> `toolName` is not in the set -> stop does not fire; a step mixing an invalid avatar call with a non-presentation tool -> not presentation-only -> no stop.
- `isStepCount(maxSteps ?? 10)` (`chat-agent.ts:142, 277`; SDK default `isStepCount(20)` at `tool-loop-agent.ts:132`) is the only other bound; it does not distinguish invalid steps.

What Core does with the unread error: `chat-agent.ts:283-286` `onStepEnd` captures `event.response.messages` for every step (including the tool-error message) and `:244-245` commits them to the conversation store, so the error text lands in the persisted turn. How the Replay projection presents it to the next turn's model was not traced here.

### 4. `execute` returning a value vs throwing

`ai/src/generate-text/execute-tool-call.ts` (used by both loops via `executeToolsFromStream`/`executeTools`):
- `:88-90`: a tool without `execute` returns `undefined` (no output part -> loop halts on that step by the continue precondition).
- `:123-190`: a thrown error (or rejected promise, or a throwing async iterator) becomes `{ type:'tool-error', toolCallId, toolName, input, error, dynamic }` (`error` is the raw thrown value). Model sees `error-text` = `getErrorMessage(error)`, e.g. `"Error: renderer boom"` (probe F).
- `:192-219`: any returned value becomes `{ type:'tool-result', ..., output }`. `to-response-messages.ts:189-195` with `errorMode:'none'` -> `create-tool-model-output.ts:23-29`: `tool.toModelOutput` if defined, else `{ type:'text', value }` for strings, else `{ type:'json', value }`. So `{ ok:false, code:"INTERNAL_ERROR", message }` from `set-expression-tool.ts:36` reaches the model as `{"ok":false,"code":"INTERNAL_ERROR","message":"publish failed"}` verbatim (probe E) — a success-shaped `tool-result` from the SDK's point of view (`steps[i].toolResults` contains it; `onToolExecutionEnd` reports `tool-result`).
- `@ai-sdk/provider-utils/src/types/execute-tool.ts:35-46`: `execute` may also return an `AsyncIterable`; intermediate values are `preliminary` results, the last one is final.
- Core's governance wrapper `packages/core/src/governance/governed-tool.ts:90-97` replaces only `execute`; `:200-206` awaits the inner result, rethrows on rejection (after settling the Effect as `failed`), and returns values unchanged (unless a dispatch lease supplies `acceptResult`). It runs after SDK validation, so it never observes invalid calls.

### 5. `execute` options (`ToolExecutionOptions`)

`@ai-sdk/provider-utils/src/types/tool-execute-function.ts:8-44`: `{ toolCallId: string; messages: ModelMessage[]; abortSignal?: AbortSignal; context: CONTEXT; experimental_sandbox?: SandboxSession }`. `messages` are the messages sent to the model for that step (no system prompt, no assistant response containing the call; probe I: length 1). Populated at `execute-tool-call.ts:132-142`; `abortSignal` is `mergeAbortSignals(abortSignal, toolTimeoutMs)` (`:119-120`, `ai/src/util/merge-abort-signals.ts:13-25`) — `undefined` when neither a caller signal nor a tool timeout exists (probe I), an `AbortSignal` in production where `chat-agent.ts:306` passes `turn?.signal`. `toolCallId` is the provider's call id (`c1` in the probe) and is the same id carried by the `tool-call`, `tool-result`/`tool-error` parts and `onToolExecutionStart/End` events (`execute-tool-call.ts:103-106, 162-175, 192-205`). Core already reads it: `governed-tool.ts:282-286` `toolCallIdOf(options)`; `tool.onInputAvailable` receives the same shape plus `input` (`@ai-sdk/provider-utils/src/types/tool.ts:136-140`).

### 6. Built-in retry / repair budget for invalid calls

- None specific to invalid calls. `maxRetries` (default 2, `ai/src/util/prepare-retries.ts:35-43`) wraps only the provider call (`stream-text.ts:1867-1875`, `generate-text.ts:932-959`) and retries thrown retryable API errors (`@ai-sdk/provider-utils/src/retry-with-exponential-backoff.ts:89-138`); an invalid call never throws, so it is never retried at that level.
- `experimental_repairToolCall`: exactly one attempt per failing call (`parse-tool-call.ts:65-92`); no counter across steps.
- The only loop-level bound is `stopWhen` (`isStepCount`), which counts every step equally.
- Tool timeouts (`timeout` option, `execute-tool-call.ts:119-120`) apply to `execute` only.

### Project layers already touching invalid calls

- `packages/core/src/agents/tool-observability.ts:140-146`: an observed `tool-call` part whose invocation `validationState === "failed"` is recorded immediately as `classifyToolOutcome({ type:"tool-error", invalid:true })`; `packages/core/src/agents/tool-outcome.ts:22` maps it to `{ outcome:"failed", errorClass:"validation", errorCode:"tool_validation_failed" }`. `packages/core/src/agents/tool-invocation.ts:129` derives `validationState` from `tool.invalid === true`.
- `packages/core/src/avatar/vocab-name-schema.ts:12-14`: `z.enum(names)` when the vocabulary is non-empty, else `z.string().min(1)` — with an empty vocabulary an arbitrary name is **valid** and reaches `execute` (`{ok:true}`), so the SDK-validation layer only exists when a vocabulary was reported.
- `packages/core/src/avatar/set-expression-tool.ts:25-38`: schema `z.object({ name: vocabNameSchema(...) })`; `execute` never throws, returns `{ok:true}` or `{ok:false, code:"INTERNAL_ERROR", message}`.

### Existing tests (file:line)

- `packages/core/src/avatar/presentation-stop.test.ts:11-28` — five unit cases of `presentationTailStop` (spoken presentation-only stop, express-first guard, mixed real tool, text-only, empty); none includes an `invalid: true` call.
- `packages/core/src/agents/chat-agent-presentation.test.ts:34-61` — end-to-end: text + **valid** `avatar_set_expression` in one step with `stopConditions: [presentationTailStop]` -> exactly 1 `doStream` call; filler never persisted.
- `packages/core/src/avatar/vocab-name-schema.test.ts:6-19` — enum accepts/rejects, JSON-Schema `enum` emission, empty-vocab fallback.
- `packages/core/src/avatar/avatar-tools.test.ts:32-52` — `execute` happy path (`{ok:true}`, characterId binding); no `{ok:false}` or throw case.
- `packages/core/src/agents/tool-outcome.test.ts:25-27` — `{type:"tool-error", invalid:true}` -> validation class; plain `tool-error` -> execution class.
- `packages/core/src/agents/tool-observability.test.ts:37-38` — observes an `invalid: true` `tool-call` followed by its `tool-error` part.
- `packages/core/src/agents/chat-agent-overflow.test.ts:199-212` — the provider-level tool-call stream shape (`input` as JSON string, `finishReason.unified: "tool-calls"`); exercises overflow retry, not tool errors.
- `packages/core/src/testing/mock-language-model.ts:172-230` — `scriptedModel` `textTool` step (text + tool call in one step) used to script such turns.
- No existing test feeds an out-of-enum / missing-`name` / unknown-tool call through `createChatAgent` with `presentationTailStop`.

### Docs vs installed code

- `ai/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx:1144` states "`generateText` throws errors for tool schema validation issues". The installed source does not: `parse-tool-call.ts:94-114` converts every validation failure into an invalid tool-call part and `generate-text.ts:1139-1156` adds a `tool-error`; the probe never threw. Treat that doc line as stale.
- `ai/docs/03-agents/04-loop-control.mdx:19` ("`stopWhen` controls when to stop execution when there are tool results in the last step") matches the code, with "tool results" including the synthetic `tool-error` for invalid calls.

## Implications for D69

Layers of the D69 row and what the installed code establishes without a provider trace:

| D69 layer | Status from installed code | Evidence |
|---|---|---|
| Provider-generated argument shape | **Unverified** — needs a live trace of the raw `tool-call.input` string (out-of-enum value vs `{}` vs empty string vs malformed JSON) and whether the provider honours the JSON-Schema `enum` | only the SDK-side handling of each shape is known (`parse-tool-call.ts:190-201`) |
| AI SDK schema validation | **Deterministic and verified**: out-of-enum / missing `name` / unknown tool -> `invalid: true` call, `execute` skipped, `tool-error` part, no throw; identical in `stream` and `generate` | §1, probe A-D, H |
| `execute` return / throw | **Not reached** for invalid calls. For valid calls, `{ok:false}` is a success-shaped `tool-result` (JSON verbatim), a throw is a `tool-error` (`error-text`) | §4, probe E/F; governance wrapper transparent (`governed-tool.ts:200-206`) |
| Tool result fed back to the model | **Always built** into `steps[i].response.messages` as an `error-text` tool message with the full enum list; **persisted** by `chat-agent.ts:283-286`. Whether the model receives it *in the same turn* depends on the next row | §1, §3 |
| Model re-generation after the error | **Blocked in the same turn** whenever `presentationTailStop` fires (see next row); otherwise the SDK does re-call the model with the error in context (probe B/C/D) | §3 |
| `presentationTailStop` hypothesis | **Confirmed**: with text already produced in the turn, an invalid `avatar_set_expression`/`avatar_play_motion` call (correct tool name) ends the loop before any re-generation (probe A: 1 model call). Not triggered for a wrong tool name (probe D) or before any text (probe C). The condition has the data to tell (`call.invalid`, `content` `tool-error` parts) but does not read it | `presentation-stop.ts:21`, `step-result.ts:383-385`, `stream-text.ts:2277-2291` |
| Avatar description / vocabulary inertia across turns | **Unverified** — requires observing the model's next call after it has read the `error-text` (or after the persisted error surfaces in the next turn) | — |
| Built-in retry / repair | **None** for invalid calls beyond one optional repair attempt per call and the step cap; Core configures no repair hook | §2, §6 |

Comparison point requested by D69 (Tavily/MCP vs avatar): the SDK path is tool-agnostic — any tool with a zod schema gets the same invalid/tool-error treatment; the observed "Tavily self-corrects" behaviour is consistent with the loop continuing to a next step (no presentation stop applies to non-avatar tools), not with different validation handling.

## Caveats / Not found

- The probe uses the SDK's mock model and `simulateReadableStream`; it proves the SDK loop, `presentationTailStop` interaction, and the exact model-facing message. It does not show what a real provider emits for `avatar_set_expression` arguments, nor whether the model corrects itself after reading the error; those require a trace from the owner's incident (D80 notes it is not yet matched to a trace).
- How the persisted tool-error message is projected into the next turn's request (Replay/context-window folding of tool rows) was not traced.
- With an empty reported vocabulary the schema is `z.string().min(1)`; an unknown name is then valid and silently published (`{ok:true}`) — a different failure mode from the enum case.
- `dist/index.js` was not diffed line-by-line against `src/`; the probe executed `dist/index.js` and matched the `src/` reading at every point cited above.
