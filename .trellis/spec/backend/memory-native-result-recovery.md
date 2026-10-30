# G1 Native Factual Results and Local Confirmation

### 1. Scope and signatures

- Applies only to an explicitly negotiated `native_results` contract `1.0.0` on the exact
  `taki-memory-hindsight-0.9.0-g1-v1` candidate build. Other supported contracts on older builds remain independent.
- Shared owns `HindsightTrackedRetainRequestSchema`, `HindsightTrackedMutationRequestSchema`,
  `HindsightNativeResultStatusSchema`, `HindsightNativeResultSchema`, `HindsightNativeResultPageSchema`,
  `PendingMemoryDispatchSchema` and `PendingMemoryNativeResultReceiptSchema`.
- `dispatch.protocol` is `tracked_native_v1` or `legacy_native_v1`. Absent dispatch on an existing row is legacy.
  A tracked dispatch freezes its full typed command and request hash before possible I/O.
- `nativeResultReceipt` stores the compact verified result; `nativeResultReceiptHash` protects that local envelope.
  These are additive JSON fields in migration 035's existing storage, not a rewrite of that migration or old receipts.
- The tracked request fingerprint binds the original wire entity list, including order, whitespace and duplicates.
  Native entity normalization/deduplication belongs to execution. Do not use Python/JS Unicode-version-dependent
  lowercase results as a cross-language request identity.

### 2. Producer and consumer contracts

- Native admission binds original operation UUID, request hash, provider lineage, Bank generation and operation kind.
  It fixes the accepted inputs/children. Execution freezes the actual native chunk plan and source base; each part's
  facts, canonical journal publication and receipt share one transaction. Full completion requires every fixed part.
- Preserve native append order: split the submitted fragment first, prepend the complete old body only to the first
  outer slice, and freeze merged-body/global-ordinal bindings. Preserve unchanged/archived delta survivors. A retry
  cannot append the fragment again, replace the chosen mode or infer its result from a newer similar document.
- A present document with unavailable historical text is not an absent append base: refuse preparation before
  publication. If chunk settings changed, a strict text prefix is not extraction coverage; tracked completion still
  requires the actual fixed first-slice chunks.
- Sealed result pages are historical proof, independent of later fact changes and native operation pruning. Bind every
  page to the original result, check contiguous ordinals and stable fact ordering, verify its hash and the full stream
  digest, and check the complete count. A current snapshot is not a substitute for the historical result.
- The consumer validates pages incrementally and stores compact proof. The old 256-reference inline receipt limit
  remains a legacy bound; it is not imposed on paged G1 results. Existing intent/state/HTTP byte limits remain intact.
- Recovery is authenticated first pull, compatible frozen replay, verified native result, then actual second-pull
  checkpoint confirmation. `native_factual` advances to `awaiting_pull`; only matching Authority/Bank identity and
  the transactional checkpoint reaching `native_through_cursor` permit `completed`.
- Preserve the same Authority/Bank/lease/deadline guards on initial pull, replay, reset/rebuild and second pull. Lost
  acknowledgement, reopen or checkpoint failure never authorize a new operation identity. Known native proof stays
  durable while local application remains incomplete; one stalled row does not erase independent progress.
- Confirmation errors use the same per-row failure boundary as replay. A policy-forbidden proven zero result keeps
  its factual proof and explicit diagnostic while later independent rows may complete. Authority/lease/deadline or
  stale-state failures still abort the Bank run; individual successes never imply overall convergence with pending rows.
- Only a verified tracked `receipt_not_found` answer in the same identity/generation permits repeating the frozen
  admission. Legacy missing operations retain their old uncertainty rule. Failed/partial/cancelled/retired/conflicting
  producer results remain explicit; absent progress is unknown, not an invented zero or proof of no factual writes.
- Explicit native retry may restore an incomplete retained plan after its queue rows were pruned or parent roll-up
  incorrectly reports completion. Restore only the fixed original children and verify the recorded parent identity/
  request hash; do not adopt a reused untracked UUID. Preserve active children, cancellation and source/generation fences.
  If pruned children removed native usage statistics, keep unknown counters null and mark the aggregate incomplete.
- Empty native results obey the original zero-result policy. Mutations retain original target/revision and the
  distinction between omitted fields and explicit null. Never relabel a known successful write as unapplied.
- Native maintenance and post-write tail behavior keep their original policy. Complete proof does not imply derived
  freshness. A completed input releases its prepared body; a child releases its task payload after all of its inputs
  complete; root sealing removes duplicated private references. Each unfinished level retains its required replay
  material. Backup/restore must preserve nonempty proof and partial replay state.
- Native retain outbox events use the per-input callback and commit with that input's final factual coverage and
  receipt. A full extraction batch with an empty final sentinel still has this transaction boundary. Callback failure
  rolls back facts/proof, and a sealed retry neither loses nor duplicates that event. This does not wait for delivery
  or derived maintenance.
- SQL/capability/schema/authentication checks gate support at admission and worker entry. Bank clear, retirement,
  generation replacement and stale attempts cannot turn unrelated work into valid proof for the old identity.

### 3. Required evidence and independent boundaries

| Condition | Required evidence |
| --- | --- |
| Native part interruption, zero result, Batch or retry | Actual SQL/part/journal behavior with fixed plan coverage and no duplicate publication. |
| Append and lost ACK | Original input produces the full historical document/fact mapping; exact retry does not append again. |
| Native success, failed second pull, reopen | Persist `awaiting_pull` and compact proof; complete only through the real SQLite checkpoint guard. |
| Old row/build or missing legacy operation | Keep old bytes/protocol and uncertainty; no automatic G1 promotion. |
| Page, hash, identity, order or count mismatch | Reject proof without completing the row or discarding independent confirmed work. |
| Backup/restore and native tail | Nonempty receipts/parts survive; incomplete work resumes and sealed work preserves native tail behavior. |
| Pruned queue rows or reused operation UUID | Explicit retry restores only the original incomplete plan; foreign parent/child identity is refused. |
| Multi-input outbox, exact final batch or callback failure | One event per committed input; final facts/receipt/outbox commit or roll back together. |
| Cross-language generation | Actual generated null/enum/request reconstruction tests, canonical repeat-generation parity and locked builds. |

The isolated producer HTTP -> actual Core -> SQLite tests are required in addition to unit tests. Core fixture OS
setup belongs under the task's validation directory, not Core runtime source. The current implementation record and
validation results distinguish fixture mechanics from semantic quality, deployed behavior and manual acceptance.

B4 initial activation, planned Hindsight-to-Local switching and B6 full Local maintenance remain independent.
`research/g1-cutover-evidence-contract.md` describes proposed finite maintenance evidence and source fencing;
its additional producer/fence protocol is not implemented by G1. Zero Pending rows and a current replica cursor
cannot stand in for that separate proof.
