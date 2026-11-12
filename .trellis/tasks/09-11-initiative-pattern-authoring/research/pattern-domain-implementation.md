# C3 Pattern domain implementation evidence

Date: 2026-09-28. Workspace: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.

## Delivered scope

- `packages/shared/src/interaction-pattern-schema.ts`: closed, strict, bounded data-only condition grammar; immutable revision and semantic current-state projection. Seven supported atoms, eight conjuncts maximum, mandatory silence, explicit context selectors and finite/ongoing lifetime.
- `packages/shared/src/interaction-pattern-protocol.ts`: list/get/history and propose/confirm/change-state/rollback commands; explicit nullable fields, opaque transport bindings and typed refusals with current readable state.
- `packages/core/src/initiative/patterns/`: one authority for seed, operator and primary Agent authoring; immutable candidate revisions, CAS review, independent effective revision, lifecycle/history and rollback as a new reviewable revision.
- Additive migration `052-interaction-patterns.ts`: identities, revisions, reviews, command receipts and trusted primary-source bindings. Triggers protect immutable identity/revision/review/source/command evidence and reject foreign or unreviewed effective revisions. No Intention or permission tables are introduced.

The service entry is `createInteractionPatternService({ db, now?, onChanged? })`. Queries are `list`, `get`, `history`, `listActive(characterId)` and Core-only `findSeed(characterId, seedId)`. Mutations accept the strict Shared command and a separate trusted `InteractionPatternActor`. `registerPrimarySource({ characterId, runId, attemptId, userTimelineSeq, userTimelineId })` must receive the actual ChatAgent user-row identity, never a latest-row guess or model arguments.

Agent writes require an existing running primary Run and its active Attempt, a registered same-Character user row and its unchanged fingerprint. Retry reuses the immutable source; stale Attempts, changed/deleted rows, foreign Characters and non-primary Runs refuse. Review may occur after the authoring Run completes, but a removed/altered source invalidates the unaccepted candidate. Author keys and source Run links are durable internal provenance and never enter the readable projection.

Same command identity cannot reapply a write or accept changed content. Same primary source/definition with a changed tool-call identity cannot create another Pattern. New drafts retain current effective behavior and pause state; accepting an edited paused rule leaves it paused. Seed reimport uses stable seed identity, returning existing state across new import commands or bundled versions. It does not replace user edits, pending candidates, pause or retirement.

## Explicit engineering bounds

- At most 100 Pattern identities per Character, 1,000 immutable revisions per Pattern, and 10,000 retained command receipts and primary-source bindings per Character. Capacity refuses visibly; old deduplication evidence is not deleted to enable replay.
- Definition JSON is bounded to 16,384 characters; literal application alternatives to 16 names of 120 characters each; purpose to 1,000 characters; lists/history to 100 per page.
- `timing.minimumGapMinutes` is a tighter Pattern **judgment** cooldown, including silent judgments, distinct from the global published-utterance gap. Chance is passed to the common deterministic wake policy and never grants permission.
- `intention_due` is a supported grammar atom with no fabricated C4 source. Source availability and eligibility remain wake-owner responsibilities.

## Verification

- `pnpm --filter @taki/shared typecheck`: passed.
- `pnpm --filter @taki/shared test interaction-pattern-schema`: 18 tests passed.
- `pnpm --filter @taki/core typecheck`: passed after public Shared exports were integrated.
- `pnpm --filter @taki/core test pattern-service pattern-source 052-interaction-patterns`: 28 focused tests passed (12 lifecycle/CAS, 12 trusted-source, 4 migration).
- Scoped ESLint over the new Shared, Pattern domain and 052 migration/test files: passed.

SQLite coverage includes 051 file-backed upgrade/reopen with unchanged receipts/Timeline/timezone, immutable storage, foreign revision refusal, deferred-COMMIT rollback, required receipt/review failures, same-source replay, source retraction, exact current-state conflicts, lifecycle/history/rollback, lifetime boundaries and observer isolation. Tests assert governance and Approval tables remain unchanged and no Run/Timeline output is created by Pattern management.

## Integration and acceptance boundary

Root owns public exports, migration registry/tail assertions, tool/operator routing, actual ChatAgent source capture, Skill/setup, main composition and final cross-layer validation. The wake owner consumes `listActive` and revision/source fences. The Desktop owner consumes strict Shared views and keeps all identifiers, hashes and version tokens out of visible, expanded, accessibility and copied content.

This report proves the focused domain contracts only. Full runtime authoring/UI/wake acceptance, native rendering, real-provider trials and owner ACs remain with integration and must not be marked passed from these tests. No commit, push, archive, real-user database or external model was used.

## Follow-up: actual authoring/setup/config integration

The root assigned four additional focused test files: `initiative/manage-pattern-tool.test.ts`,
`initiative/authoring-skill.test.ts`, `initiative/initiative-setup.test.ts` and
`config/initiative-wake-knobs.test.ts`. They use the real Pattern/Run/Timeline SQLite owners, actual standard
Skill package repository/catalog/lifecycle, real config writer/resolver and User Timezone repository/service.

Tests reproduced and fixed these integration defects within the assigned production files:

- Bundled Skill setup supplied an unwrapped `SKILL.md` directory member, which the standard lifecycle correctly
  rejected. Setup now supplies `companion-pattern-authoring/SKILL.md` and computes its unchanged content hash using
  the same wrapper validation. Fresh-profile import, runtime discovery/load, concurrent install, same-name user
  collision and explicit disablement are exercised through the actual lifecycle. An unavailable exact package is
  reported as `import-failed`, not a user name collision.
- The Pattern tool accepted inconsistent fields for read/management actions. Its all-required strict schema now
  validates action-specific required/null fields, and direct execution performs the same parse before dispatch.
  The tests cover real primary source binding, inactive proposals, duplicate calls, operator-only confirmation,
  CAS management/history/rollback, foreign/retracted/aborted source refusal and bounded unexpected errors.
- Setup accepted an unknown seed through a direct service call, validated an invalid Character only after Skill
  installation, and allowed an observer exception to relabel a committed installation. It now validates before
  mutation and isolates post-commit observer errors. Seed reimport preserves effective/user/pending/paused state;
  setup never enables initiative or activates the seed.

The wake config tests found no production defect. They prove registry uniqueness/defaults, strict numeric/time/type
bounds, sparse writes/resets, env precedence/locks, complete effective-policy validation and unchanged aggregate
quotas while changing target/event settings.

Verification: `pnpm --filter @taki/core test manage-pattern-tool authoring-skill initiative-setup initiative-wake-knobs`
passed **27 tests in four files**. Scoped ESLint covering these tests and their four allowed production modules
passed. No full package suite was run for this bounded assignment; the root owns final Core/E2E gates.
