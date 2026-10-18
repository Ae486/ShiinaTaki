# Stage 5 execution and review map

Owner approved the presented Stage 5 plan and delegated implementation/check scheduling on 2026-10-07.
This map refines engineering order using actual source research; it does not authorize real deployments,
original-data changes, paid calls, Git publication or manual acceptance.

Latest owner steering (2026-10-15): continue the original task after accepted Stage 5B and C1a/C1b source
review. The earlier B1 stop is superseded. C1b's eight Linux process cases now pass using the explicitly
approved G: temporary runtime; owned cleanup is complete. The owner subsequently approved the separate
`10-14-hindsight-managed-deployment` child and C2a source/fake-test work after design review. C1a's authorized
Ubuntu preflight found systemd 249 and missing `/usr/bin/systemd-creds`, so AC2/6 await a compatible environment
without blocking C2 source. C2a's six source criteria now pass with 182 independent tests; Root completed
source/evidence preservation and owned staging cleanup. After the approved Desktop preflight, the owner
approved a bounded project-owned Docker experiment preserving unrelated environments. The first actual
fake-consumer case passed after a task-fixture-only correction; first failure and success evidence are retained.
Its container/volume/image/process/C: resources and both G: staging trees are cleaned. Root recovered Desktop
after the later interruption; seven original container IDs remain and two auto-start services are running.
The broader Docker fault/restart matrix, database, C2b, real model and manual gates remain separate.

## Current and next slices

| Slice | Current state and source ownership | Review boundary |
| --- | --- | --- |
| 5A configuration observation | Independent full-slice PASS; R1/R2 closed, final identities verified and all ownership released. Child remains unarchived; original/installed/manual acceptance is separate. | Security/state/compatibility/UI gates passed; see the child's `research/independent-check.md` for exact test scopes and final-source limits. |
| 5B templates/user overlays | Whole-slice automatic PASS on 2026-10-13; all eleven automatic PRD criteria accepted and source/check ownership released. Child remains unarchived. | See the child's `research/b3-whole-acceptance.md` and source reconciliation. Installed/manual and original-environment/model acceptance remain separate. |
| 5C managed deployment/model lifecycle | C1 source/process PASS: 24 Native Windows + 20 observer + 8 actual Linux tests; AC2/6 remain open. Sibling `10-14-hindsight-managed-deployment` has C2a SOURCE PASS (six ACs, 182 independent tests, four old C1 ignored) and a passed first actual Docker fake-consumer case. Both attempts are preserved and cleaned; [final runtime-evidence review](../../10-14-hindsight-managed-deployment/research/c2a-docker-runtime-review.md) passes with no new blocker and report ownership released. Both tasks remain `in_progress`. | C1a install/custody; C1b fake-secret process; accepted C2a source and bounded actual startup proof, followed by remaining Docker recovery/database proof; C2b accepted deployment ledger; C3 six-slot apply/readback. |
| 5D candidate upgrade | Source dependency research delivered. Requires accepted 5B overlay/backup state and C1-C3 deployment/custody/configuration foundations; then D1 -> C4 -> D2. | D1 isolated same-version restore/identity; C4 complete candidate re-embedding; D2 separate forward-migration/final-publication recovery check. |
| 5E complete Home/admin | Minimal UI accompanies each real producer, followed by cross-flow integration. D88/D90 remain explicit admin outcomes. | Review actual conflict remedy and cleanup ownership/reference preservation before effects; final cross-flow operation/reconnect gate. |

## Avoid a model-change/upgrade dependency cycle

Current-source research shows populated embedding changes are a migration, including equal-dimensional model
changes. Therefore 5C's initial configuration milestone must not claim the complete active-data model lifecycle.
Build C1-C3 first, then the isolated-candidate preparation needed by 5D; use that verified path to complete C4
populated model changes and the full candidate-upgrade outcome. These remain Stage 5 scope, not a silent deferral
to Stage 6. Their exact shared code is chosen only after real producer contracts exist.

A refused unsupported active-model change is a correct intermediate behavior, not full lifecycle acceptance.
Preserve original source, user/template overlays, Native schema lineage and current authority during candidate
preparation. A committed candidate recovers by its actual identity; no blind downgrade or pointer replacement.

The delivered D study sharpens this to **C1-C3 -> D1 candidate foundation -> C4 populated re-embedding -> D2
complete upgrade/promotion**. D1 reuses the strict original-version restore gate and adds actual physical storage/
deployment isolation. D2 adds a separate migration proof; do not weaken Stage 3's source metadata equality.
Portable Bank export/import is not a complete clone: it drops operational/evidence data, changes fact identities
and does not establish complete mental-model re-embedding. Reuse conversion components only behind an explicit
preservation/mapping contract. Same-dimensional model changes still require semantic compatibility or conversion.

Restored Pending jobs remain fenced; resetting processing jobs to pending is not cancellation or isolation.
Final candidate publication needs a fresh source/custody boundary, exact model/deployment/template proof and live
lease guards. Do not overwrite current Core with the old backup copy or recover a committed candidate by reverting
the pointer. These are future implementation gates, not research-proven runtime behavior.

## Resource policy

Use explicit file ownership rather than one agent per function. Shared schemas/registries/migrations and authority
publication have one writer. Read-only design research can overlap implementation. Home can run in parallel only
after interface handoff. One heavy test/generation/build at a time; focused tests are bounded and do not repeat a
passing full gate without changed code or a new concern. Independent checker starts after source release.

## Source evidence

- [5A execution](../../10-07-hindsight-configuration-observation/implement.md).
- [5B design](../../10-07-hindsight-template-lifecycle/design.md) and its retained source research.
- [5C Host/model research](../../10-07-hindsight-configuration-observation/research/stage5c-host-boundary-research.md).
- [5D candidate dependencies](../../10-07-hindsight-template-lifecycle/research/stage5d-candidate-dependencies.md).
- [Original residual Stage 5 map](../../09-29-hindsight-transitions-emergency/research/stage5-readiness-2026-10-07.md).

Stage 6 continues to own supported installation/package/environment and owner/manual acceptance. Existing
W9 automated evidence remains accepted within its documented limits. D23 and D79-D83 stay separately scoped.
