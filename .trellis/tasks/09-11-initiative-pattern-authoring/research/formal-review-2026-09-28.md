# C3 formal review and fixes

Date: 2026-09-28. Workspace: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.
Reviewer: delegated C3 formal check. The root owns full-package, process, integration and final acceptance gates.

## Scope and authority

- Read the child PRD/design/implementation plan and curated check context, parent design/decision register/domain
  contracts, relevant backend/frontend specs and the four current implementation reports.
- The native task binding is `session:codex_01a0e700-4c6f-7831-a73a-8c9fe0d33167`, recorded in
  `c3-active-checkpoint.md`. The legacy global pointer names an absent Avatar Lab PRD; it was deliberately preserved.
  The root explicitly confirmed the active C3 binding and existing owner implementation authorization.
- Reviewed Shared Pattern/Wake contracts; Pattern revision/source/CAS/storage; matcher, early budget gates,
  occurrence claims, retained context and shutdown; production composition and source APIs; actual primary tool,
  standard Skill setup; Desktop controller/review/management, disclosure and same-Monitor projections.
- Main/composition/E2E remained root-owned. Reviewer edits were explicitly assigned; independent QQMM work and
  existing C1/C2 changes were preserved. No commit, push, reset, rebase, archive or real-user data operation occurred.

## Findings (fixed)

### F1 — Conversation management could not reach records after the first page

- File: `packages/core/src/initiative/manage-pattern-tool.ts`.
- Issue: `list` and `history` always sent a null cursor with a 25-item limit, but the tool accepted no continuation.
  Core permits 100 Patterns and 1,000 immutable revisions. Later rules or older accepted revisions were therefore
  inaccessible to the complete conversational management/rollback loop.
- Fix: added required nullable `listAfter` and `historyBefore`, delegating to the existing bounded service queries.
  All fields remain required in the actual AI SDK JSON schema; unrelated, missing or invalid cursor fields are
  refused. There is no `.default()`/optional-schema exception and no automatic mutation replay.
- Updated the normal runtime `resources/skills/companion-pattern-authoring/SKILL.md` with internal continuation
  instructions. Existing installed user packages remain protected by the standard immutable import/collision rules.
- Regression: actual SQLite/service tests create 26 rules and 26 accepted revisions, traverse both pages without
  loss/duplicates, read a later rule and propose rollback of the oldest accepted revision without activating it.

### F2 — Policy and release notifications bypassed both disabled wake controls

- Files: `packages/core/src/initiative/wake/wake-eligibility.ts`, Shared `initiative-wake-schema.ts`, Desktop
  `initiative-wake-labels.ts`.
- Issue: with the main initiative switch enabled and both periodic/events disabled, `notify("policy")` and
  `notify("release")` still scheduled evaluation. Common eligibility checked neither control, so an accepted clock
  rule could prepare context, admit a Run and invoke the model after a policy edit or queue release.
- Reproduction: the new owning-runtime regression initially failed four cases; policy and release each invoked
  the model once, while busy pending work also proceeded after both controls were closed.
- Fix: common eligibility returns the closed `wake-disabled` disposition before context work, and retained-selection
  currentness rejects both-disabled state. Existing notifications still invalidate old work; they do not become a
  third enabled wake source. Monitor distinguishes this state from the main initiative switch being disabled.
- Regression: zero context/model/Run for source/policy/release notifications and direct evaluation when both are
  disabled; event-only and periodic-only operation still work; busy work retires; a closure during context preparation
  cannot admit a Run. Existing pre-start notification and optional Sampling/privacy tests remain green.

### F3 — Candidate review omitted the effective periodic/event control scope

- File: `apps/desktop/src/features/initiative-patterns/initiative-policy-view.tsx`.
- Issue: the shared review/setup disclosure showed budgets and model cadence but omitted the actual periodic/event
  enabled states and deterministic check interval. It did not explain the accepted distinction between disabling
  periodic reevaluation and disabling all wake inputs.
- Fix: show both actual switch states, the interval in seconds and a concise explanation of common rules/budgets
  and both-disabled behavior. Unknown values remain unknown; config keys and transport bindings are not rendered.
- Regression: rendered tests cover periodic-only, event-only, both-disabled and missing producer values. Updated
  the feature index and frontend executable spec; the root synchronized backend C3 spec and Core module index.

## Additional review conclusions

- Candidate confirmation is operator-only and binds the exact candidate plus current aggregate version. Agent
  mutations bind the actual primary Run/Attempt/user row; permission/Approval authority is unchanged.
- Drafting leaves the accepted revision effective. Pause remains after review. Rollback creates a new proposal,
  and stale callbacks cannot substitute a newly selected entity or silently authorize a newer revision.
- Seed import is idempotent by stable seed identity. Skill setup supplies actual wrapper-root package bytes and
  preserves same-name content, disabled packages and unavailable exact packages through the existing lifecycle.
- Source matching is closed/data-only, excludes heartbeat/Class A completion cascades, retains nullable idle and
  needs actual continuous source facts. Optional observation content stays fenced and is invalidated by privacy,
  source and original-context lifetime. No extra sensor acquisition was introduced.
- Source claims are recorded before asynchronous preparation and reconciled against canonical Run idempotency.
  Final model/utterance accounting remains C1-owned; target/timezone edits do not mint capacity. Missing context and
  lost process-local claims retire without recapture/replay. Shutdown cancels context preparation before DB closure.
- Desktop uses typed invalidations, current client/read owners and exact captured review callbacks; no page polling,
  permission-confirmation reuse or local durable Pattern authority exists. Canonical tool results stay intact while
  readable tool/Monitor views omit internal bindings.
- Final feedback-driven backoff consumption and the real Intention source are explicitly Child 4 work in the parent
  implementation plan. Their absence here is not a claim that the whole initiative delivery is accepted.

## Verification executed by this reviewer

All commands ran in the T4 worktree. No full-package suite or native harness was rerun by this reviewer.

| Command | Result |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/initiative/manage-pattern-tool.test.ts src/initiative/authoring-skill.test.ts --maxWorkers=1` | Passed: 2 files, 12 tests. |
| `pnpm --filter @taki/core exec vitest run src/initiative/wake/wake-engine.test.ts --maxWorkers=1` | Regression first failed 4 cases; after fix passed all 28 tests. |
| `pnpm --filter @taki/core exec vitest run src/initiative/patterns src/initiative/wake src/initiative/manage-pattern-tool.test.ts src/initiative/authoring-skill.test.ts src/initiative/initiative-context-builder.test.ts src/initiative/initiative-setup.test.ts --maxWorkers=1` | Passed: 8 files, 92 tests after F1/F2. |
| `pnpm --filter @taki/shared exec vitest run src/interaction-pattern-schema.test.ts src/initiative-wake-schema.test.ts --maxWorkers=1` | Passed: 2 files, 21 tests. |
| `pnpm --filter @taki/desktop exec vitest run src/features/initiative-patterns src/lib/ws-client-initiative.test.ts src/windows/home/pages/monitor/pattern-tool-monitor.test.tsx --maxWorkers=1` | Passed: 7 files, 50 tests after F1/F2. |
| `pnpm --filter @taki/desktop exec vitest run src/features/initiative-patterns/initiative-policy-controller.test.tsx --maxWorkers=1` | Passed: 6 tests after F3, including 3 added combinations. |
| `pnpm --filter @taki/shared typecheck` | Passed after F1/F2. |
| `pnpm --filter @taki/core typecheck` | Passed after F1/F2. |
| `pnpm --filter @taki/desktop typecheck` | Passed after F1/F2, and again after F3. |

Final scoped lint passed:

```text
pnpm exec eslint packages/core/src/initiative/manage-pattern-tool.ts packages/core/src/initiative/manage-pattern-tool.test.ts packages/core/src/initiative/wake/wake-eligibility.ts packages/core/src/initiative/wake/wake-engine.test.ts packages/shared/src/initiative-wake-schema.ts apps/desktop/src/features/initiative-patterns/initiative-wake-labels.ts apps/desktop/src/features/initiative-patterns/initiative-policy-view.tsx apps/desktop/src/features/initiative-patterns/initiative-policy-controller.test.tsx
```

## Findings (not fixed) and remaining acceptance gates

No unresolved defect from this scoped source review remains after F1-F3. This is a scoped review result, not final
C3/parent acceptance. The root still owns final full-package tests, root lint, build, process/E2E, task validation
and whitespace gates on the combined concurrent tree; use its final evidence for those outcomes.

The previously recorded native smoke uses scripted transport/setup/Timeline producers and actual PatternService/
SQLite. It proves the stated UI/domain scenarios only. Real native trusted input, OS IME, real-provider behavior,
human visual/interaction approval and owner AC confirmation remain unperformed or pending explicit evidence.
No manual checkbox was marked passed by this review. Child 4 and deferred D78/D79/phone work remain outside C3.
