# W5 Candidate Reader Queue Repair

## Scope and outcome

The parent approved exactly three transport-bookkeeping removals after a complete-descriptor verified-byte cache
hit. The sole production change is `H:/hindsight/hindsight-api-slim/hindsight_api/engine/transition_baseline_reads.py`.
The parent separately owns real-corpus performance acceptance and the upcoming read-only trigger diagnostic.
No trigger, migration, timer, Core, API, dependency, validator or other production source changed.

Correctness validation passed: 41 directly affected tests, scoped lint/format, exact-preimage type comparison and
source audit. The reader repair is frozen by its new immutable source manifest.
No real operation was resumed. No old clone/original database or model service was accessed. All DB execution here
used the existing isolated owned-PG test runner. Earlier reports, manifests, profilers and test assertions remain
unchanged. No Git or task-lifecycle operation was performed.

## Why the cache hit must consume transport bookkeeping

Final application validation reads the Bank first, then enumerates all current artifacts. That enumeration queues
the Bank body again. The subsequent verified-byte cache hit previously left the Bank in `_pending`. A later batch
then staged its raw metadata/parts after the Bank's final read, leaving `_metadata` permanently nonempty and forcing
later bodies through ordinary per-body reads.

The approved repair removes the hit body's identifier from `_pending`, `_metadata` and `_parts` before the existing
LRU update/return. It runs only after `_identity()` verifies scope and the full descriptor matches a verified entry.
It never clears another body's staged rows or promotes raw data to verified data. A same-ID conflicting descriptor
still misses and must pass ordinary descriptor/storage validation. Model decoding, schema validation, Source closure,
historical references, all resource budgets and the five independent reader lifetimes are unchanged.

The previous A+B clone's 2823 ordinary reads consist of the expected remaining 1393 plus 1430 stranded final-view
reads. This repair addresses that concrete path. These counts explain the proposal, not a new performance result.
The previous run's two baseline passes alone took 71.080s; this patch does not establish the unchanged 60s gate.

## Changed files and validation

| File, relative to Native slim unless noted | Change |
| --- | --- |
| `hindsight_api/engine/transition_baseline_reads.py` | Three `pop(descriptor.body_id, None)` calls inside the existing full-identity cache-hit branch, plus explanatory comments. |
| `tests/native_results/test_transition_baseline_reads.py` | One regression for queued and staged cached-hit cleanup, preservation of another body's rows, conflicting alias refusal, and fresh-reader corruption refusal. |
| `tests/native_results/test_transition_artifact_reads.py` | One actual-apply final Bank-first regression with a two-body batch budget. The complete fixture crosses multiple batches; later artifacts must keep using prefetch with zero ordinary metadata fallback in that final reader. |
| Taki `.trellis/spec/backend/memory-transition-healthy-drivers.md` | One paragraph defining this transport lifecycle and its required regressions. |

The cached-hit regression stages actual stored metadata and multipart bytes. The Bank-first regression retains the
real two-transaction apply, written Block, Bank-first ordering and all five independently disposed readers. Reducing
only the batch body count makes the small owned fixture cross the same boundary as the real corpus, without changing
cache, byte/part budgets, validator semantics or production constants.

Both runs below used:

```text
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- <selection> -q --tb=short -n 0
```

| Owned PG directory under `.trellis/.runtime/g1-validation` | Selection and result |
| --- | --- |
| `taki-hindsight-g1-7752b51f0729` | RED, the two new regressions: **2 failed in 38.25s**. The first retained the cached body's pending identifier; the actual final view fell back on two later bodies. |
| `taki-hindsight-g1-7a0206ad1b48` | All directly affected baseline/artifact-reader tests, **41 passed in 392.40s**. |

The two selected files are `tests/native_results/test_transition_baseline_reads.py` and
`tests/native_results/test_transition_artifact_reads.py`. The unrelated 59-case regression group was not rerun.
Both owned instances were stopped with their data/registry removed before sealing; failing RED evidence is retained.

Scoped `ruff check` and `ruff format --check` passed for the three changed Python files. Native configuration excludes
tests from lint rules and checks their formatting. No lint suppression or length-limit adjustment was needed.

`w5-candidate-reader-queue-type-compare.py` verifies the exact production preimage and checks the prior/current file
with the existing Native `ty` configuration. Both checks exited 0 with zero diagnostics and equal normalized results.
Evidence: `.trellis/.runtime/w5-candidate-reader-queue-types-c2064dd72a7d400183363a9b4d89bc64/result.json`.

## Immutable source audit

`w5-candidate-reader-queue-preimages/manifest.json` pins the original reader bytes to the A+B source manifest entry:
`e992524883b4c75711cc2fcb3a152f384e3993dfc10f9321ca6c7d449f879b0f`.

`w5-candidate-reader-queue-source-audit.py` confirms the entire production AST is unchanged after removing exactly the
three approved statements from their full-identity cache-hit branch. Removing the single new regression from each
test file restores its exact A+B byte hash. Removing the one spec paragraph restores its prior byte hash. All other
56-entry A+B manifest evidence is checked against its recorded hashes. The old manifest itself remains:
`51b86892546896ca275b8da2fb9972d3ffce0ee01ee1f12fad61e9a18d6b6a23`.

The new source manifest is created exclusively, then every entry is reread and verified. It contains the new source,
tests/spec, exact preimage, audit/type helpers, this report and completed test/type evidence. It does not overwrite
the earlier acceptance history or claim that a correctness pass establishes corpus latency.

## Remaining work

After this correctness source is frozen, the parent will review a separately delivered, parent-run-only diagnostic
script for actual stored trigger definitions/indexes and read-only endpoint SELECT plans on a fresh physical copy.
That script must not invoke apply, DELETE, publication functions, engine startup or models. No trigger production
repair or migration is authorized by this reader work. Real-corpus timing and independent review remain separate.
