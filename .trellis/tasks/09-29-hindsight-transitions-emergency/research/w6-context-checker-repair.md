# W6 synchronous emergency verification repair

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Reviewer: `/root/w5_postpatch_review`. Date: 2026-10-06.

## Trigger and confirmed scope

Parent reported actual recovery session `73018`, history `d9280ebf2293468b9457af574727f195`, exited 1 normally.
The new operation `b661d113-93e3-4b2a-bfdd-ab61d21f1dca` is `outcome_unknown`, with diagnostic
`MEMORY_TRANSITION_LEASE_LOST` at phase `proven`. Candidate and final proof persisted on generation 2/revision 6;
receipt/publication/foreign-branch counts remain zero, original authority/capture/incident are unchanged. Earlier
live lease observations did not alone establish failure: candidate/proof progressed and renewed before the final
publication refusal. The final failed result remains preserved.

Readonly source tracing found avoidable complete recomputation inside each synchronous boundary:

- Candidate preparation reconstructed twice and verified each surviving Bank closure six times: entry, scope,
  and two calls inside each of two reconstructions.
- Proof reconstructed once. Publication reconstructed three times: its boundary, installer and final read-back.
- Each missing-policy Bank created another independent Native context and verified its whole healthy predecessor
  publication during every reconstruction.
- The healthy publication entry already supplied a scoped EvidenceContext, but the emergency dispatch, installer
  and reader did not forward it. Emergency surviving projection had no corresponding scoped pure-artifact reuse.

Parent authorized the narrow existing-context repair after the actual process ended. No TTL/lease extension,
asynchronous transaction, long-lived emergency cache, original corpus inspection or Native production change was
authorized or performed. Parent owns actual execution and the new copied-Core publication-clock rehearsal.

## Findings (fixed)

1. `transition-evidence-context.ts` now supports stored surviving evidence within the same existing synchronous
   context. Every access rereads SQL identity/bytes. Full closure validation occurs once for unchanged bytes; a
   same-ID caller envelope, foreign Database, changed/deleted row or closed/observer context cannot reuse it.
   Heads/content are frozen, Maps are copied and body bytes are isolated.
2. Native and surviving pure Bank projections have separate one-variant-per-Bank slots. The complete surviving
   key includes scope/epoch/time/ancestry/previous mappings/baseline and sorted policy Map entries, including the
   original policy-source history and Canonical record. Maps never collapse to `{}`. Key changes recompute the
   projection; a repeated key reuses only its frozen pure output.
3. Candidate preparation validates the actual inserted document within the same uncommitted transaction before
   consumption. Construction and read-back share their fresh context. Every candidate read still parses/verifies
   its durable document, incident, capture, intent, reservation, scopes, history, hashes and complete state closure.
4. Proof and COMMIT each create a separate fresh boundary. Publication forwards its existing context through
   emergency proof boundary, installer, checkpoints, final read-back and predecessor-policy verification. No
   candidate/publication verdict is cached. Policy correspondence and mutable SQL joins execute on every read.
5. Healthy observer dispatch explicitly opens a fresh independent emergency context on every emergency read.
   Direct emergency readers reject observer contexts. Healthy observation reuse and public independent-reader
   contracts remain unchanged.

The final actual-clock original-executor check immediately before COMMIT is unchanged. Current configuration,
owner/lease, authority, reservation, custody, queue, checkpoints, historical SQL rows and installed Local rows are
still reread/checked. Contexts close on normal return, error or async misuse and never cross an await, retry or
process. Spec/index updates describe these exact boundaries; no lint limit change was needed.

## Verification

All tests used synthetic owned data and at most two Vitest workers.

```powershell
pnpm --filter @taki/core exec vitest run src/memory/transitions/transition-emergency-context.test.ts src/memory/transitions/transition-emergency-lease.test.ts src/testing/memory-transition-emergency-process.test.ts src/db/memory-transition-observation.test.ts src/memory/transitions/transition-evidence-context.test.ts --maxWorkers=2
pnpm --filter @taki/core exec vitest run src/db/memory-transition-surviving-policy.test.ts src/memory/transitions/transition-emergency-recovery.test.ts src/memory/transitions/transition-emergency-service.test.ts src/db/memory-transition-emergency-publication.test.ts --maxWorkers=2
pnpm lint
pnpm -r typecheck
```

- First complete group: **5 files / 44 tests PASS, 61.81 s**. Candidate/proof/COMMIT each fully verify the two
  surviving and two predecessor Native evidence documents once and project every head once. Simulated 45-second
  full-verification cost totals 180 seconds per boundary and COMMIT succeeds within the unchanged five-minute lease.
  A new independent entry verifies again. Existing actual lease exhaustion/rollback/stop/foreign-executor cases pass.
- Same-context corruption tests alter surviving bytes, slot, transition identity and deletion after a projection
  already exists; rereads refuse. Policy history, Canonical content and mapping-key changes recompute. Foreign
  Database/caller envelopes/expired contexts/async misuse refuse; mutable Maps/bytes cannot alter stored evidence.
- Observer tests prove each emergency observation verifies all surviving evidence again, rejects an observer context
  supplied to a public emergency reader, and detects a changed current authority marker within an already populated
  independent context. The existing healthy observer and independent-context suites pass.
- The two actual Node protocol tests on synthetic stopped Core pass: fresh emergency and original sealed recovery
  each followed by distinct-process restart, retaining the original unknown operation and seal identity with zero
  additional Native/model/transport dispatch.
- Second complete group: **4 files / 20 tests PASS, 65.27 s**. Includes strict unchanged missing-policy preservation
  and a new assertion that its actual COMMIT verifies every predecessor/source Native evidence ID only once while
  checking policy/publication joins, plus original crash/reopen, service and atomic-publication regressions.
- Root lint and all five workspace typechecks PASS. No Native source changed, so the earlier independently passed
  four owned Native restore tests were not repeated.
- Initial new-test failure used an incorrect synthetic trigger name; corrected to migration057's `no_update`/
  `no_delete`. Typecheck caught closure narrowing and a potentially undefined test SQL value; corrected before final
  root PASS. These were not actual-corpus failures and no production validator was relaxed for them.

## Source release and actual boundary

`w6-context-repair-source-ownership.json` is this batch's independent source manifest. The prior 22-file
`w6-checker-source-ownership.json` and earlier admission hashes are retained unchanged as historical releases.
Core HEAD remains `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`; no commit, dependency or task archive was made.

Parent will first execute `w6-publication-clock-rehearsal.mjs` against a new owned copy of the stopped proven Core.
Its repository-level fixture creates a new recovery operation/claim without modifying either original unknown
operation, then times actual candidate/proof/COMMIT and two fresh independent read-backs with real clocks. Review
identified its missing producer `requestId`; parent corrected it. The public candidate/proof/publish APIs remain
compatible. This rehearsal intentionally does not certify operator admission, runtime binding or restart.

After the rehearsal passes, parent may run the newly reviewed original-transition recovery supervisor. Actual
recovery/restart/D91 results remain required for W6 PASS; W5 must not be rerun, and W7/W8/manual acceptance remain
open. No running reviewer tool remains at final release. Source/JSON writes and tests stop during actual execution;
only readonly review and Markdown updates continue.
