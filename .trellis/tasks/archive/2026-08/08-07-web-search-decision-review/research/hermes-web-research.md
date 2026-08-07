# Research: Hermes web capabilities

- Query: What does the local Hermes reference actually own for web search, extraction, crawl, citations, browser automation, URL safety, credentials, retries, and result handling, and which parts are delegated to external providers?
- Scope: internal
- Date: 2026-08-07

## Findings

### Executive conclusion

Hermes is not a search engine and does not build or maintain a web index. Its main contribution is a host-owned provider registry and normalized `web_search` / `web_extract` tool surface around professional APIs, self-hostable metasearch, or provider-side model search. Search relevance, freshness, indexing, and most retrieval quality remain provider responsibilities.

Hermes does own meaningful integration behavior: capability-aware provider selection, a stable result projection, bounded extraction output, credential lookup, URL and website-policy checks for extraction/browser navigation, prompt-injection marking, browser-session orchestration, and some provider-specific timeout/retry handling. Those controls can justify a thin host layer, but they do not improve the underlying search corpus or ranking by themselves.

The local implementation does **not** contain a general crawl tool, a general citation engine, a native web index, or a provider-independent arbitrary-URL HTTP fetcher. Browser automation is a separate subsystem delegated to `agent-browser`, Chromium/Camofox/CDP, or cloud browser-session services.

### Capability ownership map

| Capability | Hermes-owned behavior | Delegated behavior | Evidence status |
| --- | --- | --- | --- |
| Search indexing and ranking | Provider choice, input normalization, limit clamping, common output shape | Corpus, freshness, ranking, semantic retrieval, provider-side answers | Confirmed |
| Search providers | Registry, config precedence, capability filtering, dispatch | Tavily, Exa, Parallel, Firecrawl, Brave, SearXNG, DDGS, xAI | Confirmed |
| URL extraction | Up to five URLs, preflight safety, ordering, output projection, truncation/cache | Page retrieval and primary extraction | Confirmed |
| Crawl | No callable `web_crawl` tool or provider ABC method | Some upstream services may offer crawl products | Confirmed absent in Hermes surface |
| Citations | Source URLs survive normalized rows; xAI citation annotations can seed rows | Provider/source attribution | Partial only; no general citation engine |
| Browser automation | Tool schemas, routing, policy guards, subprocess/session lifecycle | Browser execution and page rendering | Confirmed |
| URL safety | Scheme/DNS/address checks, metadata endpoint floor, policy checks on extraction/navigation | Remote provider network behavior | Confirmed with redirect gaps noted below |
| Prompt-injection handling | Marks high-risk tool outputs as untrusted and scans for suspicious patterns | Model obedience to the trust boundary | Confirmed; advisory rather than content blocking |
| Credentials | Config-aware environment lookup, hardened `.env` write path, subprocess allow-listing | Provider-side secret storage/use after transmission | Confirmed |
| Retries/timeouts | Several explicit local timeouts and a few provider-specific retries | SDK defaults where Hermes does not configure them | Mixed and provider-specific |

### Search provider architecture

The normalized result contract is `WebSearchResult`, with `title`, `url`, `description`, and `position`; provider implementations conform to `WebSearchProvider` (`references/hermes-agent-main/agent/web_search_provider.py:22`, `:89`). The abstract surface exposes search and optional extraction, not crawl (`references/hermes-agent-main/agent/web_search_provider.py:125`, `:142`, `:153`).

Backend selection is capability-aware. Hermes reads per-capability choices (`web.search_backend`, `web.extract_backend`) before the shared `web.backend`, then resolves registered providers according to availability, preference, and the requested capability (`references/hermes-agent-main/agent/web_search_registry.py:116`, `:133`, `:281`). `tools/web_tools.py` is the host wrapper that dispatches search and extraction (`references/hermes-agent-main/tools/web_tools.py:619`).

| Provider | Search implementation | Extraction | Hermes-specific notes |
| --- | --- | --- | --- |
| Tavily | Direct `httpx` call to `/search` | Direct `/extract` call | 60-second client timeout; API key sent in request body (`plugins/web/tavily/provider.py:35`, `:64`, `:153`, `:178`) |
| Exa | Official `exa-py` SDK, semantic search with highlights | `get_contents` | SDK client and normalization at `plugins/web/exa/provider.py:41`, `:115`, `:157` |
| Parallel | Official SDK; `fast`, `one-shot`, and `agentic` modes | Async full-content retrieval | Modes/search/extraction at `plugins/web/parallel/provider.py:139`, `:170`, `:218` |
| Firecrawl | Official SDK; direct endpoint, self-hosted endpoint, or Nous gateway | Per-URL extraction | Client/config at `plugins/web/firecrawl/provider.py:123`, `:212`; search/extract at `:391`, `:423` |
| Brave | Direct Brave Search API | No | 15-second timeout (`plugins/web/brave_free/provider.py:30`, `:62`) |
| SearXNG | JSON API with score ordering | No | 15-second timeout (`plugins/web/searxng/provider.py:34`, `:68`) |
| DDGS | `ddgs` package | No | 10-second request timeout plus 30-second thread wall clock (`plugins/web/ddgs/provider.py:23`, `:31`, `:94`) |
| xAI | Grok Responses API with server-side `web_search` | No independent raw-page extractor | Model-generated response is converted to rows; 90-second default and one OAuth-refresh retry on 401 (`plugins/web/xai/provider.py:1`, `:96`, `:148`, `:188`, `:242`) |

This is an adapter architecture, not a provider-quality implementation. Switching providers can change search quality materially, while changing Hermes projection/policy generally cannot.

### Hermes-owned search and extraction projection

`web_search` clamps the requested result count to 1-100 and returns the normalized four-field rows (`references/hermes-agent-main/tools/web_tools.py:619`, `:653`). The wrapper does not expose each provider's complete native payload, so it gains portability and prompt-size predictability at the cost of provider-specific metadata.

`web_extract` accepts at most five URLs at the tool-schema/registration boundary (`references/hermes-agent-main/tools/web_tools.py:1192`, `:1224`). Current extraction processing:

- uses a default 15,000-character response budget (`references/hermes-agent-main/tools/web_tools.py:417`);
- stores full extracted text in its cache up to a 2,000,000-character ceiling (`references/hermes-agent-main/tools/web_tools.py:424`, `:480`);
- applies deterministic 75/25 head-tail truncation and emits a paging footer (`references/hermes-agent-main/tools/web_tools.py:516`);
- replaces inline base64 images with placeholders (`references/hermes-agent-main/tools/web_tools.py:450`);
- projects final items to URL, title, content, and error (`references/hermes-agent-main/tools/web_tools.py:1006`);
- explicitly performs no auxiliary-LLM summarization (`references/hermes-agent-main/tools/web_tools.py:743`, `:751`).

The user guide is stale here: it still describes auxiliary-model summaries and older 5,000-character behavior (`references/hermes-agent-main/website/docs/user-guide/features/web-search.md:40`). Runtime code should be treated as authoritative.

### Crawl is not implemented as a Hermes tool

Only `web_search` and `web_extract` are registered in the web tool module (`references/hermes-agent-main/tools/web_tools.py:1170`, `:1192`, `:1214`). The provider ABC has no crawl operation, and repository search found no `web_crawl` registration or provider `.crawl()` dispatch.

Several descriptive files overstate this capability: `references/hermes-agent-main/plugins/web/tavily/plugin.yaml:3`, `references/hermes-agent-main/plugins/browser/firecrawl/provider.py:8`, and `references/hermes-agent-main/website/docs/developer-guide/web-search-provider-plugin.md:9`, `:29`, `:46`, `:229`, `:242`. These claims describe upstream products or an outdated/planned abstraction, not the current callable Hermes surface.

### Browser automation is separate from search/extraction

The browser subsystem owns orchestration but delegates execution (`references/hermes-agent-main/tools/browser_tool.py:5`). Local mode uses `agent-browser` with Chromium; optional modes include Camofox, a user-supplied CDP endpoint, and cloud sessions created by Browser Use, Browserbase, or explicitly selected Firecrawl.

Browser tools operate primarily through accessibility-tree snapshots and reference-based actions; their schemas are assembled at `references/hermes-agent-main/tools/browser_tool.py:1828`. Cloud providers only create/close sessions and return connection metadata rather than implementing the action vocabulary themselves (`references/hermes-agent-main/agent/browser_provider.py:49`, `:90`; registry at `references/hermes-agent-main/agent/browser_registry.py:102`, `:113`).

Execution invokes `agent-browser --json`, using CDP for cloud sessions or a named local session (`references/hermes-agent-main/tools/browser_tool.py:2344`, `:2370`). Timed-out commands are terminated (`references/hermes-agent-main/tools/browser_tool.py:263`, `:2465`). Browserbase retries a 402 response by first removing keep-alive and then proxy features (`references/hermes-agent-main/plugins/browser/browserbase/provider.py:94`, `:142`). Browser Use supports direct and Nous gateway modes and preserves an idempotency key for retryable creation failures (`references/hermes-agent-main/plugins/browser/browser_use/provider.py:128`, `:188`). Firecrawl cloud browser uses `/v2/browser` (`references/hermes-agent-main/plugins/browser/firecrawl/provider.py:80`).

This subsystem is materially heavier than a search/fetch wrapper and should not be treated as required infrastructure for ordinary search.

### URL, SSRF, and website-policy controls

The shared URL checker rejects unsupported schemes, DNS failures, and private, loopback, link-local, reserved, multicast, unspecified, and CGNAT targets (`references/hermes-agent-main/tools/url_safety.py:258`, `:384`). Metadata endpoints and link-local addresses remain blocked even when private URL access is otherwise permitted (`references/hermes-agent-main/tools/url_safety.py:145`, `:153`, `:280`). The module explicitly acknowledges a DNS rebinding/time-of-check-to-time-of-use gap (`references/hermes-agent-main/tools/url_safety.py:15`).

For `web_extract`, the wrapper rejects token-like strings and credential-like query parameters, then preflights every URL with asynchronous DNS safety checks (`references/hermes-agent-main/tools/web_tools.py:776`, `:840`). It reconstructs provider responses in original input order and emits per-URL errors (`references/hermes-agent-main/tools/web_tools.py:946`). Firecrawl extraction additionally applies website policy before the request, a 60-second per-URL timeout, and safety/policy checks against the returned final URL (`references/hermes-agent-main/plugins/web/firecrawl/provider.py:463`, `:489`, `:529`, `:549`).

No equivalent post-redirect validation was found for Tavily, Exa, or Parallel extraction. Those services perform retrieval remotely, and their returned final URLs are not visibly rechecked by the common wrapper. This is a real boundary difference, not evidence that their upstream services are unsafe.

Browser navigation blocks credential-like URL query parameters for cloud readers, applies an unconditional metadata-address floor, gates private networks for non-local backends, and rechecks redirects with a blank-page escape on rejection (`references/hermes-agent-main/tools/browser_tool.py:2814`, `:2826`, `:2841`, `:2897`). Snapshot/evaluation actions also include private-page guards (`references/hermes-agent-main/tools/browser_tool.py:3029`). Local browser and private sidecar routes intentionally follow a different trust model and can bypass ordinary remote private-network blocking (`references/hermes-agent-main/tools/browser_tool.py:790`, `:1173`).

Website blocklist configuration and matching live in `references/hermes-agent-main/tools/website_policy.py:93`, `:131`, `:210`, `:233`. Malformed default configuration fails open (`:239`).

The security documentation says website policy and SSRF checks apply to `web_search` (`references/hermes-agent-main/website/docs/user-guide/security.md:597`, `:603`), but the current `web_search_tool` sends a text query to the chosen provider and does not run returned result URLs through `check_website_access` or URL safety. The checks apply when a URL is subsequently extracted or navigated. Search-result display itself is therefore a documented-versus-runtime discrepancy.

### Prompt-injection boundary

Tool results from web, browser, and MCP sources are classified as untrusted external data (`references/hermes-agent-main/agent/tool_dispatch_helpers.py:457`, `:503`). The wrapper neutralizes delimiter collisions, scans for suspicious instructions, and encloses content in an explicit trust-boundary wrapper (`references/hermes-agent-main/agent/tool_dispatch_helpers.py:534`, `:570`, `:583`). The general system prompt likewise tells the model that web/file/tool output remains untrusted (`references/hermes-agent-main/agent/prompt_builder.py:590`).

The risk scan is advisory metadata; it does not block or redact the extracted content. This is defense-in-depth for model prompting, not a sanitizer or a guarantee against prompt injection.

### Citation behavior

Ordinary provider rows preserve a source URL, but no general claim-to-source mapper, answer citation renderer, citation verifier, or enforced citation syntax was found in the web-search path. The generic grounding instruction requires evidence-backed answers but not a citation protocol (`references/hermes-agent-main/agent/prompt_builder.py:431`).

The xAI provider is a special case: it can derive result rows from `url_citation` annotations or top-level citations (`references/hermes-agent-main/plugins/web/xai/provider.py:364`). Those are then flattened into ordinary result URLs rather than retained as typed citation objects. Its JSON parsing only requires a non-empty URL string and does not itself apply scheme or URL-safety validation (`references/hermes-agent-main/plugins/web/xai/provider.py:343`, `:451`). Citation-specific code in `tools/x_search_tool.py` belongs to the separate X/Twitter tool and is not evidence of general web citation support.

### Credentials and process isolation

Web providers use a config-aware environment lookup (`references/hermes-agent-main/agent/web_search_provider.py:59`). Resolution checks the process environment before `~/.hermes/.env` (`references/hermes-agent-main/hermes_cli/config.py:8003`). The local `.env` is plaintext, but writes are atomic and permissions are hardened where the platform permits (`references/hermes-agent-main/hermes_cli/config.py:7788`, `:7843`, `:7865`). External secret-source integrations can inject secrets into the environment (`references/hermes-agent-main/hermes_cli/env_loader.py:305`).

The browser subprocess environment strips a broad set of credentials and adds back only the keys required by the selected browser backend (`references/hermes-agent-main/tools/browser_tool.py:74`, `:90`). xAI can use Hermes-managed OAuth or `XAI_API_KEY` (`references/hermes-agent-main/plugins/web/xai/provider.py:27`).

Hermes therefore improves secret scoping relative to passing the whole host environment to browser subprocesses, but it still supports a plaintext user-level `.env`; it is not a complete secret manager.

### Timeouts and retries

| Path | Explicit Hermes behavior | Gap |
| --- | --- | --- |
| Tavily | 60-second timeout | No retry loop found |
| Brave / SearXNG | 15-second timeout | No retry loop found |
| DDGS | 10-second request timeout and 30-second overall thread timeout | No provider fallback within one request |
| Firecrawl extract | 60 seconds per URL | Search SDK timeout/retry not explicitly configured |
| Exa / Parallel | Uses official SDKs | Timeout/retry policy not configured in inspected Hermes source |
| xAI | 90-second configurable timeout; one refresh-and-retry on OAuth 401 | No general transient-error retry |
| Browser provider session creation | 30-second creation; shorter cleanup timeouts | Provider-specific retry behavior only |
| `agent-browser` commands | Configurable 30-second default, navigation floors, timed-out subprocess termination | Not a web-provider retry framework |

There is no host-level retry/fallback framework shared across all web providers. Provider selection fallback and retrying an already-selected provider are distinct concerns and should not be conflated.

### Implications for TakiAgent's architecture decision

The Hermes evidence supports a narrow separation of responsibilities:

1. A professional provider should own crawling at Internet scale, indexing, freshness, ranking, relevance, extraction models, and provider-side research.
2. A host-owned layer can reasonably own stable tool schemas, provider selection, approval integration, credential references, URL/policy gates, output size limits, normalized errors, untrusted-content wrapping, and telemetry.
3. Browser automation is a separate capability with materially higher runtime, security, state, and maintenance cost; it is not a prerequisite for a thin search wrapper.
4. Citation generation/verification and crawl orchestration are not obtained merely by copying Hermes's web-provider abstraction.

Hermes is useful as an architectural reference for a thin adapter/policy layer, not as evidence that TakiAgent should build native search quality. Its Python plugin implementation is also a pattern reference rather than a directly reusable TypeScript/Node 24 library.

### Evidence classification

#### Completed evidence

- Provider contracts, registry/config precedence, and tool registration were read from current source.
- All listed provider implementations were inspected locally.
- Extraction projection/truncation/cache behavior was traced through the current wrapper.
- URL safety, website policy, credential handling, prompt-injection wrapping, and browser routing were inspected in source.
- Dependency versions and licenses were read from manifests and the repository license.
- Relevant unit/integration test families exist for providers, URL safety, extraction robustness, website policy, tool-dispatch wrapping, and browser hardening.

#### Gaps / not established

- No live calls were made, so provider relevance, freshness, latency, quotas, cost, and current service reliability were not benchmarked.
- Upstream SDK-internal retry behavior was not inferred where Hermes does not configure it.
- No claim is made that Hermes's policy controls are complete or formally verified.
- No exhaustive audit of all browser commands or all deployment modes was performed.

#### Inference

- A host wrapper can reduce provider coupling and centralize policy, but adds an integration surface that must track provider and schema changes.
- The deterministic extraction budget is likely intended to control context size and preserve both opening and ending material; the code establishes the mechanism, not its optimality.
- The absence of a shared citation model means downstream answer citation quality depends on prompting/model behavior or additional host logic.

#### Extra observations

- Several user/developer docs and plugin descriptions lag runtime behavior. Any reuse should be based on source plus tests, not descriptions alone.
- xAI's search path is structurally different from index-result APIs because an LLM with server-side search produces the response; normalized rows conceal that distinction.
- Search URL display and URL fetching have different risk surfaces. Hermes protects the latter more strongly than the former.

## Files Found

- `references/hermes-agent-main/agent/web_search_provider.py` - normalized search result and provider capability contract.
- `references/hermes-agent-main/agent/web_search_registry.py` - provider registration, configuration precedence, availability, and capability selection.
- `references/hermes-agent-main/tools/web_tools.py` - model-callable search/extract wrappers, limits, URL preflight, projection, cache, and truncation.
- `references/hermes-agent-main/plugins/web/*/provider.py` - concrete Tavily, Exa, Parallel, Firecrawl, Brave, SearXNG, DDGS, and xAI adapters.
- `references/hermes-agent-main/tools/url_safety.py` - SSRF-oriented URL and resolved-address validation.
- `references/hermes-agent-main/tools/website_policy.py` - hostname/URL policy parsing and matching.
- `references/hermes-agent-main/agent/tool_dispatch_helpers.py` - untrusted tool-output wrapping and advisory prompt-injection scan.
- `references/hermes-agent-main/agent/prompt_builder.py` - grounding and untrusted-data instructions supplied to the model.
- `references/hermes-agent-main/agent/browser_provider.py` - cloud browser lifecycle contract.
- `references/hermes-agent-main/agent/browser_registry.py` - browser backend discovery and selection.
- `references/hermes-agent-main/tools/browser_tool.py` - browser schemas, local/cloud routing, subprocess execution, and navigation guards.
- `references/hermes-agent-main/plugins/browser/browserbase/provider.py` - Browserbase session creation and feature-degrading retry.
- `references/hermes-agent-main/plugins/browser/browser_use/provider.py` - Browser Use / Nous session creation and idempotency handling.
- `references/hermes-agent-main/plugins/browser/firecrawl/provider.py` - Firecrawl cloud browser session lifecycle.
- `references/hermes-agent-main/hermes_cli/config.py` - `.env` lookup/write and permission handling.
- `references/hermes-agent-main/hermes_cli/env_loader.py` - external secret-source environment injection.
- `references/hermes-agent-main/tests/tools/test_url_safety.py` - URL safety behavior tests.
- `references/hermes-agent-main/tests/tools/test_web_extract_robustness.py` - extraction resilience and edge-case tests.
- `references/hermes-agent-main/tests/tools/test_website_policy.py` - website-policy tests.
- `references/hermes-agent-main/tests/tools/test_web_providers*.py` - concrete provider adapter tests.
- `references/hermes-agent-main/tests/agent/test_tool_dispatch_helpers.py` - untrusted-result wrapping tests.
- `references/hermes-agent-main/tests/tools/test_browser_*` - browser routing, SSRF, secret-exfiltration, timeout, and lifecycle tests.
- `references/hermes-agent-main/website/docs/user-guide/features/web-search.md` - user documentation with known extraction-behavior drift.
- `references/hermes-agent-main/website/docs/user-guide/security.md` - security documentation with known `web_search` policy drift.
- `references/hermes-agent-main/website/docs/developer-guide/web-search-provider-plugin.md` - provider-plugin documentation with crawl claims not represented in the current ABC/tool surface.
- `references/hermes-agent-main/pyproject.toml` - Python/runtime/package versions and project license metadata.
- `references/hermes-agent-main/package.json` - browser CLI dependency and Node engine requirement.
- `references/hermes-agent-main/LICENSE` - MIT license text.

## Code Patterns

- **Capability-based adapter registry:** provider discovery is separated from the stable tool contract; selection filters by `search` versus `extract` support (`agent/web_search_registry.py:116`, `:281`).
- **Narrow common projection:** provider-native results are reduced to title, URL, description, and position (`agent/web_search_provider.py:22`; `tools/web_tools.py:619`).
- **Policy before remote extraction:** wrapper-level credential-pattern rejection and DNS/IP preflight happen before provider extraction (`tools/web_tools.py:776`, `:840`).
- **Optional provider hardening:** Firecrawl rechecks the final redirected URL, while this is not a provider-interface requirement (`plugins/web/firecrawl/provider.py:529`, `:549`).
- **Deterministic context control:** extraction output uses cached full content plus stable head-tail truncation rather than an LLM summary (`tools/web_tools.py:480`, `:516`, `:751`).
- **Untrusted-data envelope:** high-risk external tool results are delimiter-neutralized and wrapped rather than silently treated as instructions (`agent/tool_dispatch_helpers.py:503`, `:570`, `:583`).
- **Least-credential browser subprocess:** inherited credentials are removed and only selected backend keys are restored (`tools/browser_tool.py:74`, `:90`).
- **Lifecycle-only cloud browser providers:** providers create sessions/CDP endpoints; a shared execution layer issues browser commands (`agent/browser_provider.py:49`; `tools/browser_tool.py:2344`).

All code-pattern paths in this section are relative to `references/hermes-agent-main/`.

## External References

No network research or live provider requests were needed for this Hermes source audit. Version and licensing facts come from the vendored local reference:

- Hermes `0.18.2`, Python `>=3.11,<3.14`, MIT metadata: `references/hermes-agent-main/pyproject.toml:10`, `:20`, `:22`.
- `httpx==0.28.1` and `requests==2.33.0`: `references/hermes-agent-main/pyproject.toml:49`, `:54`.
- `exa-py==2.10.2`, `firecrawl-py==4.17.0`, and `parallel-web==0.4.2`: `references/hermes-agent-main/pyproject.toml:149`, `:150`, `:151`.
- `agent-browser ^0.26.0`; the checked lock resolves `0.26.0`: `references/hermes-agent-main/package.json:39`; `references/hermes-agent-main/package-lock.json:7002`.
- Node engine `>=20`: `references/hermes-agent-main/package.json:46`.
- Repository license: MIT (`references/hermes-agent-main/LICENSE:1`).

These versions describe the vendored snapshot, not necessarily the latest upstream releases as of the research date.

## Related Specs

- `.trellis/tasks/08-07-web-search-decision-review/prd.md` - requires first-principles comparison of direct MCP, a thin host wrapper, established frameworks, and native capability.
- `.trellis/spec/guides/source-grounding-guide.md` - requires conclusions to follow named local sources and report unresolved gaps instead of inventing behavior.
- `.trellis/spec/backend/tool-design.md` - relevant to keeping host tools narrow, explicit, and policy-aware.
- `.trellis/spec/backend/permission-authorization.md` - relevant to approval boundaries and external-action authorization.
- `.trellis/spec/backend/mcp-tool-schema-compatibility.md` - relevant to distinguishing MCP schema transport compatibility from product-level ownership.

## Final Verdict

- **Verified fact:** Hermes is a provider adapter and policy/projection host, not a native search index; its callable web contract is search plus extraction, while browser automation is a separate delegated subsystem (`references/hermes-agent-main/agent/web_search_provider.py:89`; `references/hermes-agent-main/tools/web_tools.py:1170`; `references/hermes-agent-main/tools/browser_tool.py:2344`).
- **Gap:** The inspected web path has no general crawl tool, citation engine, arbitrary-URL HTTP fetcher, or shared provider retry framework (`references/hermes-agent-main/agent/web_search_provider.py:125`; `references/hermes-agent-main/tools/web_tools.py:1192`).
- **Inference:** Hermes supports the value of a thin host-owned policy/projection layer, but provides no evidence that recreating provider-side indexing or ranking would improve search quality.
- **Extra observation:** Runtime source contradicts parts of the bundled crawl, summarization, and search-policy documentation, so source and tests must remain authoritative (`references/hermes-agent-main/tools/web_tools.py:751`; `references/hermes-agent-main/website/docs/user-guide/features/web-search.md:40`; `references/hermes-agent-main/website/docs/user-guide/security.md:597`).

## Caveats / Not Found

- No native web index, crawler, general `web_crawl` tool, or crawl method in the provider contract was found.
- No general citation-generation, claim-to-source mapping, citation-verification, or citation-format enforcement layer was found for ordinary web search.
- No generic direct HTTP fetch tool for arbitrary URLs was found outside provider extraction and browser navigation.
- No shared host-level retry/backoff/circuit-breaker layer was found across web providers.
- Search results are not visibly filtered through website policy or URL-safety checks before display, despite broader documentation claims; enforcement occurs on extraction/navigation paths.
- Common extraction preflight cannot eliminate DNS rebinding/TOCTOU risk, and final-URL revalidation is not uniformly implemented across providers.
- xAI row parsing accepts non-empty URL strings without local scheme/safety validation in that provider path.
- Documentation/plugin metadata contains stale or misleading claims about crawl, summarization, and `web_search` policy enforcement.
- Provider quality, cost, quota behavior, and production latency cannot be concluded from this source audit and require separate current provider evidence or authorized live evaluation.
