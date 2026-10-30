# G1 Offline Python Validation Map

Date: 2026-09-08
Status: planning only; no tests, services, LLM calls, migrations, or generators were run for this report.
Scope: G1 native factual result plus an actual local checkpoint; derived processing stays asynchronous. This map does not accept cutover, B4/B6, semantic quality, or deployed-service behavior.

Source anchors are relative to H:/hindsight/hindsight-api-slim unless an absolute path is shown. G1 production/tests are being edited by another implementer; recheck the final new selectors and fixture before execution.

## 1. Isolation and fixture prerequisites

Use only:
H:/TakiAgent/.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py

The inspected harness starts an owned pg0, verifies data_directory and vector/pg_trgm (80-98,142-169), cleans inherited provider/database settings and disables dotenv (38-60), supplies its own HINDSIGHT_API_DATABASE_URL, and invokes pytest with -n 0 and g1_fixture_network_guard (101-113). It runs from H:/hindsight/hindsight-api-slim using the existing installation. No dependency installation is needed by these commands.

Do not invoke plain pytest or the repository-wide suite. tests/conftest.py:125-133 loads repository .env with override=True; pg0_db_url otherwise starts persistent hindsight-test on default port 5556 (108-109,150-238). pyproject.toml:180-191 defaults to eight xdist workers. The harness URL and -n 0 prevent using that database and concurrent queue consumers.

### Proposed root-fixture interception

The root memory fixture uses mock LLM, but its dependencies are not offline:
- conftest.py:464-492 initializes LocalSTEmbeddings.
- conftest.py:495-523 initializes LocalSTCrossEncoder.
- conftest.py:531-557 constructs mock MemoryEngine and SyncTaskBackend.
- conftest.py:455-461,560-586 define real llm_config / memory_real_llm.

A same-named plugin fixture loses to nearer conftest definitions. tests/native_results/conftest.py also does not apply to sibling tests/test_*.py.

Task-local support for root to implement:
1. In pytest_sessionstart, before fixtures run, identify the loaded root conftest by resolved file path and replace ONLY its LocalSTEmbeddings and LocalSTCrossEncoder factory globals.
2. Reuse existing no-I/O 384-dimensional Embeddings: tests/test_retain_same_document_concurrency.py:49-78 _StubEmbeddings, or the implementer's native_results/conftest.py:24-39 FixtureEmbeddings. Both fit zero-argument construction and initialize/encode/dimension. Do not register their entire conftest globally.
3. Replace the cross-encoder factory with native RRFPassthroughCrossEncoder. This preserves native ranking control flow, not semantic-ranking quality.
4. Set clean global LLM provider/model to mock BEFORE engine initialization and clear the config cache. The inspected runner sets an OpenAI placeholder (49-51); a dummy key/network guard is not a mock provider. Retain resolves operation config through with_config, so patching one engine attribute alone is insufficient (test_retain_transient_extraction_failure.py:66-76).
5. Preserve memory, request_context, api_client, tenant/auth fixtures and test-owned monkeypatches. Do not globally disable consolidation or force chunks mode. Preserve the provider=none fixture in test_delta_retain_duplicates.py:245-268 and authenticated/default-deployment cases in test_taki_extension_contract.py:26-48,121.
6. Reject unknown selectors, forbidden fixtures/markers, model initialization outside the intercepted factories, and non-fixture network attempts. Check transitive item.fixturenames, not only direct test arguments.

This interception is sufficient in principle for the root-fixture-based mechanical selectors below. It is not a general offline mode: direct model constructors, private pg0 instances and real-LLM fixtures need separate review. Support is a proposed harness prerequisite, not a passed gate.

## 2. Explicit mechanical allowlist

Full-file entries are mechanical under the prerequisites. Do not expand wildcards to all tests.

| Group | Selectors | Source evidence / purpose |
| --- | --- | --- |
| Pure retain mechanics | test_retain_orchestrator_mapping.py; test_retain_pipeline_cancellation.py; test_async_retain_tags.py; test_operation_completion.py | Mapping/filtering and embedding-length contracts: mapping:65-281. Cancellation:40 mocks extraction/consumer. Tags:12,113 mocks admission/forwarding. Completion:79,95,115 checks outbox/fallback/no-op with fake connections. |
| Admission and queue | test_async_retain_operation_id.py; test_async_batch_retain.py; test_batch_chunking.py | operation_id:58-190 covers replay/conflict/concurrent admission/ASGI validation. async_batch:484-609 covers zero/degenerate outputs and provenance; :1093,1157,1244,1311,1374,1397 covers notification failure, document-affine children and admission rollback. Chunking:24-250 is pure; :273,298 needs DB fixtures. |
| Streaming/extraction failures | test_subbatch_chunk_coverage.py; test_subbatch_multichunk_coverage.py; test_structured_chunk_size_retain.py; test_retain_transient_extraction_failure.py; test_retain_same_document_concurrency.py | Subbatch:61,96,130 checks replacement/append coverage; multichunk:114,134 checks sync/async offsets and late content; structured:29-45 sets real chunk boundaries. Transient:56-118 injects MockLLM errors but drives native poller/executor. Same-document:81-103 already uses stub embeddings and scoped consolidation disablement. |
| Append, selected nodes | test_retain_append_mode.py::test_append_mode_metadata_consistent_for_unchanged_and_new_units; ::test_append_mode_no_existing_document; ::test_append_mode_requires_document_id; ::test_replace_mode_is_default; ::test_append_mode_conversation_arrays_produce_valid_json | Lines 89,143,178,261,299: stored fields, identity validation, default replacement, JSON assembly. Other append tests include recall-presence assertions and are outside this write-path selection. |
| Delta, selected names | In test_delta_retain.py: names containing metadata, tags_propagated, removed_chunks, chunks_have_content_hash, or processed_content_tokens; all test_delta_retain_duplicates.py | Delta:406,447,501,567,627,955-1099 covers projections/deletion/hash/accounting. Duplicates:28,92,169,274,400 covers ordering, stale requests, concurrency and append metadata; its latter fixture is provider=none. |
| Native Batch API | test_batch_api.py | :30-37 uses MagicMock/AsyncMock provider; :70,421,564,690,773 covers submission/poll/results, crash/worker recovery, partial errors and native entry-point routing. Canned provider responses, no provider HTTP request. |
| Mutation/HTTP | test_taki_conditional_curation.py; test_curation_http.py | Conditional:18-21 isolates derived work; :93,132,172,230,340,406,484,599 covers CAS, concurrent replay/conflict, lifecycle/no-op and receipt lifetime. HTTP:21-45 uses ASGI and SQL seeds. |
| Journal/snapshot/writers | test_taki_replication_retain.py; test_taki_replication_curation.py; test_taki_replication_journal.py; test_taki_logical_snapshot.py | Retain:31-34 scopes auto-consolidation off; :407,454,669,733,816,979,1128,1254,1511 covers streaming/recovery/delta/fallback/rollback. Journal:196,262,293,461,500 covers commit order/rollback/pagination/read races. Snapshot:294,355,455,609,636,717 covers canonical kinds, immutable pages, races, rollback/expiry and table classification. |
| Shared writer/lifecycle | test_taki_replication_consolidation.py; test_taki_replication_observation_maintenance.py; test_taki_replication_admin_writers.py; test_taki_replication_transfer.py | Consolidation:334-345,448,493,590-592 supplies fixed actions/dedup outcomes, testing transactions rather than LLM choices. Other modules seed SQL and test tombstones, cursor serialization, restore and rollback. Run if final G1 touches shared writer/lifecycle machinery; this is not derived-completion acceptance. |
| Auth/extension contract | test_taki_extension_contract.py; test_supabase_tenant.py | Extension:26-48 preserves fixture authentication; :121 default no-auth fails closed; :251 coexistence; :405,423 typed errors/schema. Supabase:72-90 mocks HTTP/JWKS; :160-265 mocks startup HTTP; :670-719 mocks provisioning. No real Supabase connectivity claim. |
| Migration/admin persistence | test_migration_shape.py; test_migrations_newer_revision.py; test_migrations_thread_safety.py; test_admin_backup_restore.py; test_extension_bank_tables.py | Shape:20-45 parses AST. Migration wrappers stub Alembic upgrade; their literal localhost URL is not connected. Admin:28-63 uses injected pg0_db_url and unique schemas; :67 table inventory; :110,236,362,434,473,514 restore/column/extension coverage. Extension tables:82,87,113,170,197 covers classification, teardown, provisioning. |

Primary new G1 tests (not substitutes for existing regression): tests/native_results/test_retain.py, test_mutation.py, test_portable_hash.py. Their fixture uses owned pg0_db_url, mock LLM, deterministic vectors, RRF, ASGI and fixture-only authentication (native_results/conftest.py:47-89). Initial cases cover receipt survival, append full-body replay, read-without-admission, mutation boundary/rollback/no-op and portable hashes. Collect the final set after the implementer's edits settle.

## 3. Future commands

NONE were run for this report. Root-fixture groups require the factory interception and strict selector/fixture guard above. The existing native_results fixture does not cover sibling modules.

PowerShell setup:

~~~powershell
$g1Python = 'H:/hindsight/.venv/Scripts/python.exe'
$g1Runner = 'H:/TakiAgent/.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py'
$g1Markers = 'not oracle and not integration and not hs_llm_core and not hs_llm_mat'
~~~

Pure mechanics/migration shape, then new G1 evidence:

~~~powershell
& $g1Python $g1Runner -- -q -m $g1Markers tests/test_retain_orchestrator_mapping.py tests/test_retain_pipeline_cancellation.py tests/test_async_retain_tags.py tests/test_operation_completion.py tests/test_migration_shape.py tests/test_migrations_newer_revision.py tests/test_migrations_thread_safety.py
& $g1Python $g1Runner -- -q -m $g1Markers tests/native_results
~~~

Native admission/streaming/mocked Batch API:

~~~powershell
& $g1Python $g1Runner -- -q -m $g1Markers tests/test_async_retain_operation_id.py tests/test_async_batch_retain.py tests/test_batch_chunking.py tests/test_subbatch_chunk_coverage.py tests/test_subbatch_multichunk_coverage.py tests/test_structured_chunk_size_retain.py tests/test_retain_transient_extraction_failure.py tests/test_retain_same_document_concurrency.py tests/test_batch_api.py
& $g1Python $g1Runner -- -q -m $g1Markers tests/test_retain_append_mode.py -k 'metadata_consistent or no_existing_document or requires_document_id or replace_mode_is_default or conversation_arrays_produce_valid_json'
& $g1Python $g1Runner -- -q -m $g1Markers tests/test_delta_retain.py -k 'metadata or tags_propagated or removed_chunks or chunks_have_content_hash or processed_content_tokens'
& $g1Python $g1Runner -- -q -m $g1Markers tests/test_delta_retain_duplicates.py
~~~

Mutation, cursor/snapshot and authentication:

~~~powershell
& $g1Python $g1Runner -- -q -m $g1Markers tests/test_taki_conditional_curation.py tests/test_curation_http.py tests/test_taki_replication_retain.py tests/test_taki_replication_curation.py tests/test_taki_replication_journal.py tests/test_taki_logical_snapshot.py tests/test_taki_extension_contract.py tests/test_supabase_tenant.py
~~~

Shared writer/lifecycle regression when affected, then admin persistence:

~~~powershell
& $g1Python $g1Runner -- -q -m $g1Markers tests/test_taki_replication_consolidation.py tests/test_taki_replication_observation_maintenance.py tests/test_taki_replication_admin_writers.py tests/test_taki_replication_transfer.py
& $g1Python $g1Runner -- -q -m $g1Markers tests/test_admin_backup_restore.py tests/test_extension_bank_tables.py
~~~

Each invocation owns a fresh database. Retain the failing selector/log and distinguish fixture rejection, baseline behavior and G1 regression. Never bypass the network guard to pass a test. Rerun narrowly after a concrete fixture/implementation correction.

## 4. Exclusions and evidence limits

- Refuse hs_llm_core, hs_llm_mat, integration, oracle and transitive llm_config / memory_real_llm fixtures. memory_no_llm_verify is not inherently real-provider: the reviewed retry-context case is mechanical (test_async_batch_retain.py:1032-1088). Do not automatically allow unrelated uses.
- Do not select all test_retain.py. It mixes semantic-link expectations (:1584,2058), LLMConfig.from_env (:2412,2667), and real-LLM cases (:233,3515-3527). Marker exclusion alone is insufficient. Do not rewrite semantic tests to use fakes.
- Exclude test_batch_api_integration.py and provider *_batch_integration.py. The former loads dotenv/builds a real provider (:20-67); real API cases are marked/skipped (:119-125,241-245). A skip is not provider acceptance.
- test_batch_api_validation.py is deterministic but all four tests reimplement the condition/error instead of invoking production verification/extraction (:34-46,61-66,81-86,98-104). It is not a primary runtime gate; test_batch_api.py exercises actual orchestration.
- Exclude test_migration_backsweep.py, test_migration_drop_access_count.py, test_migration_entity_kind.py, test_migration_history_long_bank_id.py, test_migration_observation_search_vector_backfill.py and test_migration_remaining_bank_id_text.py. They create their own EmbeddedPostgres. History-long-bank-id:43-59 starts fixed instance/port 5567 and downgrades it; remaining-bank-id:59-70 starts fixed instance/port 5568. Others use fixed instance names even with dynamic ports. They need separately reviewed fixture adaptation; do not touch those persistent instances.
- File names are not an I/O classifier: test_http_api_integration.py:61-72 uses ASGITransport; mock-looking tests can still initialize LocalST via conftest. The allowlist, fixture closure and network guard control scope.
- Admin tests truncate/drop generated schemas inside the owned database (test_admin_backup_restore.py:28-63,190-204); run only through this harness.
- Admin table inventory is not nonempty new-receipt survival. Baseline roundtrip seeds banks, memory_units and directives only (:117-160). Add implementer-owned cases with actual G1 result/receipt rows, identity/checkpoint fields and lifecycle cleanup before claiming new evidence survives backup/restore.
- Migration AST checks plus fresh migrations do not prove existing-data upgrade/downgrade. If G1 changes upgrade/backfill behavior, seed its predecessor schema in the owned fixture and verify that compatibility contract. No Oracle runtime acceptance follows.
- Journal/snapshot regressions prove their existing protocol, not G1 receipt-to-result/checkpoint causality. New G1 tests must directly exercise the new transaction boundary and faults.
- Hash vectors/RRF validate storage/control flow only: no extraction accuracy, semantic retrieval, consolidation quality, live connectivity, latency SLA or user-data migration claim.
- SDK/cross-repo consumer selectors are root-owned and intentionally omitted.
