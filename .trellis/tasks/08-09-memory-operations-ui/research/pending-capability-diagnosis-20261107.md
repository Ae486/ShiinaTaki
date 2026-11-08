## 1. Outcome — done

**The differing field was `vectorRetrieval`: captured `"ready"` → live `"degraded"`.** The immediate trigger was a real Native hydration failure during the Run’s automatic recall. The retain refusal correctly enforced the existing immutable-Run write contract. The underlying availability problem is Native hydration contention, **not stale admission evidence or a construction-bound async context**. [inference] [source packages/core/src/memory/hindsight/hindsight-memory-recall.ts:38] [source packages/core/src/memory/memory-capability-snapshot.ts:28]

**No change can be identified as introducing this mechanism:** run 6 already contains the same hydration serialization errors. Its pending-step hydration succeeded; run 8’s failed. The evidence establishes a different interleaving of an existing problem, with concurrent curator publication. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T23-23-56.469Z/native.log] [run artifact .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-07T06-53-57.857Z/native.log]

### Q1. Capability, provenance and fence reconstruction

Run `fe72409e-8c30-4677-9d6f-0d3150884b4c` and retain request `ff696d29-5961-4aa9-8076-d9dcd8424429` establish this sequence:

| UTC time | Evidence |
|---|---|
| 07:02:04.611 | Pending step starts; harness enables retain-write interruption. |
| 07:02:10.239 | Run snapshot records all boolean capabilities true and vector retrieval ready. |
| 07:02:11.414–15.269 | Five Global curator commands complete, advancing application state cursors **71→75**, with native cursor unchanged at **73**. |
| Approximately 07:02:15 | Global hydration returns HTTP 500, with `asyncpg.SerializationError` during `save_body`. Both native recall requests returned 200. |
| 07:02:15.313 | Harness commits the memory Effect intent. |
| 07:02:15.318 | Effect settles failed with authority mismatch, before provider retain admission. |
| 07:02:16.152 | Core shutdown begins, after the refusal. |

The five commands are `hindsight-policy-work:*`; their persisted command bodies identify actor `taki-policy-curator`. [run artifact G:/taki-first-use-ruLIlA/core-data/taki.db] [run artifact .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-07T06-53-57.857Z/core-1.log] [run artifact .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-07T06-53-57.857Z/native.log]

The causal chain is:

1. Hydration HTTP 500 maps to `HINDSIGHT_UNREACHABLE`.
2. Recall’s availability handler searches the verified replica and calls `setVector("degraded")`.
3. The coordinator obtains current capabilities and rejects `"ready"`→`"degraded"` before invoking retain.

[source packages/core/src/memory/hindsight/hindsight-client.ts:243] [source packages/core/src/memory/hindsight/hindsight-memory-recall.ts:38] [source packages/core/src/memory/memory-coordinator.ts:122] [source packages/core/src/memory/memory-capability-snapshot.ts:28]

**The capability provenance is mixed, not a choice between two wholly separate snapshots:**

- Stable support—including `reflect`—comes from the persisted admission manifest.
- `vectorRetrieval` comes from the provider instance’s mutable `vector` variable.
- Both `state.capabilities()` and `capabilitiesSnapshot()` project that same combination. The latter is **not** an immutable copy of admission-time vector health.
- With existing evidence, `state.capabilities()` performs no network probe.

[source packages/core/src/memory/hindsight/hindsight-memory-provider-context.ts:54] [source packages/core/src/memory/hindsight/hindsight-memory-provider-context.ts:65] [source packages/core/src/memory/hindsight/hindsight-memory-provider-context.ts:76]

The sole run-8 admission row remains:

- Epoch: `c7333c49-f83d-4f23-8ccc-d8919feb9dc8`
- Fingerprint: `2f606b600e30565d0dfef625eb2fd48d9785cf1382660b6ef3b216e5c9ef4b55`
- Admitted: **06:56:47.132**, at activation
- Guarded Reflect: supported

The connection row has the same fingerprint. The authority marker remains Hindsight, with the same epoch/lineage and activation transaction. All three Bank routes remain verified. There is no durable admission rewrite during the failing Run. [run artifact G:/taki-first-use-ruLIlA/core-data/taki.db]

**Work fence: writable, by reconstruction; its literal scalar was not recorded.** No transition/revalidation/backup operation overlaps the failure; automatic provisioning completed at 07:00:09.453. Shutdown occurs later. The observed error is the successful-capability-read comparison failure, not fence rejection. Therefore `track(state.capabilities)` is the supported branch reconstruction, using persisted admission evidence. **UNKNOWN:** a directly observed `workFence.writable()` value and the exact capability-call stack at that millisecond. [inference] [source packages/core/src/memory/hindsight/hindsight-memory-provider.ts:33] [run artifact G:/taki-first-use-ruLIlA/core-data/taki.db]

The CPU profile independently supports the fallback sequence:

- At profile-relative **362.764690–362.869455 seconds**, samples show `recallHindsightMemory → searchApplicationMemories`, the replica fallback.
- At **362.879712–362.910673**, recall proceeds through `fit`.
- At **362.994082**, the stack reaches coordinator retain dispatch through the tool’s fence admission.

The profile contains **35,076 samples over 363.849 seconds**. It does not contain heap values, and it did not sample `setVector` or the precise capability comparison. The tool’s outer write fence also must not be confused with the subsystem work fence. [run artifact G:/taki-first-use-ruLIlA/core-data/CPU.20261107.145612.14888.0.001.cpuprofile]

There are **zero** matching rows in `hindsight_memory_write_intents` and `pending_memory` for the failed request. The Harness Effect intent is not provider Pending admission. No retained write existed for recovery. [run artifact G:/taki-first-use-ruLIlA/core-data/taki.db]

### Q2. Candidate assessment

| Candidate | Finding |
|---|---|
| **(a) P1-P construction context** | **Ruled out for this failure.** The only project-defined `AsyncLocalStorage` is per-fence `{live}` ownership. Runtime, epoch, admission and connection state use explicit closures/repositories. Main constructs the trigger **before** composing memory; the affected work-fence store does not yet exist. |
| **(b) Curator publication** | **Supported as concurrent write activity; admission-rewrite explanation ruled out.** Five Global policy publications overlap the failed hydration. Their receipts advance application state, while admission evidence remains unchanged. |
| **(c) F2 reuse** | **Not a demonstrated cause.** Run-6 and run-8 hashes for `hindsight-runtime-state.ts` and provider context are identical. Warm reuse preserves unchanged evidence; changed manifests require fresh admission. |
| **(d) Timing/interleaving** | **Best-supported explanation for why this step failed now.** The same Native failure already occurred in run 6, but its pending-step hydration returned 200. Exact scheduling effects of P1-O, P1-P and CPU profiling are UNKNOWN. |

[source packages/core/src/main.ts:198] [source packages/core/src/memory/canonical-local-write-fence.ts:28] [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:50] [source packages/core/src/memory/hindsight/hindsight-runtime-state.ts:72] [source packages/core/src/memory/hindsight/hindsight-application-capability.ts:61]

Run 6’s comparison matters: its pending window contains **23 completed policy-work commands**, including **13 Global commands**, despite review summaries reporting failed/zero edits. Its three earlier Global hydrate failures have the same serialization exception. Thus “the curator previously published nothing” is not supported by durable evidence. [run artifact G:/taki-first-use-0E2IXk/core-data/taki.db] [run artifact .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T23-23-56.469Z/core-1.log]

### Q3. Correct refusal or defect?

**The refusal is correct under the current Run contract.** It reflects an actual observed retrieval downgrade within the Run, while authority identity remains unchanged.

The governing contracts distinguish:

- Frozen Run identity/capabilities, with vector degradation allowed for recall.
- Historical capability evidence from current online availability.
- Durable Pending recovery **after provider admission**.
- Operation status and Pending counts from their actual producers.

[source .trellis/spec/backend/canonical-local-memory-runtime.md:42] [source .trellis/spec/backend/hindsight-application-runtime.md:49] [source .trellis/spec/backend/hindsight-application-runtime.md:183] [source .trellis/spec/backend/hindsight-application-runtime.md:200] [source .trellis/spec/backend/memory-operations.md:129]

The precise directional write rule is explicit in `writableMemoryCapabilities`; an existing regression also deliberately refuses mutation after recall downgrades vector health. The backend prose does not provide an equally explicit ready/degraded write matrix. This conclusion is based on the contract and executable policy, not a newly green test. [source packages/core/src/memory/memory-capability-snapshot.ts:27] [source packages/core/src/memory/canonical-memory-run.test.ts:112]

The end-to-end journey still fails its usability objective. Correct fail-closed behavior does not make the underlying Native contention acceptable.

### Q4. Smallest correct fix and missing test

**Fix classification: upstream Hindsight application-state concurrency work. No Taki capability-guard patch is justified by this diagnosis.**

Native hydrate runs in `repeatable_read`, materializes transport pages, and inserts their bodies. It already retries serialization/deadlock failures **three times**; the trace reaches the final attempt at `service.py:77`. Simply adding the existing retry strategy again would not address this case. [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/service.py:42] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/service.py:70] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/snapshot.py:287] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/store.py:410]

**Smallest patch candidate:** stabilize the application Bank row early in bundle-producing transactions using the existing Bank-lock mechanism, before reading/materializing the bundle; preserve repeatable-read consistency and bounded retries. Scope this to hydration/snapshot materialization. Validate lock ordering and cancellation before accepting it.

The likely conflict is the body INSERT’s foreign-key relationship to `memory_application_banks`, whose cursor row concurrent publication updates. **That exact PostgreSQL lock dependency remains an inference**, because no server lock trace or transaction identifiers were retained. [source H:/hindsight/hindsight-api-slim/hindsight_api/alembic/versions/d77a4f8c2e10_add_application_state.py:55] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/publication.py:263] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/store.py:167]

The test that would have caught this:

1. Use the **actual Native application schema and hydrate/publication paths**, with two PostgreSQL connections publishing policy while hydration materializes pages.
2. Exercise repeated conflicts, coherent returned checkpoints, cancellation, and bounded completion.
3. Run the existing pending journey with active curator publication and the unchanged retain-only 503 fault; require a durable original Pending request and recovery of that same identity.

Existing Native retry tests use an artificial counter table. They prove retry/rollback behavior and intentionally prove exhaustion after three attempts; they do not cover this application-body/Bank relationship. [source H:/hindsight/hindsight-api-slim/tests/test_taki_application_state_retry.py:39] [source H:/hindsight/hindsight-api-slim/tests/test_taki_application_state_retry.py:71]

**Async-context recommendation:** candidate (a) does not hold, so neither P1-P nor P1-H needs changing for this incident. Both construction bindings depend on being created outside ownership of the fence they later use. If construction ever occurs inside that same fence’s owner, clearing **that specific ownership store** for independent automatic work would be preferable to capturing construction context. The scheduler shares that conditional weakness, but its current subsystem construction creates a fresh work-fence store before constructing the scheduler. [source packages/core/src/memory/hindsight-lifecycle/hindsight-lifecycle-trigger.ts:28] [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:74] [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:50]

### Q5. Other affected paths

**Yes.** Any ready-captured Run can encounter this after automatic or explicit recall races application publication. Provisioning, binding, curator work or another Run can supply concurrent activity.

Vector state belongs to the provider instance, not an individual Bank or Run; automatic Global/Character recalls run concurrently. Another recall can therefore affect the live health compared by a captured Run. Sync/publication does not itself set vector health—it can trigger the failing read. Pre-dispatch writes then refuse; drift after dispatch can produce `MEMORY_OUTCOME_UNKNOWN`. Read-only journey steps may still finish with partial recall and therefore conceal the same availability problem. [source packages/core/src/memory/hindsight/hindsight-memory-provider-context.ts:54] [source packages/core/src/memory/automatic-memory-recall.ts:58] [source packages/core/src/memory/memory-coordinator.ts:160] [source packages/core/src/memory/memory-coordinator.ts:186]

## 2. Changes

None. No source, task, prompt, template or retained-data edits. This final message is the report for the caller’s `-o` capture; no output pathname was supplied to this session.

## 3. Evidence and checks run

- Read required project/task contracts, relevant production paths, both result sets, logs and provider-request evidence.
- Queried both retained SQLite databases using read-only connections; after confirming empty WAL files, subsequent inspection used `mode=ro&immutable=1`.
- Parsed the CPU profile’s nodes, ancestry, samples and time deltas.
- Compared recorded run-6/run-8 source hashes; checked relevant unchanged files against clean diffs and matching repository HEADs.
- Used one focused `jbcontext search`, then verified relevant source locally.
- Ran a service-free Node probe from `G:/taki-codex-work` against the actual comparator:

```text
sameStable(ready, degraded) = true
writable(ready, degraded) = false
writable(degraded, ready) = true
```

- Verified `AsyncResource.bind` semantics against installed Node types and a small isolated probe: empty construction context stays empty; binding inside stale ownership preserves that stale owner; exiting the specific store clears it.

No Vitest, connected replay, Core, Native or PostgreSQL service was started. No claim of fix validation is made.

## 4. Trade-offs

- Retaining the current guard means a transient retrieval downgrade can refuse a same-Run write despite unchanged stable write support. Decoupling those would be a separate product-contract change.
- Early Bank locking may reduce serialization failures but makes competing publications wait and requires lock-order validation.
- More retries alone increase latency and still allow exhaustion.
- No schema migration, new cache, background-work suppression or weakened consistency is recommended.

## 5. Open items / UNKNOWN

- Exact PostgreSQL conflicting transaction, row-lock dependency and first two retry failures.
- Directly sampled work-fence boolean/live capability object; their values were reconstructed.
- Which timing change caused this particular interleaving; there was no controlled bisect.
- Whether the proposed Native locking change passes real concurrency, cancellation and journey validation.
- Runs J17, 4 and 5 were not independently inspected; run 6 was.
- The caller’s actual `-o` destination.

## 6. Outside scope noticed

Policy-review summaries showing `status:"failed", edits:0` do **not** establish that no application publication occurred: both databases contain completed curator commands during such periods. This affects interpretation of the current diagnostics; no logging change was made. [run artifact G:/taki-first-use-ruLIlA/core-data/taki.db] [run artifact G:/taki-first-use-0E2IXk/core-data/taki.db]