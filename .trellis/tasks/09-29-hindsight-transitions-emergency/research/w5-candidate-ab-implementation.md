# W5 Candidate A+B Implementation

## Status and boundary

The parent approved A+B from `w5-candidate-residual-profile-analysis.md` after the completed attribution run.
The implementation is limited to bounded derived-link deletion and independent byte readers in the two predecessor
passes and the final application validation pass. Correctness verification passed: 44 targeted and 59 affected
regression cases, scoped lint/format, exact-preimage type comparison, and source audit. A+B real-corpus latency and
independent checker acceptance remain parent-owned gates. This report does not authorize a real operation
resume, mark W5 complete, or establish product/manual acceptance.

No Core, protocol, migration, index, dependency, timeout, TTL, lease or native source/current-head validation changed.
Both baseline passes and their complete integrity checks remain. There were no real model requests, original-pair or
old-clone DB accesses, real-clone/profiler executions, Git operations or task lifecycle changes in this implementation.

## Production files

All paths below are relative to `H:/hindsight/hindsight-api-slim`.

| File | Change |
| --- | --- |
| `hindsight_api/engine/transfer/transition_delta_rows.py` | Keep each row's existing restoration/update/revision/temporary/entity handling; collect exactly its old deletion-branch targets and delete the incident derived-edge union in batches of at most 128 UUIDs. |
| `hindsight_api/engine/transition_baseline_reads.py` | Rename the private reader to `_TransitionValidationReader` and describe its broader validation-only use; algorithm and budgets are unchanged. |
| `hindsight_api/engine/transition_snapshot.py` | Use the renamed class; the two baseline lifecycles and all validation are unchanged. |
| `hindsight_api/engine/transfer/transition_delta_application.py` | Create one fresh reader inside each `_predecessors` invocation and one for final Bank/artifact validation; dispose each with `finally` before any subsequent write/publication boundary. |

The final manifest records exact bytes and hashes. Four exact preimages were saved before editing in
`w5-candidate-ab-preimages/`; its manifest joins the earlier diagnostic/baseline source hashes.

### A: exact deletion set

Only an existing live row or a successfully restored archived target enters `derived_targets`. A newly introduced
target never enters this set. Every batch uses the original connection and transaction, the exact Bank predicate,
either endpoint in the batch, and only `temporal`/`semantic` link types. This computes the same union as the former
per-target deletes, including links incident to targets in different batches. The batches finish before `_write_units`
recreates retrieval links. Native-only row state and causal edges are preserved by the existing native primitives.

The production writer and per-row restore/update/revision/cleanup ASTs are unchanged except that the old derived-edge
DELETE is replaced by collecting the target. The scoped test suite proves empty input, 128+1 batching, the exact edge
set, mixed live/new/restored targets, causal/foreign edges, and rollback after a DELETE executes and then raises.

### B: independent validation views

A complete non-replay apply now has five non-overlapping reader lifetimes:

1. First transaction baseline; disposed before preflight.
2. First transaction predecessor validation; disposed before returning ordinary predecessor models.
3. Second transaction baseline; independently reloaded and disposed.
4. Second transaction predecessor validation after native writes; disposed before application command construction.
5. Final Bank/current-artifact validation after application writes; disposed before `publish_event`.

Every reader retains its original connection, table scope, namespace and Bank. It caches only fully verified immutable
bytes; each read freshly decodes/validates models and rechecks Source closure/historical references. Reader data never
crosses any of these boundaries. The second predecessor pass and final pass therefore see the current transactional
state, including new application bodies and storage corruption injected after earlier validation.

Bank-first validation and all scope/provenance checks preserve their previous order. `_body_and_command`, command
validation, body/artifact/head writes and `publish_event` continue using the ordinary `ApplicationStateStore`.
No global service cache, mutable model cache, cached acceptance verdict or new public API was introduced.

The existing budgets remain 128 descriptors, 8 MiB of actual raw bytes and 1024 part rows per batch, plus a 64 MiB /
8192-entry verified-byte LRU. Oversized/exhausted/evicted paths retain ordinary complete one-body validation. These
budgets are resource bounds for the optimization, not relaxed provider acceptance criteria.

## Test changes

| File | Coverage |
| --- | --- |
| `tests/native_results/test_transition_derived_link_batches.py` | Five owned-PG cases for exact edge deletion, mixed target state and causal/foreign preservation, empty and cross-batch sets, and transaction rollback. |
| `tests/native_results/test_transition_artifact_reads.py` | Ten actual-apply cases for five non-overlapping disposed readers, new Block visibility with normal/tiny budgets, ordinary command/publication ownership, exact receipt replay, post-predecessor corruption refusal/rollback, and failure/cancellation cleanup in each new boundary. |
| `tests/native_results/test_transition_baseline_reads.py` | Only the private class name changed; all 29 existing baseline tests and assertions remain. Byte identity after reversing the rename is audited. |

The final-view corruption test changes a previously validated Source's stored bytes after a new Block artifact has
been written. Final validation must refuse, roll back the entire transaction, restore the Source's original bytes,
and leave no native/application/delta durable effects. This detects accidental sharing across validation views.

The mixed-target test initially exposed a test probe defect: `DeleteProbe.execute` did not forward the optional
`timeout` keyword used by native restore's causal-link insertion. The exact error was
`TypeError: DeleteProbe.execute() got an unexpected keyword argument 'timeout'`. Only `**kwargs` passthrough was
added to this new test probe. All causal/foreign/identity/revision assertions remain unchanged, and all five users of
the probe were rerun successfully. This was not evidence of production causal-link loss.

## Executed validation

All PG runs used the existing owned fixture runner, PostgreSQL 18.1 with vector/pg_trgm, deterministic test helpers,
and `-q --tb=short -n 0`. No corpus extraction or real model provider was used. Paths in this table are under
`H:/TakiAgent/.trellis/.runtime/g1-validation`.

| Run directory | Selection and result |
| --- | --- |
| `taki-hindsight-g1-368012967232` | RED: exact-set batch-count and actual five-reader tests, **2 failed in 39.38s** at the expected old 3-delete/2-reader assertions. |
| `taki-hindsight-g1-f17520ab13d0` | GREEN: same two tests, **2 passed in 34.00s**. |
| `taki-hindsight-g1-f8099a36ea55` | All 44 targeted cases, **43 passed / 1 failed in 377.78s**; the one failure was the probe `timeout` forwarding defect above. |
| `taki-hindsight-g1-de6d45cc7968` | All five A cases after the probe-only repair, **5 passed in 35.50s**. Together with the unchanged 39 B/baseline cases above, all 44 targeted cases passed. |
| `taki-hindsight-g1-6b40464afe0a` | Eight affected regression files, **59 passed in 713.79s**. |

All five owned PostgreSQL instances were stopped with data and registry removal confirmed. The final source seal
rechecks every ownership record and the absence of its data/registry path. No test process remains active.

The affected regression selection is:

```text
tests/native_results/test_transition_delta.py
tests/native_results/test_transition_integrity.py
tests/native_results/test_transition_source_evidence.py
tests/native_results/test_transition_source_refusals.py
tests/native_results/test_transition_historical_references.py
tests/native_results/test_transition_proof_renewal.py
tests/native_results/test_application_bodies.py
tests/native_results/test_application_state.py
```

Reproduction uses the following command from `H:/TakiAgent`, replacing `<selection>` with the files above or the three
targeted files listed in the test table:

```text
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- <selection> -q --tb=short -n 0
```

Scoped `ruff check` and `ruff format --check` passed for all four production files and three test files. The native
configuration excludes tests from lint rules and includes them in formatting. No lint suppression or limit increase
was required. File/function length is evaluated by cohesive responsibility as the owner requested; nothing was split
solely to satisfy a line count. The full `lint.sh` was deliberately replaced by the parent-approved scoped commands
because it would synchronize dependencies and auto-edit unrelated files.

`w5-candidate-ab-type-compare.py` verified all four exact preimages and checked them against the current four files.
Both baseline and current checks exited 0 with zero diagnostics; normalized exact-source diagnostics are equal.
Evidence: `.trellis/.runtime/w5-candidate-ab-types-d80d09f9f4d44b9dbb459e62a1815877/result.json`.
The helper's first run failed while parsing `ty`'s empty successful output; the helper now treats empty output as zero
diagnostics only when exit status is 0. The failed helper directory remains preserved at
`.trellis/.runtime/w5-candidate-ab-types-a5964af01e814128baba1beeaa4f9697`; it was not a production type error.

## Source and evidence audit

`w5-candidate-ab-source-audit.py` passed its read-only source checks. Its `--seal` mode creates a new manifest with
exclusive creation and reads every recorded file back to verify the seal. It verifies:

- All four preimage hashes match the earlier diagnostic or baseline source entries.
- Reader AST is identical after normalizing the private class name and module prose; no budgets or algorithms changed.
- Snapshot bytes and the original baseline test bytes are identical after reversing only the class rename.
- Native writer AST and every per-row restore/update/revision/cleanup operation remain identical.
- Application module AST is identical after removing only the two reader lifecycle shells and their import. This
  includes `_body_and_command`, validation order, all writer logic and publication ownership.
- Earlier manifest files and their pinned reports/profiler/result files remain unchanged. The earlier diagnostic
  source differences are exactly the original baseline repair plus the two newly approved production files.
- Every test fixture is stopped and its data/registry removed before sealing. Failing logs remain immutable evidence.

The narrow spec change is `.trellis/spec/backend/memory-transition-healthy-drivers.md`, under
`Native delta validation reads and derived-link cleanup`. It records the five reader boundaries, ordinary-store
ownership, exact bounded edge union, rollback proof and unchanged timing/validation constraints.

No Trellis scripts/templates or platform registries were modified. New task-only files are this report, the type
comparison and source audit helpers, the four preimages with their manifest, and the final A+B source manifest.

## Remaining gates and rollback boundary

The parent must measure A+B using a fresh unchanged pre-apply corpus copy, then obtain independent checker acceptance
against the final source manifest. An already committed receipt cannot measure apply cost. The previous 94.569s
original run, 73.558s first-repair run and 153.961s instrumented attribution run are historical inputs to this repair;
none measures A+B. The instrumented result is attribution evidence only. Approximately 50s remains a diagnostic
headroom target; the existing 60s request deadline is unchanged and this report introduces no new product threshold.

Native source/current-head I/O (proposal C), duplicate baseline removal and validation suppression remain out of scope.
No permission to resume the paused real operation is inferred from these owned tests. There is no schema or persisted
format migration. A code rollback, if separately authorized and needed, uses the four exact A+B preimages after
checking for later edits; no rollback or destructive source operation was performed here.
