# Hindsight delivery and review map

Updated 2026-10-29. The owner prioritizes practical use and contraction of unnecessary implementation;
the existing backup/transition journeys are now an explicit delivery-order row. The
[current execution plan](../implement.md) supersedes the former global C2b-first and parallel-D1
schedule. This map routes work; it is not another acceptance ledger.

## Delivery order

| Priority | Outcome | Existing owner | Entry and exit |
| --- | --- | --- | --- |
| 1 | Usable existing-instance memory through Taki | This B7 parent; reuse Stage 1-4 and Stage 5A/5B producers | Trace actual wiring, fix concrete blockers, then verify setup/activation/retain/recall/sync/reopen and a bounded outage. C2b and D1 do not gate this path. |
| 2 | Existing backup and transition journeys on isolated data | Existing Stage 3/4 producers; this B7 parent for the journey records | Producers and isolated inputs are available. Exercise capture/backup/verify, healthy switch-back/re-entry and emergency takeover; establish the Stage 3 backup prerequisite for original-data activation. C2b, D1 and upgrades do not gate this scope. |
| 3 | Fix actual first-use problems and simplify the used path | The module owning each reproduced or source-proven defect | Preserve agreed memory behavior; consolidate unnecessary mechanisms with evidence, not blanket guard removal. |
| 4 | Usable managed installation and related model application | Existing C2 task and Stage 5C follow-ups | Reassess the minimum producer/setup path; reuse native/package facilities and accepted evidence. Review the complete increment. |
| 5 | Complete candidate/software/model upgrades | Existing D1 plus C4/D2 owners | Resume for a concrete upgrade need or the lifecycle increment after first-use stabilization. Complete preservation/conversion/publication before enabling an upgrade. |

[Acceptance](s6-acceptance-plan-2026-10-24.md) now accumulates per usable journey. Existing-instance
verification starts independently of C2b, and the existing backup/transition journeys start once their
delivered producers and isolated inputs are confirmed. Managed and upgrade journeys keep their own
later entry gates. [D94-D96](../../../../docs/deferred-decisions.md) record the unfinished work and
concrete resume triggers.

## Reuse and remaining work

These are retained checkpoints from the existing records, not new test runs or current installed proof.

| Workstream | Retained evidence | Scheduling consequence |
| --- | --- | --- |
| Stages 1-4 | Durable operations, Local onboarding, activation, Bank lifecycle, paired backup and repeated/emergency transitions have scoped accepted source evidence. | Verify their actual connected first-use behavior; do not rebuild them from historical missing-feature lists. |
| 5A / 5B | Configuration observation and templates/user overlays have scoped automatic acceptance. | Reuse them; preserve actual desired/effective configuration and user overrides. |
| C2a / C2b | Bounded Docker/PG persistence, relay diagnostic, dependency comparison and application/tokenizer artifact evidence exist. Actual API/PG and installed managed setup remain incomplete. | Do not rerun unchanged prerequisites or let them block existing-instance delivery. |
| C2b known defect | The combined review identifies observation-publication failure bypassing API/PG cleanup. | Fix and verify before using that producer; it is a real defect, not optional hardening. |
| D1 | D1-A source acceptance and D1-B source/integration review are retained; actual candidate restore/inspection and complete upgrades remain open. | Preserve source, migration 060 and evidence; stop parallel expansion ahead of first use and record the uncommitted D1-B integration in the first-use measured baseline. |

The prior root/session, Docker presence, free space and staging tokens are historical observations.
A future run verifies only the current environment facts it actually needs. No runtime is started by
this map and no historical token is replayed.

## Implementation and review contraction

- Prefer official/native capabilities, current package tooling and the existing supported service path.
- Do not expand the custom dependency inventory/comparison system or network-none relay without a
  concrete need that the simpler path cannot meet. Existing packets remain historical evidence.
- Keep authentication, secret-safe handling, resource ownership and data integrity. Their required
  behavior does not prescribe every detail of the previous experimental mechanism.
- One independent challenge precedes a material architecture/persistence/security change; one
  consolidated review follows a complete increment. Do not review every ordinary intermediate packet.
- Use targeted checks and one real connected journey. Reuse unchanged accepted results and keep
  failed/not-run/unknown outcomes distinct from success.
- Shared protocols, runtime composition and recorded migrations retain one integration owner.
  Avoid concurrent workstreams that compete with the first usable path.

## Source and evidence links

- [Current requirements](../prd.md) and [design priorities](../design.md).
- [Overall discussion and administration boundary](../../09-14-hindsight-integration-completeness-audit/research/overall-grill-2026-09-19.md).
- [5A execution](../../10-07-hindsight-configuration-observation/implement.md).
- [5B execution](../../10-07-hindsight-template-lifecycle/implement.md).
- [C2 work and historical evidence](../../10-14-hindsight-managed-deployment/implement.md).
- [C2b combined review and cleanup finding](../../10-14-hindsight-managed-deployment/research/combined-d1b-api-artifact-review-01a180b6.md).
- [D1 retained slices](../../10-24-hindsight-isolated-candidate-foundation/implement.md).
- [Stage 6 cases and owner observations](s6-acceptance-plan-2026-10-24.md).

D23 and D79-D83 keep their separate scope. First-use acceptance does not close managed installation,
full model upgrades, unverified platforms, original-data operations or owner acceptance.
