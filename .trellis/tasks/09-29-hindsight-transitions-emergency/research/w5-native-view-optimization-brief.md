# W5 locked-baseline native read reuse

Status: parent-reviewed implementation scope, 2026-10-05. Existing Stage 4 task; W5 remains incomplete.

## Problem and measured evidence

Unchanged actual-model V2 with worker/system telemetry completed full apply in58.174s, leaving1.826s before
the60s deadline. Result: `.trellis/.runtime/w5-actual-embedding-1dc8a7eda5124dcc948b1b95032ae484/result.json`,
SHA256 `e28d227a9df4c07533c45aff03040a93426919e20437e5b56c7069feb8f5e2c6`. Both baseline passes cost about16.8s.
See `w5-continuation-2026-10-05.md` and `w5-candidate-actual-embedding-telemetry-implementation.md`.

The detailed model-free baseline profile measured a redundant `_load_snapshot_source` at0.3896s and the
`current_native` group at2.2655s, including4112SQL/1.2806s and approximately0.3546s of required native hashing.
These measurements identify removable work but do not promise a particular full-request saving. The new real
run's6.34s estimated removable SQL share is a proportional estimate, not measured exclusive gain.

## Approved production ownership

Only these existing Native production files under `H:/hindsight/hindsight-api-slim/`:

- `hindsight_api/engine/transition_snapshot.py`
- `hindsight_api/engine/application_state/snapshot.py`

Add focused tests, extend the existing baseline differential fixture, and update only the relevant paragraphs
in Taki `memory-transitions.md` / `memory-transition-healthy-drivers.md` and Native `TAKI_PATCHES.md`.
Capture fresh preimages before editing. No other production file, schema, API, migration, dependency, timer,
model configuration or CPU/power setting is authorized by this patch. Report an actual scope conflict first.

## Contract

1. Only the existing `_reuse_body_bytes=True` locked-baseline path may pass its freshly loaded source into the
   private application bundler. Default snapshot/hydration, writer and publication paths stay unchanged.
2. The actual `_admit` uses ordinary `conn.transaction()`, not readonly RR. Safety depends on its existing
   Bank/fence lock and absence of writes during this validation segment. Do not claim general transaction
   caching, add a global cache, or reuse a view across a write/transaction/baseline/predecessor pass.
3. Use the complete freshly loaded source and heads for equivalent current-native validation. Still compute
   the canonical SQL-payload hash and compare the exact head/version, then independently validate immutable
   native body/version/hash/Bank and all Source evidence. Python object equality is not a hash substitute.
4. Invalidated-memory payloads keep ordinary `current_native` point reads: bulk Python ordering and duplicate
   entity IDs differ from SQL collation/ANY semantics. Duplicate native object keys also fall back without
   silently overriding entries. Missing/extra objects and malformed/tombstoned/wrong heads retain refusal.
5. Valid native kinds reuse only the existing equivalent row serializers, preserving lifecycle/revision/null,
   metadata, source IDs, entity order and observation scopes. Do not rewrite their serialization semantics.
6. Preserve document original-text/retain-parameter/source-availability evidence point reads and full digest
   checks. Every body access retains fresh decode, schema and Source-closure checks; codec/store/reader are
   outside this scope. All borrowed objects/indexes die when the private bundler returns.
7. Both admissions create independent views. A changed/corrupt state before the second view must still refuse;
   ordinary paths must retain fresh point reads. Do not optimize by weakening admission/fence/proof checks.

## Required tests and delivery

- Start with a focused regression/differential test that demonstrates the repeated work and unchanged proof
  semantics. Cover canonical booleans versus numbers, nested/null fields, kinds/lifecycle, Unicode/same-name
  entities, invalidated duplicate IDs, missing/extra/duplicate keys, wrong head/version/tombstone/hash/Bank,
  and changed document original evidence. Keep failures identical where the original path refuses.
- Run owned-PG differential coverage of ordinary versus optimized complete baseline hashes/auxiliary data,
  including archived records, Source, Block/policy and non-ASCII entities. Reuse the existing isolated harness;
  the implementer may run fresh fixture databases, never original or real working-pair databases.
- Run the directly affected second-admission corruption, rollback, reader disposal and ordinary snapshot tests,
  plus scoped Ruff/format/ty. Preserve and distinguish pre-existing diagnostics. No broad unrelated reruns.
- Deliver `w5-native-view-optimization-implementation.md`, fresh preimages and a new exact source manifest.
  Independent check precedes parent real-model execution and any HTTP/working-pair release.

## Post-patch measurement helper

Old sealed manifests must continue rejecting changed production files. Add a NEW minimal task-only composition
and manifest for the post-patch actual-model/telemetry run, with focused verifier tests. It must pin each inherited
manifest itself, replace hashes only for the explicit authorized changed files, and verify every other inherited
entry unchanged. Both parent and actual worker verify/report the new complete inventory. Reuse V2 actual-worker,
model, clone, watchdog, cleanup and telemetry; do not edit old helpers/manifests/results or broadly disable checks.
Default entry does no work. The implementer prepares this helper but only the parent runs the real-corpus clone.

No commit/push/archive, original authority replacement, reconversion, extra renewal, maintenance allowance,
W6 dispatch or manual-acceptance claim follows this implementation.
