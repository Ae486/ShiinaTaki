# Planning baseline and discussion handoff

Captured: 2026-11-02. Workspace: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`; baseline HEAD: `a2269ad`.
Before this task was created, the worktree contained only pre-existing untracked `artifacts/`. No runtime sample, paid model call, production change or live data mutation was performed for this task setup.

## Authoritative predecessor and discussion

- [Archived task](../../archive/2026-11/11-01-cache-token-cost-diagnosis/task.json): completed cache/token diagnosis, recovery/compaction, catch-up, auxiliary accounting, tidy repair and live summary-window cache monitoring.
- [Observed conversation costs](../../archive/2026-11/11-01-cache-token-cost-diagnosis/research/new-conversation-cost-analysis.md): dated data, query method and limitations; retain as baseline rather than rerunning or editing it unnecessarily.
- [Cache-window contract](../../archive/2026-11/11-01-cache-token-cost-diagnosis/research/live-cache-window-design.md) and [delivery evidence](../../archive/2026-11/11-01-cache-token-cost-diagnosis/research/live-cache-implementation-report.md): existing metric semantics and producer/UI path.
- [Reference research](../../archive/2026-11/11-01-cache-token-cost-diagnosis/research/reference-cache-practices.md): checked-in versions, provider accounting, stable-prefix constraints and competing compaction approaches.
- [Reasoning quality review](../../archive/2026-11/11-01-cache-token-cost-diagnosis/research/reasoning-quality-review.md): evidence against globally disabling thinking.

The owner initially requested read-only discussion without task-state changes, then explicitly requested this new task and necessary records. The preceding discussion proposed the category table and latest-primary occupancy interpretation; it did not approve a production design. Owner priorities and constraints are in `../prd.md`.

## Dated observations, not current live measurements

| Observation | Interpretation and limit |
| --- | --- |
| 20 foreground Runs / 39 requests on 2026-11-01 | Small normal-use cohort; ledger completion is not semantic/manual acceptance |
| 2,120,339 foreground input; 14,370 output including 9,205 reasoning | Mean input 54,368/request; token-count proportions are not price proportions |
| Four avatar correction continuations: 220,157 input | About 10.4% of foreground input but only 3.64% of the historical conditional cost; associated upper bound, not guaranteed savings |
| Two absent `wmic` calls in one batch and one later PowerShell quoting failure | Concrete mistakes; the two parallel failures were not retries after observing each other |
| Inspect/change/verify and `already_active` outcomes | Legitimate verification and normal no-change outcomes; do not label them retry defects |
| Six ordinary background calls: 8,237 input / 3,400 output, including 3,009 reasoning | Small input does not imply negligible cost; separate ordinary work from manual tidy/catch-up |
| Summary revision 6: 13,688 characters; replay 22,112 to 29,852 estimator units | Characters, local estimates and provider tokens are different units; no valid exact attribution by subtraction |
| Retained recall 15,470 characters and search result 7,402 characters | Concrete candidates for evidence-preserving reduction; important contents and subsequent usage still need evaluation |

The historical report's conditional CNY figures use the verified November 1 Sunday tariff. They are not current November 2 prices or an invoice, and differences between old/new cohorts are not causal savings estimates.

## Current code map from the preceding read-only investigation

| Location | Established seam / caveat |
| --- | --- |
| [request-measurement.ts](../../../../packages/core/src/agents/request-measurement.ts) | Message/instruction/schema estimates, response reserve and provider-total anchor; cache reads still occupy input context |
| [request-preparation.ts](../../../../packages/core/src/agents/request-preparation.ts) | Initial request and detached next-request projection; not yet full every-dispatch attribution |
| [agent-attempt.ts](../../../../packages/core/src/agents/agent-attempt.ts) | Memory/history/instruction composition and per-step active tools; identify actual dispatch inputs rather than only the initial measurement |
| [main.ts](../../../../packages/core/src/main.ts) | Process-local latest measurement and wired pressure-triggered request reduction; do not claim reduction is absent |
| [model-observability.ts](../../../../packages/core/src/agents/model-observability.ts) | Model call correlation and end-of-request usage; no complete component provenance ledger |
| [run-snapshot-capture.ts](../../../../packages/core/src/harness/run-snapshot-capture.ts) | Existing unknown/not-captured fields prevent assuming historical source coverage |
| [replay-folds.ts](../../../../packages/core/src/agents/replay-folds.ts) | Existing pressure-triggered folding; below budget leaves history unchanged and originals remain stored |
| [memory-tool-model-output.ts](../../../../packages/core/src/memory/canonical-tools/memory-tool-model-output.ts) | Existing family-owned result projection; preserve partial/error/source semantics |
| [tool-disclosure.ts](../../../../packages/core/src/agents/tool-disclosure.ts) | Existing Skill/MCP lazy disclosure; not a missing mechanism to reimplement |
| [tool-disclosure spec](../../../spec/backend/tool-disclosure.md) | Explicitly leaves D70 same-loop message reduction deferred |
| [context-config.ts](../../../../packages/core/src/config/context-config.ts) | Separate model capacities and history/compaction settings; default full context is not the effective history budget |
| [provider-factory.ts](../../../../packages/core/src/config/provider-factory.ts) | Current OpenAI-compatible model path; no implication that cached prompts disappear from requests |

The old memory assembler is legacy; use the captured `assembleMemory` path when attributing current primary requests. Dynamic avatar enums and missing-name/no-repeat guidance already exist; adding the same text again is not a demonstrated optimization.

Before implementation, read the relevant request/tool-loop and stable-prefix sections of the [agent-runtime spec](../../../spec/backend/agent-runtime.md) directly. The full file exceeds the current automatic context-injection byte limit, so it is intentionally referenced here rather than silently truncated through a whole-file manifest entry. Curate additional layer contracts once the concrete change scope is known.

## Reference mechanisms and transfer limits

- [pi truncation](../../../../references/pi-main/packages/coding-agent/src/core/tools/truncate.ts) and [bash tool](../../../../references/pi-main/packages/coding-agent/src/core/tools/bash.ts): line/byte bounds and a full-output file reference. Bounds are not token counts; TakiAgent still needs an accessible recovery path.
- [pi compaction](../../../../references/pi-main/packages/coding-agent/src/core/compaction/compaction.ts): standalone summary with recent material retained.
- [DeepSeek Harness result pruner](../../../../references/deepseek-harness-master/packages/compaction/compaction-tool-result-pruner/README.md): model-free head/omission/tail replacement, original append-only event preserved, identity/error/nontext metadata retained and strict shrink/idempotence. Syntactic pruning can remove important middle text; preserved storage is not automatically a model-facing recovery tool.
- [DeepSeek Harness compaction](../../../../references/deepseek-harness-master/packages/compaction/compaction-basic/README.md): reduce, remeasure, summarize only if still needed; conversation-envelope reuse is an alternative to pi's standalone summary. Summary replaces the earlier range rather than duplicating it.
- [DeepSeek caching documentation](https://api-docs.deepseek.com/guides/kv_cache), consulted during the preceding discussion: repeated content is still submitted, cached tokens remain request input, and eligible identical prefixes are reused on a best-effort basis. Cache-prefix-unit creation and expiration mean immediate/100% reuse is not guaranteed. These current rules do not prove the cause of any historical miss.

Reference versions recorded by the prior investigation: pi 0.84.2 and DeepSeek Harness 0.1.1-rc.2. Source mechanisms are not TakiAgent quality/cost acceptance. The attempted AI SDK `prune-messages` documentation URL returned 404 during discussion; do not cite it as verified API support.

## Known gaps and continuation guardrails

No new component distribution, cost-saving percentage, recovery acceptance or same-loop fidelity result exists yet. The next investigation must establish actual source coverage, denominator/window authority and final-dispatch correlation before choosing storage/UI contracts. The initial category set is a proposal, not fabricated data.

Keep metric facts tied to existing Core producers. Avoid broad new framework research, repeated baseline queries, extra paid calls merely for measurement, or reopening resolved failure-recovery architecture. New evidence should change a concrete decision; otherwise use these pointers and continue the ordered plan.
