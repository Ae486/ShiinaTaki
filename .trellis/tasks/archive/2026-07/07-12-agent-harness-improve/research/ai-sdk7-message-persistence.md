# Research: AI SDK v7 — full-turn (tool-call + tool-result) message persistence & cancellation

- **Query**: How to persist the COMPLETE turn (assistant tool-call parts + tool-result messages) from `ToolLoopAgent.stream()`, and how to support abort/interrupt with partial-text persistence.
- **Scope**: internal (installed `.d.ts`) — authoritative
- **Date**: 2026-07-12

## Installed versions (verified, not from memory)

| Package | Version | Path |
|---|---|---|
| `ai` | **7.0.17** | `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/index.d.ts` |
| `@ai-sdk/provider-utils` | **5.0.5** | `.../ai/node_modules/@ai-sdk/provider-utils/dist/index.d.ts` (ModelMessage types live here, re-exported by `ai`) |

`ModelMessage`, `AssistantModelMessage`, `ToolModelMessage`, `ToolCallPart`, `ToolResultPart` are all defined in `@ai-sdk/provider-utils` and re-exported from `"ai"` (index.d.ts line 7). Importing them from `"ai"` (as chat-agent.ts already does for `ModelMessage`) is correct.

---

## Q1 — `ToolLoopAgent.stream()` return type & how to get the full turn's messages

`stream(...)` returns **`Promise<StreamTextResult<TOOLS, RUNTIME_CONTEXT, OUTPUT>>`** (index.d.ts:5249). The code already `await`s it, so `result` is a `StreamTextResult`.

**The exact accessor to persist a full turn:**

```ts
readonly responseMessages: PromiseLike<Array<ResponseMessage>>;   // index.d.ts:2832
// where  type ResponseMessage = AssistantModelMessage | ToolModelMessage;   // index.d.ts:177
```

- `await result.responseMessages` returns **`Array<ResponseMessage>`** = every assistant message (incl. tool-call parts) AND every tool message (tool-results) produced across ALL steps of the loop, oldest-first. This is exactly the `ModelMessage[]` tail to write back (they are `ModelMessage`s — `ResponseMessage` is a subset union of `ModelMessage`).
- Runtime confirms the shape (index.js:5860): `responseMessages = [...initialResponseMessages, ...steps.flatMap(s => s.response.messages)]`.
- **It does NOT include the user message** — you already appended that yourself (`store.appendUser`). So the write-back sequence is: `[...existing user turn you saved] + [...await result.responseMessages]`.
- **Doc note**: `result.responseMessages` is the JSDoc-blessed "accumulated response messages of all steps" — prefer it over hand-reconstructing from `result.steps`.

**Alternative / lower-level accessors on `StreamTextResult` (all `PromiseLike`, all auto-consume the stream):**

| Accessor | Type | Use |
|---|---|---|
| `result.responseMessages` | `Array<ResponseMessage>` | **primary** — ready-to-persist ModelMessage tail |
| `result.steps` | `Array<StepResult<TOOLS,RC>>` (index.d.ts:2804) | per-step detail; each `step.response.messages` is `Array<ResponseMessage>` (index.d.ts:1486→188) |
| `result.finalStep` | `StepResult` (2810) | `steps.at(-1)` shortcut |
| `result.toolCalls` | `TypedToolCall<TOOLS>[]` (2732) | flat list of all calls |
| `result.toolResults` | `TypedToolResult<TOOLS>[]` (2762) | flat list of all results |
| `result.content` | `Array<ContentPart<TOOLS>>` (2692) | all generated content parts |
| `result.text` | `string` (2698) | final step text only |
| `result.finishReason` | `FinishReason` (2768) | |
| `result.response` | `LanguageModelResponseMetadata` (2826, **@deprecated** → use `finalStep.response`) | `.messages`, `.id`, `.timestamp` |

> ⚠ Every one of these promises **auto-consumes the stream**. If you also iterate `result.stream` yourself (as chat-agent.ts does), await them only AFTER the `for await` loop completes, or the two consumers race. Awaiting `result.responseMessages` after the loop is the safe pattern.

---

## Q2 — `result.stream` (`fullStream`) part types

`result.stream` is `AsyncIterableStream<TextStreamPart<TOOLS>>` (index.d.ts:2853). `fullStream` is the **deprecated alias** for `stream` (2862) — use `stream`. Full union (`TextStreamPart<TOOLS>`, index.d.ts:3064), with tool-relevant payloads:

| `part.type` | Payload fields (exact) | Carries |
|---|---|---|
| `"start"` | — | |
| `"start-step"` | `request`, `warnings` | |
| `"text-start"` / `"text-end"` | `id`, `providerMetadata?` | |
| `"text-delta"` | `id`, `text`, `providerMetadata?` | text (currently handled) |
| `"reasoning-start"`/`"reasoning-delta"`/`"reasoning-end"` | `id`, (`text` on delta) | |
| `"tool-input-start"` | `id`, `toolName`, `providerExecuted?`, `dynamic?`, `title?`, `toolMetadata?` | toolName (streaming arg start) |
| `"tool-input-delta"` | `id`, `delta` | partial JSON args text |
| `"tool-input-end"` | `id` | |
| **`"tool-call"`** | `= TypedToolCall<TOOLS>` → `toolCallId`, `toolName`, `input`, `providerExecuted?`, `dynamic?`, (`invalid?`,`error?` if dynamic) | **toolCallId, toolName, input** |
| **`"tool-result"`** | `= TypedToolResult<TOOLS>` → `toolCallId`, `toolName`, `input`, `output`, `preliminary?`, `dynamic?` | **toolCallId, toolName, input, output** |
| `"tool-error"` | `toolCallId`, `toolName`, `input`, `error`, `dynamic?` | error surfaced without throwing |
| `"tool-output-denied"` | `toolCallId`, `toolName` | approval-denied tool |
| `"tool-approval-request"` | `approvalId`, `toolCall`, `isAutomatic?`, `signature?` | |
| `"tool-approval-response"` | `approvalId`, `toolCall`, `approved`, `reason?`, `providerExecuted?` | |
| `"source"` / `"file"` / `"reasoning-file"` | provider content parts | |
| `"finish-step"` | `response` (Omit `messages`/`body`), `usage`, `finishReason`, `rawFinishReason`, `performance`, `providerMetadata` | per-step end |
| `"finish"` | `finishReason`, `rawFinishReason`, `totalUsage` | whole-run end |
| **`"abort"`** | `reason?` (string, serialized via getErrorMessage) | emitted on cancellation |
| `"error"` | `error: unknown` | stream-stopping error (currently handled — code throws it) |
| `"raw"` | `rawValue` | |

Key point for the hallucination fix: **`"tool-call"` and `"tool-result"` parts pass through `result.stream` today and are silently dropped** (the loop only branches on `"text-delta"`/`"error"`). But you do **not** need to reassemble messages from these stream parts — `await result.responseMessages` gives the already-assembled `ModelMessage[]`. The stream parts are only needed if you want to react live (e.g. UI feedback) or persist incrementally mid-stream.

---

## Q3 — Exact ModelMessage tool shapes (v7 field names)

Field-name verdict for SDK v7: **`input`** (NOT `args`) and **`output`** (NOT `result`). Confirmed in `@ai-sdk/provider-utils` d.ts.

### (a) Assistant message containing a tool-call part

`AssistantModelMessage` (provider-utils:1270): `{ role: 'assistant'; content: AssistantContent; providerOptions? }` where `AssistantContent = string | Array<TextPart | CustomPart | FilePart | ReasoningPart | ReasoningFilePart | ToolCallPart | ToolResultPart | ToolApprovalRequest>` (:1284).

`ToolCallPart` (provider-utils:242):
```ts
{
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;            // <-- v7 uses `input`, not `args`
  providerOptions?: ProviderOptions;
  providerExecuted?: boolean;
}
```

Concrete literal:
```ts
{
  role: 'assistant',
  content: [
    { type: 'text', text: 'Let me check the timeline.' },
    { type: 'tool-call', toolCallId: 'call_abc', toolName: 'recall_memory', input: { query: 'pet name' } },
  ],
}
```

### (b) Tool-result message

`ToolModelMessage` (provider-utils:1331): `{ role: 'tool'; content: ToolContent; providerOptions? }` where `ToolContent = Array<ToolResultPart | ToolApprovalResponse>` (:1344).

`ToolResultPart` (provider-utils:270):
```ts
{
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: ToolResultOutput;   // <-- v7 uses `output`, not `result`; and it is a TAGGED object, not a bare value
  providerOptions?: ProviderOptions;
}
```

`ToolResultOutput` is a discriminated union (provider-utils:294): `{ type:'text', value:string }` | `{ type:'json', value:JSONValue }` | `{ type:'execution-denied', reason? }` | `{ type:'error-text', value:string }` | `{ type:'error-json', value:JSONValue }` | `{ type:'content', value:Array<text|file parts> }`.

Concrete literal:
```ts
{
  role: 'tool',
  content: [
    { type: 'tool-result', toolCallId: 'call_abc', toolName: 'recall_memory',
      output: { type: 'json', value: { name: 'Taki' } } },
  ],
}
```

> When you get these back from `await result.responseMessages`, the SDK has already built them in exactly this shape — you persist them as-is, you don't hand-construct them. The literals above are for the persistence-schema design (what fields must survive a DB round-trip).

---

## Q4 — abortSignal / cancellation

**Yes, `agent.stream({...})` accepts `abortSignal`.** It is a top-level field of the stream call parameters, a sibling of `messages`:

`AgentStreamParameters` = `AgentCallParameters & { experimental_transform? }`; `AgentCallParameters` includes **`abortSignal?: AbortSignal`** (index.d.ts:4616) and `timeout?` (:4620). The `stream` method destructures `{ abortSignal, timeout, ... }` (index.d.ts:5249).

Usage:
```ts
const controller = new AbortController();
const result = await agent.stream({ messages: history, abortSignal: controller.signal });
// ... controller.abort('user interrupted') to cancel
```
(Note: `abortSignal` is `Omit`-ted from the agent's *constructor* settings — index.d.ts:5022 — so it must be passed per-call to `stream()`, never in `new ToolLoopAgent(...)`.)

**How abort surfaces in the `for await` loop (from runtime index.js:8922-8962):**
- The stream does **NOT throw** on a normal abort. On each `pull`, if `abortSignal.aborted`, it enqueues a **`{ type: 'abort', reason? }`** part and then **closes the stream gracefully** (`controller.close()`). So your `for await` loop simply receives an `abort` part (which the current code ignores) and then **ends normally**.
- If an underlying abort *error* is thrown, it is caught: when `isAbortError(error) && abortSignal.aborted`, it is converted into the same graceful `abort` part + close (index.js:8957). Only non-abort errors call `controller.error(error)` — which surfaces as a throw at the `for await`. (Current code also converts `error` parts into throws via the `part.type === "error"` branch.)

**Can you still read partial data after abort?** Yes:
- The **partial text you already accumulated** in your loop variable is intact (you appended each `text-delta` as it arrived).
- **Tool parts already completed** before the abort are available: any `tool-call`/`tool-result` parts that were emitted before the abort passed through the loop. The `onAbort` callback (a stream option, `StreamTextOnAbortCallback`, index.d.ts:3431) receives `{ steps: StepResult[] }` = all previously-FINISHED steps. `result.steps` / `result.responseMessages` reflect only fully-recorded steps (index.js:5860-5864 flat-maps `steps`); a step interrupted mid-generation is NOT in there. So after abort, `await result.responseMessages` yields the messages of every COMPLETED step but omits the in-flight (interrupted) step.
- Practical implication: after abort, prefer persisting **your own accumulated `assistantText`** for the interrupted step's partial text (the SDK won't hand you a ModelMessage for an unfinished step), plus `await result.responseMessages` for any fully-completed earlier steps' tool calls/results.

---

## Q5 — Assembling persistence (reference skeletons only — not final code)

> ⚠ Schema constraint (internal, must feed the PRD): the current store is **text-only**. `TimelineRoleSchema = z.enum(["user","assistant"])` (`packages/shared/src/timeline-schema.ts:15`) and `TimelineEntry.content` is a plain string; `ConversationStore` exposes only `appendUser`/`appendAssistant(id, text)` and reconstructs via a text-only `toModelMessage` (`conversation-store.ts:41`, comment: "multi-part fidelity returns when tools land"). **Persisting tool-call/tool-result ModelMessages requires extending the timeline role set (add `"tool"`) and the content column to hold structured parts (JSON), plus a new store method that accepts `ModelMessage[]`.** That schema change is a design decision for the PRD, not established by the SDK.

### Full-turn persist (happy path)

```ts
// chat-agent.ts stream(), replacing the tail after the for-await loop
const controller = new AbortController();
turn?.onClose(() => controller.abort('connection closed'));

const result = await agent.stream({ messages: history, abortSignal: controller.signal });

let assistantText = '';
for await (const part of result.stream) {
  if (part.type === 'text-delta') { assistantText += part.text; yield part.text; }
  else if (part.type === 'error') { throw part.error; }
  // tool-call / tool-result / abort parts flow by; captured via responseMessages below
}

// The complete turn tail as ready-to-store ModelMessage[] (assistant-with-tool-calls +
// tool-result messages + final assistant text), oldest-first, EXCLUDING the user message:
const turnMessages = await result.responseMessages;   // Array<AssistantModelMessage | ToolModelMessage>

// Persist the whole tail (requires a store that accepts ModelMessage[], see schema note):
store.appendTurn(characterId, turnMessages);          // <-- new method to design
```

### Partial-turn persist (interrupted mid-stream)

```ts
let assistantText = '';
let aborted = false;
try {
  for await (const part of result.stream) {
    if (part.type === 'text-delta') { assistantText += part.text; yield part.text; }
    else if (part.type === 'abort') { aborted = true; break; }      // graceful: stream emits this, no throw
    else if (part.type === 'error') { throw part.error; }
  }
} finally {
  // Completed steps' tool-calls/results (in-flight step is NOT here):
  const completed = await result.responseMessages;   // may be [] if aborted during step 0
  // The partial text of the interrupted step is only in your accumulator:
  if (completed.length) store.appendTurn(characterId, completed);
  if (assistantText && aborted) store.appendAssistant(characterId, assistantText /*, partial:true */);
}
```

**What's available vs lost on interrupt:**
- Available: `assistantText` accumulated so far; `result.responseMessages` / `result.steps` for every FULLY-completed step (their tool-call + tool-result messages); `onAbort({steps})`; the `abort` stream part with `reason`.
- Lost: any ModelMessage for the step that was interrupted mid-generation (the SDK never finalizes it into `steps`); a tool call that was streaming its input (`tool-input-delta`) but never reached a `tool-call` part; a tool whose execution was in flight (no `tool-result`).

---

## Caveats / confidence

- Everything in Q1–Q4 is confirmed from the **installed `.d.ts`** (`ai@7.0.17`, `@ai-sdk/provider-utils@5.0.5`) and cross-checked against `dist/index.js` runtime for the abort behavior. High confidence.
- The abort-graceful-close behavior (emits `abort` part, does not throw) is confirmed in `index.js:8927-8962` — this is runtime source, authoritative for this installed version.
- `result.responseMessages` excluding the user message and including all completed steps' assistant+tool messages is confirmed both in the JSDoc (index.d.ts:2827) and runtime (index.js:5860). High confidence.
- **Not an SDK fact (design open question for PRD)**: the timeline/store schema currently cannot hold tool messages (role enum + string content). Extending it (add `"tool"` role, structured/JSON content, `ModelMessage[]` append API) is required and is a design decision, not dictated by the SDK.
- `providerOptions` vs `providerMetadata`: ModelMessage parts use `providerOptions` (input side); stream/result parts use `providerMetadata` (output side). Don't conflate when serializing.
