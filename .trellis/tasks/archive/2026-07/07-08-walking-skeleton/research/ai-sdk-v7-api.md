# Research: AI SDK v7 API surface for the walking skeleton

- **Query**: Verify `@ai-sdk/openai-compatible@3.0.5` factory + `ai@7.0.17` agent/streaming/test APIs against installed `.d.ts`
- **Scope**: mixed (installed .d.ts primary, official v7 docs secondary)
- **Date**: 2026-07-09

Evidence roots (installed, verified by Read/Grep):

- `AI_DTS` = `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/index.d.ts`
- `AI_TEST_DTS` = `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/test/index.d.ts`
- `OAIC_DTS` = `node_modules/.pnpm/@ai-sdk+openai-compatible@3.0.5_zod@4.4.3/node_modules/@ai-sdk/openai-compatible/dist/index.d.ts`
- `PROV_DTS` = `node_modules/.pnpm/@ai-sdk+provider@4.0.2/node_modules/@ai-sdk/provider/dist/index.d.ts`
- `PU_DTS` = `node_modules/.pnpm/@ai-sdk+provider-utils@5.0.5_zod@4.4.3/node_modules/@ai-sdk/provider-utils/dist/index.d.ts`

## 1. `@ai-sdk/openai-compatible@3.0.5`

- Factory: `createOpenAICompatible(options: OpenAICompatibleProviderSettings)` — `OAIC_DTS:347`. Options (`OAIC_DTS:285-343`): `baseURL: string` (required), `name: string` (required), `apiKey?` (adds `Authorization: Bearer <apiKey>`), `headers?`, `queryParams?`, `fetch?`, `includeUsage?: boolean`, `supportsStructuredOutputs?`, others irrelevant here.
- Model instance: provider is callable — `provider(modelId)` returns `LanguageModelV4`; equivalents `provider.languageModel(id)` / `provider.chatModel(id)` (`OAIC_DTS:273-277`). Docs agree (installed `docs/index.mdx` in same package; https://ai-sdk.dev/providers/openai-compatible-providers).
- **URL construction**: baseURL is stripped of trailing slash, then the chat model appends the literal path `'/chat/completions'`: `url: ({ path }) => new URL(`${baseURL}${path}`)` — package source `src/openai-compatible-provider.ts:136,156-157` and `src/chat/openai-compatible-chat-language-model.ts:341,452`. So `baseURL=https://api.deepseek.com` → POST `https://api.deepseek.com/chat/completions`. No `/v1` is ever added by the SDK.
- Chat model implements `LanguageModelV4` (`specificationVersion = "v4"`, `OAIC_DTS:104-128`) — this is why tests must use the **V4** mock (see §3).

## 2. `ai@7.0.17` agent + streaming

- **Class name**: `ToolLoopAgent` — the issue's "ToolLoopAgent" requirement maps 1:1 to v7. `declare class ToolLoopAgent<...> implements Agent<...>` at `AI_DTS:5223`. Exported as `ToolLoopAgent` (plus deprecated alias `Experimental_Agent`). Docs: https://ai-sdk.dev/v7/docs/reference/ai-sdk-core/tool-loop-agent. (ADR 0003's SDK-6 name survived the major.)
- **Constructor** `new ToolLoopAgent(settings: ToolLoopAgentSettings)` (`AI_DTS:5022-5210`), relevant fields:
  - `model: LanguageModel` (required, `AI_DTS:5045`) — pass the provider model instance (DI seam: inject the mock here in tests).
  - `instructions?: string | SystemModelMessage | SystemModelMessage[]` (`AI_DTS:5032`, type at 662) — **v7 renamed `system` → `instructions`** (`system` on `Prompt` is deprecated, `AI_DTS:677`).
  - `stopWhen?` default `isStepCount(20)` (`AI_DTS:5056`); irrelevant with no tools — a no-tool step finishes with reason `stop`, one step, loop exits. Do not set it.
  - `maxRetries?` (via `RequestOptions`, default 2 — `AI_DTS:631-637`). Consider `maxRetries: 0` in tests (see gotchas).
  - `tools` omitted entirely for this slice.
- **Calls** (`AI_DTS:5245,5249`): `agent.generate(params)` and `agent.stream(params)`. Both return **Promises** — `stream()` returns `Promise<StreamTextResult<...>>`, so `await` it before touching `.textStream` (some doc snippets omit the await; the installed `.d.ts` is authoritative).
- **Call params** `AgentCallParameters` (`AI_DTS:4582-4685`): exactly one of `prompt: string | ModelMessage[]` **or** `messages: ModelMessage[]`; plus `abortSignal?: AbortSignal` (`AI_DTS:4616`), `timeout?` (number or `{totalMs|stepMs|chunkMs}`, `AI_DTS:597-603`), lifecycle callbacks (`onStart`, `onStepEnd`, `onEnd`...). Multi-turn = pass full history via `messages`.
- **Messages**: `ModelMessage = SystemModelMessage | UserModelMessage | AssistantModelMessage | ToolModelMessage` (`PU_DTS:1368`), re-exported from `'ai'` (`AI_DTS:8`). `CoreMessage` is gone; use `ModelMessage`. Runtime zod schemas also exported: `modelMessageSchema`, `userModelMessageSchema`, ... (`AI_DTS:653-657`).
  - **v7 breaking change**: system messages inside `messages`/`prompt` are **rejected by default** (CHANGELOG 7.0.0 entry `4e095b0`; opt-in via `allowSystemInMessages`, `AI_DTS:5041`). Keep persona in `instructions`, keep history to user/assistant turns.
- **StreamTextResult** (`AI_DTS:2686`):
  - `textStream: AsyncIterableStream<string>` (`AI_DTS:2846`) — plain text deltas; **when an error occurs the stream throws it** (doc comment at 2842-2845) → exactly the PRD's "errors propagate out of for-await" contract.
  - `stream: AsyncIterableStream<TextStreamPart>` (`AI_DTS:2853`; `fullStream` is a deprecated alias, 2862) — typed parts; error becomes a `{type:'error', error}` part instead of throwing (except stream-stopping errors). Part types (`AI_DTS:2944-3067`): `'text-start' | 'text-delta' (field .text) | 'text-end' | 'start' | 'finish' | 'abort' | 'error' | ...`. NOTE the ai-level delta field is **`.text`**, while the provider-level part uses `.delta` (§3).
  - `responseMessages: PromiseLike<ResponseMessage[]>` where `ResponseMessage = AssistantModelMessage | ToolModelMessage` (`AI_DTS:2832,177`) — the clean way to append the assistant turn to history after the stream finishes (instead of hand-accumulating deltas).
  - Also: `text`, `finishReason`, `usage` promises; `consumeStream()` (`AI_DTS:2890`).
- **Errors**: re-exported from `@ai-sdk/provider` via `AI_DTS:3`: `APICallError` (fields `url`, `statusCode?`, `responseBody?`, `isRetryable`, `data?`; `static isInstance(err)` — `PROV_DTS:672-694`), `AISDKError` (base, `PROV_DTS:667`), plus `RetryError` from `'ai'` (`AI_DTS:6892-6903`, wraps exhausted retries, `.lastError`). Import all from `'ai'`. Use `APICallError.isInstance(err)` (marker-symbol based — safer than `instanceof` across duplicated deps).
- **Abort**: pass `abortSignal` per call; on abort, `textStream` iteration terminates and the `stream` emits `{type:'abort'}` part (`AI_DTS:3052-3055`). Not needed for the skeleton but free.

### Minimal wiring snippet (verified names only)

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ToolLoopAgent, type ModelMessage, APICallError } from "ai";

const provider = createOpenAICompatible({
  name: "deepseek",
  baseURL: env.TAKI_PROVIDER_BASE_URL, // e.g. https://api.deepseek.com
  apiKey: env.TAKI_PROVIDER_API_KEY,
});
const model = provider(env.TAKI_PROVIDER_MODEL); // LanguageModelV4

const agent = new ToolLoopAgent({ model }); // no tools, no instructions yet

const history: ModelMessage[] = [{ role: "user", content: "hi" }];
const result = await agent.stream({ messages: history });
for await (const delta of result.textStream) {
  // delta: string — forward as chat.delta
}
history.push(...(await result.responseMessages)); // assistant turn(s)
```

## 3. Mock model for tests (`ai/test`)

Import path `ai/test` (package.json `exports["./test"]`). Exports (`AI_TEST_DTS:267`): `MockLanguageModelV4` (use this — matches openai-compatible's v4 spec), `MockLanguageModelV3`, `mockValues`, `mockId`, `convertArrayToAsyncIterable`, `convertReadableStreamToArray`, and a **deprecated** `simulateReadableStream` (import it from `'ai'` instead, `AI_TEST_DTS:262-265`). Docs: https://ai-sdk.dev/v7/docs/ai-sdk-core/testing (examples use exactly `MockLanguageModelV4`).

`MockLanguageModelV4` (`AI_TEST_DTS:103-120`): constructor takes `{ doStream?, doGenerate?, provider?, modelId? }`; `doStream` may be a function, a single `LanguageModelV4StreamResult`, or an array (one per call). It records **`doStreamCalls: LanguageModelV4CallOptions[]`** (`AI_TEST_DTS:111`) — assert multi-turn history via `mock.doStreamCalls[n].prompt`.

`doStream` contract: resolve `{ stream: ReadableStream<LanguageModelV4StreamPart> }` (`PROV_DTS:2640-2644`). Provider-level parts (`PROV_DTS:2576-2635`): `'text-start'/{id}`, `'text-delta'/{id, delta}` (**field `delta`**, not `text`), `'text-end'/{id}`, `'finish'/{usage, finishReason}` where `finishReason = { unified: 'stop'|..., raw?: string }` (`PROV_DTS:2440-2452`) and `usage = { inputTokens: {total,noCache,cacheRead,cacheWrite}, outputTokens: {total,text,reasoning} }` (`PROV_DTS:2478-2516`).

### (a) mock streaming 3 deltas then finishing

```ts
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};
const mockModel = new MockLanguageModelV4({
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Hel" },
        { type: "text-delta", id: "t1", delta: "lo " },
        { type: "text-delta", id: "t1", delta: "you" },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
      ],
    }),
  }),
});
// inject: new ToolLoopAgent({ model: mockModel })
// textStream yields "Hel", "lo ", "you"
```

(Chunk shapes match the official v7 testing docs verbatim; `simulateReadableStream` signature at `AI_TEST_DTS:13-20` — `{ chunks, initialDelayInMs?, chunkDelayInMs? }`, `null` delays = fully synchronous.)

### (b) mock that fails (error path)

```ts
const failingModel = new MockLanguageModelV4({
  doStream: async () => {
    throw new APICallError({
      message: "Invalid API key",
      url: "https://api.example.com/chat/completions",
      requestBodyValues: {},
      statusCode: 401,
      isRetryable: false, // avoids the default 2 retries
    });
  },
});
// for await (... of result.textStream) rejects with this error;
// assert APICallError.isInstance(err) at the chat-send boundary.
```

Alternative in-stream failure: include `{ type: "error", error: new Error("boom") }` as a chunk — `textStream` throws it mid-iteration.

### Asserting received messages (multi-turn)

`mock.doStreamCalls[1].prompt` is `LanguageModelV4Prompt = Array<LanguageModelV4Message>` (`PROV_DTS:1717-1724`) — the **converted** provider format: user/assistant content is a parts array, e.g. `{ role: "user", content: [{ type: "text", text: "hi" }] }`. Assert against that shape (or just roles + extracted text), not against `ModelMessage`.

## 4. Gotchas

- **zod peering OK**: `ai@7.0.17` peer `zod ^3.25.76 || ^4.1.8`; installed `zod@4.4.3` satisfies it and ships the `zod/v4` subpath the SDK imports (verified in installed zod package.json). Single zod instance in the workspace.
- **Node engines OK**: `ai` requires `node >= 22`; we run 24.18.0.
- **ESM-only**: ai v7 removed CJS (CHANGELOG 7.0.0 `ef992f8`). Our packages are `"type": "module"` — fine.
- **Default retries = 2**: a throwing mock marked retryable (or a plain thrown `Error`? — plain errors are not retried; only retryable `APICallError`s are) can slow error tests; set `isRetryable: false` (as above) or `maxRetries: 0` in agent settings for deterministic fast failure.
- `stepCountIs` was renamed `isStepCount` in v7 (CHANGELOG `3debdb7`); a compat alias `stepCountIs` is still exported. Irrelevant with no tools — don't set `stopWhen`.
- Two delta field names exist: provider part `.delta` (what mocks emit) vs ai-level `TextStreamPart` `.text` (what `result.stream` yields). Using `textStream` (plain strings) sidesteps the confusion — recommended for this slice.

## Caveats / Not Found

- `agent.stream()` returning a Promise (vs v6's sync return) means `const result = await agent.stream(...)` — one v7 doc snippet omits the await; trust the `.d.ts`.
- Did not verify OpenTelemetry/telemetry options — out of scope.
