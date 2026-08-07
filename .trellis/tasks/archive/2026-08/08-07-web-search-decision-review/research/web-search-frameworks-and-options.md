# Research: Web Search Frameworks and Reusable Options

- Query: Which maintained, directly reusable web search/fetch approach best fits a Node 24 TypeScript agent host: direct Tavily Remote MCP, a thin host-owned wrapper over a professional provider, an established agent/search framework, or a custom/self-hosted implementation?
- Scope: mixed (local repository/reference code plus current official external documentation and package metadata)
- Date: 2026-08-07

## Findings

### Executive conclusion

**Recommendation:** keep Tavily Remote MCP only as the current experimental surface, but if web search is promoted to a supported TakiAgent capability, replace the model-facing MCP tool with a **thin Core-owned `web_search` tool over Tavily's official `@tavily/core` SDK**. Do not build a search engine, crawler, HTML extractor, or research agent. Do not adopt LangChain.js or Mastra merely for web search.

This recommendation does **not** claim that a wrapper improves search quality. Tavily must continue to own the index, ranking, search-time retrieval, and provider-side extraction. The wrapper is justified only if TakiAgent needs enforceable tool guidance, a stable minimal result contract, prompt/token projection, credentials integration, per-call usage/latency logs, and a provider-replacement seam. Until those needs are treated as product requirements rather than observations, direct MCP remains the lower-maintenance choice.

`web_fetch` should remain a separate decision. Search does not require accepting a model-selected URL. Extraction/crawl introduces a materially different security and cost surface and should not be bundled into the first wrapper.

## Evidence labels

- **Verified:** observed in repository code, local reference source, official documentation/source, or official npm metadata during this research.
- **Inference:** engineering conclusion derived from verified facts; not a vendor guarantee.
- **Gap:** the reviewed official material did not establish the fact.
- **Observation:** useful context that does not by itself decide the architecture.

## Files found

### TakiAgent

- `.trellis/spec/backend/index.md` and `packages/core/package.json` - the backend spec fixes Core at Node 24; the package is ESM and uses AI SDK `^7.0.17`, `@ai-sdk/mcp ^2.0.10`, and Zod 4 (`.trellis/spec/backend/index.md:3`; `packages/core/package.json:5,14,17,23`).
- `packages/core/src/main.ts` - MCP config and approvals come from the Core data directory; MCP tools are merged into the per-turn tool set (`packages/core/src/main.ts:174-184,292`).
- `packages/core/src/mcp/mcp-manager.ts` - current MCP boundary discovers, normalizes, namespaces, error-wraps, and converts remote definitions into one AI SDK `ToolSet` (`packages/core/src/mcp/mcp-manager.ts:4,50,56,83`).
- `docs/deferred-decisions.md` - D60 records Tavily Remote MCP as a temporary keyed surface, three-result defaults, search/extract approval, heavier operations disabled, plaintext-key debt, and the reopened architecture decision (`docs/deferred-decisions.md:88`).
- `.trellis/spec/backend/tool-design.md` - host-owned tools require strong positive/negative guidance, bounded result projection, and sanitation of open-world text (`.trellis/spec/backend/tool-design.md:76-82,172-178`).
- `.trellis/spec/backend/agent-runtime.md` - untrusted external content must cross the A1 scrub-then-fence sense boundary (related spec; exact implementation must be re-read before coding).

### Local Hermes reference

- `references/hermes-agent-main/agent/web_search_provider.py` - a small provider contract normalizes search and extraction results and exposes separate capability flags (`:15,22,92-158`).
- `references/hermes-agent-main/agent/web_search_registry.py` - provider choice is config-driven, capability-aware, and availability-aware (`:15,122,138-150,181-210`).
- `references/hermes-agent-main/tools/web_tools.py` - host layer returns search metadata, sets explicit tool descriptions, and separately truncates/stores extraction text (`:417-543,626-643,754-771,982-1002,1172-1237`).
- `references/hermes-agent-main/tests/tools/test_url_safety.py` - URL fetch safety is a real subsystem: scheme checks, DNS fail-closed behavior, loopback/private/link-local/metadata ranges, mapped IPv6, and redirects have regression coverage (`:78-140,146-245,277-302`).

No local OpenClaw source tree was found under `references/` or the repository path scan. OpenClaw behavior therefore is not used as evidence in this file.

## Local code patterns

1. **The current MCP path is already a reusable integration layer, but not a web policy layer.** It connects configured servers, converts their definitions, namespaces tools, and wraps errors. It does not define a canonical web result or project provider payloads (`packages/core/src/mcp/mcp-manager.ts:4,74-105`).
2. **TakiAgent already has the agent/tool framework it needs.** AI SDK 7 `ToolSet` is the runtime contract. Adding another agent runtime for one tool would duplicate tool abstractions and observability surfaces (`packages/core/package.json:14-17`; `packages/core/src/main.ts:213,292`).
3. **Hermes is useful as architecture evidence, not as a dependency.** Its provider ABC is approximately the thin boundary TakiAgent would need: provider search/extract capability plus a normalized response. Its wrapper, not the provider, owns descriptions and result budgets (`web_search_provider.py:15-42`; `web_tools.py:1172-1237`).
4. **Search and extraction are separate capabilities in credible prior art.** Hermes resolves them independently and applies the large-output path only to extraction (`web_search_registry.py:138-150`; `web_tools.py:754-771`). This supports keeping `web_fetch` out of a first `web_search` implementation.
5. **A URL-taking tool creates work that a framework does not remove.** The local safety tests show why a simple `new URL()` check is insufficient: DNS results, mapped IPv6, metadata endpoints, redirect targets, and fail-closed behavior all matter (`test_url_safety.py:78-245`).

## What each responsibility actually is

| Responsibility | Professional search provider | TakiAgent host |
|---|---|---|
| Search index and freshness | Owns crawling/index corpus and freshness mechanics. | Select a provider; do not recreate the index. |
| Ranking/relevance | Owns retrieval/ranking and search-depth behavior. | Choose bounded provider options and evaluate quality; a wrapper cannot improve ranking by itself. |
| Page extraction/crawl | Tavily/Exa/Firecrawl can perform it remotely. | Decide whether to expose it at all; validate inputs and cap scope/results if exposed. |
| Model-facing schema | MCP/framework may supply a vendor schema. | For a supported capability, own a small stable schema and descriptions consistent with TakiAgent tool standards. |
| Citations | Providers return URLs; Exa also has answer citations/grounding. | Preserve source URL/title and stable ordering; do not manufacture citation claims. |
| Policy | Provider may offer filters/defaults. | Own when-to-search/when-not-to-search guidance, hard limits, approvals, and permission posture. |
| Token projection | Provider can omit raw content or return highlights/chunks. | Own final per-hit and total response caps, truncation flags, and open-world fencing. |
| SSRF / sensitive URL handling | Remote service must protect its own network, but reviewed Tavily/Exa docs did not state a public private-network contract. | Avoid URL input for search. For future fetch, validate public HTTP(S), redirects/indirection strategy, metadata ranges, and sensitive URL disclosure before provider submission. |
| Credentials | Provider authenticates API/MCP calls; Tavily MCP also supports OAuth. | Keep secrets out of ordinary config/logs and integrate with the approved secret store. This debt exists regardless of MCP vs SDK. |
| Observability | Provider may return request ID, response time, and usage/cost. | Log provider, request ID, latency, usage, result count, projected characters, and truncation without logging keys, queries by default, or full content. |
| Cost/latency | Provider pricing and network/service latency dominate. | Bound results/depth, set deadlines, record usage, and avoid hidden multi-step research/crawl. |

## Option matrix

| Option | What is directly reusable | What TakiAgent still owns | Cost / latency | License, maintenance, Node/TS fit | Verdict |
|---|---|---|---|---|---|
| **A. Direct Tavily Remote MCP (current)** | Hosted MCP; Tavily search/extract/map/crawl/research tools; OAuth or API key; `DEFAULT_PARAMETERS`; no local server maintenance. Tavily owns index, relevance, extraction. | Approval policy, credential storage, prompt guidance outside the vendor description, and any result budgeting not achieved by provider defaults. Current Core has no canonical web result projection. | Same Tavily API credits; extra MCP protocol hop is likely small beside provider time (**inference**, not benchmarked). Basic/fast search is 1 credit, advanced 2. | Tavily MCP repo/package MIT; official docs require Node >=20 only for local MCP. Remote mode is runtime-light and already works through Taki's MCP stack. | **Keep for experimentation.** Lowest code maintenance, but weak host control. Do not expand crawl/map/research. |
| **B. Thin Core tool over `@tavily/core`** | Official TypeScript SDK, full search/extract/crawl/map/research APIs; typed search result fields (`title`, `url`, `content`, `score`, dates) plus request ID/response time/optional usage. Provider still owns quality. | A small provider interface, tool schema/description, fixed limits, normalized hits/citations, A1 fence, truncation, secrets, deadlines/errors, metrics, tests. | Same Tavily credits. Avoids MCP discovery/conversion and may reduce small overhead (**inference**); no search-quality gain. | `@tavily/core` 0.7.7, MIT, updated 2026-08-05, official TypeScript package. No explicit Node engine guarantee was found; Node 24 compatibility needs a package smoke test. | **Recommended when search becomes a supported product capability.** Start with search only. |
| **C. Tavily AI SDK tools (`@tavily/ai-sdk`)** | Prebuilt `tavilySearch`, `tavilyExtract`, `tavilyCrawl`, and `tavilyMap` AI SDK tools. | Still owns policy, projection, credentials, URL rules, and observability; adapting output would require wrapping the prebuilt tool. | Same provider cost; little implementation savings once wrapped. | 0.5.0, MIT, maintained; official npm peer range is `ai ^5 || ^6`, while TakiAgent is AI SDK 7. | **Reject now: verified peer incompatibility.** Re-evaluate only after official AI SDK 7 support. |
| **D. LangChain.js + `@langchain/tavily`** | Established tool abstraction and Tavily tool; static configuration prevents agents changing some response-size options; optional LangSmith tracing. | No canonical cross-provider search result, Taki tool/approval adaptation, credentials, A1 fence, URL security, and cost policy. LangChain tool responses remain provider-shaped. | Same provider cost plus another abstraction; LangSmith can add external telemetry/data flow and credentials. | `@langchain/tavily` 1.2.0, MIT, maintained, with `@langchain/core ^1`; TypeScript/Node fit is plausible on Node 24 but would need an integration test. | **Reject.** It is reusable inside LangChain, not a useful provider-neutral layer for an existing AI SDK 7 host. |
| **E. Mastra** | Full TypeScript agent/workflow/observability framework; Node >=22.13. Official web-search guide wraps Exa as a custom tool. | Almost all web-specific policy/projection/security work; also an adapter to or replacement of Taki's existing agent runtime. | Provider cost unchanged; framework/runtime and potentially telemetry overhead. | Core Apache-2.0, active releases, Node 24 fits the documented floor. Enterprise directories use a separate license. | **Reject.** The official example demonstrates the same thin wrapper Taki can write with its existing AI SDK, without adopting a second runtime. |
| **F. Direct Exa SDK (`exa-js`) as an alternate provider** | Search plus highlights/full content, known-URL contents, answer with citations, structured output and automatic grounding; highlights are explicitly recommended for token-efficient retrieval. | Same host policy/projection/security/credential responsibilities as Tavily. | Official price at review: standard search $7/1k requests (up to 10 results), contents $1/1k pages/content type, answer $5/1k; deeper modes add latency/cost. | `exa-js` 2.16.3, MIT, updated 2026-07-27, full TypeScript support. | **Viable second provider, not a framework.** Consider only through an evidence-based quality/cost A/B after the Tavily thin seam exists. |
| **G. Firecrawl Cloud SDK** | Strong search-plus-scrape/crawl/map/extract surface, JS-heavy page handling, clean Markdown/JSON, official TypeScript SDK. | Host policy, projected result, credentials, URL safety, usage controls. Search relevance/index sourcing was not established sufficiently to prefer it over Tavily for search-first use. | Search 2 credits/10 results; scrape/crawl/map generally 1 credit/page; subscription credits and advanced features add cost. | Node SDK `firecrawl` 4.32.0 is MIT and current. Hosted service avoids operating the server. | **Useful only if robust fetch/crawl becomes primary.** Too broad for current search-only need. |
| **H. Self-hosted Firecrawl** | Credible open-source core search/scrape/crawl/map/extract and Docker Compose deployment. | Authentication, TLS, database/queue persistence, upgrades, monitoring, recovery, outbound controls, proxies, sizing, and incident response. Some cloud capabilities are absent. | Infrastructure and operational cost replace managed pricing; no verified minimum host size. | Server AGPL-3.0; official self-host guide pins v2.11.162 and explicitly warns the baseline is unauthenticated/non-production. Client can still be TypeScript. | **Reject for desktop v1.** Operationally credible, but disproportionate and not an embedded Node library. |
| **I. Self-hosted SearXNG** | Mature privacy-oriented metasearch over multiple upstream engines; simple JSON HTTP API. | Entire service operation, engine availability/tuning, normalized schema, extraction, citation projection, security, throttling, and reliability. It owns no independent general web index. | No managed per-call fee, but infra/maintenance and upstream blocking/latency are real. Public instances often disable JSON. | AGPL-3.0, actively maintained; Python/uWSGI/Valkey-oriented, not a Node library. | **Reject for current product.** Credible search service, but search-only and operationally heavy. |
| **J. Jina Reader/Search HTTP APIs** | `s.jina.ai` search and `r.jina.ai` URL-to-LLM text; token budget, JSON mode, optional OpenAI citation format. Official page reports roughly 2.5s search and 7.9s Reader average latency. | Direct HTTP integration, normalized schema, credentials, URL security, cost/token handling, and provider seam. | Search starts at a fixed 10,000 billed tokens/request; Reader bills by output tokens above free usage. | Hosted HTTP API; no Node package is needed. License for the hosted service is not an application-library concern; service terms still need review. | **Not preferred.** Potential extraction fallback, but weaker typed integration and a high minimum search token charge. |

## Candidate analysis

### A. Direct Tavily Remote MCP

**Verified facts**

- Official remote endpoint supports URL API key, Authorization header, or OAuth. The docs recommend the hosted endpoint as the easiest path and document `DEFAULT_PARAMETERS`.
- The MCP server exposes search, extract, map, crawl, and research; the repository is MIT and the npm package is actively published.
- Tavily Search itself returns ranked URL/title/content results. Search depth trades latency/relevance and cost; basic/fast/ultra-fast cost one credit and advanced costs two.
- Taki already has an MCP compatibility, isolation, namespacing, approval, and error-wrap path.

**What it does not establish**

- `DEFAULT_PARAMETERS` is documented as defaults, not a host-enforced maximum. It should not be treated as a policy boundary without testing precedence against model-supplied arguments.
- The reviewed material does not promise a small, stable model-facing payload or a Taki-specific when-not-to-search description.
- OAuth exists at the service, but compatibility with Taki's current `@ai-sdk/mcp` HTTP client and operator UX was not verified.
- No reviewed Tavily document explicitly described private-address, metadata-IP, DNS rebinding, or redirect handling for Extract/Crawl. This is a **gap**, not evidence that Tavily is unsafe.

**Decision meaning**

Direct MCP is rational while search is optional/experimental and the owner accepts vendor-shaped tools. It becomes less rational when D60's token, description, secret, or observability observations are promoted to acceptance criteria, because solving them around an unchanged MCP tool becomes a wrapper by another name.

### B. Thin provider wrapper

The smallest useful shape is not a generic "web framework." It is:

```ts
interface WebSearchProvider {
  search(query: string, options: ProviderSearchOptions): Promise<ProviderSearchResponse>;
}

type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
};
```

The provider response keeps internal request ID, duration, usage, and raw fields for logs/diagnostics. The model result gets only bounded `SearchHit[]`, an explicit `truncated`/projection indicator when applicable, and source order. This is a policy/projection seam, not a search implementation.

Use the official `@tavily/core` client rather than hand-authored HTTP unless its current implementation prevents required deadlines/telemetry. The SDK is TypeScript, MIT, current, and exposes all provider APIs. Only `search` should be wired initially; having SDK methods available is not a reason to expose them.

### C. Frameworks

LangChain.js and Mastra are maintained, credible agent frameworks. Neither is a maintained provider-neutral web search engine or security layer.

- `@langchain/tavily` packages Tavily as a LangChain tool and deliberately fixes some result-size-affecting settings at construction time. That is useful in a LangChain application, but Taki would still need to adapt it into AI SDK 7 and normalize the output.
- Mastra's official search guide creates a custom tool around `exa-js`, including a host-selected result count and `.slice(0, 500)`. This is direct evidence that Mastra does not remove the thin-wrapper work; it merely supplies another tool API.
- Vercel AI SDK already supplies Taki's tool runtime. Its official cookbook explicitly distinguishes provider-native search from custom/ready-made tools. Taki can use `tool()` directly without a second agent framework.
- Tavily's ready-made AI SDK package would be the narrowest framework integration, but its current peer dependency excludes AI SDK 7.

Therefore "adopt a framework" is not a competitive architecture for this task. It is justified only if Taki independently adopts that framework for broader agent/workflow requirements.

### D. Alternate managed providers

Exa and Firecrawl are credible, maintained alternatives, but they solve different center-of-gravity problems:

- **Exa:** strongest alternative when semantic retrieval, token-efficient highlights, known-URL contents, or citation-bearing answer/grounding is required. It can fit the same thin provider seam.
- **Firecrawl:** strongest alternative when robust extraction/crawl/JS rendering is more important than a minimal search result. Its breadth and cost model are unnecessary for D60 search alone.
- **Jina:** attractive for zero-SDK URL-to-Markdown and has explicit token-budget controls, but it is a hosted HTTP surface rather than a typed integration, and its search billing starts at a large fixed token amount.

No provider should be added for "portability" alone. A second adapter is warranted only after a small fixed query set and real usage logs demonstrate a quality, coverage, cost, latency, or availability reason.

### E. Self-hosted projects

Both SearXNG and Firecrawl are operationally credible; neither is operationally appropriate for the present Windows desktop agent.

- SearXNG aggregates upstream services. It does not give Taki an independent search index or extraction pipeline, and the official JSON API must be enabled by the instance. Public instances frequently disable it. Self-hosting adds a Python service and limiter/Valkey concerns.
- Firecrawl's current official guide is unusually candid: its Compose baseline lacks production authentication, durable storage, TLS, HA, and some cloud capabilities; the operator owns security, persistence, upgrades, monitoring, recovery, and incident response. This is far beyond a thin Node tool.

"Self-hosted" changes the operator and data-flow boundary; it does not make web retrieval free or simple. It should be revisited only under a concrete privacy/compliance/offline-control requirement.

## Feature classification

### Required if TakiAgent ships a supported `web_search`

1. Provider-owned search/ranking; no local index.
2. Host-owned, detailed when/when-not tool description.
3. Fixed server-side result/depth limits that model arguments cannot widen.
4. Stable normalized result containing title, URL, bounded snippet, and optional publication date.
5. Per-hit and total output budget, explicit projection/truncation signal, and A1 external-content fencing.
6. Closed, actionable errors and a deadline; no automatic research/crawl escalation.
7. Secret-store integration; no key in URL, ordinary config, logs, or repository.
8. Safe observability: provider/request ID, duration, usage/credits when available, hit count, projected characters, truncation, outcome.
9. A minimal provider seam so the model-facing tool survives provider replacement.

### Useful optional

1. Domain include/exclude policy controlled by host configuration.
2. Freshness selector with a small enum; only if user queries need it.
3. Query/result quality fixtures for provider A/B evaluation.
4. Short-lived result cache keyed by normalized query/options, with privacy review.
5. Exa adapter if real evaluation beats Tavily on a defined workload.

### Unnecessary now

1. Native search index, ranking algorithm, crawler, HTML-to-Markdown engine, browser automation, or research agent.
2. LangChain.js/Mastra adoption for one tool.
3. Model-exposed provider selection, arbitrary max-results/depth, raw HTML, full-page content, crawl/map/research.
4. Citation synthesis beyond preserving provider source URLs/titles.
5. Self-hosting SearXNG or Firecrawl without a specific sovereignty/compliance requirement.

## Recommended decision and sequence

### Decision

1. **Now: keep MCP.** It is already operational and remains appropriate for a temporary experimental capability. Keep expensive crawl/map/research unavailable. Do not claim D60 is solved permanently.
2. **Promotion gate: thin wrapper.** If the owner wants web search in the formal capability list, or if payload, guidance, credential, or observability problems are confirmed, implement one Core-owned `web_search` tool backed by `@tavily/core`.
3. **No framework/custom engine.** Reject LangChain/Mastra and any native search/crawl build for this need.
4. **Separate fetch gate.** Do not add URL extraction until an explicit use case and URL-security contract are approved.

### Implementation outline after owner approval (not part of this review task)

1. Define a provider-neutral normalized search contract and one Tavily adapter. Keep the interface no larger than real requirements.
2. Add a Core-owned `web_search` tool using existing AI SDK 7/Zod patterns, Taki tool descriptions, closed errors, fixed limits, and A1 fencing.
3. Source the API key through the approved secret backend. Log request ID/latency/usage and projection metrics, never key/raw content.
4. Add deterministic adapter/tool tests for mapping, fixed limits, timeout/error normalization, output budget, content fencing, and redaction.
5. Run a small live owner-approved evaluation against the same fixed queries; record quality, latency, payload size, and provider credits. The live call is a decision gate, not a unit test.
6. Only after evidence, disable the model-facing Tavily MCP search tool to avoid duplicate ambiguous tools. Preserve MCP as a general extension mechanism.
7. If fetch is later approved, create a separate task for public-URL validation, DNS/redirect behavior, sensitive URL disclosure, result budgets, provider extraction, and permission posture.

## External references

### Tavily

- Official MCP docs: https://docs.tavily.com/documentation/mcp
- Official JS SDK/source: https://github.com/tavily-ai/tavily-js
- Official JS SDK package: `@tavily/core` 0.7.7, MIT; npm metadata updated 2026-08-05.
- Official API/SDK docs: https://docs.tavily.com/sdk/javascript/reference
- Official pricing: https://docs.tavily.com/documentation/api-credits
- Official AI SDK integration: https://docs.tavily.com/documentation/integrations/vercel
- `@tavily/ai-sdk` 0.5.0, MIT; official npm metadata shows peers `ai ^5 || ^6`, `zod ^4`.

### Exa

- Official JavaScript SDK docs: https://exa.ai/docs/sdks/javascript-sdk
- Official Search guide: https://exa.ai/docs/reference/search-api-guide
- Official Contents guide: https://exa.ai/docs/reference/contents-api-guide
- Official pricing: https://exa.ai/docs/reference/pricing
- `exa-js` 2.16.3, MIT; official npm metadata updated 2026-07-27.

### Frameworks

- LangChain.js Tavily integration: https://docs.langchain.com/oss/javascript/integrations/tools/tavily_search
- `@langchain/tavily` 1.2.0, MIT, peer `@langchain/core ^1` (official npm metadata).
- Mastra web-search guide: https://mastra.ai/guides/guide/web-search
- Mastra core: Apache-2.0 for core; Node >=22.13 stated by guide; active 2026 releases.
- Vercel AI SDK search cookbook: https://ai-sdk.dev/cookbook/node/web-search-agent

### Search/extraction services

- Firecrawl source: https://github.com/firecrawl/firecrawl (server AGPL-3.0)
- Firecrawl official self-host guide: https://docs.firecrawl.dev/contributing/self-host
- Firecrawl official cloud/open-source comparison: https://docs.firecrawl.dev/contributing/open-source-or-cloud
- Firecrawl Node SDK `firecrawl` 4.32.0, MIT; official npm metadata updated 2026-07-31.
- SearXNG Search API: https://docs.searxng.org/dev/search_api.html
- SearXNG install guide: https://docs.searxng.org/admin/installation-searxng.html
- SearXNG source: https://github.com/searxng/searxng (AGPL-3.0, active official docs build observed 2026-08-04).
- Jina Reader/Search: https://jina.ai/reader/

## Related specs and decisions

- `.trellis/spec/backend/index.md` - Node 24 Core and relevant backend contracts.
- `.trellis/spec/backend/tool-design.md` - tool description, portable schema, result budget, open-world text sanitation, and birth checklist.
- `.trellis/spec/backend/agent-runtime.md` - A1 untrusted external-content fence.
- `.trellis/spec/backend/error-handling.md` - structured result/error behavior for future implementation.
- `.trellis/spec/backend/permission-authorization.md` - any new capability/tool permission posture.
- `.trellis/spec/backend/mcp-tool-schema-compatibility.md` - current MCP definition-to-tool compatibility boundary.
- `.trellis/spec/guides/source-grounding-guide.md` - evidence and gap handling followed here.
- `docs/deferred-decisions.md:88` - live D60 record.
- `.trellis/tasks/archive/2026-08/08-07-mcp-tool-schema-compatibility/` - completed prerequisite, not evidence that a native tool is needed.

## Caveats / Not Found

1. No paid/live provider calls were made, so search-quality, end-to-end latency, and real payload comparisons remain untested. Vendor quality/latency claims are not treated as comparative proof.
2. No local OpenClaw source tree was found. This file does not assert OpenClaw search/fetch behavior.
3. No explicit Tavily or Exa official guarantee covering private IPs, cloud metadata, DNS rebinding, or redirect validation was found. A future URL-taking capability must define its own security contract or obtain a contractual provider guarantee.
4. `@tavily/core` package metadata did not expose a clear `engines.node` guarantee in the reviewed sources. Its TypeScript SDK is a strong Node 24 fit by implementation surface, but an install/typecheck/smoke test is still required before adoption.
5. Direct MCP `DEFAULT_PARAMETERS` precedence was not verified. Treat it as configuration convenience, not a hard policy cap.
6. Hosted-service terms, data retention, regional processing, and enterprise security addenda were not exhaustively reviewed. Those become necessary before non-owner or sensitive-data use.
7. Prices and versions are point-in-time facts as of 2026-08-07 and will drift.
