# Research: OpenClaw web search, fetch, citation, provider, credential, and SSRF design

- Query: What does OpenClaw actually implement for web search quality, provider selection, result shaping and caching, URL fetching/extraction, crawling, citations, credentials, model exposure, and SSRF/private-network safety?
- Scope: mixed (local TakiAgent evidence plus official OpenClaw source/docs and first-party issue evidence)
- Date: 2026-08-07
- Version boundary: OpenClaw `v2026.4.9` (`0512059dd4e6d2e582393828b837c376ddc4719c`). `main`-branch snippets were not used as release facts.

## Findings

### 1. Architectural conclusion

**OpenClaw does not build a search engine, index, relevance model, or crawler.** It builds a host-owned Web tool layer around professional or self-hosted providers:

```text
model
  -> one stable web_search tool
  -> provider registry + explicit/automatic selection
  -> provider-owned schema, request adapter, API, and result projection
  -> host-owned cache, untrusted-content wrapping, tool policy, and credentials

model
  -> separate web_fetch tool for an arbitrary URL
  -> strict guarded HTTP GET + per-hop DNS validation/pinning
  -> local Readability extraction
  -> optional provider fallback (currently Firecrawl)
  -> bounded, wrapped result
```

Search quality remains a provider responsibility. OpenClaw owns orchestration, portability, safety, configuration, and model-facing ergonomics. Its own code does not re-rank results across providers, merge multiple indexes, crawl discovered links, or validate that a provider-generated answer is entailed by its citations.

This is source-confirmed, not reputation-based: `src/agents/tools/web-search.ts:13-49` delegates description, parameters, and execution to a resolved provider; `src/web-search/runtime.ts:118-175,299-342` chooses and invokes one provider; representative adapters call Brave, Gemini, or Exa APIs directly. The official provider table describes 12 different external/self-hosted backends with materially different result styles [OC-DOC-WEB].

### 2. Files found

#### Local evidence

| File | Relevance |
|---|---|
| `docs/deferred-decisions.md:88` | D60: temporary Tavily Remote MCP decision, payload/description/credential/safety concerns, and explicit requirement to re-evaluate rather than assume a native tool. |
| `.trellis/tasks/08-07-web-search-decision-review/prd.md:5-63` | Review scope and acceptance criteria; implementation is out of scope. |
| `.trellis/spec/backend/tool-design.md:168-170` | TakiAgent rule to return high-signal semantic fields rather than low-level provider payloads. |
| `.trellis/spec/backend/config-store.md:4-5,97-98` | Current TakiAgent config store is not a secret store; durable target remains an OS credential backend. |
| `.trellis/spec/guides/source-grounding-guide.md:31-42` | External behavior must be source-backed and researched through approved MCP tools. |
| `.trellis/tasks/archive/2026-07/07-20-tool-design-standards/research/ra-tool-design-templates.md:27-30,220` | Prior OpenClaw evidence covers generic tool naming/adaptation only; it explicitly says no local OpenClaw clone was inspected. It does not establish Web behavior. |

Exact `rg` searches over `.trellis/` and `docs/` found no earlier source-backed OpenClaw Web implementation study. There is no local `references/openclaw-*` checkout, so all OpenClaw implementation facts below are pinned to first-party `v2026.4.9` URLs.

#### OpenClaw source modules

| File | One-line description |
|---|---|
| `src/agents/tools/web-search.ts:13-49` | Converts the selected provider definition into the stable `web_search` agent tool and annotates output with provider id. |
| `src/web-search/runtime.ts:118-342` | Provider discovery, credential-aware auto-selection, explicit-selection semantics, fallback ordering, and execution. |
| `src/plugins/web-search-providers.runtime.ts` | Loads provider registrations from bundled/runtime plugins. |
| `src/plugins/web-search-providers.shared.ts` | Sorts providers, including `autoDetectOrder`. |
| `src/web/provider-runtime-shared.ts:49-141` | Shared provider credential presence and definition resolution. |
| `src/agents/tools/web-search-provider-common.ts:34-58,274-290` | Shared count bounds, in-memory cache, credential normalization, TTL, and cache helpers. |
| `extensions/brave/src/brave-web-search-provider.ts` | Brave registration, credential paths, model-facing description, and lazy runtime adapter. |
| `extensions/google/src/gemini-web-search-provider.ts:81-269` | Google-grounded answer generation and structured citation extraction/redirect resolution. |
| `extensions/exa/src/exa-web-search-provider.ts:333-625` | Exa request shaping and projection of provider results into title/URL/description/published/site name. |
| `src/agents/tools/web-fetch.ts:53-622` | `web_fetch` schema, caching, HTTP/extraction pipeline, provider fallback, output bounding, and untrusted-content wrapping. |
| `src/web-fetch/runtime.ts:97-177` | Separate web-fetch provider selection; currently used for the Firecrawl fallback. |
| `src/agents/tools/web-guarded-fetch.ts:10-85` | Strict arbitrary-URL mode versus trusted fixed-provider-endpoint mode. |
| `src/infra/net/fetch-guard.ts:267-397` | Scheme validation, per-hop manual redirects, DNS pinning, redirect loop/cap checks, and cross-origin header/method safety. |
| `src/infra/net/ssrf.ts:47-437` | Blocked hostnames, literal/DNS-result checks, hostname policy, and pinned dispatcher creation. |
| `src/shared/net/ip.ts:9-313` | IPv4/IPv6 special-use classification and embedded-IPv4 detection. |
| `src/agents/tool-catalog.ts:105-120,316-331` | Places `web_search` and `web_fetch` in the Web section and coding/full policy surfaces. |
| `src/agents/openclaw-tools.ts:181-186,284` | Instantiates both tools and includes whichever definitions are enabled in the model tool set. |

### 3. Search provider abstraction and selection

#### Source-confirmed behavior

1. **The stable model API is `web_search`, but the provider owns its description, parameter schema, and result object.** `createWebSearchTool()` uses `resolved.definition.description`, `.parameters`, and `.execute` (`src/agents/tools/web-search.ts:13-49`). This is a provider registry, not a single normalized SERP contract.

2. **Providers are plugins.** Runtime resolution loads `PluginWebSearchProviderEntry` registrations and sorts them by plugin metadata. Representative registration fields are `id`, `label`, `envVars`, `credentialPath`, `autoDetectOrder`, credential getters/setters, and `createTool`.

3. **Explicit selection wins.** Resolution considers, in order, an invocation-level provider id, runtime selected/configured provider, then auto-detection (`src/web-search/runtime.ts:180-265`). An unknown invocation-level provider errors.

4. **Auto-detection is credential-aware.** It takes the first sorted credential-requiring provider with a configured credential; if none is ready, it uses the first keyless provider (`src/web-search/runtime.ts:118-175`). Official order is Brave, MiniMax, Gemini, Grok, Kimi, Perplexity, Firecrawl, Exa, Tavily, then keyless DuckDuckGo/Ollama/SearXNG [OC-DOC-WEB].

5. **Fallback differs between automatic and explicit choice.** `runWebSearch()` iterates candidates and may try the next provider when selection was automatic. If the operator explicitly selected a valid provider, provider unavailability/error is surfaced instead of silently changing engines (`src/web-search/runtime.ts:267-342`).

6. **Provider-specific controls remain provider-specific.** The generic surface exposes common query/count and selected filters, while Exa, Brave, Perplexity, Tavily, Firecrawl, and grounded-answer providers have distinct capabilities. OpenClaw exposes dedicated plugin tools such as `tavily_search`, `tavily_extract`, `firecrawl_search`, and `firecrawl_scrape` when their richer controls do not fit `web_search` [OC-DOC-WEB][OC-DOC-TAVILY][OC-DOC-FIRECRAWL].

#### What OpenClaw does and does not add to search quality

| Concern | OpenClaw owns | Provider owns |
|---|---|---|
| Stable tool name and policy | Yes | No |
| Provider choice/fallback | Yes | Supplies availability metadata |
| Query/count/filter validation | Shared basics plus provider schema | Provider-specific controls |
| Indexing and retrieval | No implementation found | Yes |
| Ranking/relevance | No cross-provider ranking found | Yes |
| Neural/keyword/deep search | No implementation found | Exa/Tavily/etc. |
| Grounded answer synthesis | No generic synthesis found | Gemini/Grok/Kimi and some Perplexity modes |
| Result projection/wrapping | Yes, inside each adapter | Supplies raw result payload |
| Cache | Yes, process-local payload cache | Some providers also cache independently |

### 4. Result shaping, truncation, and caching

#### Search results

- There is **no universal result schema**. Structured adapters commonly project to `title`, `url`, `description`, and optional `published`/`siteName`. For example, Exa chooses description from highlights, then summary, then text, and wraps provider text as untrusted external content (`extensions/exa/src/exa-web-search-provider.ts:561-589`).
- Grounded-answer adapters return a different shape. Gemini returns `{query, provider, model, tookMs, externalContent, content, citations}` (`extensions/google/src/gemini-web-search-provider.ts:226-243`).
- Common search count defaults to 5 and clamps to 1-10 (`src/agents/tools/web-search-provider-common.ts:31-47`), but providers can intentionally define different limits; Exa permits up to 100 and Tavily up to 20. Therefore the provider schema, not a global projector, is authoritative.
- Search response text is marked/wrapped as untrusted Web content. This is prompt-injection containment metadata, not HTML sanitization or factual verification.
- **No universal character/token cap for all `web_search` payloads was found.** Count limits and provider-specific extraction budgets constrain many adapters, but the common cache/projection layer does not apply one final global max-character truncation pass. This is an explicit gap relevant to D60's payload-size concern.

#### Search cache

- `SEARCH_CACHE` is an in-process `Map` (`src/agents/tools/web-search-provider-common.ts:34`). Each adapter builds a normalized cache key from provider id plus all parameters that change semantics, reads a cached payload with `cached: true`, and writes with the configured TTL (`:274-290`).
- Default TTL is 15 minutes per official docs; it is configurable through `tools.web.search.cacheTtlMinutes` [OC-DOC-WEB].
- No disk-persistent or distributed Web search cache was found. A Gateway restart loses this map. This statement is based on the inspected cache definition and write helpers; repository-wide runtime verification was not possible without a checkout.

#### Fetch result bounding

- `web_fetch` has a stronger global projection contract: default output cap 50,000 characters, default response-body cap 2,000,000 bytes, configurable body cap clamped to 32,000-10,000,000 bytes, and default redirect cap 3 (`src/agents/tools/web-fetch.ts:41-53,80-116`).
- The model-supplied `maxChars` is clamped to the operator's `maxCharsCap`. The wrapper overhead itself counts against the cap (`src/agents/tools/web-fetch.ts:173-229`).
- Output includes raw chainable `url`/`finalUrl`, status and content type, wrapped title/text/warning, extractor identity, truncation/length metadata, fetch time, and duration (`src/agents/tools/web-fetch.ts:276-335,515-539`).
- Fetch cache key is URL + extraction mode + effective character cap; it is also an in-process map with default 15-minute TTL (`src/agents/tools/web-fetch.ts:53,362-371,540-541`).

### 5. Citations

#### Source-confirmed

- Citation behavior is **provider-dependent**, not a single OpenClaw citation engine. Structured SERP providers return result URLs; grounded-answer providers return synthesized `content` plus a `citations` array [OC-DOC-WEB].
- Gemini extracts Web grounding chunks from the provider response, maps each to `{url,title}`, resolves provider redirect URLs in batches of ten, then returns the structured list (`extensions/google/src/gemini-web-search-provider.ts:81-157,226-243`).
- OpenClaw keeps citation URLs separate from wrapped untrusted prose so the model can cite or follow them.

#### Not found

- No common citation numbering/footnote renderer was found in the Web tool layer.
- No source-to-sentence entailment validation, quote verification, citation deduplication policy, or mandatory citation-use rule was found.
- No evidence was found that OpenClaw rewrites the final assistant answer to guarantee citations. The provider result is simply returned to the agent loop.
- `web_fetch` returns the fetched/final URL and content metadata, but does not manufacture a formal citation object or archival snapshot.

### 6. URL fetching and extraction

`web_fetch` is deliberately separate from search and browser automation.

#### Local path

1. Accept only `http:` or `https:` and build a cache key (`src/agents/tools/web-fetch.ts:362-380`).
2. Run a guarded GET with a Chrome-like user agent, `Accept-Language`, response byte limit, timeout, and redirect limit (`:386-410`). JavaScript is not executed [OC-DOC-FETCH].
3. If the response is Markdown, preserve it (or convert to text). If HTML, run Readability. If Readability returns no content, try the configured fetch provider, then basic HTML cleanup. JSON is pretty-printed; other content stays raw (`:451-507`).
4. On network failure or non-2xx response, the configured provider fallback may run. **An `SsrFBlockedError` is re-thrown and never converted into a provider fallback**, so the local security refusal is fail-closed (`:412-446`).
5. Wrap all externally controlled text and cache the bounded payload (`:509-545`).

#### Provider fallback

- Fetch-provider selection is independent of search-provider selection (`src/web-fetch/runtime.ts:97-177`).
- At this version the bundled fetch fallback is Firecrawl. The official extraction order is local Readability, Firecrawl if ready, then basic HTML cleanup [OC-DOC-FIRECRAWL].
- Firecrawl's configured base URL is restricted to the official HTTPS host in this release. Its hosted service supplies bot circumvention, JS-heavy extraction, and provider-side caching [OC-DOC-FETCH][OC-DOC-FIRECRAWL].

#### Browser and crawling boundary

- `web_fetch` is a single-URL lightweight GET/extractor. It does not execute JavaScript [OC-DOC-FETCH].
- OpenClaw directs JS-heavy/login flows to its separate `browser` tool [OC-DOC-WEB].
- Tavily exposes search plus multi-URL extraction; Firecrawl exposes search plus single-URL scrape. These are explicit provider plugin tools, not a Core crawler [OC-DOC-TAVILY][OC-DOC-FIRECRAWL].
- **No recursive crawl, sitemap/map tool, link frontier, crawl budget, robots policy, or site-level deduplication was found in the reviewed OpenClaw Web surface.** In particular, the official Tavily integration exposes `tavily_search` and `tavily_extract`, not Tavily's crawl/map/research APIs.

### 7. SSRF, private-network, metadata, redirects, and DNS rebinding

#### Arbitrary model-controlled URLs (`web_fetch`)

OpenClaw uses strict guarded fetching by default (`src/agents/tools/web-guarded-fetch.ts:37-52,78-85`):

- URL parsing permits only HTTP(S).
- Hostname pre-check blocks `localhost`, `localhost.localdomain`, `metadata.google.internal`, and `.localhost`, `.local`, `.internal` suffixes (`src/infra/net/ssrf.ts:47-65,164-187`).
- IP classification blocks IPv4 unspecified, broadcast, multicast, link-local, loopback, CGNAT, private, reserved, and RFC 2544 benchmarking space; IPv6 unspecified, loopback, link-local, ULA, multicast, reserved, benchmarking, discard, ORCHIDv2, and deprecated site-local ranges (`src/shared/net/ip.ts:9-37,252-280`). Thus cloud metadata IPs such as `169.254.169.254` are blocked through link-local classification even if their hostname is not enumerated.
- Malformed/legacy IPv4 literals and malformed IPv6 literals fail closed; embedded IPv4 is extracted from IPv4-mapped, RFC 6145, RFC 6052, NAT64 local-use, 6to4, Teredo, and ISATAP forms before classification (`src/infra/net/ssrf.ts:122-162`; `src/shared/net/ip.ts:288-313`).
- DNS is resolved with all answers; every answer is checked. A public hostname resolving to any blocked address is rejected (`src/infra/net/ssrf.ts:322-365`).
- The approved DNS answers are pinned into the Undici dispatcher lookup. The connection cannot perform a fresh attacker-controlled resolution after validation (`src/infra/net/ssrf.ts:202-248,412-437`). This is the key DNS-rebinding defense.

#### Redirect safety

- Fetch uses `redirect: "manual"`; every redirect target loops through URL parsing, DNS resolution, private/special-use checks, and a new pinned dispatcher (`src/infra/net/fetch-guard.ts:267-397`).
- Redirects are capped (default 3), loops are detected, and missing `Location` is an error (`:353-371`).
- On cross-origin redirects, unsafe request bodies/method replay is disabled by default and sensitive cross-origin headers are stripped (`:202-265,372-382`). `web_fetch` is GET-only, but the shared guard also protects provider/API callers.
- Therefore a public first hop cannot redirect to loopback, RFC1918, link-local metadata, or another blocked destination.

#### Trusted provider endpoints

OpenClaw makes an explicit threat-boundary distinction. Fixed/provider-configured API endpoints use `withTrustedWebToolsEndpoint`, which enables trusted environment proxy behavior and a policy permitting private/RFC2544 addresses (`src/agents/tools/web-guarded-fetch.ts:10-76`). This avoids applying arbitrary-URL restrictions to operator-selected service endpoints. It must not be reused for model-controlled fetch targets.

#### Escape hatches and operational caveat

- The generic SSRF policy supports `allowPrivateNetwork` / `dangerouslyAllowPrivateNetwork`, exact `allowedHostnames`, a hostname allowlist, and an RFC2544 exception (`src/infra/net/ssrf.ts:39-45`).
- In `v2026.4.9`, no `tools.web.fetch.ssrfPolicy` is threaded from `web_fetch` config into its strict fetch call. The model-controlled tool therefore has no documented private-network opt-in. First-party issues #25322, #29669, #39604, and #49444 report the resulting incompatibility with Clash/Surge fake-IP DNS and request a scoped escape hatch. These are **issue reports**, not stronger authority than the inspected release source.
- The trusted environment-proxy mode changes the DNS-pinning threat model when a proxy is actually configured. The release source uses it for trusted API endpoints, not arbitrary `web_fetch` URLs.

### 8. Credential design

#### Web provider credentials

- Provider registrations declare accepted environment variables and config paths. Examples: Brave uses `BRAVE_API_KEY` / `plugins.entries.brave.config.webSearch.apiKey`; Gemini uses `GEMINI_API_KEY` / `plugins.entries.google.config.webSearch.apiKey`; Exa uses `EXA_API_KEY` / `plugins.entries.exa.config.webSearch.apiKey`.
- Credentials can be plaintext config values, process/dotenv values, or structured `SecretRef` objects. SecretRef providers support `env`, guarded local `file`, and guarded absolute-command `exec` resolution [OC-DOC-SECRETS].
- `hasWebProviderEntryCredential()` treats a configured non-env SecretRef as present without resolving every candidate (`src/web/provider-runtime-shared.ts:49-89`). Official docs state that auto-detection resolves only the selected provider key, leaving non-selected SecretRefs inactive [OC-DOC-WEB].
- Missing selected credentials return a structured provider-specific error. An unresolved selected Firecrawl fetch SecretRef fails Gateway startup rather than silently downgrading [OC-DOC-FETCH].
- Environment keys may come from the Gateway process or `~/.openclaw/.env`; provider-scoped SecretRefs are preferred when process-wide values are undesirable [OC-DOC-SECRETS].

#### Security properties and limitations

- File SecretRefs have size/time/ownership/permission checks. Exec SecretRefs require an absolute regular non-symlink executable, bounded time/output, restricted environment passing, optional trusted directories, and explicit CLI consent for audit/apply. Windows ACL verification fails closed [OC-DOC-SECRETS].
- OpenClaw supports secret migration/audit/reload tooling and avoids resolving inactive provider refs.
- **No general OS Keychain/Credential Manager backend was found for Web API keys.** OpenClaw can reference env/file/exec resolvers (including third-party secret managers through exec/plugins), but its Web setup docs also permit plaintext `openclaw.json` or `~/.openclaw/.env`. This does not satisfy TakiAgent's existing OS-credential-backend target by itself.

### 9. How tools reach the model

- `createOpenClawTools()` constructs `web_search` and `web_fetch` with runtime-resolved provider metadata, then includes non-null definitions in the agent tool list (`src/agents/openclaw-tools.ts:181-186,284`).
- `web_search` and `web_fetch` appear in the Core Web catalog and `group:web`; both are in the `coding` profile, while `full` has no restrictive allowlist (`src/agents/tool-catalog.ts:105-120,316-331`). Operators can allow/deny individual tools or the Web group [OC-DOC-WEB].
- `web_search` uses the selected provider's description and schema. `web_fetch` has one Core-owned description: lightweight URL access without browser automation (`src/agents/tools/web-fetch.ts:565-622`).
- Tool results are returned through the ordinary agent tool-result path as JSON. No special post-tool citation renderer was found.

### 10. Evidence classification

#### Verified from release source

- Provider registry, credential-aware selection, explicit-selection no-fallback, automatic fallback.
- Provider-owned schemas and heterogeneous result shapes.
- Process-local cache implementation and key construction.
- Gemini structured citations and redirect resolution.
- Local fetch/extraction/fallback ordering and bounded output.
- Strict SSRF checks, DNS-answer validation, DNS pinning, redirect revalidation, header stripping.
- Model tool construction and tool-profile exposure.

#### Verified from official release docs

- Provider inventory/order and declared capabilities.
- Default 15-minute cache TTL and Web tool configuration surface.
- Firecrawl/Tavily explicit tool surfaces.
- SecretRef env/file/exec behavior and operational controls.
- `web_fetch` is non-JS lightweight extraction; browser is separate.

#### First-party issue evidence only

- Fake-IP/corporate-proxy operational failures and requests for a `web_fetch` SSRF policy escape hatch: openclaw/openclaw issues #25322, #29669, #39604, #49444. These corroborate the strict-path tradeoff but are not used to override release source.

#### Inference for TakiAgent's decision

- OpenClaw is evidence that a host-owned wrapper can add portability, policy, payload projection, credential routing, and SSRF safety **without improving the underlying search index**.
- OpenClaw is not evidence that TakiAgent should recreate multi-provider adapters. OpenClaw's breadth is a large plugin ecosystem; TakiAgent could capture the valuable boundary with a much thinner policy/projection layer over one professional provider.
- Search and arbitrary URL fetch should remain distinct decisions. Search-provider API calls target operator-selected endpoints; `web_fetch` accepts attacker/model-controlled URLs and carries the materially harder SSRF/redirect/DNS-pinning burden.
- Direct Tavily MCP already supplies search/extraction quality. The remaining host-owned value is primarily tool description/policy, bounded projection, credential integration, observability, and URL safety, not retrieval quality.

### 11. External references

All source links are first-party and pinned to `v2026.4.9` unless marked as issue evidence.

| Key | Reference |
|---|---|
| OC-DOC-WEB | https://github.com/openclaw/openclaw/blob/v2026.4.9/docs/tools/web.md |
| OC-DOC-FETCH | https://github.com/openclaw/openclaw/blob/v2026.4.9/docs/tools/web-fetch.md |
| OC-DOC-TAVILY | https://github.com/openclaw/openclaw/blob/v2026.4.9/docs/tools/tavily.md |
| OC-DOC-FIRECRAWL | https://github.com/openclaw/openclaw/blob/v2026.4.9/docs/tools/firecrawl.md |
| OC-DOC-SECRETS | https://github.com/openclaw/openclaw/blob/v2026.4.9/docs/gateway/secrets.md |
| OC-SRC-SEARCH-TOOL | https://github.com/openclaw/openclaw/blob/v2026.4.9/src/agents/tools/web-search.ts#L13 |
| OC-SRC-SEARCH-RUNTIME | https://github.com/openclaw/openclaw/blob/v2026.4.9/src/web-search/runtime.ts#L118 |
| OC-SRC-SEARCH-COMMON | https://github.com/openclaw/openclaw/blob/v2026.4.9/src/agents/tools/web-search-provider-common.ts#L34 |
| OC-SRC-GEMINI | https://github.com/openclaw/openclaw/blob/v2026.4.9/extensions/google/src/gemini-web-search-provider.ts#L81 |
| OC-SRC-EXA | https://github.com/openclaw/openclaw/blob/v2026.4.9/extensions/exa/src/exa-web-search-provider.ts#L333 |
| OC-SRC-FETCH | https://github.com/openclaw/openclaw/blob/v2026.4.9/src/agents/tools/web-fetch.ts#L53 |
| OC-SRC-FETCH-RUNTIME | https://github.com/openclaw/openclaw/blob/v2026.4.9/src/web-fetch/runtime.ts#L97 |
| OC-SRC-FETCH-GUARD | https://github.com/openclaw/openclaw/blob/v2026.4.9/src/infra/net/fetch-guard.ts#L267 |
| OC-SRC-SSRF | https://github.com/openclaw/openclaw/blob/v2026.4.9/src/infra/net/ssrf.ts#L47 |
| OC-SRC-IP | https://github.com/openclaw/openclaw/blob/v2026.4.9/src/shared/net/ip.ts#L9 |
| OC-ISSUE-FAKEIP | https://github.com/openclaw/openclaw/issues/29669 |

## Caveats / Not Found

- No local OpenClaw checkout exists, so source was inspected through Context7, Exa, and Tavily against first-party tag URLs. Exact local compilation/tests were impossible and were not claimed.
- OpenClaw changes quickly. This report is about `v2026.4.9`; later `main` behavior may differ.
- The complete implementation of every provider adapter was not transcribed. Brave, Gemini, and Exa were inspected as representative structured, grounded-answer, and extraction-rich adapters; official docs establish the broader provider inventory.
- No live paid-provider calls were made. Search quality, latency, cost, and provider result fidelity were not benchmarked.
- No Core recursive crawling or mapping subsystem was found.
- No universal Web search output character/token cap was found.
- No provider-independent citation-verification or citation-rendering layer was found.
- No persistent/shared Web result cache was found.
- No general OS-native credential store for Web API keys was found.
- No documented arbitrary-URL private-network opt-in was found for `web_fetch` in this release; issue reports show demand but do not constitute implemented behavior.
