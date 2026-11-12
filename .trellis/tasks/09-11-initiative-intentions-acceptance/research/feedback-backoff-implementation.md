# C4 Qualified Feedback Backoff Implementation

## Scope and provenance

- Date: 2026-09-28.
- Workspace: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.
- Native task identity supplied by the root: `codex_01a0e700-4c6f-7831-a73a-8c9fe0d33167`.
- Child: `09-11-initiative-intentions-acceptance`; parent design sections 8.3/12 and current
  `user-presence.md` take precedence over historical research gaps.
- Recovery preserves the interrupted implementation and concurrent changes. The stale global `.current-task`
  still names Avatar Lab and was not changed. The root explicitly supplied the active C4 path and recovery scope.
- No commit, push, rebase, reset, archive, external provider call, paid model call or other-worktree edit occurred.

This report covers the backoff consumer, Shared status, migration 055 and focused validation only. Root-owned
main/config/wake/Monitor integration, independent formal check and full/native/owner acceptance remain separate.

## Delivered files and responsibilities

| File | Responsibility |
| --- | --- |
| `packages/core/src/initiative/backoff/initiative-backoff.ts` | Read/refusal/reset/engagement/capture API; semantic stage/status; configured cadence |
| `packages/core/src/initiative/backoff/backoff-repo.ts` | Read real C2 dispositions; monotonic persistent Timeline reset fences |
| `packages/core/src/initiative/backoff/backoff-admissions.ts` | Read canonical admissions; immutable original zone; conservative civil-day carry |
| `packages/core/src/initiative/backoff/initiative-backoff.test.ts` | 16 focused tests using actual SQLite, Run/Delivery/ConversationStore/C2 repositories |
| `packages/core/src/initiative/backoff/index.md` | Owned module navigation |
| `packages/shared/src/initiative-backoff-schema.ts` and colocated test | Strict content-free semantic status and operator reset parameters |
| `packages/core/src/db/migrations/055-initiative-backoff.ts` and colocated test | Nullable canonical admission metadata, reset table and indexes; four migration tests |
| `.trellis/spec/backend/initiative-backoff.md` | Executable consumer/integration contract and negative-path matrix |

The recovery pass added the missing boundary/reopen/rollback tests and integration warnings to the prior module
implementation. Root owns Shared public exports, migration registration and their shared folder/spec indexes.

## API and integration contract

```typescript
createInitiativeBackoff({ db, now?, timezone, modelIntervalMs, onChanged? })
  -> read(characterId)
  -> refusal(characterId)
  -> reset(characterId)
  -> observeUserTurn(characterId)
  -> recordAdmission(runId, capturedTimezone?)
```

- `read` returns `InitiativeBackoffStatusSchema`: stage, qualified weak count, spacing multiplier, actual daily
  judgment count, nullable next eligibility/refusal/reset evidence, and window/observation timestamps. No raw
  content, correlation IDs, source identities or claimed reading/attention are exposed.
- `refusal` is only a gate before NEW admission. It must not be reused in that admitted Run's `isCurrent` or
  delivery gate: the just-recorded Run is supposed to make the next admission ineligible.
- Call `recordAdmission` synchronously immediately after an admission with `reused=false`, using the captured
  User Timezone. Do not assign today's zone to a reused old Run with missing metadata. Canonical `runs` already
  preserve the admission if the process dies before the metadata write.
- `observeUserTurn` and status reads query actual same-Character `role=user` Timeline evidence. The tests use
  ConversationStore's production `appendUser` seam. A callback alone and another Character cannot reset policy.
- Reset only fences feedback history. It does not refund hard counters, rewrite feedback settlement, consume or
  resolve Intentions, or mutate Memory. Callback notification is post-commit and observer-isolated.

## Behavior proved by focused tests

1. Actual C2 qualified dispositions select normal/double/quadruple/daily at 0-2/3/6/9 instances in the inclusive
   seven-day settlement window. Duplicate producer settlement does not double count. Normal stage preserves
   existing jitter; later stages tighten the configured base interval, with exact spacing boundary coverage.
2. Unknown opportunity, no invitation, Class A, silence, expressions and unpublished held speech contribute no
   weak instances. C2 owns its original identity, opportunity intervals and settlement.
3. Full reset requires real same-Character input or explicit operator action. Same-millisecond sequence ordering,
   callback without evidence, another Character, deleted reply after reset and missed callback after reopen are
   covered. Reset write failure preserves both policy and C2 evidence and emits no observer notification.
4. Operator reset survives file reopen. An earlier pending invitation can later settle `weak_non_engagement` in
   C2 while still contributing zero to reset policy; new later invitations can move backoff forward again.
5. Daily accounting includes an actual admitted failed Run and actual silent/express judgments, independent of
   utterance charging. Duplicate timezone capture remains one admission; Class A/other Character do not enter
   this Character's count. Independent global delivery/opportunity quotas remain root pipeline responsibilities.
6. Exact civil midnight release is exercised for New York's 23-hour spring day, 25-hour fall day and Santiago's
   missing-midnight transition. Date-line changes, return to the original zone and clock rewind preserve carry.
   Missing original-zone metadata retains a conservative 48-hour bound without rewriting NULL; the exact end
   of that bound can become eligible again subject to independent policy.
7. A populated on-disk 054 upgrade preserves all previous migration receipts, Run bytes except the new NULL
   field, snapshots/events, Timeline, User Timezone and hard opportunity history. Reopen applies no migration
   again. Receipt and deferred-COMMIT failures roll back the complete 055 column/table/index/receipt change.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/initiative/backoff/initiative-backoff.test.ts` | Passed: 16 tests, 1 file |
| `pnpm --filter @taki/core exec vitest run src/db/migrations/055-initiative-backoff.test.ts` | Passed: 4 tests, 1 file |
| `pnpm --filter @taki/shared exec vitest run src/initiative-backoff-schema.test.ts` | Passed: 1 test, 1 file |
| `pnpm exec eslint packages/core/src/initiative/backoff packages/core/src/db/migrations/055-initiative-backoff.ts packages/core/src/db/migrations/055-initiative-backoff.test.ts packages/shared/src/initiative-backoff-schema.ts packages/shared/src/initiative-backoff-schema.test.ts` | Passed |
| `pnpm --filter @taki/shared typecheck` | Passed |
| `pnpm --filter @taki/core typecheck` | Not green: latest run found nine concurrent integration diagnostics outside the owned files; no backoff diagnostic. Root notified. |
| `python ./.trellis/scripts/get_context.py --mode packages` | Passed; selected backend/frontend guidance. `python3` alias was unavailable; used installed `python`. |
| Scoped `git diff --check` plus direct byte/line audit of all 11 owned files | Passed; direct audit includes untracked files and verifies UTF-8 without BOM and no trailing whitespace |

Initial Core typecheck diagnostics were `intention-repository.ts` lines 13/46/57/65 (`IntentionScope`/`IntentionClaim`
not assignable to SQL bindings) and `intention-service.test.ts` line 216 (outdated Heartbeat decision shape).
These files are outside this owner's scope; their implementation owner was notified instead of overwriting them.

The final Core rerun no longer reported those five errors. It reported two SQL-binding diagnostics at
`db/primary-memory-source-read.ts:34`, a missing candidate `kind` in `initiative-context-builder.test.ts:30`,
union narrowing in `initiative-context-builder.ts:101` and `wake/wake-engine.ts:120-122`, and two output-type
diagnostics in `memory/initiative-memory-recall.ts:52`. These concurrent integration files remain root/other-owner
scope. A later green integrated typecheck must be recorded by that gate's owner; none is claimed here.

## Acceptance and remaining work

- C4-05 and parent feedback/backoff behavior have focused engineering evidence above, including durable recovery.
  This does not mark the complete child or parent acceptance matrix passed.
- Root must verify new-admission-only placement, captured-zone handoff, operator authorization, actual callback
  wiring, hard-cap composition, same Monitor projection and boot behavior through integrated services.
- Full workspace tests, process/native Desktop trials, real-provider trials and subjective owner acceptance were
  not run by this subtask. No unit fixture is labelled native or owner acceptance.
- Rollback is disablement of new backoff admission integration while retaining compatible readers and durable
  history; do not downgrade a database past migration 055 or erase canonical admission/feedback state.
