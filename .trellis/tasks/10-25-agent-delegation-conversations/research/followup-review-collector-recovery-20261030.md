# Follow-up review: recoverable final material rejection — 2026-10-30

## Scope and outcome

Fixed two confirmed failure boundaries exposed by the real running-correction case. Production changes are limited to
`packages/core/src/governance/governed-tool.ts` and `packages/core/src/agents/subagent-result-tool.ts`.
Desktop, E2E, dependency, database schema, task pointer, and model-route sources were not changed.
No paid model call was made by this repair. The coordinator owns refreshed full gates and real-model retries.

The repaired governed SDK path can reject an invalid material reference, deliver an actionable refusal to the model,
and accept a corrected final in the same work, Run and Attempt while retaining the original supporting source.
Natural prose is still not validated completion. Historical failures are retained unchanged.

## Original evidence and limits

Original campaign: `target/agent-delegation-20261030-validation/real-running-correction-fixed/goals-running-followup-cEje0w/`.
The exact parent correction was consumed at child step 1. At step 2, `complete_subagent` produced
`SUBAGENT_MATERIAL_NOT_FOUND`; the child settled failed with partial `[tool-call: complete_subagent]`.
The governed result Effect `a8cb2875-d28b-481e-a1fb-1547b191df01` remained `intent_committed`.

Request 7 supplied three exact Core material references. Each matches its SQLite `subagent_tool_results` row/key.
The failed call's actual arguments were deliberately removed by the existing names-only persistence boundary and
never appeared in a later request; they cannot be reconstructed from retained evidence. This review therefore does
not claim to identify which reference the real model supplied incorrectly. The recoverability defects below are
independently established by actual source, retained Effect state, module probes and red-to-green SDK regression.

## Findings fixed

### Synchronous execution escaped the governed Effect bracket

`governed-tool.ts` evaluated `execute(...)` before entering `Promise.resolve(...).catch(...)`. Synchronous failure
therefore bypassed settlement, although asynchronous rejection settled correctly. The SDK retained a tool error,
but the next checkpoint/model intent encountered the existing unresolved non-model Effect fence.
The installed SDK's `isLoopFinished()` returns false; it was not the terminating condition.

The bracket now uses `try { raw = await execute(...) } catch`. It catches only closure execution/rejection and
retains existing cancellation/failure classification, exactly-once settlement and original-error propagation.
Intent hooks, observer binding, result acceptance and persistence settlement remain outside this catch. Failures at
those boundaries still propagate and are not disguised as ordinary tool failures or retried as settlement.

### Invalid material occupied the final/question choice

The final collector previously reserved `final` before resolving material references. A failed lookup left the
shared reservation in place; a later corrected final or input request then conflicted.

The collector now resolves materials and validates the proposal first. Only a valid proposal can reserve the shared
terminal choice. The seven existing missing/scope/stale/limit error codes from this lookup chain return a bounded
`not_proposed` refusal with explicit instructions to use actual Core material references or self-history. The reply
never echoes raw error data or recommends stripping supporting sources. Unknown storage/schema failures still throw.
Earlier accepted proposals, competing final/question semantics, currentness and commit-time refusal are preserved.

Synced the three touched folder indexes, shared delegation contract, and governed execution contract in
`.trellis/spec/backend/permission-authorization.md`.

## Verification and retained evidence

Evidence root: `target/followup-review-20261030/collector-recovery/`.
`owned-files.json` records the ten owned source/test/index/spec paths and before/after hashes; `preimages/` preserves
inherited contents and `owned.diff` isolates this repair from other worktree changes.
Environment: Windows PowerShell, Node v24.18.0, pnpm 10.22.0, installed AI SDK 7.0.148, Vitest 4.1.10.

- `red.log`: 12 failed / 19 passed before production changes. The actual SDK/SQLite test reproduced the live
  `failed/partial` outcome; synchronous throw and stuck reservation cases failed while asynchronous settlement passed.
- `green-final.log`: 3 files / 31 tests passed after the fix and final test typing corrections.
  Governance tests cover sync/async failure and cancellation, plus intent/observer/settlement failure separation.
  Collector tests cover closed refusals, unknown storage errors, first accepted proposal preservation, question
  competition, and stale-currentness release.
- The real SDK/SQLite regression in `subagent-materials.test.ts` executes a governed `read_file`, submits an invalid
  key, sees the structured refusal on the next actual model request, and supplies the exact original reference.
  It proves one work/Run/Attempt, three completed steps, one final event, exact file-source retention, no unfinished
  Effects, and no relationship Timeline writes. Its provider is scripted; this is not a live-model semantic claim.
- `regressions.log`: 4 files / 28 tests passed for unattended authority, interactive Stop/input control,
  N/K check-ins/pressure rollover and completion/recovery. Total: **59 distinct tests passed**.
- `lint-final.log`: all five touched TypeScript source/test files pass ESLint.
- `typecheck-final.log`: Core `tsc --noEmit` passes. The initial `typecheck.log` found only newly added test calls
  missing SDK7's required `context` option and one optional-source access; those tests were corrected and rerun.
- Scoped `git diff --check` passed; the untracked collector test was also linted/typechecked and captured in the
  owned diff. Existing line-ending notices are not failures.

Commands, from the exact T4 worktree:

```powershell
pnpm --filter @taki/core exec vitest run src/governance/governed-tool.test.ts src/agents/subagent-result-tool.test.ts src/harness/subagent-materials.test.ts --maxWorkers=2 --reporter=verbose
pnpm --filter @taki/core exec vitest run src/governance/governed-tool-unattended.test.ts src/harness/subagent-interactive.test.ts src/harness/subagent-checkin.test.ts src/harness/subagent-completion.test.ts --maxWorkers=2 --reporter=verbose
pnpm --filter @taki/core typecheck
pnpm exec eslint packages/core/src/governance/governed-tool.ts packages/core/src/governance/governed-tool.test.ts packages/core/src/agents/subagent-result-tool.ts packages/core/src/agents/subagent-result-tool.test.ts packages/core/src/harness/subagent-materials.test.ts
```

## Remaining coordinator gates

Production source is frozen after these checks. Rerun the real correction and missing-requirement cases with their
strict input-wait/final assertions, then continue the remaining campaign and full affected gates. No original
failed case, unknown Effect, natural unstructured completion or human acceptance is reclassified by this repair.
