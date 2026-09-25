# Stage 2c grill record

Date: 2026-09-24. Conditional grill per the owner's direction: only material product issues pause the flow.
Research: [stage2c-seams.md](research/stage2c-seams.md) §8.

## Q1 — Who starts Bank provisioning for a Character first used after activation? (OWNER: A, 2026-09-24)

A (recommended): Core submits `bank.provision` automatically when a Run first finds the Character without a Bank; one
automatic attempt per Character per connection fingerprint; after a failure only the operator's 创建 Bank retries; the
Run continues without memory. B: operator only (Home shows `not_provisioned` + 创建 Bank). Trade-off: A means
Core-initiated network writes to Hindsight without an operator click (B3 setup was operator-only); Local already creates
new Character Banks lazily. Wave A does not depend on the answer; wave B's automatic trigger does.

## Q2 — Connection settings or API key changed while Hindsight is the authority? (OWNER: A, 2026-09-24)

A (recommended): Core submits `connection.revalidate` automatically at first detection, only when lineage,
`deploymentMode` and template revision are unchanged; Runs degrade in between; a failed attempt waits for 重新校验连接.
B: operator only, Runs degrade until revalidated. C: operator only and chat refused until revalidated.
The enable flag is not a question: it is `connection_disabled`, memory unavailable, authority unchanged (A31).

## Engineering rulings resolved from source (no owner input needed)

- Degraded Run snapshot (research §9): providerId `hindsight`, lineage/epoch ids kept, capabilities all `false` with
  `vectorRetrieval: "unavailable"`. Truthful for a Run that had no memory; no `harness-schema.ts` change.
- Occupancy probe (G5): native `GET /v1/default/banks/{bank_id}/stats?refresh=true`
  (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4521`). Stats aggregate by `bank_id`
  (`engine/memory_engine.py` `_compute_bank_stats`), so an absent Bank reports zeros. Occupied = any of `total_nodes`,
  `total_documents`, `total_observations`, `pending_operations` > 0 -> `HINDSIGHT_BANK_OCCUPIED`. Only probed when the
  scope has no B3 row of ours.
- Kind names `bank.provision` / `connection.revalidate`, family `hindsight-lifecycle` (a rebind never swaps under a
  running provisioning); producer-kind inference becomes an explicit per-kind table in `memory-operation-schema.ts`.
- Status is an extension of `memory.authority.status` (already invalidated by `memory.operations.changed`); no new
  method, no network probe.
- D86 stays OPEN (trigger: Stage 4 reverse transition / Stage 3 backup identity); D87 closes on AC6; D88 stays OPEN
  retargeted to Stage 3/5 (native `target_conflict` has a transient cause where re-POST is correct; only reset is a
  whole-Bank DELETE).
