# Web Search Architecture Decision Review

## Goal

Re-evaluate D60 from first principles. Decide whether TakiAgent should keep Tavily Remote MCP, add a thin Core-owned
policy/projection wrapper over a professional provider, adopt an established search framework, or build any native
search/fetch capability. The prior Leader's native `web_search` proposal is evidence to review, not an owner
requirement and not a binding decision.

## What We Already Know

- Tavily Remote MCP is currently usable as a temporary search surface; `search` and `extract` are approved while
  heavier `crawl`, `map`, and `research` operations are disabled.
- MCP schema compatibility is now handled at the definition-to-tool boundary (`f7a406a`). That prerequisite does not
  establish a product need for a native search tool.
- The current remote tool description, result payload size, provider coupling, plaintext data-directory credential,
  and URL/fetch safety were the prior Leader's reasons for proposing a native wrapper.
- The owner questions whether recreating professional search capability can outperform Tavily and explicitly permits
  rejecting the native proposal.

## Requirements

- Separate search quality/indexing from host-side policy, projection, security, credentials, observability, and UX.
- Compare at least three architectures: direct Tavily MCP; thin host-owned wrapper over a professional provider; and an
  established multi-provider/search-and-fetch framework or project.
- Inspect local Hermes and OpenClaw references for their actual search, fetch, extraction, crawl, citation, and SSRF
  behavior. Do not infer behavior from project reputation.
- Identify reusable frameworks/projects and current maintenance/licensing/runtime fit for TypeScript/Node 24.
- Explain what extra functionality TakiAgent could own, which items are necessary, and which are unjustified scope.
- Produce a recommendation and an implementation outline only after evidence is collected.

## Acceptance Criteria

- [x] Explain why a host-owned layer may or may not be useful despite MCP, without claiming it improves search quality.
- [x] Compare capability, control, security, cost, latency, maintenance, portability, and credential implications.
- [x] Document Hermes and OpenClaw with concrete source anchors.
- [x] Evaluate reusable maintained frameworks/APIs before proposing custom implementation.
- [x] Classify candidate extra features as required, useful optional, or unnecessary.
- [x] Recommend keep, wrap, adopt, or build; explicitly state what should not be built. (Owner selected keep-MCP option A on 2026-08-07.)
- [x] Present an implementation sequence and decision gates if any code task is recommended.

## Definition of Done

- Research artifacts are persisted under `research/`.
- The Leader synthesizes the comparative decision and asks the owner for one concrete preference ruling.
- D60 is updated only after the owner decides; no implementation context or code is produced in this review task.

## Out of Scope

- Implementing native search, fetch, crawl, browser automation, or provider adapters.
- Changing the live Tavily MCP configuration, approvals, credentials, or quotas.
- Paid/live provider experiments without explicit authorization.
- Assuming web search and arbitrary URL fetching must be one tool or one task.

## Open Questions

- Which responsibilities genuinely belong to TakiAgent rather than the professional search provider or MCP server?
- Does a thin wrapper solve enough real problems to justify another maintained integration surface?
- Is direct MCP already sufficient once compatibility, approvals, and configuration mature?

## Technical Notes

- Start with `docs/deferred-decisions.md` D60, the archived MCP compatibility task, and local `references/` projects.
- External research may use only approved MCP search/documentation tools and must distinguish official docs, source,
  issue evidence, and inference.

## Research References

* [`research/hermes-web-research.md`](research/hermes-web-research.md) - local Hermes source audit; Hermes owns provider selection, policy, projection, and safety boundaries, not indexing or ranking.
* [`research/openclaw-web-research.md`](research/openclaw-web-research.md) - OpenClaw `v2026.4.9` source/docs audit; its stable search/fetch tools wrap providers and keep arbitrary URL fetching separate with strict SSRF controls.
* [`research/web-search-frameworks-and-options.md`](research/web-search-frameworks-and-options.md) - current provider/framework comparison for Node 24, TypeScript, and AI SDK 7 constraints.

## Research Synthesis

### The term "native search" must be split

There are two materially different proposals:

1. **A native search engine**: TakiAgent owns crawling, indexing, freshness, retrieval, ranking, extraction, or citation verification. This cannot compete with Tavily by adding a small Core feature and is outside the current product scope.
2. **A Core-owned search tool**: TakiAgent owns the model-facing contract and policy while a professional provider still owns search quality. This is a thin integration boundary, not a search engine.

MCP and a Core-owned tool are therefore not alternatives at the search-quality layer. They are alternative integration boundaries. MCP is lower maintenance and already operational; a Core tool adds control over descriptions, hard limits, projection, secrets, deadlines, errors, and telemetry at the cost of another provider integration.

### Responsibility split

| Responsibility | Professional provider | TakiAgent host |
|---|---|---|
| Index, freshness, retrieval, ranking | Owns | Select/evaluate; never recreate for this task |
| Model-facing schema and guidance | May expose vendor-shaped defaults | Own supported contract and when/when-not-to-search rules |
| Result projection and budgets | May provide fields/limits | Enforce stable fields, per-hit/total caps, truncation signal, and A1 external-content fencing |
| Credentials and permissions | Authenticates requests | Use approved secret backend, operator approval, and no secret logging |
| Deadline, errors, telemetry | May return request/usage metadata | Enforce actionable errors/deadlines and record provider/request ID, latency, usage, projection metrics |
| URL fetching, redirects, SSRF | Provider-specific and not uniformly documented | Separate future decision; define public-URL, DNS, redirect, and disclosure contract before accepting model URLs |

### Option matrix

| Option | Advantages | Costs/risks | Leader assessment |
|---|---|---|---|
| A. Keep Tavily Remote MCP | Already works; no new dependency or adapter; preserves MCP experimentation | Vendor-shaped schema/payload; weak host-side hard limits, guidance, secret routing, and telemetry | **Recommended now** while search is optional/experimental |
| B. Thin Core tool over `@tavily/core` | Stable Taki contract; enforceable limits/projection/fencing; provider seam; direct request telemetry and secret integration | New maintained adapter; same Tavily quality/cost; Node 24 and SDK smoke test still required | **Promotion path** only when web search becomes supported or current MCP gaps become acceptance failures |
| C. Adopt LangChain.js/Mastra or another agent framework | Established abstractions and integrations | Duplicates Taki's AI SDK 7 runtime; does not remove policy/security/projection work; adds dependency and runtime surface | **Reject for this one capability** |
| D. Add Exa/Firecrawl/SearXNG/Jina now | Potential alternate retrieval or extraction center of gravity | No evidence-based need yet; cost/operations/licensing/quality trade-offs; fetch/crawl is a separate scope | **Defer** until a fixed live workload proves a gap |
| E. Build native index/crawler/ranker/citation engine | Maximum theoretical control | Disproportionate engineering, operations, and quality risk; cannot match professional retrieval in this scope | **Reject** |

### Feature classification

If TakiAgent later ships a supported Core-owned `web_search`, the following are required: provider-neutral seam; host-authored positive/negative tool guidance; hard server-side result/depth caps; normalized title/URL/bounded snippet/publication date; output budget and truncation signal; A1 fence; structured deadline/errors; approved secret backend; and safe request/latency/usage telemetry.

Useful but optional: host-controlled domain filters, a small freshness enum, deterministic quality fixtures, a privacy-reviewed short-lived cache, and a second provider adapter after an evidence-based A/B evaluation.

Unnecessary now: a local search index, ranking algorithm, crawler, HTML-to-Markdown engine, browser automation, research agent, citation synthesis/verification, model-selected provider/depth, raw HTML/full-page output, or self-hosted Firecrawl/SearXNG without a concrete sovereignty/compliance requirement.

## Leader Recommendation

1. **Now**: retain Tavily Remote MCP for experimentation; keep `search`/`extract` approved and `crawl`/`map`/`research` disabled. The MCP schema-compatibility prerequisite is complete, but D60 is not thereby permanently resolved.
2. **Promotion gate**: if the owner promotes web search to a formal capability, or confirms payload/guidance/credential/observability defects as product requirements, create a separate implementation task for a thin Core-owned `web_search` tool over official `@tavily/core`. This would improve host control, not search quality.
3. **Do not adopt** LangChain.js or Mastra solely for search, and do not build native indexing/crawling/ranking/citation infrastructure.
4. **Keep fetch separate**. A future `web_fetch` task must have its own public-URL, DNS-answer/pinning, redirect, metadata/private-network, sensitive-URL disclosure, output-budget, and permission contract.

### Thin-wrapper outline (only after owner approval)

1. Define a minimal provider-neutral `WebSearchProvider` and normalized `SearchHit` contract.
2. Add one Tavily adapter using `@tavily/core`, with a Node 24 install/typecheck/smoke gate.
3. Expose one Core-owned AI SDK 7 tool with fixed limits, bounded projection, A1 fencing, closed errors, deadlines, approved secret lookup, and safe telemetry.
4. Add deterministic fake-provider tests for mapping, limit enforcement, timeout/error normalization, budgets, fencing, and redaction.
5. Run a small owner-authorized live fixed-query evaluation for quality, latency, payload, and credits; only then decide whether to replace the model-facing MCP search tool.

## Decision (ADR-lite)

**Context**: D60's previous native-tool proposal conflated provider search quality with host integration concerns. The owner explicitly allowed rejecting it. Local Hermes and pinned OpenClaw research show the established pattern is provider-backed host orchestration, not a self-built search engine.

**Provisional decision**: Keep Tavily Remote MCP during experimentation. Reserve a thin Core-owned Tavily SDK wrapper as a conditional promotion path. Reject a new search framework and native search/crawl implementation for the current product scope. Keep URL fetch as a separate decision.

**Owner ruling**: The owner selected **A** on 2026-08-07: keep MCP until a concrete promotion signal. No code is authorized by this review.

**Consequences**: Option A minimizes maintenance and preserves optionality but leaves current vendor-shaped MCP/payload/secret UX gaps. Option B improves host control and portability but adds an adapter and does not improve Tavily's ranking, freshness, or corpus. Any future second provider must be justified by a fixed live workload, not portability alone.
