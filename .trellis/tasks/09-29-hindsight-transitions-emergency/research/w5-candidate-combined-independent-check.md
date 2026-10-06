# W5 Cumulative Native Candidate Optimization — Independent Check

Date: 2026-10-05. Reviewer: `w5_combined_check`.

## Verdict

The cumulative production changes pass the independent scoped correctness review and all 105 newly executed
targeted tests. No new production defect was confirmed; no production/test/spec file was changed by this reviewer.
Ruff and formatting pass. **Complete seven-file type-check is not green:** it retains exactly one independently
reproduced preexisting diagnostic, with no added diagnostic. The parent explicitly retained that known baseline.

This verdict permits preparation of the next parent-owned actual-local-embedding discriminator. It does **not**
release the real working pair, establish complete W5 acceptance, or authorize its migration/resumption. The working
pair was not accessed, started, migrated or renewed by this reviewer. Its stopped/e30/count301 status is the parent's
handoff, not a new reviewer database observation.

## Checked scope and provenance

The input manifests were read and hashed independently, in authorized evolution order:

| Manifest | SHA256 |
| --- | --- |
| `w5-candidate-baseline-source-manifest.json` | `766ff65824c15aaf081be13c4becfc8ffe83d960e3dd7b5e0e15e2b326a12a5b` |
| `w5-candidate-ab-source-manifest.json` | `51b86892546896ca275b8da2fb9972d3ffce0ee01ee1f12fad61e9a18d6b6a23` |
| `w5-candidate-reader-queue-source-manifest.json` | `b38a102c5e6b9737afc62c6f4063f7dc9b7ecda6e39039e7026aab6555bda47f` |
| `w5-trigger-uuid-source-manifest.json` | `9340f11464caffa680a83503def0e16404df3068ba5743ba78e4a2210a5d2b07` |

Paths were resolved and case-folded under Windows before selecting each path's latest authorized entry. All **196
non-runtime entries** matched size and SHA256. The **46 historical runtime entries** were explicitly excluded from
access and remain historical references in the input audit; no old clone was opened to satisfy a hash check.
Twelve independent preimages preserve all seven production and five new test files before the review.

The authorized production files, relative to `H:/hindsight/hindsight-api-slim/`, are:

| File | Verified responsibility |
| --- | --- |
| `hindsight_api/engine/application_state/store.py` | Original metadata/part SQL extracted into override seams; original body validation retained |
| `hindsight_api/engine/transition_baseline_reads.py` | Private validation-pass byte reuse, bounded raw transport and complete cache identities |
| `hindsight_api/engine/transition_snapshot.py` | Opt-in reader creation and unconditional disposal within one baseline |
| `hindsight_api/engine/transfer/transition_delta.py` | Both admitted baseline passes opt in after original locks/executor/proof guards |
| `hindsight_api/engine/transfer/transition_delta_rows.py` | Exact derived-edge deletion union, bounded to 128 target UUIDs per statement |
| `hindsight_api/engine/transfer/transition_delta_application.py` | Two independent predecessor views and final post-write view; ordinary-store writers/publication |
| `hindsight_api/alembic/versions/e40b1e8a7d32_optimize_transition_association_lookup.py` | Additive replacement of three association endpoint predicates only |

Core, public protocol/generated SDKs, dependencies, production timers/TTL/leases/budgets, e30 history and the
frozen V3 diagnostic remain unchanged. The parent approved scoped quality commands in place of the unrelated
global auto-fix/dependency-sync hook. No Git or task-lifecycle action was performed.

## Actual-path review

- Every body still passes ordinary descriptor equality, sealed-state, part count/order/size/digest, whole-byte
  digest and semantic digest validation before its immutable bytes enter the cache. Raw metadata and parts are
  bounded in their materializing SQL, rather than trusting declared lengths. Oversized/evicted/dependency reads
  fall back to ordinary validation. Complete descriptor plus lineage/Bank/generation controls reuse; original
  connection/table identity is retained. Models are freshly decoded and validated, and Source closure/history
  is revisited even on a byte hit. Cycles and failure/cancellation dispose or evict the relevant state.
- All five readers are separate: baseline/predecessors in transaction one; baseline/predecessors after Native
  writes in transaction two; final Bank/current-artifact validation after application writes. Tests observe their
  disposal before the next view, command or publication. No validated view crosses a write boundary.
- The Bank-first cached hit consumes only its own pending/staged raw rows. The actual final-view regression
  crosses several batches and observes no ordinary metadata fallback; descriptor conflicts and subsequent fresh
  corruption refusal remain covered.
- Derived deletion retains existing per-row restore/update/temporary/entity ordering, collects only existing or
  restored targets, and deletes exactly this Bank's incident temporal/semantic edge union. New targets, causal
  links and foreign/unrelated edges retain their original semantics. Final lifecycle and retrieval rebuilding
  remain in the original `_write_units` path; errors roll back effects and receipts.
- The e40 migration preserves direct Bank, OLD+NEW, live/archive/entity ownership, null behavior, sorting,
  publication guards and return values. Only typed RHS UUID casts and indexed UUID-column comparisons change.
  New-revision downgrade restores the old body without invoking e30's history-refusing downgrade. Both public
  and tenant migrations preserve function identity/attributes, other functions/triggers/indexes and all rows.
- `memory-transition-healthy-drivers.md`, `memory-transitions.md`, and `TAKI_PATCHES.md` already describe the final
  contracts and explicit migration gate. No further spec or template update is needed for this scoped review.

## Findings (fixed)

No new production issue required a fix. The reviewer added only independent evidence, the parent-only diagnostic
design, and a pure-audit wrapper that redirects its output to a NEW file to preserve the earlier sealed audit.
An initial formatting issue in that new wrapper was corrected; its final lint/format/type checks pass.

The evidence interpretation was corrected: c79 has 68 document inputs, 68 actual invalidation inserts and zero
`memory_links` INSERT statements. `_write_units` applies final lifecycle before constructing the live link list.
Therefore that run did not exercise live semantic-link creation; it does not prove that synthetic vectors altered
its semantic graph. Real encoding and temporary vector-index costs remain unmeasured there.

## Findings (not fixed)

1. `hindsight_api/engine/transfer/transition_delta.py:97` retains ty `invalid-argument-type`: optional
   `request.baseline_transition_id` is passed to `_read`, which expects UUID. A newly executed comparison against
   the exact original baseline preimages reproduces the same sole diagnostic before and after. The request's
   `baseline_kind` model validator enforces exactly one retired-baseline/unused-scope choice, and `_admit` returns
   on the unused-scope branch. This is preexisting static narrowing debt, not an introduced runtime acceptance
   failure. The parent explicitly instructed the reviewer to retain it and preserve scoped production source.
2. Actual local embedding, adequate request-budget margin, working-pair migration and real resumed roundtrip
   acceptance remain unperformed gates. They require parent-owned isolated/real execution, not a production
   patch inferred from the synthetic timing result.

## Verification

| Newly executed check | Result |
| --- | --- |
| Ruff on 7 production + 5 new test paths | PASS, exit 0; project test-file exclusions honored |
| Ruff format on all 12 paths | PASS, 12 already formatted |
| Complete 7-production-file ty | FAIL baseline, exit 1; exactly the one diagnostic above |
| Exact original-preimage/current type comparison | PASS comparison; before 1, after 1, identical source-normalized diagnostic |
| New reviewer audit wrapper lint/format/type | PASS |
| Pure captured SQL/default-public-tenant/downgrade/parent Alembic config audit | PASS; no database/clone/model access |
| Isolated targeted PostgreSQL tests | **105 PASS**, 0 failures, 521.11 seconds |
| New fixture shutdown and cleanup | PASS: stopped, data removed, registry removed, port no longer listening |

Test totals: baseline reader 30; artifact reader 11; derived deletion 5; real association behavior 40;
public/tenant migration 2; existing delta regression 16; selected offline-backup preservation 1. The migration
tests create fresh unique databases, execute e30 -> e40 -> e30 by downgrading only e40, then upgrade again. No
historical e30-downgrade test was selected. No Core suite or unrelated 252-case group was repeated.

Command (from `H:/TakiAgent`):

```text
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- tests/native_results/test_transition_baseline_reads.py tests/native_results/test_transition_artifact_reads.py tests/native_results/test_transition_derived_link_batches.py tests/native_results/test_transition_association_lookup.py tests/native_results/test_transition_association_migration.py tests/native_results/test_transition_delta.py tests/native_results/test_transition_backup.py::test_offline_restore_preserves_retired_quarantine_and_trigger_rollback -q --tb=short -n 0
```

The isolated runner provided PostgreSQL 18.1 with vector/pg_trgm, clean noncredential environment and the
fixture-owned network guard. Fixture:
`H:/TakiAgent/.trellis/.runtime/g1-validation/taki-hindsight-g1-2bb2df24e40a`.
Ownership/stop logs remain; data and registry are absent. Port 5432 was checked as no longer listening after
cleanup. No actual model was initialized or called by the reviewer.

## Parent performance evidence and release limits

The reviewer read only the explicitly authorized new c79 `result.json`, independently confirming SHA256
`ff029a9d77960a5442c862064f7222d63f168d2b3b8d4984aa31c75c9585a0f5`. No benchmark was repeated.

| Parent c79 evidence | Observed result |
| --- | --- |
| Explicit e30 -> e40 migration | 2.611 seconds; migration plus complete proof 20.152 seconds |
| Function identity | Same OID/attributes; new function SHA256 `72a1716fac4a7ce714fa2a0bf9e77d1b3ba80b9f59dc189640c3d5e1df8044c3` |
| Migration preservation | Other functions/triggers/indexes and 60 data objects preserved |
| Timed full apply | 56.018 seconds |
| Apply plus subsequent lookup interval | 56.709 seconds; distinguish this from full apply and HTTP latency |
| Independent baselines | 17.259 and 16.876 seconds |
| Synthetic prepare | 1.233 milliseconds, 68 inputs; zero actual model calls |
| Native/application writes | 6.688 / 8.484 seconds |
| Derived deletion | One call, 4.066 seconds |
| Body transport | 96 metadata prefetches, 1393 ordinary metadata reads |
| Committed identity/result | Same delta operation/hash; exact lookup; 1 delta row; 1559 mappings and 1558 artifacts |
| Preservation/cleanup | Source/input/Core/original/repair sources preserved; stopped and port released |

The migration proof reads the data before apply, so this is SQL-prewarmed evidence. It omits actual model encode,
temporary vector-index differences and HTTP parsing/transport overhead; device/cache/model startup were not
measured. A roughly four-second direct-apply margin is insufficient to establish real readiness.

Next step is specified in `w5-candidate-actual-embedding-discriminator-design.md`: a NEW parent-run-only composition
using the exact request and actual normal LocalSTEmbeddings/prepare path on another fresh clone. Initialization
is separate from apply, actual device/model/offline/batch timings are recorded, and synchronous initialization
and thread encoding require an outer owned-process deadline and cleanup. Asyncio cancellation alone is not a
hard model execution bound. No new helper execution or model framework was introduced in this check.

Only after the actual-model discriminator and remaining budget/transport evaluation may the parent consider
the separately gated working-pair migration and exact interrupted-operation recovery. Maintenance, final proof,
complete real roundtrip, later waves and user/manual acceptance remain open.

## Evidence artifacts

- `w5-candidate-combined-input-audit.json`: exact input verification and explicitly unread historical references.
- `w5-candidate-combined-check-preimages/manifest.json`: twelve reviewer preimages.
- `w5-candidate-combined-quality.json`: complete commands, exit codes and diagnostics.
- `w5-candidate-combined-verification.json`: exact test command/totals and cleanup checks.
- `w5-candidate-combined-source-audit.py` / `.json`: immutable-output-safe pure audit and new result.
- `w5-candidate-combined-parent-result-audit.json`: hash-bound summary of the authorized parent c79 result.
- `w5-candidate-actual-embedding-discriminator-design.md`: bounded parent-only next diagnostic design.
- `w5-candidate-combined-source-manifest.json`: new cumulative checked-source/evidence list, with historical
  runtime references separated from newly read files. Its own SHA256 is supplied at delivery to avoid self-hashing.
