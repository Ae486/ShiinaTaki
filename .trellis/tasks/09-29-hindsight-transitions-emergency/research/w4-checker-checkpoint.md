Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.

# Independent W4 checker checkpoint

**Final state: complete W4 scoped PASS under the owner's explicit line-count amendment.** All checker commands have
ended; no active test session remains. Read `w4-independent-check.md` and `w4-checker-source-hashes.json` for the final
handoff. The progress sections below are historical and are superseded by the final section at the end.

- Checker: `/root/w4_check`; parent session `session:codex_01a0ed15-10d0-7802-90a1-48c5d50ec0fc`.
- Exact cwd `H:/TakiAgent`, branch `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
  Parent confirmed `/main` in dispatch was branch shorthand, not a directory. Initial exec with that nonexistent
  directory failed before execution; no source mutation occurred. Native cwd `H:/hindsight`, main HEAD
  `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`; native unchanged-source gate belongs to the parent.
- Explicit task assignment overrides the expected empty legacy `.current-task`; never switch to T4 or create a task.
- Own the COMPLETE W4 check/repair, no delegation. Preserve existing edits and immutable delivery manifests.
  No new dependencies, commit/push/reset/rebase, original-data/authority changes, finish/archive or W5 implementation.
- Read full parent handoff, W4 implementation and check brief first, PRD/implement/design contracts, check skill,
  before-dev skill, root instructions, applicable spec indexes, all curated context files (historical/frontend
  material skimmed for scope/contract sections, not claimed as exhaustive line review), final W0-W3 reports.
  Critical W4 publication/runtime spec and source paths are authoritative; older planning status is superseded.
- Memory quick pass found only general operating/history discipline; MEMORY.md151-154,169. No historical task result
  substitutes for current W4 verification. Cite if used in the final response.

## Initial actual checks (historical; superseded by progress below)

- `pnpm lint`, session46238: exit1, precisely five known cohesive length exceptions: Hindsight binding55/50,
  composition51/50, selector55/50, transition runtime51/50, prior W3 Local projection51/50. No other diagnostic.
- `pnpm -r typecheck`, session24599: exit0, Shared/Core/Desktop/CLI/E2E all Done.
- No test run by checker yet. No production/spec edits yet.
- Read both runtime binding implementations and selector. Continue through actual transition runtime, publication
  transaction/read-back, custody/ingestion ancestry, queued-provider/executor and writer drain paths/tests.
- Known doc sync finding to repair after exact search: eslint.config.js narrowly allows Shared entry540 with named
  source-bearing export guards; CLAUDE.md and backend quality spec still say520. Preserve config, attribute no author.
  Check Local spec's historical lazy-Bank caveat against current W4 bank fence (may need an explicit W4 amendment).

## Current progress, 2026-10-03

- **F1 fixed:** `memory-transition-custody.ts` previously trusted a completed live witness without validating its
  actual span source/hash/member/epoch ancestry. It now checks completed spans even before Timeline compaction,
  including actual producer identity, provider and lineage. **F2 fixed:** finalized groups with a missing final member
  now refuse against `finalized_through_seq` before being filtered from outstanding custody.
- New source/target membership and pre-proof final-member regressions: session10096 exit1,3FAIL/9PASS (actual red);
  session90166 exit0,12PASS after repair. Both commands:
  `pnpm --filter @taki/core exec vitest run src/db/memory-transition-custody.test.ts --maxWorkers=2 --reporter=dot`.
- First independent Core group session4342 exit0,27files194PASS; exact selectors/output in `w4-independent-core.log`
  and tool trace. Includes publication/custody/replica/migration054/lineage/runtime/bindings/fences/activation and queue.
  This precedes F3 and is not a final aggregate; counts overlap all later targeted groups.
- **F3 fixed:** detached `syncBanks` outlived the Run admission budget while inheriting the completed capture owner.
  Its second Bank could no longer enter the work fence. `hindsight-runtime-bank-service.ts` now owns/tracks the entire
  capture sequence independently; `hindsight-capture-sync.ts` admits it before racing the budget. Both drain and
  shutdown join it. New actual started subsystem/two-Bank/expired-budget test in `hindsight-runtime-lifetime.test.ts`.
- F3 first probe session76102 exit1 due to test fixture interference from the ordinary scheduler, not the defect.
  Pausing the already-started scheduler isolates foreground work. session38139 then exit1,1FAIL/2filtered for the
  actual missing second Bank. Logs `w4-independent-detached-red.log`, `w4-independent-detached-red2.log` preserve both.
- F3 targeted session32253 exit0,3files18PASS: lifetime + existing capture-sync D1/D2 + runtime-bank-service.
  Log `w4-independent-detached-green.log`. All commands ended.
- **F4 candidate:** native-outcome readers fetch Bank B's row but validate payload Bank A independently; a valid
  outcome from another admitted Bank can stand in for missing activation/abort evidence. Two test variants added to
  `memory-transition-native-outcome.test.ts`; red run **session31819 currently active**, command selects `-t "another Bank"`,
  output `w4-independent-outcome-key-red.log`. No F4 production patch yet.
- No other active process. Only checker owns production/spec changes; parent only edits task coordination docs.
- Still need docs sync (520 -> actual540 in CLAUDE/backend quality; current Local lazy-Bank paragraph; F1/F2/F3 contracts
  and touched indexes), final lint/types, source inventory/header/encoding/diff checks, actual isolated Core boot and
  graceful handler smoke, remaining Shared/queue/operation regressions, final report. Native remains unchanged.

## Remaining gate

Independent affected tests (<=2 Vitest workers, no overlap), failure search and meaningful regressions; source/hash
inventory, boot smoke, migration054/history/rollback, spec/index/encoding/diff checks. Preserve raw failures and count
overlaps honestly. Deliver `w4-independent-check.md` and separate `w4-checker-source-hashes.json`, never regenerate
`w4-source-ownership.json`. Do not mark W4 PASS until all scoped obligations are completed.

## Resumed check progress, 2026-10-03

- F4 fixed in `memory-transition-native-outcome.ts`: native response payload Bank/transition identity must match
  the exact storage key used by readiness, release and idempotent writes. Red31819 exit1,2FAIL; green57747 exit0,
  3files9PASS (native-outcome, abort, runtime-recovery).
- F5 fixed in `memory-transition-pending-refusal.ts`, source-disposition and effect-repo: no-effect classifiers now
  call the original `readPendingMemory` validator before stripping storage-only sequence for stable evidence hashes.
  A forged JSON operationId/intentHash can no longer disagree with the queried Pending key. Red25954 exit1,2FAIL;
  green2927 exit0,3files13PASS (source-disposition, effect-repo, intent-executor).
- Final candidate typecheck78355 exit0 in all five workspaces. Lint12710 exit1, exactly the same five approved
  cohesive length exceptions; no other diagnostics. Existing `eslint.config.js` preserved.
- Source/spec/index repairs completed: publication contract F1-F5; Shared entry540 guidance in CLAUDE/quality;
  Local inventory/fenced new-Bank caveat; current W3/W4 transition responsibilities; db/Hindsight indexes.
- Shared independent group exit0,4files38PASS: transition-schema, provider-operation, operation, error-code.
  Raw output `w4-independent-shared.log`. Core caller/operation group66254 currently active (<=2 workers);
  command/output in `w4-independent-callers.log` and tool trace. No competing test groups.
- Continuing actual Node strip-only Core boot/shutdown with isolated Legacy and genuine B2 producer-created Local
  data. No synthetic activation receipt is needed. Harness not yet executed at this checkpoint.

## Final independent gate, 2026-10-03

- Core callers66254 exit0,7files51PASS. The recorded `transition-provider.test.ts` selector does not exist; no extra
  file/test is claimed. Actual queued-provider coverage runs through canonical tools in intent-executor tests.
- Final affected runtime55091 exit0,8files71PASS. Includes final custody/publication, four-receipt started cycles,
  source recovery, expired-budget capture, Bank service and Hindsight composition. All groups are sequential and
  counts overlap earlier runs; no additive total is claimed.
- Independent Node v24.18.0 strip-only `main.ts` Legacy and Local boot passed. Local data came from a synthetic
  Markdown entry through genuine B2 snapshot/prepare/activate producers. Actual authenticated WS authority status
  reports available=true, actual SIGINT handler exits0, then DB reopen integrity is ok. Zero model requests.
  Final script/log: `w4-independent-boot.mjs`, `w4-independent-boot-status.log`; owned result directory:
  `.trellis/.runtime/w4-independent-boot/792b6a9f-8b5c-4345-a956-de21022ae8c8/`.
- Source audit exit0:94paths (original89 +5extra),14delivered paths changed; four additional repairs plus preserved
  ESLint config. UTF-8/no BOM, module headers and directory indexes pass. All55 historical migration sources
  numbered001-053 match their baseline. Parent Native349-path preservation evidence remains separately attributed.
- New checker manifest SHA-256: `8e9474814dcd503b30922576c657038ba88d8fdb19ee46f127c27dc26ee89915`.
  Original W4/W3/pre-W4 manifests and existing ESLint hash remain unchanged. Use only the new checker audit script.
- Task validate exit0,34implement/37check entries. Both `git diff --check` and `git diff --cached --check` exit0.
- Final types78355 exit0 and final raw lint12710 exit1 remain the last source checks; only the five owner-approved
  cohesive length diagnostics remain. No suppression or global relaxation introduced.
- Report `w4-independent-check.md` records F1-F5 behavior fixes, F6 docs sync, exact commands/results and limitations.
  No unresolved in-scope behavioral defect remains. Inherited ESLint historical author/wave remains unproven.
  W5-W8, real Native/model/corpus journeys, manual and original-environment acceptance are not marked passed.
- A later user interruption made no source changes. Resume performed no redundant test reruns; only the final
  checkpoint/delivery metadata was completed. No delegation, W5 implementation or Git publication occurred.
