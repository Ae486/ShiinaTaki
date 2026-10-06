# W5 candidate baseline read repair

Status: scoped implementation and available correctness gates PASS; source frozen for parent performance measurement and independent review. Those remaining gates do not permit an overall W5 or real-corpus acceptance claim. This report supersedes the implementation-pending status of the preserved proposal, without editing that proposal or the diagnostic evidence.

## Problem and scope

The preserved diagnostic clone took 94.569 seconds for actual `TransitionDeltaService.apply`, using synthetic embeddings. At 60.382 seconds it was still in the second baseline, before native/application writes. The two baseline captures consumed 60.900 seconds. That established a reproducible pre-write request-budget overrun, not the exact original timed-out HTTP endpoint or a real-model latency bound.

Parent authorization was limited to the four production paths below, focused Native tests, this task's evidence and the narrowly corresponding healthy-driver spec. No Core code, public protocol, migration, dependency, timeout, TTL or lease was changed. No real pair or prior clone database was accessed or started. No Git or task-lifecycle operation was performed. The real transition remains parent-owned normal recovery; this implementation does not perform another admission renewal.

## Files and behavior

Paths in this table are relative to `H:/hindsight/hindsight-api-slim`.

| File | Change |
| --- | --- |
| `hindsight_api/engine/transition_baseline_reads.py` | New private connection/invocation-bound reader. Bounded raw prefetch, immutable verified-byte LRU, exact descriptor identity, Source dependency guard and explicit disposal. |
| `hindsight_api/engine/application_state/store.py` | Extract only `_load_body_metadata` and `_load_body_parts`. The default methods retain the previous SQL and original validation sequence; ordinary readers/writers receive no cache. |
| `hindsight_api/engine/transition_snapshot.py` | Internal opt-in creates a new reader inside each capture and clears it in `finally`, before auxiliary capture completes. The result remains an ordinary `TransitionBaseline`, with all native/application/auxiliary/complete hashes. |
| `hindsight_api/engine/transfer/transition_delta.py` | Sole production opt-in at `_admit` after the existing Bank lock, executor, namespace and retired-proof guards. Both transaction invocations remain. |
| `tests/native_results/test_transition_baseline_reads.py` | 29 focused owned-PG regressions, including real apply revalidation between transactions. |

The scoped contract is added to `.trellis/spec/backend/memory-transition-healthy-drivers.md`. New research helpers compare exact preimage type diagnostics and seal source/evidence hashes. Preimages remain byte-exact under `research/w5-candidate-baseline-preimages/`.

### Integrity and resource boundaries

- Heads/artifacts queue only body IDs for bounded transport. Raw metadata/parts are not evidence: ordinary `body_bytes` still checks exact descriptor equality, sealed state, count/order/size/part SHA256, whole SHA256 and semantic digest before immutable bytes enter the cache.
- Cache identity includes provider lineage, Bank ID/generation and the complete serialized descriptor, including body ID/schema, both hashes, byte length and part layout. The reader also guards its original connection and table function. Mutating its namespace/Bank/connection cannot retarget accepted bytes.
- Every `read_body` creates a fresh decoded/schema-validated model through the original codec and reruns Source closure, including its exact historical artifact. No decoded dict, Pydantic result or acceptance verdict is cached. Failure removes that body's verified-byte entry; capture disposal clears the entire invocation.
- One staged batch contains at most 128 descriptors, 8 MiB of actual descriptor plus part bytes and 1024 part rows. A SQL size probe selects eligible bodies; window predicates in the materializing queries check actual lengths/counts again. An untrusted declared length or a changed size after the probe cannot bypass the client-side batch bound.
- The verified-byte LRU is limited to 64 MiB and 8192 entries. A large body, exhausted budget, eviction or newly discovered dependency while a batch is still staged uses the original full one-body validation. These private budgets never reject legal provider data solely for being too large for optimization.
- Source dependencies do not discard pending prefetched heads/artifacts. A new baseline never receives the preceding transaction's reader, and no reader reaches preflight, configuration/embedding preparation or writes.

## Executed checks

All commands use installed dependencies. Native pytest runs are sequential, one worker (`-n 0`), against newly owned pg0 fixtures. The harness strips provider/DB environment, disables dotenv, installs fixture-only LLM/TEI settings and a network guard, and checks the actual PostgreSQL data directory before use. PostgreSQL 18.1 with vector/pg_trgm was used. No real model request was made.

| Check | Actual outcome | Evidence |
| --- | --- | --- |
| Original regression before production edits | Expected RED: 1 failed, duplicate full body validation within one baseline; 18.97s | `g1-validation/taki-hindsight-g1-eb76280c7997/pytest.log` |
| First implementation regression | 1 passed, 14.46s | `g1-validation/taki-hindsight-g1-f29f18ecddd8/pytest.log` |
| New focused reader/apply coverage | 29 passed, 122.25s | `g1-validation/taki-hindsight-g1-eca4208ff82e/pytest.log` |
| Existing affected Native/D77 group | 59 passed, 366.71s | `g1-validation/taki-hindsight-g1-7ef850b84205/pytest.log` |
| Scoped Ruff check / format check | Passed; five files already formatted | Commands below |
| Exact saved preimage versus current `ty` | Both exit 1, one identical existing diagnostic; comparison exit 0 | `w5-candidate-baseline-types-0d7722abb5e44504b70fa9ab58828a29/result.json` |

Runtime evidence paths in the table are under `H:/TakiAgent/.trellis/.runtime/`. The existing type diagnostic is `invalid-argument-type` for optional `request.baseline_transition_id` passed to `_read` in `transition_delta.py`. The type comparison matches exact highlighted source, diagnostic, severity and columns, permitting line displacement. An initial new tuple-expansion diagnostic in the new reader was fixed by explicit identity fields; the final comparison has no new diagnostic. The 29-test run began before that type-only expression replacement; the subsequent affected group uses the final expression.

`scripts/hooks/lint.sh` was read, but not run: it performs dependency synchronization and whole-repository auto-fixes outside the explicit scope. Scoped Ruff and the exact preimage type comparison implement the approved quality boundary. No suppressed lint/type diagnostic or artificial split was introduced. The user permits cohesive files/functions to exceed length guidelines; no new length waiver was needed by these Native checks.

### Focused coverage and limits

- Actual unchanged-delta apply captures exactly two baselines and fully validates each encountered body once per invocation. Ordinary and optimized complete baselines match, including an invalidated-unit fixture.
- Returned Source model, nested metadata and tags can be mutated without changing the next decoded result. The Source fixture includes 100,000 retained characters, multipart bytes, 80 metadata levels, non-ASCII padding and original special-string values. No broader depth limit is inferred from that fixture.
- Same-ID/different-descriptor aliases refuse. Both readers return the same closed code/status for missing, extra, reordered, byte-corrupt, whole-hash-corrupt, semantic-hash-corrupt, wrong-schema and unsealed bodies.
- Raw metadata/part duplicates, foreign namespace rows and out-of-order prefetched rows are injected at the real reader's PG transport seam. PostgreSQL primary keys ordinarily prevent persisted duplicate keys; these tests specifically verify that batching does not silently collapse bad returned rows.
- Zero-byte cache, eviction and one-byte batch budgets preserve full reads/refusals. Actual oversized part bytes avoid batch materialization and then refuse in the ordinary integrity path. A valid descriptor with oversized whitespace also bypasses batch optimization and still reads successfully.
- Bank/generation/lineage/connection retargeting refuses; a fresh foreign-Bank reader does not find the original body. Cancellation, ordinary integrity failure and success all dispose staged rows, pending IDs, active dependencies and verified bytes.
- Source closure checks the historical artifact again on a cache hit. Missing historical evidence and corrupt nested Source bytes refuse. A deliberately cyclic closure callback exercises the active-identity guard; it is not a claim that the existing Source schema accepts a stored cyclic envelope.
- Between actual apply transactions, the preparation seam corrupts a stored original Source in the isolated fixture. The second `_admit` refuses, native writes are never called, logical records are unchanged and exact delta lookup remains absent.

### Exact commands

From `H:/TakiAgent`:

```text
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- tests/native_results/test_transition_baseline_reads.py -q --tb=short -n 0
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- tests/native_results/test_transition_delta.py tests/native_results/test_transition_integrity.py tests/native_results/test_transition_source_evidence.py tests/native_results/test_transition_source_refusals.py tests/native_results/test_transition_historical_references.py tests/native_results/test_transition_proof_renewal.py tests/native_results/test_application_bodies.py tests/native_results/test_application_state.py -q --tb=short -n 0
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-candidate-baseline-type-compare.py
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-candidate-baseline-source-audit.py
```

From `H:/hindsight/hindsight-api-slim`:

```text
H:/hindsight/.venv/Scripts/python.exe -m ruff check hindsight_api/engine/transition_baseline_reads.py hindsight_api/engine/application_state/store.py hindsight_api/engine/transition_snapshot.py hindsight_api/engine/transfer/transition_delta.py tests/native_results/test_transition_baseline_reads.py
H:/hindsight/.venv/Scripts/python.exe -m ruff format --check hindsight_api/engine/transition_baseline_reads.py hindsight_api/engine/application_state/store.py hindsight_api/engine/transition_snapshot.py hindsight_api/engine/transfer/transition_delta.py tests/native_results/test_transition_baseline_reads.py
```

The harness runs pytest from the Native slim root with `-p g1_fixture_network_guard`, not against an existing database URL. All four owned runs report `Stopped=true`, `DataRemoved=true`, `RegistryRemoved=true`. Cleanup verifies each owned instance is stopped before removing its data and pg0 registry. Logs/ownership records are retained. The source-audit helper is deliberately one-shot (`open("x")`) and cannot overwrite its completed manifest.

The final affected group includes exact committed-receipt lookup without repeated embedding/effect, rollback after native/application writes, Source alias/history preservation, renewal during complete baseline proof and ordinary D77 upload/seal/snapshot/replay behavior. Together with the 29 new cases, 88 distinct selected tests passed; the earlier one-test GREEN overlaps the new group. Self-review found no remaining source correctness or scope finding. The existing Native type diagnostic and the unmeasured corpus performance remain explicit limitations.

## Remaining gates and handoff

The parent must run a fresh pre-apply corpus clone with the original reviewed `w5-reentry-candidate-native-clone.py` unchanged. Its timed wrapper forwards the new internal keyword, and its connection wrapper keeps a stable instance during each acquire, so no instrumentation/API adjustment is needed. Its new UUID creates a new clone; the old clone already contains a receipt and must not be reused for apply timing.

Use the same request/hash/operation, synthetic vector seam, pool and finite observation bounds. Record full apply and both baseline durations, SQL counts, receipt/lookup equality, mappings/artifacts, body reuse and source preservation. Require actual completion before the unchanged 60-second observation with meaningful headroom; do not infer real-model acceptance from synthetic-vector performance. If the bound is still exceeded, stop at the measured residual and review a new narrow scope.

After that performance measurement, an independent checker reviews final source and affected evidence. Only subsequent separately authorized normal recovery may touch the real stopped transition `6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53`, retaining the original delta operation/hash, model counter 301 and historical maintenance. This delivery does not claim overall W5, real-corpus, UI/manual, W6-W8 or original-environment acceptance.

The immutable delivery inventory is `research/w5-candidate-baseline-source-manifest.json`. It also verifies the diagnostic manifest remains `637cc0fbcbe4b971bf7ecf09926967ff1495993c22fbab30e2a20c27c39361dc` and that only the three approved pre-existing production paths differ among its 26 entries. New files are separately listed in the delivery inventory. Source is frozen after that seal until parent review.
