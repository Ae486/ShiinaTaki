# Interaction Patterns and unified wake policy — design

## Normative design and reading order

Read the curated context entries, this child PRD, this design and its implementation plan, then the [parent design](../09-11-companion-initiative-implementation/design.md). The parent owns shared contracts; this child narrows execution ownership and does not define an alternative architecture.

Parent implementation section 5 supplies the matching ordered scope. Children 1 and 2 must pass their execution, delivery, presence, timezone and evidence contracts.

## Owned modules and boundaries

Paths below name existing module areas or explicitly proposed additions. Confirm precise filenames against live source before editing; new paths are not evidence of installed features.

| Owner area | Responsibility |
| --- | --- |
| Shared | Proposed Pattern/Signal/policy/method contracts and labels; use common execution/report types from prior children. |
| Core domain | Proposed initiative/ Pattern repository/service, providers, matcher, eligibility/coalescer and adapter composition; current config/tool/method registries. |
| Desktop | Pattern candidate/revision controller/view, settings/management projection and existing Monitor field/filter adapters. |
| Skill resource | Proposed packages/core/resources/skills/companion-pattern-authoring/SKILL.md and standard packaging/setup path; not .agents. |
| Integration | Registry/main/index/migration updates by one owner, with source and event facts added together. |

## Required contracts

1. Conditions are validated supported data, not executable scripts or model-written predicates; unavailable stress/emotion sources are clarified rather than invented.
2. Bare cadence, reconnect and pause release cannot create a candidate; actual due/transition facts and active accepted policy are required.
3. Coalesce compatible reasons with provenance and select a bounded set before one shared Run; repeated events cannot reroll chance or multiply budgets.
4. Exactly one explicit initiative target is used in the current product; asset import or target switching cannot multiply speakers or reset global caps.
5. Draft revisions do not replace the active revision. Confirmation binds the exact displayed candidate and current base; stale confirmation cannot activate unseen content.
6. Conversation and panel share pause/resume/revision/history/rollback; rollback creates a new revision, never permission restoration or old occurrence replay.
7. Cards expose effective business parameters and differences without internal metadata; Pattern confirmation never routes through permission approval.
8. The authoring Skill uses the existing immutable package/catalog/import lifecycle and actual byte payload; same-name user/disabled packages are preserved.

## Concurrency and integration

One implementation owner serializes shared exports, `main.ts`, migrations and registry edits. Other agents may own non-overlapping bounded work after explicit assignment. Preserve existing changes; do not reset, rebase, overwrite another task or run the main worktree.

All new persistent/protocol fields are strict and bounded. Core remains the single writer. State plus required evidence commits atomically; publication follows commit. Context, generation and source identity remain internal binding facts rather than visible metadata.

## Validation design

- All six authoring steps work, including clarification, concrete review, confirmation, actual wake participation and later management.
- Seed upgrades and Skill imports cannot overwrite user edits, pauses, disablement or packages without explicit revision-bound replacement.
- Concurrent candidate confirmation/revision is CAS-safe and idempotent; permission grants remain unchanged.
- No model request for missing/stale/quiet/busy/privacy/unsupported/budgeted sources; policy evidence is accurate and bounded.
- Two supported behaviors run through the same adapter using data-only definitions; global budget/target changes cannot bypass caps.
- Realtime and replayed Monitor views agree, and all visible/expanded/accessibility/copy fields omit internal identifiers.
- Existing primary chat, approval disclosure, schedule behavior, scroll/focus and configured source privacy are preserved.

Use real owning services and meaningful failure/negative cases. Mocked UI or pure builder tests alone do not establish lifecycle, transport, source or native presentation contracts. Source tests cited in research were read, not run for this child.

## Sources

- [Research: domain-contracts.md](../09-11-companion-initiative-implementation/research/domain-contracts.md).
- [Research: reference-designs.md](../09-11-companion-initiative-implementation/research/reference-designs.md).
- [Research: observability-contracts.md](../09-11-companion-initiative-implementation/research/observability-contracts.md).
- [Research: decision-register.md](../09-11-companion-initiative-implementation/research/decision-register.md).
- [Effective parent decisions](../09-11-companion-initiative-implementation/research/decision-register.md).

