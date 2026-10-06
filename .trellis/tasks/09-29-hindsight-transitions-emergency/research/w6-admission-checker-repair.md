# W6 emergency admission validity repair

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Independent reviewer: `/root/w5_postpatch_review`.

## Root cause and accepted contract

The preserved first actual attempt minted its preview at `2026-10-06T00:37:39.836Z`, expiring at
`00:39:39.836Z`. The driver submitted at `00:37:39.842Z`, only 6 ms later. Admission performed complete
synchronous local authority/evidence validation, then checked the later wall clock again and refused
`MEMORY_TRANSITION_STALE`. The operation owner invokes the plan twice in the same transaction. Emergency
identity reads additionally failed to use the already supplied independent evidence context, repeating
immutable evidence verification. This was a pre-admission refusal, not a changed authority or failed seal.
The parent verified complete prior authority/intents/receipts/operation rows unchanged and all emergency
capture/incident/quarantine tables empty; this report does not replace that retained original evidence.

The parent explicitly confirmed the emergency-only contract: an independently confirmed preview must be
valid when one synchronous operation-owner submission starts. Its own full local validation cannot count
as operator delay. Final stored-preview and current configuration/authority/inventory checks remain required.
Healthy transitions retain their existing final wall-clock expiry contract.

## Repair

- The operation owner creates an admission-scoped `TransitionEvidenceContext` with one real entry timestamp.
  Both emergency plans read that timestamp. The context closes before notification and execution; another
  submission obtains a new timestamp. Exact existing request retries only return their durable operation.
- Emergency plan still reloads preview, actor, request/recovery, current identity, configuration and inventory;
  only immutable evidence validation is reused within the synchronous context. It never caches a mutable
  authority/configuration result or final verdict. Recovery authority reads use the same independent context.
- Real operation, lease and execution clocks continue advancing. No TTL/lease/timeout increased; no stored
  preview was rewritten. Preview issuance already follows its expensive read and did not require relocation.
- Synced the emergency contract and both touched folder indexes. Parent supervisors/drivers and native code
  were not modified by this repair.

## Independent regression evidence

`pnpm --filter @taki/core test -- src/memory/transitions/transition-emergency-admission.test.ts src/memory/transitions/transition-emergency-service.test.ts src/memory/transitions/transition-evidence-context.test.ts src/memory/transitions/transition-admission-verification.test.ts --maxWorkers=2`

Result: **4 files, 41 tests passed**, 69.55 s. The nine new cases prove 6-ms-old immediate submission across
two 130-second synchronous identity reads; unchanged 120-second expiry for a later new submission; exact
duplicate observation; fresh evidence scope ending after COMMIT; current configuration/inventory/epoch/replica
and deleted-preview refusal on the second plan; and configuration/deleted-preview refusal after the first
expensive identity read. The existing healthy tests retain first-plan and second-plan final expiry refusal.
No Native/model dispatch was added. `pnpm lint` passed, as did scoped `pnpm --filter @taki/core typecheck` and
the final repeated root `pnpm typecheck` across all five workspace projects. Scoped `git diff --check` passed.

Initial test-authoring failures were retained in the session output: incorrect new test table names and an
assertion that counted the separate post-COMMIT quiescence boundary as admission reuse. These were corrected
without weakening production proof. Root typecheck then caught one optional callback invocation in the new test;
its fixture-established non-null assertion was corrected and Core typecheck passed.

## Released source identities

| Path | SHA-256 |
| --- | --- |
| `packages/core/src/memory/operations/memory-operation-service.ts` | `f747f660ea5afacf33dd8703d5ea336b68e2980619a3bbae7233cfc20410eb5a` |
| `packages/core/src/memory/transitions/transition-current-identity.ts` | `a6f885f839615142c142e49473a2df395cfb0024175969374e369c97dad4c867` |
| `packages/core/src/memory/transitions/transition-emergency-service.ts` | `8281d5940331abaa5a1f0dd4448d1fa3b0350e6c5f57c45a213f0d29bff27cbd` |
| `packages/core/src/memory/transitions/transition-evidence-context.ts` | `740606ca468f89dcff011d8fe009ad0ecdc8c5321b186ea6816fdcaf202baf74` |
| `packages/core/src/memory/transitions/transition-emergency-admission.test.ts` | `bb3361590be59bd1369169b13b52536dfe5137dc4346ab79e8fd53e86ac95760` |

This scoped repair is not final W6 acceptance. Parent-owned real emergency/restart, D91 paired recovery and the
remaining consolidated independent source review are still required. The parent owns the explicit successor
retry wrapper and preserved first-attempt evidence; never overwrite or silently retry the old result.
