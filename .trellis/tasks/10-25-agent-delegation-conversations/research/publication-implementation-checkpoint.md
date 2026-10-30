# Publication implementation checkpoint

## Recovery status (2026-10-25)

Recovered the existing publication patch from session `01a1720a-7edd-7b43-96cf-1942e99b3110`; no baseline reset or patch replacement. The explicit delegated task is `10-25-agent-delegation-conversations`; legacy `.current-task` still points at Avatar and was preserved. Workspace/branch verified as `H:/TakiAgent-worktrees/t4`, `task/t4-skills-mcp-productization`.

Existing changed paths recovered from successful-session edit calls and present in the live tree:

- `packages/core/src/co-watching/media-analysis-state.ts`
- `packages/core/src/co-watching/publication-source.test.ts`
- `packages/core/src/co-watching/publication-source.ts`
- `packages/core/src/co-watching/real-prepared-playback.test.ts`
- `packages/core/src/delivery/direct-request-report.ts`
- `packages/core/src/delivery/direct-request-validity.test.ts`
- `packages/core/src/delivery/index.md`
- `packages/core/src/delivery/prepared-publication-source.ts`
- `packages/core/src/delivery/prepared-publication.test.ts`
- `packages/core/src/harness/index.md`
- `packages/core/src/harness/prepared-publication-authorization.test.ts`
- `packages/core/src/harness/prepared-publication-authorization.ts`
- `packages/core/src/harness/primary-request-witness.ts`
- `packages/core/src/harness/run-prepared-publication.ts`
- `packages/core/src/harness/run-work-binding.ts`
- `packages/core/src/testing/direct-request-report-fixture.ts`
- `packages/core/src/testing/index.md`
- `packages/core/src/testing/prepared-publication-fixture.ts`
- `packages/shared/src/co-watching-publication-schema.ts`
- `packages/shared/src/index.md`
- `packages/shared/src/prepared-publication-schema.test.ts`
- `packages/shared/src/prepared-publication-schema.ts`

## Current verification state

Existing code has explicit finite/until-cancelled authorization, a trusted primary request witness, direct-request report freshness and publication consumers/tests. Recovery review and fresh focused tests/typecheck/lint are pending; prior interrupted-session results are not claimed as current verification. Runtime/schema generic-expiry and inbox ownership remain with the runtime agent; ChatAgent/private routing remain with the coordinator. No paid calls, real-user database changes, dependency changes or Git delivery are authorized.

## Preserved preimages

Prior owned preimages remain at `G:/Temp/taki-publication-preimages-db3c26da-52a0-42a3-a271-18decaa1e36c`. Current differing existing files (some shared-owner files may contain subsequent collaborator edits):

- `packages/core/src/agents/source-context-real.test.ts`
- `packages/core/src/co-watching/media-analysis-state.ts`
- `packages/core/src/co-watching/publication-source.test.ts`
- `packages/core/src/co-watching/publication-source.ts`
- `packages/core/src/co-watching/real-prepared-playback.test.ts`
- `packages/core/src/delivery/direct-request-report.ts`
- `packages/core/src/delivery/index.md`
- `packages/core/src/delivery/prepared-publication-source.ts`
- `packages/core/src/delivery/prepared-publication.test.ts`
- `packages/core/src/harness/index.md`
- `packages/core/src/harness/prepared-publication-authorization.test.ts`
- `packages/core/src/harness/prepared-publication-authorization.ts`
- `packages/core/src/harness/run-prepared-publication.ts`
- `packages/core/src/harness/run-work-binding.ts`
- `packages/core/src/testing/index.md`
- `packages/core/src/testing/prepared-publication-fixture.ts`
- `packages/shared/src/co-watching-publication-schema.ts`
- `packages/shared/src/index.md`
- `packages/shared/src/prepared-publication-schema.test.ts`
- `packages/shared/src/prepared-publication-schema.ts`

## Recovery review progress (17:27 local)

- Confirmed actual preimages and preserved all prior publication edits. Added a canonical SQLite silent-parent -> later same-work final-answer regression, and lost-handle refusal for both finite/unlimited acceptance including stale pre-acceptance inputs.
- Updated the actual SDK report regression to omit the removed model-facing lifetime parameter and require an unlimited silent `no_action` result to preserve the accepted report root. It exposes a real integration issue: `harness/subagent-completion.ts` still closes every non-reply report; handed to Runtime owner rather than editing its file.
- Synced explicit validity/witness/five-minute candidate/no-renewal contracts in `accepted-work-lifecycle.md` and finite Co-Watching folder entries.
- Runtime owner supplied explicit work validity/new+legacy reply acceptance/barrel exports and fixed migration 058 incoming-trigger validation. Initial DB tests had failed at migration open before publication behavior; that blocker is resolved.
- Node `v24.18.0`, pnpm `10.22.0`. Package-scoped test invocations are required: an initial root Vitest invocation also collected historical preimages and is not acceptance evidence.
- `pnpm --filter @taki/shared exec vitest run src/prepared-publication-schema.test.ts`: PASS, 5 tests.
- `pnpm --filter @taki/core exec vitest run src/harness/prepared-publication-authorization.test.ts src/delivery/prepared-publication.test.ts src/co-watching/publication-source.test.ts`: PASS, 40 tests on post-migration run (shared invocation with direct-validity tests reported 50/51 before one test expectation was corrected to retain the canonical no_action receipt).
- `pnpm --filter @taki/core exec vitest run src/delivery/direct-request-validity.test.ts`: PASS, 11 tests on the next invocation alongside SDK report tests.
- `pnpm --filter @taki/core exec vitest run src/delivery/direct-request-report.test.ts`: 1 PASS (actual reply), 1 FAIL (unlimited no_action loses grant); Runtime owner notified with actual evidence.
- Owned-file ESLint PASS before latest doc/test changes; final lint rerun pending. Shared TypeScript PASS; latest Core typecheck fails only in other owners' active context/barrel work and nullable legacy expiry test updates. No publication-owned diagnostic remains. Final integrated Core typecheck remains pending.

## Inbox publication interface handoff (17:45 local)

Runtime now replaces the legacy parent-continuation scheduler for event-backed outcomes. The existing `stageReply` only accepts canonical legacy parent results, so new `speech_proposed` actions need a distinct trusted adapter entry. Proposed contract sent to Runtime owner: stage by exact event/consumer/action identity; read committed speech action and actual delivered event through its canonical inbox repository; keep separate durable publication outcome; derive immutable finite candidate freshness from proposal acceptance time. Do not fabricate old parent links for a batched consumer. Implementation waits for exact owner API names/shapes.

Additional actual integration concern sent to Runtime: `stopChild` did not call report `closeWork`; report currentness itself does not read the child stop latch. A queued speech candidate can therefore remain valid after child Stop unless Runtime revokes the report root on committed Stop. This is not addressed by directly invoking adapter closeWork in tests. Final publication handoff must cover the actual service Stop path.

`pnpm --filter @taki/core exec vitest run src/co-watching/media-analysis-runtime.test.ts src/harness/run-work-binding.test.ts`: PASS, 32 tests. Final owned-file lint rerun passed. Runtime reports the no_action closure branch has now been removed; SDK recheck will run after new inbox publication wiring settles.

## Canonical proposal integration milestone

Added `delivery/direct-request-proposal.ts` to join legacy results or exact inbox event/consumer/action receipts without copying grants. `direct-request-report.ts` now exposes `stageEventReply`, shares candidate selection, verifies child/Character/work frontier and fixes freshness to durable proposal time (also correcting delayed first staging for legacy results). The actual SDK report test now uses `handle_agent_event`; the canonical repository fixture disables autonomous scheduling and retains separate SDK evidence. Runtime is adding immutable event frontier readback and canonical delivery-state progression after publication review found both gaps. Current Core typecheck still reports the pending frontier API plus two Runtime-owned legacy nullable-expiry test diagnostics; no pass is claimed yet.

## First fresh verification milestone

Node v24.18.0 / pnpm 10.22.0. Package-scoped `direct-request-validity.test.ts` passes all 12 cases, including new delayed first staging. `direct-request-inbox.test.ts` initially passes 8/12; the four failures are the pending canonical immutable frontier API (undefined frontier correctly refuses authority). Actual SDK `direct-request-report.test.ts` reproduces a Runtime integration gap: `handle_agent_event` is denied by existing canonical governance as unregistered, leaving the event delivered/reconciliation-needed; runtime/coordinator notified with actual tool-result evidence. Shared prepared schema tests pass 5/5. Owned lint found and fixed one multiline test-call formatting issue. Remaining gates: Runtime frontier/governance changes, fresh inbox/SDK tests, full owned lint and package typechecks.

## Fresh finite-source gates and Stop truth

Scoped prepared-publication authorization/publication, finite Co-Watching source/runtime and Run work-binding tests pass: 72/72 across five files. Shared typecheck passes. Scoped lint passes on the six current publication/helper/test files. Added immediate deferred-proposal refusal on actual Stop, with an in-flight guard so factual delivery outcomes are never replaced by refusal. Added an actual service Stop-versus-final-publication race regression; execution awaits Runtime canonical frontier API. Updated accepted-work-lifecycle spec with canonical inbox witness/frontier, fixed proposal-time freshness, source-loss refusal and Stop behavior. Runtime resumed after upstream agent error and confirmed it owns immutable event frontiers/governance/publication-state fixes.

## Runtime integration and cancellation race milestone

Runtime landed immutable event frontiers and canonical governance; the next fresh run passed 26/28 publication tests, including actual SDK no_action and all missing/forged/lost-grant checks. The SDK reply test observed transport before asynchronous publication receipt recording; it now waits for the actual canonical publication result. A substantive Stop race was reproduced: synchronous publisher entry could invoke Stop before assigning the in-flight promise, prematurely recording refusal before a factual delivery outcome. `stage` now installs its promise before entering publication, and the in-flight owner records the actual final delivery state. Added a separate actual child Stop while report-root acceptance awaits capture regression; this passes and prevents a delayed acceptance from minting authority behind a committed Stop. Final current publication rerun/typecheck in progress.

## Current publication acceptance (2026-10-25)

- Preimages from the actual recovered dirty tree are under `target/delegation-publication-20261025-recovery/`; `manifest.json` lists preserved files, new files and current owned hashes. The initial recovery-output scan encountered a console encoding error after copying the preimages; no preimage was lost or restored.
- Exact package-scoped command `pnpm --filter @taki/core exec vitest run src/delivery/direct-request-validity.test.ts src/delivery/direct-request-inbox.test.ts src/delivery/direct-request-report.test.ts`: PASS, 28/28 tests in 3 files. This includes actual SDK original-turn cancellation and inbox speech/no_action, canonical delivered event/action identity, cross-day same-work final answer, unavailable process grant, stale event, fixed candidate expiry, actual Stop of deferred speech, Stop during final publication checks, and Stop during awaited report-root acceptance.
- `pnpm --filter @taki/core exec vitest run src/harness/prepared-publication-authorization.test.ts src/delivery/prepared-publication.test.ts src/co-watching/publication-source.test.ts src/co-watching/media-analysis-runtime.test.ts src/harness/run-work-binding.test.ts`: PASS, 72/72; unchanged finite-source behavior retained.
- `pnpm --filter @taki/shared exec vitest run src/prepared-publication-schema.test.ts`: PASS, 5/5; Shared typecheck PASS.
- Publication-owned TypeScript diagnostics are clear. Current Core typecheck has only Runtime-owned `db/subagent-repo.test.ts:358,425` nullable historical expiry errors; Runtime notified.
- Six changed publication/helper/test files passed scoped lint; final 21-owned-file lint running. A PowerShell array invocation was rejected by ESLint as one concatenated path; that invocation is not acceptance evidence and was rerun with explicit arguments.
- Owned UTF-8/no-BOM checks and scoped `git diff --check` PASS. No dependency, Git delivery, external model call or real-user database operation occurred.
- Integration limits: this slice does not establish production-main/WS/native UI or human acceptance; coordinator owns the final wiring/private routing/system audit. Runtime owns migration/frontier/governance tests and canonical event lifecycle.
