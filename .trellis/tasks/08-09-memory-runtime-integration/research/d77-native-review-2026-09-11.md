# Independent native D77 review — 2026-09-11

Three commit-path defects were reproduced and repaired within the parent's explicit scope. The final isolated PostgreSQL run passed 24 tests, including 11 new binding/retirement cases and 13 existing application-state tests. No additional must-fix finding remains in the reviewed native implementation. The parent still owns independent review of this repair and overall D77/B6 acceptance.

## Scope and independence

- Reviewer: `/root/d77_sdk_generate`; implementation checkout: `H:/hindsight`, main at `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
- Reviewed the engine/storage, commit/receipt, publication, snapshot/hydration/replay, generation lifetime, original-body preservation, migration/backup and guarded-reflect paths against the active D77 implementation contract and native application-state plan.
- The earlier OpenAPI/schema/codegen repairs authored by this reviewer are excluded from independent approval. Their separate completed evidence remains in `d77-sdk-validation/validation-summary.md`.
- After reporting the failures, the parent authorized minimum production repairs only in `engine/application_state/commits.py`. This review changed that file and added `tests/native_results/test_d77_review_binding_guards.py`; no other native production source, wire schema, SDK, G1/D78 behavior or Core production file changed.

## Reproduced and repaired findings

### P1 — Distinct Memory artifacts could claim the same head in one atomic request

Location: `hindsight-api-slim/hindsight_api/engine/application_state/commits.py:209`, `:254`.

The existing guard checked ownership against the pre-commit native head, while command uniqueness covered only artifact keys. Two different Memory keys could therefore both pass preparation against one initially unbound unit. Commit then assigned the head twice. A hidden policy followed by a neutral policy completed successfully and left only the second binding active.

The repair tracks exclusive native `(object_kind, object_id)` targets across the entire preparation batch and rejects a duplicate with a durable `binding_invalid` receipt before any authoritative write. The previous cross-key ownership check now applies consistently to retirement as well. Sources remain exempt because distinct original Source artifacts may intentionally share one native document.

Regression: `test_d77_review_binding_guards.py:88` asserts complete refusal, unchanged head/checkpoint and stable receipt replay/status. `:267` proves multiple Sources sharing a document still commit successfully.

### P1 — Retirement could overwrite an unrelated native head

Location: `hindsight-api-slim/hindsight_api/engine/application_state/commits.py:221`.

The retire branch required some native CAS for exact bindings but did not match its kind/ID to the artifact's own binding. It also accepted extra CAS for awaiting Sources and Core Blocks. Retiring each of an exact Source, awaiting Source and Block with a valid unrelated Memory version completed and reassigned that Memory head to the retired artifact, losing its usable policy association.

The repair requires exact-binding retirements to CAS the same native kind/ID at its current version. Awaiting Source and Core Block retirements require no native CAS. The existing `current_native` check still verifies the authoritative current version and full payload hash; no caller-supplied version is trusted merely because its ID matches.

Regression: `test_d77_review_binding_guards.py:146` exercises both valid and invalid retirement for all four binding families. The Memory case explicitly tests the same native kind with a different ID. Successful retirement preserves the original immutable body and binding; refusal leaves the unrelated head and checkpoint unchanged.

### P2 — Native edits prevented legitimate Memory retirement

Location: `hindsight-api-slim/hindsight_api/engine/application_state/commits.py:127`.

Retirement reuses the historical body. The old validator incorrectly required that body's assessment target to equal the newer current native CAS, so a valid same-object retirement after a native edit was refused unless the caller first performed a semantic reassessment/rebind.

The repair validates the retained assessment against the artifact's historical exact binding. The independent native CAS and same-object checks still verify the current object. Retirement cannot claim that a new assessment occurred and cannot select another object.

Regression: `test_d77_review_binding_guards.py:233` edits the native unit, proves `rebind_required`, retires with its current CAS and verifies the current native version is unchanged while the binding becomes missing.

## Other reviewed boundaries

| Area | Evidence and conclusion |
| --- | --- |
| Authentication and namespace | `memory_engine.py:1835` constructs the application facade only after tenant authentication and PostgreSQL capability checks. `store.py:136`/`:186` enforce live namespace and durable application state. The authenticated HTTP and cross-Bank tests passed. |
| Atomicity and historical replay | `commits.py:287` looks up immutable receipts before current-state CAS, then locks native/application Bank rows and prepares inside a savepoint. Deterministic refusals do not carry successful checkpoints. Existing parallel-CAS, later-native-edit replay and publication rollback tests passed. |
| Native publication and generation | `replication.py:1113` calls the common capture hook. `publication.py:187` combines repeated appends within one outer transaction; `:274` preserves exact native heads, durable rebind work and deletion lifetime. Existing repeated-append, deletion/recreation and paired-checkpoint replay tests passed. |
| Complete original evidence and recovery | `store.py:281`/`:372`/`:375` validate immutable scoped parts and sealed typed bodies. `snapshot.py:92` closes hydration over historical artifacts/source references; `:158` verifies native logical payload and independent original document evidence. Original-body, source-edit, hydration, immutable-part and prune/reset tests passed. |
| Backup and downgrade | All eight application tables are listed in `admin/cli.py:86`. The D77 migration preserves historical evidence outside live-Bank cascade lifetime and refuses a nonempty downgrade. The owned physical backup/restore test passed. |
| Model-input admission | `read_admission.py:213` resolves exact current artifact/native policy associations; `:367` rechecks remembered input before submission and makes refusals sticky. `memory_engine.py:6080` filters before reranking, with another guard at `:6136`. `reflect/agent.py:583`, `:879`, `:1226`, `:1374` and `:1387` cover cache, main model, tool-result, final-answer and rewrite paths. Existing actual LLM/reranker spies, hidden sibling/opaque input suppression and restrictive-policy race tests passed. |

No further native mutation was needed after these checks. Full original Source and Canonical bodies remain immutable evidence; policy-only changes do not mutate native content or advance its native cursor. Missing/unproven associations are withheld before model consumption. The optional admission hook continues to preserve ordinary native behavior when absent.

## Validation

| Run | Result |
| --- | --- |
| Red fixture `1b2804b31746` | Original six new cases: **5 failed, 1 passed**, 26.90 seconds. All five failures reproduced the three findings above; valid shared Source/document binding passed. |
| Green fixture `ac600bbff86d` | Expanded review file plus `test_application_state.py`, `test_application_bodies.py`, `test_application_api.py`, `test_application_reflect.py`, `test_application_backup.py`: **24 passed**, 80.59 seconds. Two existing deprecated `ReflectRequest.context` access warnings; no failed/skipped case. |
| Scoped Ruff | `ruff check` and `ruff format --check` passed for `commits.py` and the new review test. |
| Scoped types | `ty check --python ./.venv/Scripts/python.exe` passed for both changed files. |
| Preservation | Compared all 36 entries in `d77-sdk-validation/native-source-sha256-after-sdk.json`: only the explicitly authorized `commits.py` changed; all other 35 files are byte-identical. |

Exact green command, from `H:/hindsight`:

```powershell
& 'H:/hindsight/.venv/Scripts/python.exe' 'H:/TakiAgent/.trellis/.runtime/b6-continuation-20260911/run_reflect_regressions.py' tests/native_results/test_d77_review_binding_guards.py tests/native_results/test_application_state.py tests/native_results/test_application_bodies.py tests/native_results/test_application_api.py tests/native_results/test_application_reflect.py tests/native_results/test_application_backup.py -q --tb=short
```

The wrapper preserves the existing clean environment, owned-PG identity checks and network guard; it adds only the verified local tokenizer fixture. Both fixture runs reported `Stopped=true`, `DataRemoved=true`, `RegistryRemoved=true`. Their logs remain under `H:/TakiAgent/.trellis/.runtime/g1-validation/taki-hindsight-g1-<run-id>/pytest.log`.

Final SHA-256:

- `commits.py`: `3d98c03c46016c9b0622a2bd55ba545405441ff67b7c991a6830edfa64a7b2f8` (before review: `7e058d176c8a28880f49ae5a32a224092b4fc2533474b082720959a266e02416`).
- `test_d77_review_binding_guards.py`: `dffbedb34edc6e239dd6e010070cc4d5aeb5866f62562b31c7fdd2fe9ae9c5e7`.

## Acceptance limits

The already-recorded 553-test native corpus, repaired historical-assumption checks, legacy reflect checks and complete SDK generation were not rerun for this bounded internal commit-validation repair. Whole-repository lint/platform baselines remain described by the native and SDK checkpoints; this report does not reclassify them as clean. No original user database, repository `.env`, credentials, real model, retained live target, activation, dependency addition, Git mutation or other worktree was used. This report does not claim integrated Core runtime, real-model, manual or production acceptance.
