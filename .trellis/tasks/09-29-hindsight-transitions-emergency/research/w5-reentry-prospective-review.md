# W5 same-Bank reentry prospective review

## Outcome and scope

**Do not start the existing `--stage reentry` driver unchanged.** Its production transition producers can reuse the
returned baseline and apply the small application delta, but its task-owned progress/recovery and budget-inspection
helpers need a narrow repair first. New reentry maintenance enumerates a new whole finite requirement set; it is
not limited to the two changed application artifacts and cannot reuse a completed RETURN run as its new proof.

This was a source-only prospective review. No live SQLite/PG file, service, model, test or running pair was accessed.
Only this report was created. Parent subsequently reported actual RETURN completed, both Banks retired, Local ready,
the same receipt retained, 92 completed steps / 769 actions preserved, zero new models and cumulative count 301.
Those are parent-supplied live facts, not independently re-audited by this read-only worker. No Local edits/reentry
or new verification-bound native plan are claimed to exist.

## Existing Local edits and assertions

Source: `research/w5-reused-driver.mjs:90-134`.

| Step | Actual existing behavior | Required prospective treatment |
| --- | --- | --- |
| Return anchor | Calls `runDirection(return-local)`, reuses a saved completed operation, reconstructs its final candidate, requires 2 Banks / 722 Sources / 21 invalidated records, saves `returnCompleted`. | Preserve the exact original transition/receipt/candidate/new Local epoch and prove them against SQLite on restart. Never start a second return as recovery for a missing JSON step. |
| Policy edit | Selects the first valid, non-hidden candidate record. Calls actual `policyEdit`, stable request `w5-real-policy-change`, candidate revision and returned epoch; importance becomes 6 unless already 6, then 7. | Persist exact scope, record identity, original revision, intended patch and request before execution. Its actual resulting unit revision and policy version matter. This is one record, not one per Bank. |
| Block edit | Selects the first user-written Block, otherwise first Block, and appends `W5 isolated healthy transition continuity check.` using old candidate Block revision and writer. | Persist exact original/desired content hash, scope, actor and expected/result revision before execution. This is one Block, not one per Bank. |
| Reentry Source reuse | Requires 722 final Sources / 2 scopes; for every original document mapping compares exact native target, application version and application body hash. | Keep these strong assertions and record the mapping count. They cover original Sources, not an assertion that all maintenance-derived observations/models remain byte-identical. |
| Delta check | Every preparation must contain zero `rows.documents` and zero `rows.memory_units`. | Keep; also bind every preparation and delta receipt to the new reentry transition and original Bank/generation/baseline. No full corpus retain/conversion is allowed. |
| Changed policy/Block | Checks resulting importance and Block revision. Saves policyVersion but does not assert it; does not check desired Block content. | Add exact intended policy version/record identity and desired Block content/hash assertions. Log-only final invalidated count is not an explicit lifecycle preservation assertion. |
| Same Banks | Final scopes count is checked, but the harness does not directly compare final Bank IDs/generations/Local mapping IDs against the return baseline. | Add explicit same-Bank/generation/lineage/baseline identity checks for reviewable real evidence. Production already rejects foreign retired baselines. |

Production same-Bank protection is concrete: `packages/core/src/db/memory-transition-delta-repo.ts:80-92` requires
the exact existing native Bank/generation, baseline transition and proof, retired outcome, and original Core receipt.
`transition-healthy-candidate.ts:23-45` captures current Local state, prepares/applies each Bank's delta, then verifies
that Bank and loads real native evidence before building the Hindsight candidate. It never manufactures a new Bank
or a final proof merely because the application-only change is small.

## Confirmed helper recovery gaps

1. **Block-commit / JSON-ack crash gap.** `w5-reused-driver.mjs:98-110` commits the policy edit, separately commits the
   Block replacement, then saves `localChanges`. If the Block commit succeeds but that save is lost, restart repeats
   the old expected Block revision and fails `MEMORY_REVISION_MISMATCH`. This is a truthful refusal, not silent duplicate
   content, but the existing harness cannot automatically reconcile it. A policy-only lost acknowledgement is already
   safe: `canonical-memory-maintenance-journal.ts:47-86` excludes `now` from request identity and returns the original
   immutable receipt/revision snapshot. Do not replace its stable request ID or raise the expected revision to retry.
2. **Progress JSON is not atomic.** `save()` uses direct `writeFileSync` at driver line 47. Truncation/crash may leave
   invalid JSON; initial parsing is outside the main `try`. Parent supervisor preserves copies on each normal launch,
   but those copies do not close the live write window. Use the task's established `.next` plus atomic replace pattern
   and preserve the last verified checkpoint; never silently initialize fresh state after an invalid file.
3. **Submit / step-identity save gap.** `runDirection` lines 151-174 creates a random request, calls `owner.submit`,
   then saves operation/transition identity. A crash after SQLite admission but before step save can leave a real
   transition with no `steps[name]`. `latestOperation` may exist but is not reconciled by `runDirection`. Persist the
   exact request/preview before submit, recover its existing operation by request/producer evidence, and refuse an
   ambiguous match rather than minting another request or using an unrelated completed transition.
4. **File flag is a weak restart anchor.** `--stage reentry` trusts `result.returnCompleted` as its early gate, then
   relies on the saved return step. Preserve that state across successful return shutdown and validate against the
   actual completed operation/receipt/selected epoch. The supervisor copies `driver-result.json` into attempt-history;
   it does not delete it (`w5-reused-native.py:194-199`), so normal stage handoff is supported. Missing/corrupt/partial
   checkpoint recovery remains the gap; no new database or fresh return should be used as a substitute.
5. **Restart loop snapshots lease once.** `runDirection` line 156 reads `attempt` once before waiting for expiry.
   The exclusive stopped-pair discipline makes the normal case bounded, but another owner renewal/replacement would
   not be reread during that loop. The repaired stage should verify exclusive ownership and refresh the attempt
   before deciding that recovery is admissible; no lease-duration reduction is needed.

## New finite maintenance and model-call estimate

### Confirmed native behavior

- `transition_maintenance.py:51-142` keys the durable run by **Bank plus the new transition ID**. For a reentry with
  no such run it requires the real applied delta, reads current fenced native records/journal and current policy,
  computes new candidate/required-set hashes, and persists the run. The prior RETURN transition's completed run
  has a different identity and is not consulted as reusable completion.
- `maintenance_candidate.py:18-52` includes every valid world/experience memory unit for each resolved write scope,
  not just changed input rows. Each refreshable mental model adds a requirement. Static models with no source query
  have explicit non-applicability evidence in `transition_maintenance.py:90-113`. Observations/invalidated raw units
  are not enumerated as source-scope requirements.
- `cutover_verification_runner.py:511-532` groups remaining requirements by `(sorted original tags, scope_tags)` and
  chunks by `max(1, consolidation_llm_batch_size)`. Completed requirement outcomes are reused only from the **same**
  durable run. Prepared valid saved plans and committed action receipts can also avoid repeating their own earlier
  model work; old unrelated timestamps/certificates cannot.
- Each new source batch reaches `_consolidate_batch_with_llm` (`consolidator.py:2236-2330`); successful stored plans
  skip that call. Retry/subdivision, observation dedup and model refresh can add calls. `cutover_verification_model.py`
  uses the actual mental-model producer. `memory_engine.py:14181-14210` removes ordinary refresh time bounds under
  proof and runs reflect; structured delta/output work can require additional calls (`14643-14677`).

### What can be budgeted before new model dispatch

For a **fresh** candidate with observations enabled and no saved step/plan/action reuse:

`base model-call estimate = sum over Banks and tag/scope groups ceil(source requirements / batch size)
                           + one initial refresh allowance per dynamic mental model`.

The consolidation term is a source-backed minimum successful first-pass batch count. The model term is a minimum
planning allowance, not a maximum reflect conversation count. A safe finite cap needs separately reviewed headroom
for actual reflect/tool loops, dedup and permitted retries. Token/monetary cost is unknown until measured. On recovery,
subtract only exact same-run completed requirements and separately identify valid saved plans/action receipts.

Do **not** reuse the historical `83` as the new reentry bound. That was the old RETURN's *remaining* 484 Character
source scopes in 61 batches plus one model, 20 Global batches plus one model, after 60 already completed requirements
(`w5-implementation.md:194-197`, `w5-real-resume-handoff.md:41-49`). Those already completed requirements belong in a
fresh reentry enumeration again if still eligible. The historical counts strongly warn that the currently unused
28 submissions under 329 are not a reviewed reentry budget, but this worker did not inspect current records/config
and therefore does not assign an exact numeric reentry minimum. Obtain current per-Bank grouping/batch/model counts
before choosing a new finite **cumulative** ceiling; preserve submitted=301 and all prior usage.

### Existing inspection helpers are not the exact new plan gate

- `w5-reused-native.py:115-138` already produces a no-model source enumeration in `inspect` mode, before HTTP/driver
  startup. It is a useful fresh **forecast** on the stopped owned pair. It enumerates with policy hash `0...0`, does
  not persist a new verification-bound run, and its run-mode variant proceeds immediately after writing the forecast.
  It cannot prove the exact later post-delta candidate hash or provide a human review pause by itself.
- `w5-remaining-plan.py:33` does `SELECT * ... WHERE bank_id=$1` without verification ID or uniqueness. With RETURN
  and reentry history it can fetch an old complete run and incorrectly count no work. Its fallback uses old
  `run-plan.json` by Bank ordinal, and line 92 subtracts from hardcoded 240. It is unsuitable unchanged. Query the
  exact Bank/verification ID, use stable Bank identity instead of ordinal, and use the explicit reviewed current cap.
- The public `/executor/verify` route immediately runs preparation **and execution** (`api/taki_transitions.py:142`,
  `transition_maintenance.py:154-192`). There is no public prepare-only transition maintenance endpoint. Calling it
  normally and hoping to inspect the plan before a model request is not a reliable gate.

## Minimal recoverable task-helper design

Keep production Core/native sources, proof validators, heartbeat, TTLs, timeouts and polling unchanged. Repair only
the existing task-owned driver/supervisor/plan helper and focused zero-model helper regressions in the next assignment.

1. **Persist exact journey and mutation plan.** Add an atomic versioned task checkpoint anchored to return operation,
   transition, receipt, candidate, Local epoch and all original Bank identities. Store the desired policy and Block
   mutation before applying either. Reconcile policy by its existing receipt/snapshot. Reconcile Block by exact
   original state or the planned new revision **and desired content hash**; any other state is a conflict. Read back
   both durable results before marking local changes complete. Do not use JSON flags alone to infer database effects.
2. **Persist exact reentry submission identity.** Save original request/preview before `owner.submit`; on restart
   resolve its exact durable operation/transition, then use the ordinary explicit recovery request when required.
   Completed source/target receipts are authoritative even if the checkpoint write was lost.
3. **Use a task-only native preparation gate before `_execute_attempt`.** The supervisor already owns its Native
   engine in the same Python process. For an explicitly selected staged mode, wrap the transition maintenance
   execution seam and match the exact new transition ID and Bank before any source/model execution. Let the actual
   `_prepare_transition` run unchanged, persist/capture the real candidate, policy, required-set and delta-result
   identities, then deliberately refuse unapproved maintenance **before calling `_execute_attempt`**. Use the existing
   real refusal/error path so the run becomes truthfully `incomplete` and Core remains `outcome_unknown` with the
   original preparations/fences. Never return a fake proof, success or completed step. Require zero model submissions
   and preserved prior work, then join/stop owned processes normally. A staged checkpoint may be ready for budget
   review while its Core operation is unknown; it must not be labeled a completed transition.
4. **Respect the current per-Bank sequencing.** Core currently does `delta(Bank A) -> verify(A) -> evidence(A) ->
   delta(Bank B) -> verify(B)`. Consequently the first pause can capture only Bank A's exact new post-delta plan;
   Bank B has not yet applied its delta and has only a forecast. Do not bypass A's proof or return a synthetic status
   to reach B. Minimal staging is: prepare/pause A; review its exact plan and finite allowance; ordinary same-transition
   recovery permits A execution and pauses at B preparation; review B; recover again to complete. Configure the
   helper gate by exact allowed Bank/transition identity and preserve sealed A proof/completed steps on later resumes.
   If the owner instead requires **both actual persisted plans before any new model call**, that needs a larger dedicated
   all-Bank preparation orchestration using the existing guarded producers; it is not present in the current sequential
   driver and should not be smuggled in by skipping validators. The smaller per-Bank staging is recommended.
5. **Review/resume truthful incomplete plans.** The preparation refusal goes through the current native catch and
   records an incomplete run under the real owner. On restart use existing Core/native lease expiry/claim and explicit
   recovery; do not clear running state, rewrite attempts, shorten leases or invoke the private preparer ad hoc and
   leave a same-executor running plan. Native `_prepare_transition` refuses a still-running same attempt. Capture exact
   attempt/generation/fence and distinguish a genuine stopped incomplete plan from still-active work.
6. **Strengthen final acceptance without freezing legitimate derived maintenance.** Keep exact Source mappings/body
   reuse and zero document/unit delta payload assertions. Add explicit Bank/generation/lineage joins, changed policy
   version, desired Block content hash and original invalidated-unit identities/lifecycle assertions. Derived models,
   observations and graph state can legitimately change through the new finite maintenance; prove their actual final
   closure/provenance rather than requiring all native bytes equal to RETURN.

Suggested narrow files for that implementation: `w5-reused-driver.mjs` (atomic checkpoint/Local reconciliation/
submission/final assertions), `w5-reused-native.py` (explicit staged execution admission), `w5-remaining-plan.py`
(exact plan/current-cap reads, or a separately named successor to preserve historical helper evidence), one focused
task-owned stage helper if necessary, and their independent zero-model checks. Snapshot these helper preimages
before editing. No new production endpoint, dependency, second scheduler or authority ledger is required.

The exact native preparation gate requires a deliberate new task-helper patch and independent tests; this report
does not assert it is implemented. Tests should cover policy commit/Block commit/checkpoint loss, submit-before-ACK,
RETURN checkpoint restart, selecting old-vs-new plans, gate refusal before zero model calls, same-transition resume
with prepared plan, completed first Bank reuse, and unchanged original usage/receipts/step hashes.
