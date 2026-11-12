# Shared initiative runtime and delivery foundation

## Goal

Extend the existing execution and observability framework so one bounded autonomous opportunity can run, decide, hold/deliver and recover through the same Run/Attempt/Agent/Effect/Timeline/Monitor path.

## Parent and dependency

This is child 1 of [Unified Companion initiative](../09-11-companion-initiative-implementation/prd.md). It inherits the parent's confirmed scope, authority, workspace, exclusions and source precedence.

**Prerequisite:** Reviewed parent design and a verified incoming Memory/schema baseline; no preceding implementation child.

Work stays in `H:/TakiAgent-worktrees/t4` on `task/t4-skills-mcp-productization`. The parent baseline gate passed on 2026-09-20 and this child proceeds under the owner's existing development approval. Creation/activation grants no commit/push/finish authority.

## Requirement coverage

R01, R08-R12, R15-R16. Parent acceptance ownership: AC01, AC09-AC14, AC17-AC18; contributes to AC19.

## Scope

- Shared selected-context, decision, continuation and mixed-version event contracts; preserve existing v1 readers/producers and compatible client projections.
- Existing Character coordination and primary/Scheduled call sites; primary reservations, background priority and bounded cancellation cleanup.
- Run snapshot, ChatAgent request selection/preparation, strict tool profile and heartbeat_respond accepted-decision stopping.
- Shared delivery repository/coordinator, transaction-aware Timeline publication, same-Run executable continuation and recovery classification.
- Existing Monitor business-fact projection and bounded policy-read seam; no synthetic Run for a denied opportunity.
- Existing User Timezone authority/service, designated-device report contract and future schedule recomputation; child 2 completes actual Desktop reports/settings.
- Incoming Memory 036/040/runner compatibility review before later schema writers; no duplicate bridge or automatic authority switch.

## Acceptance criteria

- [ ] **C1-01** Real SDK request is thin and authority-captured; non-primary control remains ephemeral and ordinary primary behavior is unchanged.
- [ ] **C1-02** Primary admission gap/races, FIFO per priority, cross-Character work, background refusal and cancellation do not leak reservations or create spurious Runs.
- [ ] **C1-03** All three outcomes, invalid/conflicting/duplicate terminal calls and observer settlement failures behave truthfully.
- [ ] **C1-04** Held expression releases the slot, resumes the same Attempt without the model, and is refused after expiry/revocation/terminal state; crash cuts do not auto-complete it.
- [ ] **C1-05** Same-identity publication is idempotent; quotas/gap are atomic; pre-publish cancellation releases only unused capacity, uncertainty does not refund.
- [ ] **C1-06** Existing Monitor shows the same Run and factual events after reopen; old-client projection and mixed event decoding retain cursor correctness.
- [ ] **C1-07** Supported migration lineages retain Memory/Timeline state; unsupported/unmappable history refuses atomically.
- [ ] **C1-08** Fixed and designated-device timezone changes preserve absolute/fixed schedules and recompute only future user-zone work.

## Exclusions and completion

Keep all parent exclusions: D79, the separate D78 redesign, phone implementation, autonomous long-term Pattern evolution and unrelated Avatar Lab/OpenBiliClaw work. This child does not close the whole first delivery.

Completion requires scoped tests, formal review, matching spec/index updates and an evidence report. Unperformed native/owner checks remain explicitly pending.

## Artifacts

- [Child design](design.md).
- [Child implementation plan](implement.md).
- [Parent technical design](../09-11-companion-initiative-implementation/design.md).
- [Parent sequence and acceptance matrix](../09-11-companion-initiative-implementation/implement.md).
