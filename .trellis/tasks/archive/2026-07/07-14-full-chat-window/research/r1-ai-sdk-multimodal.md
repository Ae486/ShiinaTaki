# Research: AI SDK 7 multimodal image input (issue #17)

- **Query**: exact multimodal user-message shape in `ai` ^7.0.17; image data formats; ToolLoopAgent flow; openai-compatible wire format; DeepSeek vision support; per-turn model routing
- **Scope**: mixed (node_modules .d.ts/.js verification + official docs)
- **Date**: 2026-07-15
- **Installed versions verified**: `ai@7.0.17`, `@ai-sdk/openai-compatible@3.0.5`, `@ai-sdk/provider-utils@5.0.7` (the one `ai` re-exports its message types from)

## 1. Exact TS shape of a user ModelMessage carrying an image

All message/part types are defined in `@ai-sdk/provider-utils` and re-exported by `ai`
(`node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/index.d.ts:8`).

Verified from `node_modules/.pnpm/@ai-sdk+provider-utils@5.0.7_zod@4.4.3/node_modules/@ai-sdk/provider-utils/dist/index.d.ts`:

```ts
// line 34
type DataContent = string | Uint8Array | ArrayBuffer | Buffer;   // string = base64-encoded

// line ~1346
type UserModelMessage = { role: 'user'; content: UserContent; providerOptions?: ProviderOptions };
// line 1362
type UserContent = string | Array<TextPart | ImagePart | FilePart>;
// line 1368
type ModelMessage = SystemModelMessage | UserModelMessage | AssistantModelMessage | ToolModelMessage;

// line ~109 — NOTE: deprecated in v7!
/** @deprecated Use `FilePart` with `mediaType: 'image'` instead:
 *  `{ type: 'file', mediaType: 'image', data: { type: 'data', data } }`. */
interface ImagePart {
  type: 'image';
  image: DataContent | URL | ProviderReference;
  mediaType?: string;          // optional
  providerOptions?: ProviderOptions;
}

// line ~133 — the CURRENT recommended part
interface FilePart {
  type: 'file';
  data: FileData | DataContent | URL | ProviderReference;
  filename?: string;
  mediaType: string;           // REQUIRED by the type ("image/png", or top-level "image")
  providerOptions?: ProviderOptions;
}
// FileData tagged union: {type:'data',data} | {type:'url',url} | {type:'reference',...} | {type:'text',...}
```

**Verdict**: the shape `{role:"user", content:[{type:"text",text}, {type:"image", image, mediaType?}]}`
still type-checks and works, BUT `ImagePart` is `@deprecated` in ai 7 and the runtime logs a
deprecation warning on every turn (`ai/dist/index.js:1389-1396`: pushes a `"deprecated"` warning and
calls `logWarnings`). It is auto-converted via `convertImagePartToFilePart`
(`ai/dist/index.js:1550`: `{type:'file', data: part.image, mediaType: part.mediaType ?? 'image'}`).

**Use `FilePart` directly** — the canonical v7 user message with an image:

```ts
import type { ModelMessage } from "ai";

const msg: ModelMessage = {
  role: "user",
  content: [
    { type: "text", text: "What is in this screenshot?" },
    { type: "file", mediaType: "image/png", data: base64String }, // bare base64 DataContent shorthand
  ],
};
```

## 2. What the data field accepts — and the data-URL gotcha

For `FilePart.data` (bare `DataContent` shorthand), verified in `ai/dist/index.js`
`convertToLanguageModelV4FilePart` (line 1208):

| Input | Behavior |
| --- | --- |
| raw base64 string (no `data:` prefix) | `new URL()` throws -> treated as inline base64 bytes. RELIABLE. |
| data-URL string `data:image/png;base64,...` (bare string) | parses as `URL` with `data:` protocol -> `splitDataUrl` (line 1151) extracts mediaType + base64. Works; extracted mediaType wins. |
| `{ type: 'data', data: 'data:image/png;base64,...' }` (tagged) | **THROWS** `InvalidDataContentError`: "Data URLs are not valid inline data. Pass them as { type: 'url', url } instead." (line 1212-1218) |
| `Uint8Array` / `ArrayBuffer` / `Buffer` | converted to inline bytes. Works. |
| `URL` (http/https) | kept as url part; downloaded by the SDK only if the provider does not support URLs (openai-compatible passes remote URLs through as `image_url.url`). |

**Most reliable for locally-attached bytes**: strip the `data:...;base64,` prefix in the UI and send
the **raw base64 string** plus the **explicit full `mediaType`** (from the picker's `File.type`).
That avoids both the tagged-data-URL throw and any URL-parsing ambiguity, and keeps the WS payload
minimal (no prefix).

**Is mediaType required or inferred?** Both, in layers:
- The `FilePart` TS type REQUIRES `mediaType` (top-level `"image"` is accepted).
- At convert time (`ai/dist/index.js:1646-1652`), for inline string/Uint8Array data the SDK sniffs
  magic bytes via `detectMediaType({topLevelType:"image"})` and **overrides** mediaType for
  png/jpeg/gif/webp/bmp/tiff/avif/heic (signature table in provider-utils `dist/index.js:~230-310`).
- If nothing is detected and mediaType resolves to null -> throws `Media type is missing for file part`.
- Provider side (`resolveFullMediaType`, provider-utils `dist/index.js:3034`): a bare top-level
  `"image"` that cannot be sniffed to a full subtype throws `UnsupportedFunctionalityError`.

So: **always set the full `mediaType` from `File.type`**; sniffing is a safety net, not a contract.

## 3. Flow through ToolLoopAgent — nothing in the stream loop changes

- `agent.stream({messages})` is typed `messages: Array<ModelMessage>`
  (`AgentCallParameters`, `ai/dist/index.d.ts:4580-4612`; `ToolLoopAgent.stream` at :5250).
  A user message with a parts array is passed **directly** — no transform.
- Internally: `standardizePrompt` -> `convertToLanguageModelPrompt` (`ai/dist/index.js:1253`) ->
  `convertToLanguageModelMessage` (:1361) maps each user part
  (`convertImagePartToFilePart` -> `convertPartToLanguageModelPart`). All automatic.
- The existing stream loop in `packages/core/src/agents/chat-agent.ts:89-98` iterates
  `text-delta` / `finish-step` / `error` parts — image INPUT does not add stream part types.
  **No change needed in the loop.**
- `messageText()` (`chat-agent.ts:153-159`) already handles array content (keeps only text parts),
  so the memory recall query keeps working when user messages become parts arrays.

**Where the repo DOES need work** (message-building path, not the loop):
- `ChatSendParamsSchema` (`packages/shared/src/chat-schema.ts:17-20`) is `{characterId, message: string}` — needs an optional images field.
- `ConversationStore.appendUser(characterId, text)` (`packages/core/src/agents/conversation-store.ts:41`)
  persists user rows as plain text; `toModelMessage` replays user rows as `{role:"user", content: entry.content}`
  (`packages/core/src/agents/turn-mapping.ts:72`). `TimelinePart` has no image variant — whether past
  images REPLAY in later turns is a design decision (see Caveats).

## 4. @ai-sdk/openai-compatible 3.0.5 wire format — no provider option needed

Verified in `node_modules/.pnpm/@ai-sdk+openai-compatible@3.0.5_zod@4.4.3/node_modules/@ai-sdk/openai-compatible/dist/index.js:126-220`
(`convertToOpenAICompatibleChatMessages`):

- A file part whose `mediaType` top-level is `image`:
  - inline data -> `{ type: "image_url", image_url: { url: "data:<fullMediaType>;base64,<base64>" } }`
  - url data -> `{ type: "image_url", image_url: { url: "<url>" } }`
- No providerOptions required. Text-only single-part messages collapse to plain string `content`.
- Provider-reference and text-file parts throw `UnsupportedFunctionalityError` (not relevant here).

This is exactly the OpenAI Chat Completions vision shape, so any OpenAI-compatible proxy that
supports vision accepts it.

## 5. DeepSeek deepseek-v4-flash: treat as TEXT-ONLY; route images to the VLM

- Official DeepSeek docs (https://api-docs.deepseek.com/ + /api/create-chat-completion/) document
  **no image input** for the first-party API as of 2026-07-15. The V4 preview announcement
  (https://api-docs.deepseek.com/news/news260424, 2026-04-24) mentions 1M context + thinking modes, not vision.
- Tencent CloudBase (hosts both models) states explicitly: "`deepseek-v4-pro` — supports image input
  (multimodal); the pro series is the only model that accepts `type: 'image_url'` ...
  **`deepseek-v4-flash` — accepts only plain-text messages; passing images will be silently ignored
  or cause an error**" (https://docs.cloudbase.net/en/recipes/add-multimodal-image-cloudbase-deepseek-v4).
- NVIDIA NIM model card for deepseek-v4-flash: "Input Types: Text"
  (https://docs.api.nvidia.com/nim/reference/deepseek-ai-deepseek-v4-flash).
- Only third-party resellers (reapi.ai) claim "vision input (beta)" for the whole V4 family — conflicting, unofficial.

**Verdict**: image-bearing turns MUST route to the VLM endpoint (TAKI_VLM_*). Never send image parts
to `deepseek-v4-flash` — worst case silent ignore (model answers without seeing the image), which is
worse than an error.

**Gemini behind an OpenAI-compatible proxy** (TAKI_VLM_MODEL=`gemini-2.5-pro-1m`): Google's own
OpenAI-compatibility layer officially supports `image_url` with base64 data URLs
(`{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,..."}}`) — documented at
https://ai.google.dev/gemini-api/docs/openai and
https://cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/overview ("The image_url type
supports ... a base64 encoding in the form `data:<mime>;base64,<data>`"). A proxy fronting Gemini with the
OpenAI surface is the standard path; the openai-compatible provider's output (section 4) matches it.

## 6. Recommended per-turn model selection (minimal sketch)

`chat-agent.ts` already constructs `new ToolLoopAgent({model: deps.model, ...})` fresh inside
`runTurn` (chat-agent.ts:63) — per-turn model choice is a one-line substitution:

```ts
export interface ChatAgentDeps {
  model: LanguageModel;
  /** Optional vision-capable model; used for turns that carry image parts. */
  visionModel?: LanguageModel;
  // ...existing deps
}

function pickModel(deps: ChatAgentDeps, hasImages: boolean): LanguageModel {
  if (!hasImages) return deps.model;
  if (!deps.visionModel) throw new Error("image attached but no vision model configured (TAKI_VLM_*)");
  return deps.visionModel;
}

// in runTurn:
const agent = new ToolLoopAgent({ model: pickModel(deps, turnHasImages), /* ... */ });
```

- The thrown error surfaces through the existing `chat.error` path (`ws chat-send method`) as a
  structured error — matches "structured error if a turn has an image but no vision model".
- In `main.ts`, mirror the existing provider block with a second `createOpenAICompatible({name:"taki-vlm",
  baseURL, apiKey}).languageModel(model)` from optional `TAKI_VLM_BASE_URL/_API_KEY/_MODEL`
  (all-or-none optional group in a `vlm-config.ts` mirroring `provider-config.ts`).

## Caveats / open questions

1. **History replay with images**: if `hasImages` is computed only from the CURRENT message, a
   later text-only turn replays history through `deepseek-v4-flash`; if past user rows replay image
   parts, the text model receives images (silently ignored/error). Two workable options:
   (a) compute `hasImages` over the whole outgoing messages array (pins the conversation to the VLM
   for up to REPLAY_WINDOW=200 messages after one image), or
   (b) do NOT replay image parts: persist user image turns with a text placeholder (e.g. `[image attached]`)
   and full bytes only in the in-flight turn. (b) matches the existing text-only timeline schema
   (`TimelinePart` has no image variant) and keeps routing decisions per-turn — the implementer/leader
   should decide; (b) is the smaller change.
2. DeepSeek official vision support may land later (V4 sources conflict) — the routing stays valid
   either way since the VLM env vars can point anywhere OpenAI-compatible.
3. `providerConfig`-style zod env validation for TAKI_VLM_*: must be OPTIONAL (feature degrades to
   text-only with a structured error), unlike the required TAKI_PROVIDER_* group.
