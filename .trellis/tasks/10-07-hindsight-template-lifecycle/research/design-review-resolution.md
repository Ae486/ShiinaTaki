# Stage 5B design review resolutions

The leader accepted all seven findings of the [independent review](../../10-07-hindsight-configuration-observation/research/stage5b-design-review.md)
as source-grounded engineering corrections within the owner's Stage 5 authorization. They are incorporated in
`design.md` and `implement.md`; confirmation and post-5A source release remain activation prerequisites.

| Finding | Incorporated contract | Required milestone check |
| --- | --- | --- |
| P1-1 generic row/fence cannot preserve partial hold | Add executor generation/token/lease/checkpoint CAS within existing operation ownership, and durable unpublished-effect hold consulted at boot, reads/reflects, writers, provisioning and conflicting admission even for failed/outcome_unknown. Only original recovery crosses it; atomic selection publication releases it. | B2: two-Bank partial commit then restart; no mixed reads/new operations or lost witnesses; final live deadline/revision checks; binding-only recovery. |
| P1-2 exact tags/entities lack structured provenance | Server-owned per-fact sidecar from validated structured labels before caller merge, exact unit/revision/hash/Bank binding, mutation invalidation and bounded authenticated preload. Keep original/curated policy and neutral safeguards. | B2: labeled/unlabeled facts in one content with injected reserved tags/entities, both extraction paths, old/stale/modified evidence and suppressed group. |
| P1-3 stable child admission is not execution/publication ownership | B1 now includes Sync/Worker persisted claims, exact payload/owner, apply-time definition and object revision/hash checks before work and final publish, and atomic child result marker. Original retry may repeat provider calls before marker; no billing exactly-once claim. | B1: Sync/Worker race, another content/definition edit, A-B-A change, lost notification, crash before/after model commit; no duplicate child/history. |
| P2-4 incomplete read/CAS/hash/caps | Read-only repeatable snapshot without ensure, actual lock order, immutable request uniqueness across target reuse, real projections and complete deletion digest. Use unchanged D78 tagged JSON codec with new domains and concrete section-8 finite bounds. Distinguish no-op receipts from one-winner mutations. | B1: no DB writes on preview, cross-language vectors, stream/body/object bounds, permission exceptions, concurrent writers and real schema/lock tests. |
| P2-5 receipt membership cannot prove overlay equality | Versioned per-Bank managed state in Core and Native backup proofs with exact selection/receipt/projection equality, independent of permitted ordinary Native-ahead cursors. Include result/label tables and refuse unpublished work or absent-Core/new-Native enrollment. | B3: customized/removed restore, pre-Core/post-Native mismatch, legacy pair compatibility, later ordinary writes still allowed. |
| P2-6 empty-content definition not pristine completion | Add distinct exact definition-installed initialization event with original creation/template and empty-content/null-embedding proof. Preserve requested refresh's real events and old import proof; never reset used or manufacture completion. | B1/B3: genuine fresh definition-only, requested refresh, later change, server-default base with unproven unused scope. |
| P2-7 enrollment/activation ambiguity | Three enrollment modes: proved fresh creation, explicit reviewed existing-base overlay, untracked legacy/collision. No forced legacy adoption. Freeze migration/build after 5A release, preserve exact old/5A support. | B1/B2: collisions, reviewed captured base, no-Taki/user-inherit distinction, original v1 digests and old Native support. |

Additional bounded choice: Native stores whole `entity_labels`. Preserve original field absence/base separately
from a reviewed materialized list and require fresh preview when parent groups change; do not promise unsupported
live nested inheritance. On removal, recompose captured base plus surviving user values/suppression; only restore
original absence/tombstone if that result needs no Bank override. This corrects the sole contradiction found in the
bounded confirmation. User values/suppression and unrelated reviewed groups are preserved.

Field caps, complete trigger semantics and exact codec/lock references are in design section 8 and the independent
review. Generic Native limits remain unchanged. No new owner product decision is needed; actual data adoption,
paid execution, service installation and destructive recovery remain separate from fixture-only implementation.
