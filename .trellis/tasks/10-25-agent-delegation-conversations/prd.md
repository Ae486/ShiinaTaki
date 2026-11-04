# Interactive agent delegation follow-up

## Goal

Make delegated workers usable as continuing task conversations while the main Agent remains available as the Companion. Child results and requests must reach the main conversation reliably without routine polling or interrupting foreground user chat. Reuse the existing shared Runtime and Chat interface.

## Authority and baseline

- Source discussion: `01a16d1d-191d-7070-a7e5-3181605428e8`, 2026-10-24; recovery chain and current session: [context recovery](research/context-recovery.md).
- The original source session authorized planning research. After reviewing the plan and message/wait mechanics, the owner requested implementation in session `01a17186-8409-7073-b737-845377a5e84f`: "了解，是否可以进行实现？". This authorizes the described production implementation and necessary verification; the older planning-only boundary is superseded.
- Implementation-agent routing follows the owner's latest instruction: choose Astra, 6.1 Sol or 5.6 Sol by task difficulty; complex architecture and critical reviews use Astra. On rate limits, resume the same subagent with its existing context and ownership. This governs development collaboration, not the product's model-routing policy.
- Work stays in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`. Preserve the extensive existing dirty worktree.
- [Owner discussion record](../../../docs/AGENT-DELEGATION-RESEARCH.md), especially its October 24 section, is the requirements source. Distinguish owner decisions from assistant-recommended technical mappings.
- [October 23 acceptance](../10-21-agent-context-acceptance/research/acceptance-before-human-20261023.md) is the delivered baseline. Its automatic checks passed within their recorded scope; human acceptance, native Hindsight and T4/main SQLite convergence remain separate and unpassed.
- 2026-10-30 (Claude Code session `0d1f3e80-677e-4e02-8be0-8781cef96719`): after the [maturity assessment](research/maturity-assessment-20261030.md), the owner approved its follow-up order, folded requirements 11-14 into this task and authorized real-model/E2E calls, encouraging them because real models expose real problems. Requirement 5 and the step-cap acceptance item are revised accordingly.
- 2026-10-30 (Codex session `01a18bce-da73-7f02-985a-b6d8f180dd28`): after discussing the follow-up order and check-in semantics, the owner confirmed provisional defaults N=50 and K=3, both configurable, completing the pending product decision and authorizing continuation of this existing task. No new Trellis task or Git delivery is requested.
- 2026-11-04 (Codex session `01a1a607-29a8-7c12-8a34-c6d90f0eb1aa`): after recovering session `01a195a9-001a-7ae1-bb3a-a0b1ed50e4ec`, comparing mature delegation interfaces, and reviewing the current parent/child action inventory, the owner authorized implementation and real-model verification: "如果已经根据成熟做法有了方向，可以开始实施优化，允许使用实际模型进行验证". Continue this existing task. Reduce parent coordination burden while preserving the requirements below; do not add a framework, routine polling, or an independent waiting subsystem. The November 1 request ceiling is historical; record a new bounded campaign before any new paid calls. No Git delivery, real-user data mutation or deployment is authorized.

Delivery authorization update (2026-11-04, same session): after reviewing the implementation and
results, the owner requested a local commit followed by an inventory of remaining requirements.
This authorizes committing the completed interface slice and its tests/docs. Push, archive, release
and implementation of additional requirements remain outside this delivery step.

## Requirements

1. The main conversation remains the child's primary reporting counterpart. It can inspect child state deliberately but should not routinely poll or explicitly block waiting for children.
2. Accept child final reports, interaction/input requests and unexpected interruption/failure durably. Foreground user interaction has priority; accepted events must not be lost, processed repeatedly as fresh work, or stranded indefinitely behind ordinary chat. Receiving an event, handling it, and speaking to the user are distinct.
3. Ordinary interaction can be asynchronous. A child explicitly needing input suspends dependent work and resumes in the same private conversation after addressed input. Runtime owns trustworthy lifecycle facts; prompts guide useful reporting and judgment. A natural model stop without a final report must remain distinguishable from successful task completion.
4. User input, main-Agent direction and system events remain distinguishable in model context and UI. Users can interrupt, correct and continue a child. User Stop does not proactively notify/wake the main conversation; explicit inspection still reveals it. Parent messages cannot clear a user-stop latch. Explicit user continuation restores normal child-to-main reporting without changing the counterpart.
5. A delegated task has no validity period and no hard total turn/action cap; requirement 11's periodic check-in bounds unattended progress instead (owner, 2026-10-30). Waiting across days must not force a new task. Preserve individual request deadlines, genuine permission/source validity and explicit cancellation independently; removing old deadlines must not replay historical effects or auto-resume interrupted work.
6. Use task-oriented context compaction at pressure boundaries: summarize older completed action rounds and retain recent complete rounds. Support compaction during long tool loops and later conversation reuse; exclude Companion relationship/Memory processing. Preserve exact retained history and supply a usable self-scoped retrieval fallback with truthful pagination/failure states.
7. Model-facing delegation results expose readable identity, truthful state, useful results and required exact action targets without routinely copying internal receipts, full input or unrelated history pages. User-facing formatting separately provides readable names, progress and results.
8. Present each child as a continuous conversation using the existing Chat visual and interaction reference, shared components, familiar composer and Stop/Continue controls. Preserve drafts, paging, scroll anchors, pending content and reconnect/stale-target behavior. Live activity must come from real producers.
9. Task completion, interruption and closing a UI view do not permanently close a conversation. No new permanent-close feature is required. If later selected, closed conversations must remain readable and refuse direct/queued input visibly and authoritatively.
10. Preserve existing feature-owned `record_only` work, Run/Attempt/Effect authority, privacy/source boundaries and other main-conversation behavior. Prefer current SDK/package capabilities and existing owners; no framework/broker replacement without a demonstrated need.
11. Runaway protection (owner, 2026-10-30): a running child pauses for a progress check-in every N model steps, counted across compaction segments since work start or the last check-in. Completion, input requests, Stop or failure before then end normally; a completion in the N-th step is a completion. The check-in report reaches the main conversation through the inbox; an explicit continue or redirect resumes the same work. After K consecutive main-Agent check-in continuations without user input, the next check-in requires the user. Count independently per work; trusted user guidance or explicit continuation of that work resets the unattended count, while ordinary main-chat input, parent messages, compaction and restart do not. User Stop remains user-only. Show cumulative token usage per child. Provisional defaults are N=50 and K=3; both must be operator-configurable through the existing configuration system.
12. Unattended inbox handling may answer, record or stop existing children but cannot create new children.
13. Stuck states are visible and recoverable: `needs_user_input` dispositions and reconciliation-needed batches notify the user, and a pre-intent idle failure retries on a bounded timer as well as on fresh opportunities, without duplicate handling.
14. Tightening requirement 7: ordinary messages do not fail merely because the child started or finished a Run since the model last read it; exact-version checks remain where acting on stale state is unsafe, such as Continue after Stop or answering a specific request. Model-facing inbox and inspection output omits digests and internal receipts, full results are truncated and paged, and refusals state the current status and the next valid action.
15. Parent coordination should expose clear business choices with fewer overlapping action routes and fewer model-maintained bookkeeping parameters. Replying to a child, explicitly continuing a permitted wait, retaining evidence, involving the user, and delivering an answer must remain available and distinguishable.
16. Interface simplification must preserve durable atomic acceptance, meaningful retry/conflict handling, exact pending-request and user Stop checks, private evidence boundaries, and separate publication authority. Historical actions and their receipts remain truthful; ordinary model termination or a read alone does not acknowledge an event.
17. Preserve useful foreground work and user interaction during delegation. Do not infer that all foreground work is blocked merely because a child exists. Any proposed explicit end-of-turn action must justify its benefit without expanding the coordination surface unnecessarily.
18. Validate the simplified interface through actual SDK/SQLite integration and a bounded real-model campaign. Cover child questions/answers, check-in continuation, separately delivered reports, final public delivery, unrelated foreground work, and attempts to wait through execution tools. Distinguish real models, scripted Hosts, native Hosts, and owner acceptance.

## Acceptance criteria for later implementation

- [ ] Foreground conversation continues while child events arrive; bounded delivery eventually handles backlog without per-event user interruptions or routine status polling.
- [ ] Restart, duplicate notification, failed admission and unknown execution outcome retain truthful event state; accepted, delivered and handled are distinguishable.
- [ ] Asynchronous child messages, explicit input waits, final reports and runtime failure remain distinct; main handling may be silent or reply to the child.
- [ ] Direct user Stop creates no automatic main notification, including cancellation-derived notifications; explicit main inspection works; user continuation permits normal reporting while parent input alone cannot resume it.
- [ ] An answer after the former maximum task lifetime continues the same work, subject to real permission and stop checks. Existing expired/cancelled outcomes remain historical facts and effects are not replayed.
- [ ] A deterministic child exceeds both the old project and SDK fallback step caps and continues through compaction until its check-in interval; main-Agent limits are unchanged.
- [ ] Summary failure retains raw evidence and reports an explicit bounded failure/degradation. Exact-history retrieval is available, self-scoped, source-attributed and fully pageable.
- [ ] Compact delegation tool results remain actionable with existing stale-target protections; inspection returns only the requested category/page and distinguishes absence, omission and failure.
- [ ] Actual child UI shows one coherent conversation, truthful sender/state, normal send/Stop/Continue, readable tool/report content, draft/scroll/paging stability and reconnect behavior. Automated UI evidence and owner acceptance are reported separately.
- [ ] Existing prepared-result/record-only work, publication authorization and foreground Chat regressions pass; no private work is automatically published to relationship Timeline or Memory.
- [ ] Check-in: a child finishing before step N ends normally; one reaching N pauses with a progress report, resumes the same work on explicit continue, counts steps across compaction and escalates to the user after K consecutive unattended continuations; per-child token usage is visible. Defaults N=50/K=3 and operator changes reach the real runtime with truthful application semantics; restart preserves the unattended count and user Stop authority.
- [ ] Unattended inbox handling cannot create children; answering, recording and stopping existing children still work.
- [ ] `needs_user_input` and reconciliation-needed states reach the user; a pre-intent idle failure retries on a bounded timer without duplicate handling.
- [ ] Model-facing delegation output carries no digests or internal receipts, pages full results, keeps stale-target protection where stale action is unsafe, and lets a model recover from a refusal without rebuilding identifiers by hand.
- [ ] A real-model campaign on the production model route, with prompts that do not dictate tool names or arguments, covers natural delegation, follow-up messages, a needs-input round trip, a full inbox batch and a long child through compaction and check-in. Findings are fixed or explicitly deferred.

## Research and planning artifacts

- [November 4 interface acceptance](research/interface-acceptance-20261104.md) — delivered five-intent
  contract, current source checks, bounded real-model evidence and remaining parent-task gates.
- [Context recovery](research/context-recovery.md) — original user instructions, superseding authorization and current session binding.
- [Runtime lifecycle](research/runtime-lifecycle.md) — existing owners, queue experiment, event/handling/recovery and expiry/publication compatibility.
- [Worker context and SDK](research/worker-context-sdk.md) — installed SDK source, offline probes, compaction/retrieval and safe call-segmentation gates.
- [Conversation UI](research/conversation-ui.md) — shared Chat seams, actual producer gaps, controls, ordering/paging and visual/interaction criteria.
- [Design](design.md) and [implementation plan](implement.md) — proposed contracts, alternatives, sequencing and requirement-to-test mapping.
- [Planning brief](research/planning-brief.md) — slice-specific source/spec loading for subsequent implementation and checks.
- [Foreground private boundary](research/foreground-private-boundary.md) — resolution of the saved review's mixed-request correction, existing Memory protection and concrete implementation gates.
- [Planning validation](research/planning-validation.md) — current checks, retained evidence, reviewer service failures and the next authorization boundary.
- [Maturity assessment](research/maturity-assessment-20261030.md) — 2026-10-30 verified findings, external comparison and owner decisions behind requirements 11-14.

## Planning completion criteria

- [x] Verify the current code/SDK seams and record concrete evidence, reuse decisions and unresolved technical gates.
- [x] Produce a coherent `design.md`, ordered `implement.md` and curated implementation/check manifests.
- [x] Obtain an independent architecture challenge and resolve evidence-backed findings in the plan. Saved review plus current coordinator verification; fresh reviewer calls failed and are not counted as approval.
- [x] Prepare the change direction and tradeoffs for owner review; leave the task in `planning` pending implementation approval.

## Out of scope

New framework/broker/dependency installation; recursive delegation or a general task graph; a permanent-close feature; product model-routing/cost-policy redesign beyond requirement 11's check-in and usage display; new memory/provenance services; real-user database changes; T4/main migration convergence; native Hindsight validation; commit, push, finish/archive or release. Retained-data cleanup (T4-D88) and routed approvals for background children (T4-D89) are deferred in `docs/deferred-decisions.md`.
