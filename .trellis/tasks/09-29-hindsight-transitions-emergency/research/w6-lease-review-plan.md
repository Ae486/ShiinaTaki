# W6 execution lease review and repair plan

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Reviewer: `/root/w5_postpatch_review`.
State: source diagnosis and repair design only; actual successor session `81335` holds the source freeze.

## Confirmed source gap

`transition-emergency-service.ts` claims one 300000-ms lease, then never calls `renewTransitionLease` and
has no heartbeat/boundary owner. `refresh()` only reloads the attempt; `phase()` changes phase/revision without
renewing the expiry. The complete sequence includes old-runtime quiescence, asynchronous copy/seal and repeated
full evidence reads, candidate preparation, proof, publication, bind, readiness, queue settlement and resolution.
Real `deps.now()` checks after seal and bind correctly refuse a dead lease, but total duration over five minutes
therefore ends an otherwise live attempt even if each independently verified step fits that lease.

This is functional liveness, not an optional performance project. No lease-duration change is proposed. A single
uninterrupted step that itself outlives the lease must still fail closed; it cannot be fixed by renewing after expiry.

## Final publication boundary to prove

`memory-transition-emergency-publication.ts` checks `input.assertConfiguration()` near the beginning of `boundary()`,
before complete candidate reconstruction. Its later `recordTransitionReceipt` call uses the entry `input.now`,
and the complete publication read-back is followed by return rather than a new real-clock executor check. A clock
regression must establish that expiry during that work cannot leave a newly committed authority.

Do not call the current closure blindly after receipt insertion: `recordTransitionReceipt` advances the attempt
revision and phase to `committed`, so that closure's pre-publication revision would reject a valid same-owner COMMIT.
The final check must retain the exact captured transition/operation/attempt/generation/owner and use only the known
receipt-induced revision advancement. It must not accept an arbitrary freshly loaded executor as the old caller.

## Scoped implementation

1. Reuse the existing healthy heartbeat mechanism rather than add a second scheduler. Extract its serial renewal,
   30-second timer, real event-loop boundary/join, pending-failure propagation and terminal cleanup into a small
   transition-local helper if needed. Healthy supplies its current Core-plus-Native renewal and keeps its existing
   behavior. Emergency supplies only guarded local `renewTransitionLease`; it must never acquire a Native client.
2. Give emergency execution an owned abort lifetime. Ordinary stop aborts/clears its heartbeat and joins its active
   local work. A renewal failure records the same original transition's truthful outcome and cannot leak a timer.
3. Yield/join only after completed synchronous transactions: quiescence, seal return, each copied-Bank materialization,
   candidate preparation, proof preparation, publication, bind/readiness and queue settlement. Join/stop before
   terminal resolution. Preserve incident/capture/candidate identities across lost replies and explicit recovery.
   Existing asynchronous file-copy/digest waits can deliver the timer; never introduce an async SQLite transaction.
4. Add an explicit real-clock final executor guard to emergency publication, carried by its internal production
   work input. It runs after the expensive validation and full read-back, inside the still-open outer SQLite
   transaction. Keep the immutable receipt timestamp separate from this check. Validate the original lease identity
   and exact expected committed revision; preserve configuration/scope guards. Missing/foreign/stale ownership
   refuses. Do not relax `requireTransitionLease` revision/generation checks globally.
5. If the final guard throws before SQLite COMMIT, all selected authority/candidate installation/receipt/foreign-branch
   changes roll back together while the already sealed incident remains. If the COMMIT has already succeeded and
   a later bind/readiness check expires, the new Local authority remains selected and unavailable/unknown; recover
   the same receipt. Never claim that post-COMMIT work rolled authority back.

The exact small internal input shape for step 4 should follow the clock regression. A live clock getter or explicit
same-owner final callback is appropriate; reusing a frozen timestamp, weakening the CAS, or moving verification
outside the transaction is not. All affected fixture inputs must be updated to prove the actual producer path.

## Required targeted regressions

- Several independently complete local steps each below 300 seconds but totaling above 300 seconds keep the same
  live executor through renewal; incident/capture/receipt remain singular and Native/transport/model calls stay zero.
- An uninterrupted step crossing expiry refuses; a failed renewal cannot resurrect the old lease. A foreign/replaced
  owner/generation and stopped execution cannot renew or publish. Subsequent explicit recovery retains original IDs.
- Expiry during candidate/publication reconstruction or final read-back rolls back authority, target epoch,
  installed state, receipt, foreign branch and queue/custody assignment in the same transaction. Original seal survives.
- A genuinely committed receipt followed by expiry before/during bind remains the selected target and resumes that
  exact receipt. No predecessor revival or duplicate publication.
- Stop, renewal rejection and terminal settlement leave no pending timer/Native call. Healthy final-TTL admission,
  Native renewal ordering and existing heartbeat tests remain unchanged.

## Evidence boundary

No lease regression was run during the actual-source freeze. The parent will supply the measured successor result;
repair is authorized after the process ends regardless of whether that particular run fits the original lease.
The actual driver also adds complete candidate/publication verification before bind; distinguish its validation
cost from the product's own independent boundaries when interpreting logs. Do not shorten or mutate the running
attempt to force a result, and do not convert this work into a general cache/performance redesign.
