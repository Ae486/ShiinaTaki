# Agent delegation and source-aware context

## Goal

Improve the Companion's handling of external material and delegated work without confusing that material with the user's own experience. Coordinate a supported AI SDK baseline, reusable Subagents, source-preserving context and prompts, and end-to-end acceptance of the Co-Watching motivating case.

The owner authorized task organization, planning and research dispatch on 2026-10-21, then required waiting before formal start. The later instruction to optimize global rules and enter development when ready supersedes that wait. Implementation may proceed within reviewed child scope and dependency gates, without further routine permission requests. On 2026-10-22 the owner additionally authorized real-model end-to-end testing to verify the implementation. Use bounded cases and isolated test-owned data, including the required model calls. This parent is the coordination and integration authority, not a second Runtime owner. Production publication, Git commit/push, real-user memory mutation and destructive operations remain outside this authorization.

## Requirements

- R01: Upgrade the existing AI SDK ecosystem coherently after capturing a reproducible compatibility baseline. Prefer supported package features and established official implementations; do not assume a patch upgrade is behavior-neutral.
- R02: Reuse the same Agent Runtime/framework for parent and child work. Preserve Core governance, Run/Attempt/Effect ownership, one continuous Character relationship Timeline and derived Replay Views.
- R03 / G1: Always retain the child result for inspection. A captured delegation choice controls whether completion requests subsequent parent inference. Recording, inference and user-facing publication remain separate facts.
- R04 / G2: Let the parent decide whether to create a new child or reuse an existing child's working context. Do not encode feature-specific reuse heuristics as mandatory rules or restart terminal Runs.
- R05 / G3: Let the parent organize the task, selected starting context, material and addressed follow-ups. Inherited context is a snapshot; later parent conversation is not automatically mirrored.
- R06 / G4a-G4b: Stopping a parent request never cascades to children, including request-specific children. Each child keeps its original completion policy and may request a newly admitted parent execution after completion.
- R07 / G4c: Preserve a user-stopped child's context and require user continuation before resuming it. Parent-directed interruption can be resumed by the parent. Process shutdown, uncertain effects and restart recovery remain governed by existing runtime constraints.
- R08: Provide a navigable Subagent Conversation with readable progress, addressed input, stop and continuation controls. Its private work transcript does not become another Character relationship history.
- R09: Preserve CS01-CS11 in `docs/AGENT-CONTEXT-SOURCES.md`: program-supplied known source information, model interpretation, native role/tool framing, optional material-level metadata, relevance and consistent handling across foreground/background generation, replay, compaction and memory stages.
- R10: Distinguish generation origin from material origin. A marker at initial input is insufficient if publication, replay or compaction loses its meaning. Retain durable information only where verified consumers need it; do not invent missing historical attribution.
- R11: Before selecting XML, JSON, Markdown or prompt wording, inspect current official documentation and implementations as needed, then validate the actual serialized model input and representative behavior. Documentation, source inspection, local deterministic tests and live model evidence must be labelled separately.
- R12: Preserve existing memory eligibility/authority, foreground coordination, source/revision/playback validity and truthful delivery status. Do not relax them merely to improve attribution.
- R13: The coordinating agent owns task dependencies, bounded delegation, report integration and verification. Resolve routine engineering choices from evidence without reopening settled product preferences.
- R14: Subagents have read-only access to Memory through the existing shared runtime. They may retrieve relevant memory and return proposed changes as work results, but cannot retain, edit, invalidate, restore or automatically ingest their private work into long-term Memory. The main Companion owns decisions to change Memory under its existing authority. Private Run transcripts and Effect records remain runtime evidence, not long-term Memory writes. This owner clarification was added on 2026-10-22.

## Acceptance Criteria

- [x] AC01: The chosen SDK versions and compatibility evidence are reproducible; baseline failures are separated from introduced regressions and lockfile rollback is documented. See the SDK child's final implementation and independent-review records, including the owner-approved cancellation policy.
- [ ] AC02: Create/reuse, selected snapshot and addressed follow-up work without leaking private child history or automatically mirroring unrelated parent chat.
- [ ] AC03: Completion is recorded once; record-only work causes no parent model request, and continuation-requesting work causes one eligible new execution without automatically publishing speech.
- [ ] AC04: Parent stop leaves every child running; child controls target the intended child, and user-stop versus parent-interruption semantics remain distinct.
- [ ] AC05: The Subagent Conversation supports view/input/stop/continue through the shared framework, with readable loading, empty and error states.
- [ ] AC06: Actual model input retains sufficient available attribution at material ingestion, delegation, publication replay and compaction; missing metadata stays unknown rather than guessed.
- [ ] AC07: Video or quoted external experiences are not asserted as the user's own, while an explicit user self-report remains understood correctly, including mixed-source and post-compaction follow-ups.
- [ ] AC08: Memory admission/extraction/maintenance/use preserve source meaning within existing authority and eligibility. Provider-owned prompts or unavailable test paths are explicitly documented, not claimed verified.
- [ ] AC09: Revision, independent stop, stale results and restart/uncertain-effect cases preserve runtime identity, existing Co-Watching playback/delivery protections and relationship ordering.
- [ ] AC10: Automated, live-model and owner acceptance results are recorded separately. Existing outstanding manual playback checks are neither silently passed nor duplicated as newly completed work.
- [ ] AC11: Child memory reads work within existing authority, while mutation tools and automatic private-work ingestion remain unavailable across create/reuse, addressed input, retries and recovery. The main Companion's permitted memory operations remain available. Capability enforcement is verified at actual executable-tool/dispatch boundaries, not merely through prompt wording or hidden schemas.

## Constraints and out of scope

- Work only in `H:/TakiAgent-worktrees/t4`; preserve the existing dirty tree. The explicit real-model E2E authorization permits required test model calls and isolated test state. It does not authorize commit, push, archive, production deployment or real-user memory mutation.
- No preselected framework replacement, second permission authority, second relationship session store, feature-specific model loop, full provenance graph, mandatory sentence-level attribution or extra classification Agent.
- No browser source-selection UX redesign, unrelated initiative/Memory/extension redesign or automatic dependency-update service in this delivery.
- Package metadata and upstream examples do not establish supported Windows deployment, exactly-once effects, adapter feature parity or successful model behavior without evidence.

## Definition of done

All independently verifiable child deliverables satisfy their acceptance criteria; the parent integrates the evidence against AC01-AC11 and records any remaining owner trials honestly. Production implementation is not complete merely because research or task planning is complete.

## Requirement sources

- [Delegation decisions G1-G4](../../../docs/AGENT-DELEGATION-RESEARCH.md)
- [Context-source requirements CS01-CS11](../../../docs/AGENT-CONTEXT-SOURCES.md)
- [Domain glossary](../../../CONTEXT.md)
- [Architecture roadmap](../../../docs/ARCHITECTURE-ROADMAP.md)
- [Prior research and latest-package leads](research/prior-evidence.md)
