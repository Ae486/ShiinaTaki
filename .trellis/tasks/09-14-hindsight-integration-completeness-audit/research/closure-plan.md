# Closure Order and Usable-State Acceptance

Date: 2026-09-16. This is the recommended implementation order derived from the completed research. It does not
authorize implementation, change existing batch acceptance, or create additional tasks. B7 U1 remains unanswered.

## Conclusion

Complete integration requires more than connecting UI controls to existing functions. First-enable orchestration,
active Bank/setup lifecycle, durable operator operations, repeated authority handoff and administration remain real
implementation gaps. The existing providers, migration/proof storage, checkpoint recovery and field preservation
should be reused. The [54-entry matrix](completeness-matrix.md) is the requirement ledger for the work below.

The [2026-09-18 source recheck](source-recheck-2026-09-18.md) preserves this proposed order and makes the local writer
coverage prerequisite explicit: S2/S3 cannot treat the Legacy fence or a promotion-wrapper comment as proof that
Canonical Local writes are drained or durably queued. Overall gap/closure discussion remains the current stop point.

## Dependency order

| Order | Deliverable and original ownership | Concrete work | Readiness before moving on |
| --- | --- | --- | --- |
| S1 | Establish actual operation prerequisites; B3/B4/B5/B6 seams coordinated by B7 | Define the narrow Core operation owner over existing producers, stable admitted request/operation identity, discovery/status, restart recovery and stage-aware cancellation. Correct orphaned setup and the stale-validation gate. Separate setup compatibility, runtime readiness and authority. Define active Bank provisioning and active health/configuration recovery. | C02/C04/C09 failure scenarios are specified against real producer state. No UI action is advertised from an unimplemented service or a historical configured flag. |
| S2 | Make the existing-instance first-enable journey executable; B4 plus B7 | Wrap B2 conversion where needed, current Local capture, complete Bank coverage, native import, required maintenance proof, replica verification and final fenced promotion. Bind the correct runtime after the committed marker and preserve pre/post-commit recovery. Deliver a minimal guided existing-instance path and truthful status. | C01/C02/C03/C04/C05 can run through actual registered operations without editing DB markers or fabricating receipts. Existing-instance setup does not depend on a managed provisioner. |
| S3 | Complete repeated switching and emergency operations; B7, using native/Core prerequisites | Implement the final source fence/drain, transition-owned queued writes, Local promotion, old-reference retirement and committed-runtime recovery. Re-entry must apply the current Local epoch's changes against verified baseline/mappings, then reconcile and commit the next epoch. Implement the separate emergency branch and uncertainty capture. | C07/C08 pass with multiple Banks, later Local edits/deletions/policy/Blocks, interruption and lost replies. Reconstruction alone cannot satisfy the gate. Backup/recovery prerequisites from S4 are required before any real takeover or replacement. |
| S4 | Complete administration and setup variants; Shell/helper/Core/B7 | Implement managed deployment, actual model/credential configuration and read-back, complete native plus Core backup/restore artifacts, versioned template/user-overlay lifecycle, and staged upgrade. Use immutable compatible artifacts and explicit Host/secret ownership. | C02/C10/C11/C12/C16 pass on isolated targets. No live replacement, takeover or destructive restore is allowed merely because a native CLI or receipt schema exists. This work can proceed beside S2/S3 where contracts are independent. |
| S5 | Finish the B7 operator experience; Shared/Core/Home | Consume the live operation owner for setup, authority/readiness, manual sync/reconcile/retry, Pending/failed/unknown states, backup/upgrade and normal/emergency switches. Reopen or attach a second client to authoritative progress. Add active-Character readiness and actionable failure paths. | C06/C09 and the UI parts of C02-C12 pass; all promised controls have real producers. Loading, stale, partial, conflict and unknown outcome are distinct. No second scheduler or frontend operation ledger is introduced. |
| S6 | Integrated delivery and supported-environment acceptance | Run changed-code package checks and complete the product journeys in the intended build. Verify actual compatible native artifact, persistent storage, Windows/headless secrets, same-Core multi-client behavior and operator/manual outcomes. Preserve unresolved capability limits explicitly. | C01-C12/C16 are recorded for the required scope, with optional/deferred C13-C15 identified separately. Original-environment activation and subjective acceptance require their actual evidence. |

S4 is listed as a workstream, not permission to postpone backup until after a real transition. Readiness is determined
by dependencies: complete backup and validated recovery must exist before real destructive or authority-replacement
operations. Backend and Home work may run in parallel only after their shared operation contracts are concrete.

Do not silently reassign unfinished work to a previously verified batch or invalidate B6's bounded results. Record
which existing B3/B4/B5/B6 seam each B7 prerequisite extends, and verify the new complete operation separately.

## Required user journeys and first blockers

| Journey from the research design | Current boundary / first unresolved step | Closure requirements |
| --- | --- | --- |
| J1 - usable Canonical Local | Provider/runtime exists after explicit B2 activation; the guided new/legacy-workspace path is not complete. Actual owner DB state was not inspected. | C01/C05; preserve current Local behavior and immutable migration evidence. |
| J2 - configure and activate Hindsight | B3 setup RPC exists, but there is no complete production B4 start/resume/promote operation or wizard. Model apply and managed helper are separate gaps. | C02/C03/C04; existing-instance and managed-local variants must each have truthful prerequisites. |
| J3 - ordinary chat/tools/maintenance | Supported on an admitted, correctly bound runtime. A new unprovisioned Character can fail before chat; fields/settings do not prove configured native behavior. | C04/C05/C16; report current waiting and deferred policy limits. |
| J4 - outage/restart/recovery | Durable replica/Pending and factual recovery work exist. Operator recovery/status and verified-reconnect triggering are incomplete. | C06/C09; do not replay unknown operations or treat browser reconnect as provider recovery. |
| J5 - healthy round trip with intervening Local changes | Missing reverse transition, generalized re-entry and repeated runtime/queue handoff. | C07 plus C03/C09/C10 prerequisites. Reuse verified common state, never a forced new-Bank/full-copy default. |
| J6 - emergency Local takeover | Missing admitted takeover/publication workflow and its uncertainty/backup UI. | C08/C09/C10; preserve recovered old authority as foreign history. |
| J7 - multiple clients and remote placement | Same-Core client substrate exists; memory operation observation is missing. Remote desktop Core selection is D23/#29, a separate deferred dependency. | C09/C12 for current same-Core scope; C15 only for separately scoped remote/cross-Core work. |
| J8 - backup/restore/staged upgrade | Native CLI exists, but no complete Taki artifact/helper/candidate workflow. | C10/C11/C12/C16. |

## Acceptance cases

These cases define what future implementation must prove. None is marked passed by this source audit.

| Case | Observable proof | Matrix coverage / limits |
| --- | --- | --- |
| C01 - Local and legacy conversion | Start from empty and supported historical workspaces. Use actual dry-run/stage/resume/verify/exclusion/activate operations; compare raw evidence, identities, lifecycle, Blocks and restart state. Show Local chat/retain/recall/maintenance works without Hindsight or vectors. | A01-A05/A09. Use isolated copies; original owner data is separate acceptance. |
| C02 - setup, models and interruption | Configure the existing-instance and managed variants with the correct secret owner. Validate the actual build and effective native models, preview templates, provision the required Banks and read back configuration. Interrupt each remote stage; recover the same durable attempt. After failed revalidation, refuse setup before mutation until valid evidence exists. | A06/A28-A33/A42. A stored model field or old compatibility object is not the expected result. |
| C03 - first Hindsight activation | From real current Local state, exercise registered capture/import/proof/replica/promotion operations with all Banks. Refuse current-source drift, missing maintenance/mapping, stale epoch and unsupported runtime capability. Prove the fence/drain reaches actual Canonical Local foreground and background writers. Lose replies and restart on either side of COMMIT, then observe the correct authority/runtime without redispatch or fabricated receipts. | A02/A10-A12/A38. No manual authority-marker edits or test-only B2 receipt injection. |
| C04 - active Character and configuration lifecycle | After Hindsight activation, add/use another Character and prove ready Bank mapping before Run admission. Exercise pending/failed provisioning, active health, credential/config change and recovery. Preserve the committed authority and prevent scope crossover. | A27/A31 plus S1. Distinguish an existing valid Bank's recall failure from a never-provisioned Bank. |
| C05 - actual memory use and policy | Through real chat/tools, verify safe primary-source routing, explicit retain, Global/current-Character isolation, cap-aware tool exposure, automatic recall budget/deduplication, no feedback ingestion, reversible mutations, Blocks, Local retention/tidy and Hindsight curator. Check addressed hidden/expired records according to their policy. | A04/A18/A22-A26. D81 derivative propagation is not implicitly included as passing; see C14. Model quality needs actual grading. |
| C06 - sync, reconnect and Pending | Exercise incremental apply, full reconciliation, cursor loss, lease races, interrupted publication, automatic due/startup catch-up, verified provider reconnection and manual mode. Lose native/application replies, restart, supersede stale revisions and prove one factual effect with truthful parent/application completion. Confirm unchanged bodies can be reused and document projection-repair behavior. | A13-A21. Separate timing, native/app cursors, failed/unknown work and assessment state; zero Pending is not cutover readiness. |
| C07 - repeated healthy switching | Run Local -> Hindsight -> Local -> Hindsight cycles across Global and multiple Character Banks. Make Local-period additions, edits, invalidations/restores, policy/expiry/deletion and Block changes. Verify complete identity/value/provenance/mapping preservation and propagation, final required maintenance/reconciliation, complete writer admission/drain, durably queued writes arriving during the fence and their post-restart replay, old-reference refusal and pre/post-commit recovery. | A08/A35/A36/A38. Receiving-provider capability differences do not authorize silent logical-data loss. Reuse the verified baseline and unchanged records. |
| C08 - emergency takeover | Make the provider unavailable, preserve replica/Pending/checkpoint evidence, show the potentially missing interval and require explicit takeover. Restore the new Local epoch after restart; when old Hindsight returns, prove it cannot overwrite or auto-merge. | A37 plus C09/C10. Unknown remote-only changes remain disclosed, not invented as zero. |
| C09 - durable operation and multiple observers | Submit an admitted setup/sync/switch/admin operation, close or lose the initiating Home reply, reopen Home and observe it from another authenticated client. Recover the same operation identity, exact progress and terminal/unknown outcome. Exercise stale revisions/epochs and stage-aware cancellation without duplicate mutation. | A17/A21/A30/A34/A44/A45. Do not borrow Chat's close-cancels-Run behavior for admitted memory operations. |
| C10 - complete backup and recovery | Produce an explicitly located inventory covering native/application tables plus Core authority/mappings/Pending/journals/configuration and required credential custody. Validate an isolated restore, read back exact identities/proofs, and resume incomplete work without repeating native effects. | A39/A41/A43. Native ZIP or readable replica alone is insufficient; missing credentials must be explicit. |
| C11 - staged upgrade | Restore a candidate, validate exact compatibility/schema, retain/recall/sync/template/override behavior, and promote only after the gates pass. Preserve old authority and recoverable artifacts before promotion; recover committed state after a lost reply or bind failure. | A33/A40 plus C10/C12. Do not use unverified upstream latest or destructive downgrade as recovery. |
| C12 - supported deployment and secret ownership | Verify intended Windows-local and headless key sources, installed helper/package lookup, exact native build, storage persistence and restart. Use same-Core client auth and write-only set/clear/presence without exposing secrets. Record actual environment/build identity and owner/manual observations. | A06/A41-A44. Historical tests and source hashes are not these environment results. |
| C13 - optional capabilities | If advertised, configure the Canonical Local vector path and prove asynchronous indexing/rebuild and sparse fallback. Export current canonical state in the promised format and prove field/lifecycle/provenance completeness without mistaking old Markdown or native-only transfer for that export. | A05/A48. Optional functionality remains visibly unavailable until implemented; not a new basic-chat prerequisite. |
| C14 - truthful deferred capability limits | Preserve separate statuses for daily review, retention execution, model assessment, promotion, derivative freshness and actual latency. Retain the recorded D81 failing case and do not label the original failed assessments successful. When each follow-up is separately implemented, add its real behavioral acceptance. | A24/A49-A53. Current report/disclosure acceptance does not mean the deferred feature passes. |
| C15 - remote/cross-Core boundary | For current scope, state that remote Hindsight is separate from desktop Core selection and preserve no implicit merge. If D23/#29 is later delivered, verify operator/Shell endpoint, auth/cache/secret ownership, CSP/transport and rebind together. Independently scope any multi-Core shared-Bank isolation/coordination requirement. | A46/A47. No automatic addition to B7 or claim of observed data leakage. Ordinary same-profile Bank reuse remains accepted. |
| C16 - templates, taxonomy and user overlays | On freshly prepared Banks, verify controlled per-fact layer setup plus neutral fallback. Apply, customize, preview/update and remove the Taki overlay under independent revisions while preserving native defaults and user overrides. Exercise the same state through restore/upgrade. | A23/A33 plus C02/C11. Fixed v1 owned-field comparison alone is insufficient. |

## Preserved scope decisions

- D79-D83 retain the owner's after-B7 ordering. D81 is a demonstrated limitation that must remain visible, not a newly
  accepted information-erasure guarantee. This audit does not silently promote every capability expansion to a blocker.
- D23/#29 remains the separate remote-Core deployment work. Same-Core multi-client memory correctness is in the
  integration acceptance; full independent-Core memory merging is not.
- Optional vectors/export stay in the full-design ledger with their actual incomplete status. Sparse Local use and
  existing-instance Hindsight use must not be made dependent on optional infrastructure.
- B6's bounded closeout is valid for its stated scope. User/manual quality, original environment and complete operator
  journeys must have their own evidence. No existing passing case is erased and no unperformed case is marked passed.

## Audit verification

The research itself is checked for complete R1-R10/later-ruling coverage, unique matrix/case identities, resolvable
report references, task-context integrity, valid local document links and current source-reference locations. The
source-fingerprint check is a bounded comparison to prior evidence, not a new test run or a clean-tree assertion.
