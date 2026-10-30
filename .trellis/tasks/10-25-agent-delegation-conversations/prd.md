# Interactive agent delegation follow-up

## Goal

Make delegated workers usable as continuing task conversations while the main Agent remains available as the Companion. Child results and requests must reach the main conversation reliably without routine polling or interrupting foreground user chat. Reuse the existing shared Runtime and Chat interface.

## Authority and baseline

- Source discussion: `01a16d1d-191d-7070-a7e5-3181605428e8`, 2026-10-24; recovery chain and current session: [context recovery](research/context-recovery.md).
- The original source session authorized planning research. After reviewing the plan and message/wait mechanics, the owner requested implementation in session `01a17186-8409-7073-b737-845377a5e84f`: "了解，是否可以进行实现？". This authorizes the described production implementation and necessary verification; the older planning-only boundary is superseded.
- Implementation-agent routing follows the owner's next instruction: complex tasks use Astra, simple bounded tasks use 6.1 Sol, and reviews use Astra. This governs development collaboration, not the product's model-routing policy.
- Work stays in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`. Preserve the extensive existing dirty worktree.
- [Owner discussion record](../../../docs/AGENT-DELEGATION-RESEARCH.md), especially its October 24 section, is the requirements source. Distinguish owner decisions from assistant-recommended technical mappings.
- [October 23 acceptance](../10-21-agent-context-acceptance/research/acceptance-before-human-20261023.md) is the delivered baseline. Its automatic checks passed within their recorded scope; human acceptance, native Hindsight and T4/main SQLite convergence remain separate and unpassed.

## Requirements

1. The main conversation remains the child's primary reporting counterpart. It can inspect child state deliberately but should not routinely poll or explicitly block waiting for children.
2. Accept child final reports, interaction/input requests and unexpected interruption/failure durably. Foreground user interaction has priority; accepted events must not be lost, processed repeatedly as fresh work, or stranded indefinitely behind ordinary chat. Receiving an event, handling it, and speaking to the user are distinct.
3. Ordinary interaction can be asynchronous. A child explicitly needing input suspends dependent work and resumes in the same private conversation after addressed input. Runtime owns trustworthy lifecycle facts; prompts guide useful reporting and judgment. A natural model stop without a final report must remain distinguishable from successful task completion.
4. User input, main-Agent direction and system events remain distinguishable in model context and UI. Users can interrupt, correct and continue a child. User Stop does not proactively notify/wake the main conversation; explicit inspection still reveals it. Parent messages cannot clear a user-stop latch. Explicit user continuation restores normal child-to-main reporting without changing the counterpart.
5. A delegated task has no validity period and no fixed turn/action count. Waiting across days must not force a new task. Preserve individual request deadlines, genuine permission/source validity and explicit cancellation independently; removing old deadlines must not replay historical effects or auto-resume interrupted work.
6. Use task-oriented context compaction at pressure boundaries: summarize older completed action rounds and retain recent complete rounds. Support compaction during long tool loops and later conversation reuse; exclude Companion relationship/Memory processing. Preserve exact retained history and supply a usable self-scoped retrieval fallback with truthful pagination/failure states.
7. Model-facing delegation results expose readable identity, truthful state, useful results and required exact action targets without routinely copying internal receipts, full input or unrelated history pages. User-facing formatting separately provides readable names, progress and results.
8. Present each child as a continuous conversation using the existing Chat visual and interaction reference, shared components, familiar composer and Stop/Continue controls. Preserve drafts, paging, scroll anchors, pending content and reconnect/stale-target behavior. Live activity must come from real producers.
9. Task completion, interruption and closing a UI view do not permanently close a conversation. No new permanent-close feature is required. If later selected, closed conversations must remain readable and refuse direct/queued input visibly and authoritatively.
10. Preserve existing feature-owned `record_only` work, Run/Attempt/Effect authority, privacy/source boundaries and other main-conversation behavior. Prefer current SDK/package capabilities and existing owners; no framework/broker replacement without a demonstrated need.

## Acceptance criteria for later implementation

- [ ] Foreground conversation continues while child events arrive; bounded delivery eventually handles backlog without per-event user interruptions or routine status polling.
- [ ] Restart, duplicate notification, failed admission and unknown execution outcome retain truthful event state; accepted, delivered and handled are distinguishable.
- [ ] Asynchronous child messages, explicit input waits, final reports and runtime failure remain distinct; main handling may be silent or reply to the child.
- [ ] Direct user Stop creates no automatic main notification, including cancellation-derived notifications; explicit main inspection works; user continuation permits normal reporting while parent input alone cannot resume it.
- [ ] An answer after the former maximum task lifetime continues the same work, subject to real permission and stop checks. Existing expired/cancelled outcomes remain historical facts and effects are not replayed.
- [ ] A deterministic child exceeds both the old project and SDK fallback step caps and continues through compaction; main-Agent limits are unchanged.
- [ ] Summary failure retains raw evidence and reports an explicit bounded failure/degradation. Exact-history retrieval is available, self-scoped, source-attributed and fully pageable.
- [ ] Compact delegation tool results remain actionable with existing stale-target protections; inspection returns only the requested category/page and distinguishes absence, omission and failure.
- [ ] Actual child UI shows one coherent conversation, truthful sender/state, normal send/Stop/Continue, readable tool/report content, draft/scroll/paging stability and reconnect behavior. Automated UI evidence and owner acceptance are reported separately.
- [ ] Existing prepared-result/record-only work, publication authorization and foreground Chat regressions pass; no private work is automatically published to relationship Timeline or Memory.

## Research and planning artifacts

- [Context recovery](research/context-recovery.md) — original user instructions, superseding authorization and current session binding.
- [Runtime lifecycle](research/runtime-lifecycle.md) — existing owners, queue experiment, event/handling/recovery and expiry/publication compatibility.
- [Worker context and SDK](research/worker-context-sdk.md) — installed SDK source, offline probes, compaction/retrieval and safe call-segmentation gates.
- [Conversation UI](research/conversation-ui.md) — shared Chat seams, actual producer gaps, controls, ordering/paging and visual/interaction criteria.
- [Design](design.md) and [implementation plan](implement.md) — proposed contracts, alternatives, sequencing and requirement-to-test mapping.
- [Planning brief](research/planning-brief.md) — slice-specific source/spec loading for subsequent implementation and checks.
- [Foreground private boundary](research/foreground-private-boundary.md) — resolution of the saved review's mixed-request correction, existing Memory protection and concrete implementation gates.
- [Planning validation](research/planning-validation.md) — current checks, retained evidence, reviewer service failures and the next authorization boundary.

## Planning completion criteria

- [x] Verify the current code/SDK seams and record concrete evidence, reuse decisions and unresolved technical gates.
- [x] Produce a coherent `design.md`, ordered `implement.md` and curated implementation/check manifests.
- [x] Obtain an independent architecture challenge and resolve evidence-backed findings in the plan. Saved review plus current coordinator verification; fresh reviewer calls failed and are not counted as approval.
- [x] Prepare the change direction and tradeoffs for owner review; leave the task in `planning` pending implementation approval.

## Out of scope

New framework/broker/dependency installation; recursive delegation or a general task graph; a permanent-close feature; product model-routing/cost-policy redesign; new memory/provenance services; paid model calls; real-user database changes; T4/main migration convergence; native Hindsight validation; commit, push, finish/archive or release.
