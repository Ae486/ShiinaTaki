# W5 real healthy journey: accepted with explicit audit corrections

The real reused-corpus healthy journey is functionally complete. Parent stopped-copy verification confirms
the original reentry transition, actual authority COMMIT, both Native activation outcomes, ready runtime,
settled queue and one terminal completion resolution. No corpus conversion was repeated. The finalization
run made zero model requests; cumulative submissions remain551. Original inputs and all5113 sealed sources
passed preservation checks, and owned processes/ports were released. W6 may now begin.

Machine-readable evidence: `w5-healthy-final-result-2026-10-06.json`. Final stopped Core SHA256:
`274e1ccbd651bcd8c64f88f7ceb0d80c56a3701e5a5a62309369cbfbd0235a45`.
The reusable stopped pair remains the W5 working root recorded in `leader-now.md`; W6 must derive a new private
copy and must not start or mutate this completed predecessor. This is automated scoped acceptance, not owner
manual acceptance or completion of W6-W8.

## Actual completion and preserved failures

- Transition: `6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53`.
- Receipt: `c6dc908527eaec7b70c57151a5c08cef0dcde986d787fc69da9f50d00c4ab450`.
- Selected Hindsight epoch: `9a27367e-afb5-4a0a-ae55-2fbb7b07e8b4`.
- Final recovery operation: `e43299c6-437c-4303-a650-a39b78c79b84`.
- Completion resolution: `ef72acef9387f489fc7d2ef98dd1f9787ec1bfb58816f0ceaa91a8069ca72685`.

Session62850, supervisor`379f26412a1046c9a9ab7d3e4985d57a`, completed the production operation, then the old
driver failed its final zero-unit-upsert assertion. Its exit1, `driver-result.completed=false`, AssertionError
and all old reports remain unchanged. Recovery history is`4d562a928ae34e1e9dc782bde06ef401`; post-COMMIT
history is`709aea296286461e87ab4c3178c40682`. Native completed steps174/actions1428 were exactly unchanged
by finalization. The earlier session26459 lease failure also remains recorded; it is not relabeled successful.

The accepted result comes from the real terminal resolution plus new read-only audits of all remaining
assertions, with the following two source-backed corrections. No production code or stored result was edited,
and no successful operation was rerun to produce a green driver flag.

## Why the old assertions were too strict

1. The driver assumed zero Native unit upserts after the planned policy/Block edits. The Local startup sweeper
   had already invalidated68 existing intentions at2026-10-04T07:54:39.432Z. Every one has an original
   `retention:` request, `invalidate/applied` receipt and revision4/5 snapshot pair. Production
   `stableRequestHash` verifies all68 request IDs and semantic request hashes; production
   `memoryRetentionVerdict` confirms every recorded explicit expiry was due. Only the five lifecycle fields
   changed; policy and all other unit fields remain equal. The prepared68 upserts exactly match these receipts,
   target the original Native identities and create no documents/chunks. Both complete prepared delta results
   pass the production validator. Ignoring these actual Local changes would violate current-state transfer.
2. The old driver compared raw timestamp spelling for the21 already-invalidated records. Their final
   `updatedAt` exactly equals the retained application body's original Local value, while the before/final Native
   `updated_at` bytes are unchanged. This is the existing `preserveTransitionLocalTimestamps` contract.
   For the68 changed units, PostgreSQL datetime serialization uses an equivalent UTC representation. Python
   datetime comparison preserves microseconds, and every other field is compared exactly. Their canonical
   revision follows the existing independent Local revision branch; the Native mapping revision is separately
   checked against the final Native page. The existing projection can advance a Local revision for a different
   ISO representation of `invalidatedAt`; this is recorded, not silently treated as identical bytes.

Source references: `canonical-local-retention.ts`, `retention-sweeper.ts`,
`canonical-memory-maintenance-journal.ts`, `transition-local-timestamps.ts`,
`transition-local-projection.ts`, and Native `engine/replication.py` / `transfer/current_state_rows.py`.
Raw bodies, proofs, receipts and historical source inventories retain their exact byte checks.

## Final checks

- 2 Banks,722 sources and722 unchanged document/native/application/body mappings.
- 1275 final units;89 invalidated =21 original +68 receipt-backed Local expiry changes.
- Original21 invalidated contents/lifecycle preserved, with exact original-body timestamp provenance.
- Planned policy importance/version2 and Block revision2/content hash preserved.
- Both delta results validated against their immutable original preparations using production readers/validator.
- Both Native outcomes active and bound to the actual receipt; Core terminal resolution states committed,
  runtime ready, queue settled. This real fixture's queue is empty; nonempty queue coverage remains the checked
  W4/W5 deterministic cases, not an invented real-data mutation.
- No conversion requests, no finalization model calls, no source drift or leftover owned listener.

Parent-owned reproducible read-only commands, cwd`H:/TakiAgent`:

```powershell
& 'C:/Program Files/nodejs/node.exe' .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-final-receipt-audit.mjs --verify-owned-copy
& H:/hindsight/.venv/Scripts/python.exe -X utf8 -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-final-preservation-audit.py --verify-owned-copy
```

Both final commands exit0; receipt/delta audit2.260s, preservation audit5.268s. Python Ruff E/F/I and format,
plus Node syntax check pass. Initial audit probes intentionally exposed the old literal assumptions; one
first probe also needed explicit UTF-8 on Windows. Those probes changed no data. No unrelated whole suite,
Native service restart, extra model run or production performance change was added for these audit corrections.

Non-blocking follow-up: consider avoiding Local revision churn caused only by equivalent lifecycle timestamp
representations, while retaining exact Native/application evidence and current revision conflict contracts.
Long synchronous validation and lease scheduling remain observable costs; ordinary exact recovery completed
this journey, and no further performance tuning is a prerequisite for W6.
