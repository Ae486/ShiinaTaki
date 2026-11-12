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

## Completed Diagnosis Acceptance (initial read-only phase)

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

## Approved tidy repair and new-conversation diagnosis

The owner approved repairing partial tidy completion/recovery and diagnostics, verifying it, then resuming the original
cost investigation using new normal conversations and historical records. Existing real-data/paid-call permission
persists. The design is research/tidy-repair-design.md; no new commit/push/archive authorization is implied.

- [x] Exact proven correction can complete Local tidy; unrelated success cannot hide errors.
- [x] Partial committed work and safe failure reasons reach the operator without weakening CAS/authority.
- [x] Existing Legacy/Hindsight contracts, old-client errors and unknown transport outcomes remain truthful.
- [x] Isolated integration and actual rendered UI verify the original failure and success paths.
- [x] New/old normal-conversation token/cache/tool costs are compared with explicit cohort/quality limits.

The [tidy repair report](research/tidy-repair-report.md) records 6,524 passing tests/6 skipped, the rendered WS cases,
independent review, and one successful real-model pass (11 effects, four provider calls) after updating Core to PID26756.
The [new conversation analysis](research/new-conversation-cost-analysis.md) records 20 foreground Runs, 39 requests and
six normal background calls; independent SQL confirmed 96.06% foreground cache and conditional CNY0.2013968 total.
This is a short observational cohort, not controlled causal savings or owner semantic/UI acceptance. The task stays
in progress for sustained normal-use validation and review of bounded optimization candidates; defaults are unchanged.

## Added requirement: live cache rate between primary summaries

The owner requested an explicit, automatically updated overall cache-hit metric in Monitor and chose to continue
under this task rather than create another task. The owner then specified that each successfully committed primary
conversation summary starts a new statistics window. This supersedes the proposed all-history/day alternatives.

- Show the weighted input cache-read ratio prominently but compactly in Monitor, labeled in Chinese as the period
  since the current primary conversation summary. The ratio is sum(cache-read input) / sum(input) over the same
  eligible request observations, never an arithmetic mean of request percentages.
- Include recorded foreground and background model calls. Update after each terminal provider usage observation is
  durably recorded and the aggregate is ready; a multi-request conversation therefore updates more than once.
- A successful primary summary commit resets the displayed window immediately. Summary generation without a committed
  checkpoint, failed/stale/cancelled compaction, memory tidy and private child summaries do not reset it.
- A request that settles after a reset belongs to the new completion-based window. The successful summary's own model
  call settles before the checkpoint commit and therefore belongs to the preceding window.
- With no primary summary, use the pre-first-summary window. With no eligible input in a window, show no data rather
  than a synthetic zero. Explicit upstream zero cache hits are valid observations; omitted/conflicting/invalid data
  are unknown and excluded from both paired sums, with coverage shown.
- Preserve the same window through Core/page restart and reconnect; opening the page or changing the selected Run
  must not reset or reweight it. Keep this overall window distinct from the selected Run's browsing filters.
- Use existing durable usage sources, post-commit notifications and Monitor lifecycle patterns. Optional metric
  failures must not change a request outcome, replay model work or affect summary durability. Do not poll or retain
  prompts/conversation bodies for the metric.

Acceptance:

- [x] Weighted aggregation includes valid zero, excludes unknown consistently and counts each physical request once.
- [x] Successful primary summary commit starts an empty new window; failure/rollback and other maintenance do not.
- [x] Equal timestamps and calls spanning a reset cannot leak pre-reset settlements or lose post-reset settlements.
- [x] Completion updates the visible metric without a manual page refresh; restart/reconnect restores the same value.
- [x] Unknown, partial coverage, disconnected/stale, disabled and empty states are truthful and render correctly.
- [x] Production WS/UI integration and a read-only comparison against actual recorded usage verify the full path.

The planned normalization prerequisite and historical coverage limits are documented in
[live-cache-metric-review.md](research/live-cache-metric-review.md). Existing tidy/cost deliveries remain intact.
The concrete implementation proposal is [live-cache-window-design.md](research/live-cache-window-design.md), with
independent boundary review in [live-cache-window-advisor.md](research/live-cache-window-advisor.md). This addition
was explicitly approved and implemented. See [the completed delivery](research/live-cache-implementation-report.md):
6,591 tests passed/6 skipped, real SQLite/SDK/WS/browser evidence and actual main-entry integration, migration066 and
live Core PID47796 with92.8% over55/55 eligible observations. Owner acceptance is separate; implementation is ready
for ordinary Git/documentation wrap-up without folding more optimization candidates into this task. The owner has
now authorized commit/archive; final completion and follow-up boundaries are recorded in [closeout.md](closeout.md).
