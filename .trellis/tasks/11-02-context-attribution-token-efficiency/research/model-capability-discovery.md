# Research: Model capability discovery

- Query: Discover tool calling, native image/multimodal input, and web search when configuring the primary model; reuse existing maintained metadata instead of building a detection framework.
- Scope: mixed — current Core/Shared/Home settings, installed AI SDK interfaces, local Pi reference, and current public provider/catalog documentation.
- Date: 2026-11-02
- Owner: this research file only. No production/config/data changes, new dependencies, paid generation, service restart, Git operation, or task lifecycle operation.

## Findings

### Recommendation and scope decision

Use a small projection of **models.dev provider/model metadata**, fetched with the already available `fetch` and validated with the already installed Zod, to fill declared capabilities automatically for exact known identities. Keep the existing AI SDK for request serialization and the tool loop. Do not add Pi as another runtime or create a generic capability-probing service.

Metadata lookup is supplementary to the owner's native-image change: every image source must reach MAIN as native media, including screenshots/perception. Eliminate the vision slot and image-to-text translation calls. Do not retain a vision/translator fallback for text-only or unidentified models. Lookup availability must not become a prerequisite to implementing native image transport.

The original request for automatic discovery of **actual** endpoint capabilities cannot be guaranteed for arbitrary OpenAI-compatible endpoints through metadata alone. The UI must distinguish catalog declarations, current adapter support, and endpoint observations. Unknown is a real result, not false and not true. An unidentified proxy/model must not acquire capability claims from its name. Known unsupported input needs actionable feedback; unknown metadata should remain visible without silently replacing the requested native input with translated text.

The parent has created the independent child task `.trellis/tasks/11-02-native-multimodal-model-capabilities`. That split is warranted because deleting the vision/translator paths and routing all image producers is a cross-layer behavior change, independent of token-attribution delivery. This report remains in the parent's authorized research directory. Native-image path ownership and detailed producer mapping belong to the other researcher.

### Files found

| File | Role / evidence |
| --- | --- |
| `packages/core/package.json:14` | Actual dependency pins: `@ai-sdk/mcp` 2.0.81, `@ai-sdk/openai-compatible` 3.0.75, `ai` 7.0.148. |
| `pnpm-lock.yaml:204` | `@ai-sdk/gateway` 4.0.121 is transitive through `ai`, not a separately selected runtime/provider in Taki. |
| `packages/core/src/config/provider-config.ts:10` | MAIN configuration contains only base URL, API key, and model ID. |
| `packages/core/src/config/provider-factory.ts:20` | MAIN is constructed with `createOpenAICompatible`, logging name `taki-provider`; optional vision currently constructed separately. |
| `packages/core/src/config/provider-factory.test.ts:13` | Construction/slot/includeUsage tests; no actual endpoint capability validation. |
| `packages/core/src/config/provider-config.test.ts:10` | Required-field parsing tests; no model-list or generation health checks. |
| `packages/core/src/config/vision-config.ts:35` | Existing vision configuration is all-or-nothing; owner now requests its removal. |
| `packages/core/src/config/knob-registry.ts:151` | MAIN/VLM/utility fields and per-slot declared context limits are restart-applied knobs. |
| `packages/core/src/config/config-source.ts:19` | Existing Core-owned env/stored/default precedence; operator projection masks secrets. |
| `packages/core/src/config/config-writer.ts:43` | Existing settings writer refuses secret/config-boundary misuse. |
| `packages/shared/src/config-schema.ts:10` | Settings protocol is list/set/subscribe/changed; entries have editing/provenance metadata, no model discovery/test result schema. |
| `packages/core/src/server/methods/config-methods.test.ts:70` | Operator authorization, masking, sparse persistence and change notification tests. |
| `apps/desktop/src/windows/home/pages/settings/knob-field.tsx:45` | Home renders ordinary editable knob rows, with no dedicated discovered-capabilities panel. |
| `node_modules/.pnpm/@ai-sdk+provider@4.0.31/node_modules/@ai-sdk/provider/dist/index.d.ts:3443` | Installed `LanguageModelV4` contract: model identity, URL transport patterns, generation methods. |
| `node_modules/.pnpm/@ai-sdk+openai-compatible@3.0.75_zod@4.4.3/node_modules/@ai-sdk/openai-compatible/dist/index.js:95` | Image data/URL serialization to `image_url`; not endpoint capability discovery. |
| `node_modules/.pnpm/@ai-sdk+openai-compatible@3.0.75_zod@4.4.3/node_modules/@ai-sdk/openai-compatible/dist/index.js:301` | Provider-defined tools are omitted with an unsupported warning. |
| `node_modules/.pnpm/@ai-sdk+gateway@4.0.121_zod@4.4.3/node_modules/@ai-sdk/gateway/dist/index.d.ts:194` | Installed Gateway list return type lacks tool/vision flags. |
| `references/pi-main/packages/ai/package.json:2` | Local Pi reference is `@earendil-works/pi-ai` 0.84.2, MIT; not installed in Core. |
| `references/pi-main/packages/ai/src/types.ts:821` | Pi model projection has API/provider/baseUrl, reasoning, text/image inputs, limits/prices; no general tool-support tri-state or native-search flag. |
| `references/pi-main/packages/ai/scripts/generate-models.ts:1403` | Pi consumes models.dev and applies provider-specific filtering/corrections. |
| `references/pi-main/packages/coding-agent/src/core/remote-catalog-provider.ts:7` | Pi has persisted remote overlay/refresh behavior; a larger mechanism than needed here. |

### Existing SDK support and its limits

The installed interface is **v4**, despite older comments in the factory/tests referring to compatible SDK 3.0.5. The installed factory sets `specificationVersion = "v4"` (`openai-compatible/dist/index.js:352`); exact current types/source take precedence over those comments.

`LanguageModelV4` has no generic `supportsTools`, `supportsVision`, or `supportsWebSearch` property. `supportedUrls` is a map of media types to URL patterns for deciding which remote URLs the provider may handle natively without SDK downloading (`@ai-sdk/provider/dist/index.d.ts:3456`). It is not a multimodal capability certificate. The compatible model defaults this map to `{}` (`openai-compatible/dist/index.js:366`) while still encoding inline images.

`ProviderV4` exposes model constructors, not a universal capability or account-model discovery method (`@ai-sdk/provider/dist/index.d.ts:6324`). AI SDK provider registry/custom provider support can centralize constructors and aliases; registering `provider:model` does not query the serving endpoint or verify the model. Taki's SDK provider string `taki-provider.chat` is a logging/adapter identity, not an upstream catalog provider ID.

The compatible chat serializer converts ordinary function definitions to Chat Completions tools (`openai-compatible/dist/index.js:305`). It ignores provider-defined tools and reports `unsupported`, including an OpenAI native web-search tool. A model accepting ordinary tools/images therefore remains different from an adapter supporting native provider tools, and neither establishes endpoint acceptance.

SDK-level feature support also does not prove that every combination works: native media in tool results, media in user input, streaming function calls, and provider-native search can have different provider/protocol constraints. The separate native-image researcher owns those paths.

### Four kinds of evidence

| Evidence | What it establishes | What it cannot establish |
| --- | --- | --- |
| Maintained catalog/provider declaration | Declared features for a documented provider/model, with date/source | The operator's proxy, account, deployment or exact request accepts them |
| Installed adapter types/source/wire fixture | This SDK version can encode/decode an exact protocol feature | A real endpoint/model supports it or answers correctly |
| Actual endpoint metadata | The configured service declares features for that model/route, if its API supplies them | Successful generation, reliable vision, correct tool choice, or permission/account availability |
| Actual generation/tool observation | One model/endpoint/request combination accepted and exhibited the observed behavior | Universal support, all media formats/tool schemas, or future availability |

OpenAI's official `GET /models` lists basic identity/availability fields (`id`, `created`, `object`, `owned_by`, optional `shutdown_date`), not capabilities. A generic compatible `/models` list with that shape cannot answer this task. Services may add useful fields, but they are documented service-specific metadata, not implied by compatibility.

### Reusable approaches compared

| Approach | Reuse / cost | Fitness |
| --- | --- | --- |
| Existing compatible SDK / provider registry | Already installed; zero new dependency | Keep for transport/loop. No general discovery metadata; a registry does not solve detection. |
| `gateway.getAvailableModels()` from `ai` | Already available through `ai`; uses Gateway `/config` with Gateway headers and cached SDK metadata | Installed result has id/name/description/pricing/specification/modelType, not tool/vision flags. Does not discover arbitrary custom endpoints. |
| Vercel public REST model catalog | Public no-auth `GET https://ai-gateway.vercel.sh/v1/models`; native fetch + small Zod projection | Has tags (`tool-use`, `vision`), modalities, limits, supported parameters. Good when configuring Gateway or as explicitly labeled Gateway declarations; not truth for another proxy. |
| models.dev API | Public no-auth JSON, zero new dependency; provider/model lookup + narrow projection | Best small broad catalog source. Retains explicit tool calling and input modalities, plus limits/dates. Missing/unknown must be preserved. |
| Pi generated/remote catalog | Local reference available for study; consuming its runtime adds SDK/auth/catalog state and additional dependencies | Not needed. Useful proof that maintained catalogs can be reused; generated output filters out unsupported/unidentified models and collapses input modalities to text/image. |
| Automatic paid generation probes | New calls, cost and side effects; separate successful tool/image/search probes still do not prove all combinations | Do not introduce. Not performed or authorized for this research. Not a prerequisite to native-image routing. |

**Gateway detail:** the installed SDK's typed `/config` schema (`gateway/dist/index.js:683`) projects model identity, pricing and specification; the public REST `/models` is a different documented endpoint with richer fields. Treating these APIs as interchangeable would produce incorrect expectations. A successful no-auth REST fetch here returned 498 models; its sample included `tags`, `modalities`, `context_window`, `max_tokens`, and `supported_parameters`. This is catalog observation, not a Gateway generation or a statement that all 498 models are available to this owner.

**models.dev detail:** the live v1 `https://models.dev/api.json` fetched here returned 235 provider groups. Model entries expose `tool_call`, `modalities.input`, `limit.context/input/output`, optional `canonical_model_id`, and `last_updated`. For example, the inspected OpenAI entry `gpt-5.4-pro` declared `tool_call: true`, text/image input, context 1,050,000, input 922,000 and output 128,000; its entry date was 2026-03-05. This is an example of the API fields, not a target-model selection or a guarantee about Taki's current endpoint. A fetch date does not make the entry newly validated.

The maintained source now uses schema-v2 TOML with lab/model facts separated from provider overrides, while `api.json` remains the generated v1 projection. The README documents deep merging of provider overrides and `canonical_model_id`; `models.json` gives model-only facts and `catalog.json` contains both providers and models. Use the provider projection for served limits/features and preserve canonical identity when supplied. Do not replace an explicit configured context limit from this research: catalog limits, configured limits and learned effective limits remain different scopes.

The local Pi generator fetches models.dev (`generate-models.ts:1406`), filters `tool_call !== true` (`:1417` and subsequent provider branches), then projects `modalities.input.includes("image")` to `text/image`. Its Gateway import similarly filters `tool-use` tags (`:1131`). Thus absence from Pi's generated list cannot mean "unsupported"; it can also mean unknown/filtering/stale/retired. The Pi `Model` type itself does not preserve a tools false/unknown value. Copying this list as Taki's complete capabilities truth would lose distinctions the owner requires. Pi also contains provider-specific compatibility guesses/corrections; these must not be copied wholesale into the existing AI SDK adapter.

### Web search must remain separate

1. **Ordinary tool calling:** the model requests an application tool. If an available MCP/native search tool is actually disclosed, authorized and functioning, the application executes search and returns results. The model itself need not have provider-hosted browsing. Tool capability, actual tool availability and successful search are separate facts.
2. **Provider-native search:** requires the provider's protocol/tool definition and suitable model/account. Official OpenAI Docs recommends Responses with `web_search` for a new integration; Chat Completions search uses specific search integration/models. AI SDK's OpenAI provider exposes `openai.tools.webSearch`; Google and Anthropic have their own APIs. Those native provider packages are not installed/selected in Taki's current MAIN factory.
3. **Network connectivity:** an endpoint responding to HTTP or returning a model list proves neither form of search. The model cannot be described as browsing merely because Core or the provider is on the internet.

The checked models.dev v1 reference has no general provider-native-search field. Do not derive search from `tool_call`, image support, `attachment`, free-text descriptions or model names. For current compatible MAIN, report provider-native tool search as unsupported by the installed adapter; an application search tool may still provide usable search, with its own extension/run availability. This research did not inspect or contact any owner's actual MCP search service.

### Minimal implementation shape for later review

- Derive a **read-only** capability projection in Core from effective MAIN config; do not store catalog booleans as manually maintained settings or invent another authority table.
- Automatically match exact catalog provider/model identities for recognized endpoints. The current config has no provider ID; catalog `api` fields can help only when present. A few verified official endpoint mappings or an explicitly chosen catalog provider may cover the supported configurations. An unrecognized relay remains unknown. No fuzzy model-name matching, prefix stripping or assumed canonical equivalence.
- Keep each value as declared true/false/unknown with source/model/provider/date, and separately show adapter usability and any actual endpoint observation. Missing fields and fetch/parse/match failures are not negative capability results.
- Fetch once on configuration inspection/change, share a bounded catalog cache, and surface stale/unavailable metadata honestly. A network failure should leave existing configured behavior intact; no retry loop or generation probe is needed to use MAIN native input.
- Queries to a public catalog never include credentials, private prompts, or the operator's arbitrary endpoint URL. Preserve the existing Core secret boundary and env precedence. Old capability results must not be displayed as belonging to a changed MAIN model/base URL.
- Display concise feature/status text next to MAIN settings. Keep provider-native search distinct from application tool search. Do not promise endpoint validation when only catalog metadata is available.
- For native-image migration, remove VLM settings/slot consumers through the separate approved implementation plan. Known unsupported and unknown cases retain honest diagnostics; neither creates a translator fallback or a hidden alternate model call.

Estimated **metadata-only** change scope: one small Core catalog/projection module with focused tests; one Shared projection/result schema plus operator handler/wiring; a MAIN settings presentation/hook with loading/error/unknown states and tests; touched directory indexes/specs. Approximately 6–10 production files plus focused tests/docs, no new dependency and no new durable capability table. This is an estimate, not an approved file list. All-image migration is additional cross-layer scope owned by the new child task; do not use this estimate as its total size. Provider-native web-search integration, if desired later, is a separate protocol/provider selection change and may require a new provider dependency and distinct acceptance.

### Evidence and reproducible checks

Read-only checks used the T4 worktree, Node 24.18.0, and installed lockfile versions. Semantic discovery used one focused `jbcontext search`, then direct source reads and exact identifiers. No dependency install or user-model generation was needed.

A mock-fetch fixture called the **real installed compatible serializer** with an arbitrary `unknown-model-id`, one ordinary function tool, one `openai.web_search` provider tool, and an image data part. It produced:

```json
{
  "fixtureCalls": 1,
  "realNetworkCalls": 0,
  "specificationVersion": "v4",
  "supportedUrls": {},
  "modelId": "unknown-model-id",
  "encodedImage": "data:image/png;base64,iVBORw0KGgo=",
  "encodedTools": [{ "type": "function", "name": "inspect" }],
  "warnings": [{ "type": "unsupported", "feature": "provider-defined tool openai.web_search" }]
}
```

This deliberately tests encoding and unsupported-tool warning behavior, not valid image decoding, vision accuracy, or remote capability. The image payload is only a small fixture header. An initial fixture used an incorrect v4 file-data discriminant (`inline`); reading the installed converter corrected it to `data` before the result above. It is not evidence of a production failure.

To reproduce from `packages/core`, run the following with `node --input-type=module` (all requests are intercepted; the base URL is intentionally invalid):

```js
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
let body;
const provider = createOpenAICompatible({
  name: "research-fixture", baseURL: "https://fixture.invalid/v1", apiKey: "fixture-key",
  fetch: async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
const model = provider.languageModel("unknown-model-id");
const result = await model.doGenerate({
  prompt: [{ role: "user", content: [
    { type: "text", text: "Describe image and call inspect." },
    { type: "file", mediaType: "image/png", data: { type: "data", data: "iVBORw0KGgo=" } },
  ] }],
  maxOutputTokens: 8,
  tools: [
    { type: "function", name: "inspect", inputSchema: {
      type: "object", properties: {}, required: [], additionalProperties: false,
    } },
    { type: "provider", id: "openai.web_search", name: "web_search", args: {} },
  ],
});
console.log({ specificationVersion: model.specificationVersion,
  supportedUrls: await model.supportedUrls, body, warnings: result.warnings });
```

Public metadata checks, separate from generation: GET `https://models.dev/api.json` (200; 235 provider groups), GET `https://models.dev/catalog.json` (200; root `providers` and `models`), GET `https://ai-gateway.vercel.sh/v1/models` (200; 498 entries). Only structural/sanitized projections were printed; no credential or user content was supplied. These counts are dated observations, not coverage guarantees.

Suggested later acceptance: exact known match; unidentified model/proxy; explicit false; absent field; stale/unavailable catalog; model/URL change while lookup is pending; secret masking; adapter-native-search unsupported; and actual native-image/function-tool wire shapes. A real endpoint image/tool/search test is a separate observation and should not be presented as automated metadata truth.

### External references (fetched/read 2026-11-02)

- [Official OpenAI Docs — list models](https://developers.openai.com/api/reference/resources/models/methods/list): basic model object fields, no capabilities.
- [Official OpenAI Docs — web search](https://developers.openai.com/api/docs/guides/tools-web-search): explicit Responses `web_search` and specific Chat Completions integration; tool calls incur costs. No generation call was made here.
- [AI SDK custom providers](https://ai-sdk.dev/providers/community-providers/custom-providers): interface and native URL handling semantics, confirmed against installed provider 4.0.31.
- [AI SDK provider management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management): registry/custom provider constructs and aliases; not universal endpoint discovery.
- [AI SDK Gateway](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway): documented discovery and Gateway-specific feature routing, checked against installed Gateway 4.0.121. Documentation routing filters are not the same as fields returned by installed `getAvailableModels()`.
- [Vercel Models and Providers](https://vercel.com/docs/ai-gateway/models-and-providers): public no-auth REST model listing and provider-specific endpoint metadata.
- [AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai): `openai.tools.webSearch` via Responses; native provider package is not selected in current Taki.
- [AI SDK Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google) and [Anthropic provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic): provider-specific search/grounding APIs; not installed or executed here.
- [models.dev](https://models.dev), [API](https://models.dev/api.json), and [maintained source README](https://github.com/anomalyco/models.dev/blob/dev/README.md): community-contributed metadata, generated v1 API and current v2 data model/provider overrides. README was fetched from the corresponding raw GitHub URL. No external code was copied.

### Related specs and decisions

- `.trellis/spec/backend/index.md`: read current external-library interfaces, Shared owns protocol, English engineering artifacts.
- `.trellis/spec/backend/config-store.md`: Core-owned sparse config, env precedence, masked secrets, truthful restart/live application.
- `.trellis/spec/backend/agent-runtime.md`: actual model inputs/tool-loop semantics and truthful capability descriptions; full tool turns remain required.
- `.trellis/spec/frontend/index.md`: disposable UI client, Core authority, actual state/feedback.
- `docs/adr/0003-ai-sdk-6-agent-engine.md`: AI SDK remains selected engine; July amendment selects SDK 7; Pi runtime coupling was rejected.
- `docs/TECH-STACK.md:11`: compatible provider with owner-supplied endpoint is the primary path. Native provider support is not currently wired merely because docs describe it as available.
- `.trellis/tasks/11-02-context-attribution-token-efficiency/prd.md`: maintainability, honest unknowns and request/model scope; no false precision or new framework without evidence.
- `.trellis/tasks/11-02-native-multimodal-model-capabilities/prd.md`: newly created owner-directed all-image/MAIN and configuration simplification goal; detailed requirements are still being written by the parent.

## Caveats / Not Found

- No universal machine-readable endpoint capability schema was found in the installed AI SDK compatible interface or official OpenAI `/models` object. Some providers supply richer metadata; use their documented schema only for the identified service.
- No production model discovery/list/test operator API was found in current Core/Shared/Home settings. Existing tests verify parsing, construction and config semantics; they are not endpoint acceptance evidence.
- There is no general provider-native web-search flag in the checked models.dev v1 reference or Pi `Model` projection. This is distinct from ordinary function calling/application search availability.
- Catalog metadata can be stale, incomplete, filtered or wrong, and relays/deployments can differ. A missing model is not proof of unsupported features. Catalog context is not automatically the effective Taki window.
- No current owner's credentials/configured endpoint, MCP search service, paid generation, real vision response, tool execution, or native search response was inspected/probed. No manual acceptance is claimed.
- Exa's shared free MCP allowance exhausted after successful OpenAI documentation fetches. Source verification continued through Context7, Tavily extraction and public Node fetches; no account setup or paid research service was requested.
- The child process had no session task binding and the legacy global pointer was stale; the parent explicitly confirmed its session binding and assigned this exact output file. No pointer or task status was changed by this researcher.
- Memory supplied only process/boundary reminders; capability conclusions above come from current repository/package source, public metadata and official documentation.
