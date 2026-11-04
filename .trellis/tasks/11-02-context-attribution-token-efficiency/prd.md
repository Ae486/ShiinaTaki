# Context attribution and token efficiency

## Goal

Make the contents and size of actual model requests understandable, then reduce unnecessary token consumption and total cost for equivalent user tasks without weakening capabilities, answer quality, memory accuracy, necessary verification, or recoverability.

Cache reuse and token reduction are separate dimensions. A higher cache percentage alone is not success, and fewer input tokens alone do not prove lower total cost.

## Status and authorization

- On 2026-11-02 the owner explicitly approved beginning the reviewed attribution/Monitor implementation. The current slice delivers observation and display; broader token reductions follow measured evidence.
- On 2026-11-04 the owner approved repairing requested/response model identity correlation, then expanding the existing maintained model catalog with names, canonical relationships, capabilities and provider icons. These follow-ups remain within the parent and existing native/capability child.

- Created on 2026-11-02 at the owner's explicit request to create a task and record the discussion.
- Initial status was planning; the task is now in progress under the later execution approval. Initial task creation authorized records only. In the subsequent clarification, the owner requested heartbeat-flow analysis and authorized native-image/capability work in this task if bounded; complex work must be separated into one task. Assess the actual scope before activation.
- The owner then approved the coordinated execution stage: parent attribution investigation in parallel with native-image implementation in the linked child. Both were followed by the verified Monitor instrumentation implementation. Evidence-selected token-reduction pilots remain future parent work.
- The owner previously permitted real data and paid model calls for the diagnosis. Preserve that authorization for matching bounded work; do not interpret task creation as a request to run calls now.
- The [completed cache/cost task](../archive/2026-11/11-01-cache-token-cost-diagnosis/task.json) remains archived and supplies the baseline. This task does not reopen its completed recovery, tidy, accounting, or cache-monitor delivery.

## Owner requirements

1. **Request composition and visibility.** Identify the parts of the context, quantify their proportions, and establish whether their sources can be identified, including prompts, tools, MCP and Skills. Display composition together with cache hit rate and used context / effective context-window limit in Monitor. Updates follow completed request accounting, including individual requests inside a tool loop.
2. **Unnecessary model calls.** Investigate avoidable tool mistakes and repeated calls. Balance first-call correctness against the cost and complexity of added instructions, checks and retries. Preserve legitimate inspection, adaptive work and verification.
3. **Repeated history and tool results.** Study established reduction mechanisms. Folding with on-demand recovery is a candidate; prefer verified mechanisms and prove that recovery is usable by the model.
4. **Same-turn tool loops.** Investigate repeated context within a single loop, preserving correct tool feedback and execution semantics.
5. **Prompt and injected-memory overhead.** Identify actual redundancy and evaluate changes together with cache behavior. Correct caching misconceptions using the current provider path.
6. **Summaries and background processing.** Evaluate useful work, input/output consumption, frequency, cache interactions and downstream quality together.
7. **Evidence before optimization.** Use old and new real observations, separate facts from hypotheses, and challenge owner/agent assumptions when contradicted by evidence.
8. **Maintainability.** Prefer existing producers and simple bounded mechanisms. Avoid overdesign and layers of defensive logic without a demonstrated failure mode.
9. **Heartbeat and proactive interaction.** Explain their actual data chain and where they share or differ from ordinary conversation requests, history, output delivery, memory and usage. Do not infer one context composition merely from shared runtime code.
10. **Native image input.** Every image source, including user attachments, agent screenshots, ambient perception and proactive evidence, goes directly to the primary model. Remove the separate vision-model configuration, image-to-text translator calls and their prompts. Merely switching the translator to the primary model is insufficient. Migrate screenshot/perception consumers rather than excluding them or preserving the translator for compatibility. Images belong to their enclosing message/tool content and need no separate token-meter category or subsystem.
11. **Model capability discovery.** At model configuration, reuse maintained catalog/provider metadata for names, explicit canonical relationships, provider icons, tools, multimodal input and applicable search capabilities. Avoid application-maintained per-model correspondence. Distinguish declared metadata from what a custom endpoint actually supports; do not invent universal detection or silently classify unknown as unsupported. Reuse existing capabilities before adding a dependency or framework. Catalog availability never determines whether valid request statistics are displayed.

## Measurement and quality constraints

- Preserve the existing cache metric: input-weighted eligible observations since the current primary Character's latest successfully committed primary summary, including foreground and background calls. Unknown cache usage is not zero. A failed summary or memory tidy does not reset it.
- Make each metric's request/window/model scope explicit. Do not mix unrelated model requests into one context occupancy or window denominator.
- Distinguish provider-reported totals, local component estimates, missing data and multimodal uncertainty. Do not fabricate historical provenance or per-component exactness.
- Use non-overlapping composition categories. MCP/Skill origin is a separate attribution dimension when it overlaps content categories.
- Image input remains included in the provider's total request usage. There is no separate image token counter; component estimates must still state their coverage without fabricated zero/exactness.
- Cached input still occupies context and remains input usage. Changes must be evaluated over subsequent requests, including cache disruption, summarization and recovery calls.
- Count output/reasoning correctly: reasoning already included in output must not be added a second time. Failed/cancelled calls with known usage remain part of observed cost.
- Preserve original records, error/partial/empty distinctions, necessary evidence and required tool capabilities. Model-accessible recovery must not re-execute the original side effect.
- Compare equivalent scenarios and record quality outcomes, input/cache/output usage, request counts, recovery calls, latency and applicable prices. Do not promise a percentage saving before measurement.
- Keep private conversation bodies and credentials out of ordinary task reports; retain sanitized aggregates and necessary source references.

## Acceptance criteria

The observation implementation is automatically verified; see research/execution-progress.md. Synthetic-provider integration proves wiring, not real-provider sizing, native owner acceptance or cost savings.

- [x] The content taxonomy, provenance coverage and unknown cases are documented against actual request construction, including tools, MCP, Skills and multimodal input. See `research/request-composition-attribution.md` and the refined `design.md`; these are source/research evidence, not running Monitor instrumentation.
- [x] Heartbeat/proactive flow and its request/context/history/accounting differences are documented from current wiring in `research/heartbeat-message-flow.md`. This is static wiring evidence, not live acceptance.
- [x] Native-image and model-capability scope is classified and assigned to one linked task because it crosses configuration, native request construction, tools, perception/initiative and history. This records scope assignment, not implementation or owner acceptance.
- [x] Monitor shows the three requested metrics with clear scopes, model/window identity and honest estimation/coverage labels; completed-request updates work without resetting the existing cache window incorrectly.
- [x] Request measurements correspond to actual dispatched content, including continuation-step messages and active tools; usage is correlated without double counting.
- [ ] Old and new observations support a prioritized list of avoidable consumption, with legitimate multi-step work separated from waste.
- [ ] Each proposed reduction has an explicit adopt/reject/defer decision supported by relevant quality and total-cost evidence. Implementation scope is reviewed before production changes.
- [ ] Any adopted folding mechanism demonstrably preserves accessible originals and necessary tool semantics, including exact-detail recovery and failed recovery.
- [ ] Same-loop reduction is not adopted until call/result fidelity and non-duplication of effects are demonstrated.
- [ ] Final delivery states measured benefits, costs, limitations, rejected candidates and remaining unknowns. Automated checks are not presented as owner manual acceptance.

## Scope boundaries

- Subagent-runtime optimization is not a primary focus because current samples are insufficient. This does not prohibit using development advisors where project rules require them.
- No blanket tool removal, arbitrary request/token cap, global thinking disablement, memory freeze, or destructive history deletion as a shortcut.
- No provider-private cache framework, second billing ledger, general retrieval platform, or unrelated runtime rewrite without a demonstrated need and reviewed scope.
- No production changes, live database changes, service restart, paid call, commit, push or archive was part of the initial task-creation turn. The subsequent conditional implementation authorization is recorded above; concrete complex implementation still requires the normal planning review.
- Keep work in `H:/TakiAgent-worktrees/t4`; preserve pre-existing `artifacts/` and other collaborators' work. Use English engineering artifacts and Simplified Chinese owner communication. Development subagents, if needed, use the owner-allowed astra / 5.6sol / 6.1sol families.

## Planning references and unresolved decisions

- [Native multimodal main flow and model capabilities](../11-02-native-multimodal-model-capabilities/prd.md) owns owner items 2 and 3 as one verified linked implementation. Its native source/dispatch boundary is integrated with attribution, using ordinary total usage without an image meter.
- The owner requested planning for parallel context investigation and image unification. [The coordinated sequence](implement.md#coordinated-work-sequence-2026-11-02) allows that parallelism, assigns one owner to shared request/replay changes, and keeps capability discovery off the native-image critical path.
- [Measurement design](design.md): implemented nine categories, orthogonal origin coverage, exact dispatch/Effect binding, real-window units and bounded existing-ledger/push integration. Automated implementation evidence is recorded in `research/execution-progress.md`; actual user deployment and natural-use outcomes are separate evidence.
- [Execution-plan draft](implement.md): ordered investigation, review and validation stages.
- [Evidence and handoff](research/planning-baseline.md): dated baseline, code/reference pointers and limitations.
- [Heartbeat data flow](research/heartbeat-message-flow.md), [all-image migration scope](research/native-image-flow-scope.md), and [model capability discovery](research/model-capability-discovery.md): current-code findings supporting the owner's follow-up and the linked task split.

Dispatch attribution, effective-window units, initial grouping and reactive display are implemented and verified. Remaining decisions concern naturally occurring request costs, model-accessible original-result recovery and which reduction has sufficient benefit. Candidate-specific implementation scope, budgets and quality/cost acceptance follow that evidence.
