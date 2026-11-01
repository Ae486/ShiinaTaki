# Cache and token cost diagnosis

## Goal

Explain the owner's observed API cache hit rate of roughly 70% or lower and identify avoidable token/currency costs using actual conversation and monitoring records. Deliver an evidence-backed diagnosis and a prioritized, reviewable optimization plan without reducing the assistant's required capabilities or silently changing behavior.

## Requirements

- Identify the database and runtime that actually produced the observed activity; distinguish everyday use, development acceptance traffic, historical records, and current code.
- Reconcile provider input, cache-read, cache-write, output/reasoning, request counts, tool activity, and any available cost records. State aggregation denominators and unknown fields explicitly.
- Compare concrete high-cost and low-cache episodes with their prompt construction, replay, summaries, memory, tools, retries, background work, and worker lifecycles.
- Separate measured facts, code-supported mechanisms, and unverified causal hypotheses. Do not infer exact token counts from character counts or treat missing observations as zero.
- Consult the local pi and DeepSeek harness references and applicable official provider/SDK documentation; identify transferable mechanisms and compatibility limits.
- Prioritize changes by expected cost benefit, evidence strength, implementation risk, and behavior/quality tradeoffs. Include validation criteria that measure money and successful work, not cache percentage alone.
- Implement the owner-approved bounded simplification in this worktree, preserving unrelated changes and current behavior outside the accepted contracts. Real-data reconciliation and paid catch-up remain separate from code/test implementation.

## Accepted Simplification Direction

The owner accepted the following direction after challenging the initial recommendation to preserve synchronous flush-before-compaction. The owner subsequently reviewed the bounded cost/scope assessment and approved implementation. The source-quality requirement remains; its current implementation is not treated as untouchable.

- Save primary-message identity, exact membership and necessary captured origin together at the local Timeline write boundary. Memory-provider availability must not decide whether otherwise valid chat is durable.
- Keep cancellation/retraction, actual partial retention and Run/effect uncertainty truthful. An open source is not automatically ready for extraction.
- Reuse existing Local/Hindsight processing journals and immutable receipts. Eliminate the fragile post-turn proof callback as the sole producer and avoid introducing a general queue/recovery framework.
- Let context summarization proceed independently of completed canonical memory extraction while original Timeline and pending source state remain durable.
- Preserve salient durable facts and relevant constraints in summaries while extraction is delayed. Do not assume they already exist in long-term memory.
- Isolate unresolved source gaps from otherwise valid later processing; retain explicit gaps and correct continuous-coverage reporting.
- Keep old unknown-source classification and paid backlog processing separate from the forward schema/code change. New captures must be correct without fabricating old Run linkage.
- Scope the current implementation estimate to ingestion/compaction simplification. Broader usage-ledger completion and the other cache/tool findings remain separately identified follow-up work.

## Optimization Acceptance (Deterministic Implementation Evidence)

- [x] A real SQLite reopen after each relevant crash boundary recovers exact retained/retracted source membership without a provider call in the chat transaction.
- [x] Memory outages do not lose a committed source or roll back valid chat; repeated binding uses existing immutable provider receipts without duplicate facts.
- [x] Canonical memory failure/delay does not prevent eligible summary creation or hide an ingestion coverage gap.
- [x] Delayed extraction does not remove relevant names, preferences or hard constraints from both summary and available memory context.
- [x] Existing Local/Hindsight source readers and Legacy compatibility are preserved; old unknown rows are not bulk relabeled during migration.
- [x] Tests cover normal/cancelled/partial/interrupted/restarted flows, source changes, repeated recovery and truthful progress. Real-model quality/cost and owner acceptance remain separately evidenced.

## Completed Diagnosis Acceptance

- [x] The actual data source, sample interval, record coverage, available model/provider evidence, and important measurement gaps are documented, including the absence of a currently running Core.
- [x] Reproducible read-only queries produce aggregate and per-scenario evidence for cache loss and additional token usage.
- [x] Every prioritized finding links measured evidence to the relevant request/runtime/tool code, with alternatives and uncertainty recorded.
- [x] Reference-project and provider documentation findings include source links and applicability notes.
- [x] The diagnosis, technical options, ordered implementation plan, and success criteria are ready for owner review after independent challenge.
- [x] All writes by this diagnosis remain in this new task's planning artifacts. This task performed no production optimization, paid application-model experiment, database mutation, commit, push, or archive; concurrent workspace changes were preserved.

## Scope and Authorization

- The owner approved task creation and planning on 2026-11-01. Implementation is not authorized by that approval.
- The owner subsequently agreed to simplify origin capture, recovery and compaction coupling, and requested a concrete change-size/cost assessment. That assessment remained read-only; implementation began only after the later approval below.
- After reviewing the concrete three-batch scope and effort estimate, the owner approved implementation with "同意". Implement batches 1 and 2 plus the read-only batch 3 preview; do not apply historical repairs, run paid application-model experiments/catch-up, commit or push without their corresponding authorization.
- Working directory: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`; initial HEAD: `6b36d0d`.
- The worktree already contains extensive unrelated changes (201 porcelain status lines at entry). They are not owned by this task.
- The authoritative current-task source is this Codex session. The legacy `.trellis/.current-task` pointer is stale and is not used.
- Normal-use and background/delegated work are relevant cost dimensions. Quality degradation, deleting history, changing the model, disabling required tools, and adding arbitrary budgets are not assumed acceptable optimizations.

## Implementation and Research References

- [Implementation report](research/implementation-report.md) — delivered behavior, actual change scope, checks and remaining limits.
- [Historical preview](research/historical-source-preview.md) — three unresolved old gaps and independently processable candidate groups.
- [Final independent review](research/final-review.md) — full implementation challenge and added lifecycle coverage.


- [Diagnosis and design](design.md) — measured findings, existing protections, options, tradeoffs, and cost criteria.
- [Proposed implementation sequence](implement.md) — review, scoped execution, verification, and rollback boundaries.
- [Runtime data map](research/runtime-data-map.md) — actual source, schemas, missing observations, and reproduction commands.
- [Runtime metrics](research/runtime-metrics.json) — normalized usage, request cohorts, tools, and compaction evidence.
- [Failure root causes](research/failure-root-causes.md) — source-proof gaps, presentation failure classification, and read-only queries.
- [Usage coverage](research/usage-coverage.md) — actually connected primary/auxiliary accounting and SDK version limits.
- [Reference practices](research/reference-cache-practices.md) — pi, DeepSeek Harness, and official provider/SDK sources.
- [Replay probe](research/replay-projection.json) — current pure projection behavior with fixed, explicitly stated calibration.
- [Independent review](research/independent-review.md) — challenge of original-goal coverage and safety/measurement claims.
- [Simplification scope review](research/simplification-scope-review.md) — accepted-direction alternatives, actual affected seams, change-size estimates and verification boundaries.

## Subsequent Real-Data Authorization and Acceptance

The owner explicitly authorized real conversation data and paid model calls after the code-only delivery.
The bounded operation is documented in [the catch-up plan](research/real-catchup-plan.md) and
[the completed real-data report](research/real-catchup-report.md).

- [x] Consistent pristine backup, migration rehearsal and actual forward migration.
- [x] Explicit historical user-only classification for the three gaps, without invented Run linkage.
- [x] Process 420 pending records through the production journal; latest coverage4232 and pending0.
- [x] Commit summary revision6 through4182, preserving50 recent original rows and all original Timeline data.
- [x] Record all5 successful provider calls and complete raw usage; verify5 new facts through Local Recall.
- [x] Independent preservation/source-attribution spot check, accurate cost estimate and next-step guidance.

Natural-query/whole-summary quality and ongoing normal-conversation cost improvement remain separate observations.
No old unresolved model request was replayed, and no Git commit/push or permanent Core process was created.

## Approved Auxiliary Usage Follow-up

The owner agreed to durable auxiliary model accounting and a bounded real reasoning comparison after reviewing the
completed catch-up. The implementation contract is [auxiliary-usage-design.md](research/auxiliary-usage-design.md).
The existing explicit authorization for real data and paid calls persists; production thinking defaults remain unchanged
until evidence supports a separate decision. Existing Run accounting and unrelated workspace work must be preserved.

- [x] Actual auxiliary invocations persist across restart, including multi-step/retry and partial/unknown usage.
- [x] Existing Run-owned requests are not counted a second time.
- [x] Operator query exposes bounded pages and correctly denominated counts/cache metrics.
- [x] Optional metering failures never alter or repeat model execution; source/Run correctness remains intact.
- [x] Real fixed-input reasoning comparison records quality limits, actual tokens and cache-independent cost estimates.

Completed follow-up evidence: [auxiliary-usage-report.md](research/auxiliary-usage-report.md). Production thinking defaults remain unchanged after the failed quality comparison; current Core is running and actual auxiliary usage is queryable. Owner semantic acceptance and normal-chat cost improvements are not claimed.
