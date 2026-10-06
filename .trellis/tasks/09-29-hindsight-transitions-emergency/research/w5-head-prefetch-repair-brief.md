# W5 locked-view head prefetch registration repair

Status: parent-reviewed bounded repair, 2026-10-05. Continue the existing owner-authorized W5 task.

## Evidence and objective

The checked native-view actual-model run at `w5-actual-embedding-2e081d2289694da987c48eb7455690a2`
completed correctly but full apply60.544s failed60s. Ordinary body descriptor/part reads each increased from
1393 to4517; the three batch-query families each decreased96->72. Expected Native point queries disappeared.

Independent reviewer reproduced the exact scheduling regression without PG/model access in the NEW
`w5-native-view-postpatch-scheduling-probe.py`: ordinary reader heads register1559 native body references,
but `_locked_native_view` parses its directly fetched rows without that registration. Per-baseline ordinary
metadata/part reads increase558->2120 and each batch family decreases29->17. Both paths perform immutable-byte
transport validation for4223 synthetic bodies, and their second pass performs zero SQL. This is not a substitute
for full body-schema, Source-closure or PostgreSQL proof. Two baselines exactly explain each +3124 ordinary /
-24 batch delta.
Read the final `w5-native-view-postpatch-analysis.md` and its probe artifacts before implementing.

Restore original head-first prefetch registration while retaining the independently checked Native source/head
reuse. This is a transport scheduling repair, not a new cache lifetime, weaker proof or request-budget change.

## Production ownership

Only three Native production files under `H:/hindsight/hindsight-api-slim/hindsight_api/engine/`:

1. `application_state/store.py`: extract the existing head-row parsing to protected `_heads_from_rows(rows)`;
   ordinary `heads()` calls that method after its unchanged SQL.
2. `transition_baseline_reads.py`: replace its `heads()` override with `_heads_from_rows(rows)` override. Call
   the superclass parser and register the same non-null native body references in the same original order.
3. `application_state/snapshot.py`: `_locked_native_view` calls the protected parser/registration method for
   its already fetched rows. Preserve the exact SQL object-key comparison, duplicates, unsafe keys and fallbacks.

No duplicate SELECT, external mutation of reader `_pending`, changed body budgets, global cache or new public API.
Do not change transition_snapshot.py, delta apply, codec, models, serializers, transactions, migrations, timers,
model settings, system settings or Core production. Capture fresh preimages of every changed existing path.
Any actual scope conflict returns to the parent before expansion.

## Contracts and meaningful verification

- Ordinary store/head SQL and parsing/refusals remain equivalent. Locked rows retain their actual SQL keys.
- Original head-first ordering must be restored for nonempty heads and artifacts. Preserve null references,
  duplicate/invalidated fallback behavior, Source dependencies and cached-body queue cleanup.
- Complete descriptor identity, namespace/Bank/version/hash proof, sealed metadata, every part/hash/schema and
  Source closure still validate. Both admissions and the three other validation lifetimes remain independent.
- Add a meaningful failing regression before patching, exercising real `_locked_native_view`/bundler and the
  actual `_TransitionValidationReader` transport scheduling with heads, artifacts and Source dependencies.
  Assert full body correctness and restored ordinary/batch query structure, not just private `_pending` shape.
- Extend the existing focused tests in `test_transition_native_view.py`, `test_transition_native_view_pg.py`
  and/or `test_transition_baseline_reads.py` only where needed. Use a fresh owned PG fixture for real locked
  differential/full baseline hash/auxiliary coverage, plus second-admission corruption, rollback/disposal and
  ordinary snapshot behavior. Do not repeat unrelated broad suites. Report overlapping test counts honestly.
- Run scoped Ruff, format and type checks. Existing unrelated full-native auto-fix/dependency-sync hooks are
  replaced by these parent-approved scoped commands. No dependency installation or broad formatting.
- Update only the relevant Native TAKI_PATCHES.md and Taki memory-transitions/healthy-drivers spec paragraphs
  if needed to record the shared parse/register contract. No generated templates or configuration changes.

## NEW execution composition and immutable evidence

The current checked382-entry inventory and every historical helper/report/result remain sealed. After production
changes they must continue rejecting drift. Create NEW `w5_head_prefetch_inventory.py`,
`w5-head-prefetch-postpatch.py` and focused offline tests, final source manifest, preimages and delivery report.

Pin the previous checked manifest to
`e0ec8c9e8b10706411e1f1bc2c43d1d0022a2b010471ef3bc976e4bea8331f4c`. Derive the exact new inventory from
its complete file set plus explicitly declared new additions; permit replacements only for the exact approved
production/test/spec paths. Every other preceding file, including all seven historical manifests and helper
implementations, stays byte-identical. Reject missing, extra, duplicate and undeclared entries and unauthorized
replacements. Include and pin the preceding manifest itself; no self-hash cycles.

Prefer a thin NEW composition over the unchanged checked native-view entry: inject the new inventory module and
new entry path so both parent and actual V2 worker use the same new exact source set. Preserve original V2 launcher,
handshake, dependency pins, offline model settings, watchdogs, clone-only network, normal claim/apply, failure
records, all four persisted reports and cleanup. Default invocation does no work. Source inventory success,
diagnostic completion and Native timing remain separate. The implementer must not execute model/corpus/working
pair or HTTP paths; only the parent may run the new entry after independent review.

## Delivery and later gates

Deliver `w5-head-prefetch-implementation.md`, meaningful RED/GREEN and scoped checks, exact final manifest SHA,
and a concrete parent command. Independent review follows the implementer. Parent then rehashes the final set
and runs ONE new actual-model clone, using the same request/model/deadlines/telemetry. Restored query counts
must be confirmed independently of full timing. Do not promise a numeric gain from SQL counts alone.

HTTP acceptance requires adequate actual-model margin. Same-transition working-pair recovery, exact per-Bank
maintenance review, all-Bank COMMIT/readiness/custody/queue proof and final W5 check remain later gates. No further
admission renewal, repeated Local edits, corpus conversion, commit/push/archive, authority replacement or manual
acceptance is authorized by this repair. At most one child is active; preserve all concurrent parent edits.
