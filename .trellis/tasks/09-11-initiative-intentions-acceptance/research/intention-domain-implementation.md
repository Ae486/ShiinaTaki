# Intention domain implementation evidence

Date: 2026-09-28. Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.
This resumes the interrupted C4 domain implementation under the owner's continuation authorization.
The native task assignment is C4; the global task pointer belongs to concurrent work and was left unchanged.

## Delivered ownership

- Shared: `initiative-intention-schema.ts` and its colocated tests.
- Core: `initiative/intentions/{intention-source,intention-repository,intention-lifecycle,intention-service}.ts`,
  colocated service tests and directory index; `initiative/plan-follow-up-tool.ts` and its tests.
- Database: additive `054-initiative-intentions.ts` and its migration tests.
- Executable spec: `.trellis/spec/backend/initiative-intentions.md`.
- Bundled `packages/core/resources/skills/companion-pattern-authoring/SKILL.md`: version-2 finite automatic follow-up
  guidance, exact foreground-dwell meaning and continued master/source gates after Pattern confirmation. The package
  name and standard immutable installation lifecycle are unchanged; an older installed package is never overwritten.

Root owns shared exports, migration registration, central source indexes, ConfigSource/governance, production
composition, Wake integration and the full validation/acceptance gate. No central wiring, Memory internals,
other worktree, commit, push, reset, rebase, archive or paid provider was changed by this domain worker.

## Exact service interface

```ts
createIntentionService({
  db: Database,
  now?: () => number,
  maximumWindowMs?: () => number,
  onChanged?: (change: { characterId: string }) => void,
  sourceState?: (source: {
    characterId: string;
    userTimelineId: string;
    userTimelineSeq: number;
    sourceDigest: string;
  }) => "current" | "unavailable" | "withdrawn",
}): IntentionService

registerPrimarySource(source: InteractionPatternPrimarySource): boolean
plan(input: { characterId: string; plan: InitiativeIntentionPlan },
  actor: { runId: string; attemptId: string; toolCallId: string }): InitiativeIntentionPlanResult
get(scope: { characterId: string; intentionId: string }): InitiativeIntention | null
listDue(characterId: string): InitiativeDueIntention[]
nextWakeAt(characterId: string): number | undefined
claim(input: { characterId: string; intentionId: string; canonicalRunKey: string }): boolean
link(input: { characterId: string; intentionId: string; canonicalRunKey: string; runId: string }): boolean
isCurrent(input: { characterId: string; intentionId: string; canonicalRunKey: string }): boolean
releaseUnadmitted(input: { characterId: string; intentionId: string; canonicalRunKey: string }): boolean
settleLinked(scope: { characterId: string; intentionId: string }): void
reconcile(): void
notificationFailures(): number
```

The plan fields are `{purpose, notBefore, expiresAt, reportedEventTime}`; all are required and the reported time
is ISO-or-null. Results are `created | duplicate` with the durable aggregate or `refused` with a closed reason.
The primary tool is `createPlanFollowUpTool({service, characterId, userEntry, turn?}): ToolSet`; absent or non-primary
Run context returns an empty tool set. Its public result omits opaque source/Run identities.

`listDue` includes actual purpose alongside `{intentionId, characterId, sourceKey, sourceRevision, notBefore,
expiresAt}`. `nextWakeAt` is pure and uses bounded pages; it does not expire rows or acquire provider state.
The callback source digest is the exact C3 `patternDigest` of the selected SQL Timeline row, not the ingestion
entry digest. The separate Memory adapter must preserve this distinction.

## Integration requirements

1. Create source-backed plans only at the primary append/tool seam. Bind automatic due facts into the common
   Wake policy and use `nextWakeAt` in the existing engine rather than a per-Intention timer.
2. Call `claim` before canonical admission, `link` afterward, and `releaseUnadmitted` only for known unadmitted
   refusals. Release independently checks that no Run with the canonical key committed.
3. Use direct `isCurrent` for claimed output. Its absence from `listDue` is expected and must not invalidate its
   own admitted Run. Preserve expiry/source checks at both admission and output.
4. Run `reconcile` at boot. It repairs an exact existing heartbeat Run key, preserves still-live linked work,
   closes lost unlinked context as unknown, and expires stale plans without creating a second Run.
5. Call `settleLinked` after canonical Run terminal changes and terminal Delivery transitions. Completed
   non-silent staged/held delivery deliberately remains claimed; silence consumes immediately. Existing
   `core.delivery` v2 writers own `delivery.sent`, `unknown`, `no_target`, `expired`, `suppressed` and
   `presentation_settled`; this domain creates no invented RunEvent kind or second execution ledger.
6. Supply current provider-neutral source validation and production configuration through the declared hooks.
   Domain construction without a source callback still validates the actual Timeline source, but cannot independently
   prove Memory-authority freshness; production composition owns that adapter.

## Verification results

The initial resumed run exposed an obsolete silent-decision test field (`reason`). Core typecheck also found four
SQL binding-interface errors and the stale decision fixture; all were fixed using explicit primitive bindings and
current Shared decision contracts. No earlier agent's unreported checks are counted as passes.

| Command | Observed result |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/initiative/intentions/intention-service.test.ts src/initiative/plan-follow-up-tool.test.ts src/db/migrations/054-initiative-intentions.test.ts` | 3 files, 31 tests passed, final run at 20:13 local time. |
| `pnpm --filter @taki/shared exec vitest run src/initiative-intention-schema.test.ts` | 1 file, 3 tests passed. |
| `pnpm --filter @taki/core exec vitest run src/initiative/plan-follow-up-tool.test.ts src/initiative/authoring-skill.test.ts` | After the requested bundled guidance update: 2 files, 9 tests passed; original Skill import/conflict/disablement/concurrency tests unchanged. |
| Scoped `pnpm exec eslint` over the above source/test files and `initiative/intentions/` | Passed with no diagnostics. |
| `pnpm --filter @taki/core typecheck` | Latest completed run had no Intention-domain errors; package failed in concurrently changing Memory/Wake integration files. Root owns the integrated rerun. |
| `pnpm --filter @taki/shared typecheck` | Passed, exit 0. |
| Scoped `git diff --check` plus explicit whitespace scanning of owned tracked/untracked files | Passed. The explicit scan covers new files that ordinary Git diff omits. |

Coverage includes real SQLite migration/reopen and transactional rollback, strict source/claim scopes, exact
inclusive/exclusive time bounds, far-future seven-day windows, quoted timestamps, duplicate wording/Attempts,
Timeline correction/deletion, provider outage/withdrawal, read-only due timer queries, foreign canonical keys,
unadmitted release, lost callbacks and same-Run currentness through held output. Fixtures clean up only validated
test-owned temporary directories. Tests preserve the original user Timeline content and do not write Memory.

## Limits and follow-up ownership

- These are domain/schema/tool/migration checks, not full process, native rendering, real-provider or owner acceptance.
- Intention invalidation is a bounded post-commit Character notification; the canonical Run/Delivery stores remain
  the durable execution/publication evidence. Root must wire committed-event settlement and Monitor composition.
- No closed plan is scanned to manufacture a fresh opportunity. Fresh independently eligible Memory-backed follow-up
  remains the separately owned Wake/Memory integration scenario.
- The 10,000-per-Character source/plan capacity preserves source tombstones and returns a refusal rather than silently
  allowing replay by evicting them. Future retention changes must retain anti-replay identity while source rediscovery
  remains possible.
- The bundled Skill's content hash changes with version-2 guidance. Existing installed content remains under the
  normal immutable lifecycle; setup reports an older same-name package as a conflict rather than silently replacing
  or re-enabling it. No prose-mirroring test was added; the existing real lifecycle tests cover this update.

## Additional Wake/C1 integration regression

The root assigned a separate bounded test-only follow-up after the domain delivery. Added
`packages/core/src/initiative/wake/wake-intention.integration.test.ts`; no production or central index files were
changed for this follow-up. It uses the actual `IntentionService`, `WakeEngine`, C1 `InitiativeRuntime`, SQLite
Run/Event/Effect/Delivery repositories, `RunService`, lane queue and DeliveryCoordinator through `initiativeFixture`.
The source plan is created from a real appended primary user row, and that primary Run completes before waking.

Observed checks:

| Command | Result |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/initiative/wake/wake-intention.integration.test.ts` | 1 file, 15 tests passed at 20:25 local time. |
| `pnpm exec eslint packages/core/src/initiative/wake/wake-intention.integration.test.ts` | Passed with no diagnostics. |

The new integration regression proves these module-level paths:

- A due Intention creates a standalone candidate without any stored Pattern. The model boundary observes the
  exact linked canonical Run while `listDue` is empty and direct currentness remains true. Deliberate silence consumes
  the opportunity once; reconstructed service/engine instances cannot admit another Run from the same source.
- Quiet, busy and unavailable-context refusal leave the original active plan and deadlines intact, with zero
  heartbeat Runs. A real C1 lane refusal after context preparation releases both domain and wake reservations,
  permitting one later attempt within the same window.
- Source unavailability preserves finite state; an observed withdrawal closes permanently. Exact expiry and
  source invalidation are rechecked after asynchronous context preparation and after the committed model Effect,
  preventing generated speech from reaching Timeline while preserving truthful model charge and failed Run state.
- The held-output case forces the existing delivery-gate port to `hold`; real C1/Delivery keeps the original
  claimed source and resumes the same Run/Attempt. A controlled backoff port becomes denying after admission,
  showing that the Run does not reject its own held output because its admission consumed an allowance.
- Fault injection lets actual canonical admission commit, then loses its return callback before link/model/start.
  Lifecycle reconciliation repairs the exact existing key, and reconstructed owners create no replacement Run.
- With periodic wakes disabled, the actual WakeEngine arms its finite event-source timer at `notBefore`; fake-clock
  advancement proves no early model, one due judgment and no replay timer after consumption.

Evidence boundary: the model is a deterministic generator, source authority and backoff are controlled callback
ports, context preparation supplies a strict selected-context fixture, and restart means owner reconstruction over
the same SQLite handle. This does not test a real provider, installed Memory adapter, process kill/reopen, native
rendering, human reading or owner acceptance. Domain file reopen is covered separately above; root owns full process,
provider-neutral Memory and native validation. The focused run exposed no production failure, so no assertions were
weakened and no production fixes were made by this test worker.
