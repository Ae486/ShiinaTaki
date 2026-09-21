# Independent Stage 2a Contract Review

Date: 2026-09-20. Reviewer: `s2a_contract_review`, explorer using `gpt-6-astra`.
Scope: source-only review of candidate isolation, exact primary custody and same-epoch runtime recovery. No tests,
production changes, original data or service operations. Leader recorded the findings and incorporated the selected
contracts into [design.md](../design.md). Final artifact review is a separate check.

1. **Candidate isolation is necessary.** `legacy-migration-runner.ts:89` reuses the active epoch and
   `legacy-canonical-import-repo.ts:50-55` writes globally scoped Blocks. Use a new candidate epoch/run/full inventory,
   durable supersession and run/source-scoped Block plans. Replace candidate pointers/custody in one transaction;
   preserve the Legacy authority marker. Reject superseded runs on all mutation paths. Existing status/reason enums
   do not require a global new value: use an additive supersession relation and existing failed/closed values.
2. **Direct callback persistence is insufficient.** `canonical-ingestion-source-repo.ts:74,98-99` fixes one complete
   group boundary and rejects the same row under a changed boundary. `chat-agent.ts:194,310-321` separates first append
   from the eventual callback. A first prepare can overtake an already appended primary user, and a crash loses the
   callback below a newly initialized baseline. Use trusted group/member custody from the primary persistence seam,
   with member and Timeline append atomic; finalize/retract atomically and keep complete-group witness semantics.
3. **Recovery must be executable.** Retained user-only failures must finalize too. Explicit recovery can finalize
   exact committed prefixes after proving the old boot dead or the same-boot producer terminal, without model/Run
   replay or role/range inference. Still-active groups remain in flight. Flush must consult exact group members,
   including pre-baseline or assistant-only gaps; the existing baseline/user query alone is insufficient
   (`canonical-ingestion-source-repo.ts:185-193`). Normal active custody does not globally block runtime readiness.
4. **One binding publication truth is required.** `runtime-composition.ts:92-94` publishes scope.canonical before
   selector's flush callback/current publication (`runtime-selector.ts:62-64`). Failed flush publication can leak a
   half-ready Local through capture/write/maintenance. The constructor starts a retention sweep
   (`canonical-local-subsystem.ts:37-39`; `sweep-runner.ts:58`). Separate draft construction/start, publish one complete
   binding, clean failures and preserve failing flush. Boot must avoid the unconditional current().memoryFlush read
   (`runtime-composition.ts:133`) when selected Local construction fails.

Required fault cases include prepare-before-callback, append-before-callback crash, silent retraction, user-only final
failure, late finalize during candidate replacement, failed flush publication across every accessor, unavailable boot
and same-epoch repair. These findings are engineering requirements within S2a; no new product choice was identified.

## Final artifact review

The same independent Astra reviewer reviewed the full PRD/design/execution plan, initially identifying six bounded
contract blockers: finalized-group relocation, healthy/ready custody recovery, empty/unassigned group finalization,
claim/unknown interfaces, legacy RPC/subscription shapes and capture-gate release. The leader fixed all six.
The reviewer then rechecked only their closure and returned **ready for task activation and implementation** on
2026-09-20. This verdict covers planning contracts only; no implementation or test pass is implied.
