# D1 implementation and review context

This is a reading route, not a duplicate status ledger. Task phase and requirements live in `../task.json`
and `../prd.md`; technical decisions and ordered slices live in `../design.md` and `../implement.md`.

Before implementation or checking, read [source-readiness-2026-10-24.md](source-readiness-2026-10-24.md)
in full using bounded direct reads. It is 40,777 bytes at the research handoff, above Trellis's 32,768-byte
per-file injection limit. The context manifests inject this short route instead of silently truncating
the evidence. Do not implement from an injected partial study or this index alone.

The complete study grounds: current paired restore and immutable-reader reuse; full source/table/body/
Pending/template preservation; actual candidate-bound authenticated observation; the explicit-dimension,
migrations-off validation-only profile; original-operation/Host/restore-transaction ownership; four D1
slices, the future verification matrix, and mandatory C4/D2 handoffs. Its code references point to the
actual Taki and Native working trees, including preserved uncommitted Stage 5 source.

Also read the existing C2b [current preflight](../../10-14-hindsight-managed-deployment/research/c2b-preflight-2026-10-24.md),
the parent's [independent preparation review](../../08-09-memory-operations-ui/research/preparation-advisor-2026-10-24.md),
and [S6 acceptance plan](../../08-09-memory-operations-ui/research/s6-acceptance-plan-2026-10-24.md).
The first C2b runtime gate is actual cached-image inventory, not another design review or a repeated database fixture.
No document on this route establishes candidate or model runtime acceptance.
