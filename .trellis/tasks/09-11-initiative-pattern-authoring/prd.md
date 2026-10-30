# Interaction Patterns and unified wake policy

## Goal

Deliver one typed Pattern authority and supported Signal/Wake path, including the complete user-initiated conversational and panel authoring/confirmation/management loop.

## Parent and dependency

This is child 3 of [Unified Companion initiative](../09-11-companion-initiative-implementation/prd.md). It inherits the parent's confirmed scope, authority, workspace, exclusions and source precedence.

**Prerequisite:** Children 1 and 2 must pass their execution, delivery, presence, timezone and evidence contracts.

Work stays in `H:/TakiAgent-worktrees/t4` on `task/t4-skills-mcp-productization`. The owner activated C3 implementation on 2026-09-28 after the C1/C2 automated prerequisites. Commit/push/finish and manual acceptance remain separate.

## Requirement coverage

R01-R05, R09-R16. Parent acceptance ownership: AC02-AC06, AC12-AC14, AC17; contributes to AC01 and AC19.

## Scope

- Pattern identities, immutable revisions, CAS confirmation and lifecycle; seed/user/Agent candidates share one service.
- Closed supported condition vocabulary, real Signal adapters, bounded coalescing/selection and common eligibility.
- Core/user-level model-opportunity and utterance limits, Pattern timing/chance, explicit initiative target and accurate policy diagnostics.
- Primary authoring/management tool, Core operator methods, readable candidate/revision cards and reactive management UI.
- Normal runtime Skill source package and explicit standard import/setup, preserving user-owned packages and enablement.
- Same Monitor policy/decision projections; no per-behavior or per-page runtime/polling system.

## Acceptance criteria

- [ ] **C3-01** All six authoring steps work, including clarification, concrete review, confirmation, actual wake participation and later management.
- [ ] **C3-02** Seed upgrades and Skill imports cannot overwrite user edits, pauses, disablement or packages without explicit revision-bound replacement.
- [ ] **C3-03** Concurrent candidate confirmation/revision is CAS-safe and idempotent; permission grants remain unchanged.
- [ ] **C3-04** No model request for missing/stale/quiet/busy/privacy/unsupported/budgeted sources; policy evidence is accurate and bounded.
- [ ] **C3-05** Two supported behaviors run through the same adapter using data-only definitions; global budget/target changes cannot bypass caps.
- [ ] **C3-06** Realtime and replayed Monitor views agree, and all visible/expanded/accessibility/copy fields omit internal identifiers.
- [ ] **C3-07** Existing primary chat, approval disclosure, schedule behavior, scroll/focus and configured source privacy are preserved.

## Exclusions and completion

Keep all parent exclusions: D79, the separate D78 redesign, phone implementation, autonomous long-term Pattern evolution and unrelated Avatar Lab/OpenBiliClaw work. This child does not close the whole first delivery.

Completion requires scoped tests, formal review, matching spec/index updates and an evidence report. Unperformed native/owner checks remain explicitly pending.

## Artifacts

- [Child design](design.md).
- [Child implementation plan](implement.md).
- [Parent technical design](../09-11-companion-initiative-implementation/design.md).
- [Parent sequence and acceptance matrix](../09-11-companion-initiative-implementation/implement.md).

