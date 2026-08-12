# Research: Batch 0 Hindsight source exploration

- Query: Resolve the exact Hindsight source files, symbols, tests, and minimal extension seams for the six Batch 0 compatibility contracts required by TakiAgent.
- Scope: internal
- Date: 2026-08-09

## Findings

### Executive conclusion and version clarification

Batch 0 cannot be implemented as an HTTP adapter alone. The public HTTP extension seam can isolate new replication endpoints, but correctness still requires changes inside the authoritative Hindsight write transactions: record revisions/CAS, journal publication, and entity/tag projection must commit with the mutations they describe.

The local checkout is best described as a **0.9.0-versioned `main` snapshot**, not yet as a proven checkout of the immutable `v0.9.0` Git tag:

- `.git/HEAD` points to `refs/heads/main`; `.git/refs/heads/main` contains commit `4b2041eb3de5c4235f4a3dd5619fc47cce782e29`. No local tag ref is present in `.git/packed-refs` or `.git/refs/tags`.
- The API package and runtime constant are both `0.9.0` (`H:/hindsight/hindsight-api-slim/pyproject.toml:5-8`; `H:/hindsight/hindsight-api-slim/hindsight_api/__init__.py:56`).
- The generated OpenAPI document declares API version `0.9.0` (`H:/hindsight/skills/hindsight-docs/references/openapi.json:1-14`), as do the Python client, TypeScript client, and Helm chart (`H:/hindsight/hindsight-clients/python/pyproject.toml:1-4`; `H:/hindsight/hindsight-clients/typescript/package.json:1-4`; `H:/hindsight/helm/hindsight/Chart.yaml:1-6`).
- Upstream's release script synchronizes package/runtime versions and then creates `v$VERSION` (`H:/hindsight/scripts/release.sh:65-115`, `250-257`); release CI is triggered by `v*` tags (`H:/hindsight/.github/workflows/release.yml:1-7`). These files explain the intended relationship, but the local metadata does not prove that commit `4b2041e...` is exactly the tag target.

Therefore Batch 0 should pin both identities: base API/package version `0.9.0` and the exact immutable source commit/image digest used for compatibility testing. `/version` alone is not a source-build identity.

### Batch 0 contract-to-source map

| Contract | Exact current source seam | Existing test evidence | Smallest defensible extension |
| --- | --- | --- | --- |
| Additive retain/observation instructions | Retain already has an additive seam: `BankCreateUpdateRequest.retain_mission` says it is injected beside built-in rules (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:1337-1340`), and `_retain_mission_preamble()` prepends it to the per-request user message while the cached native prompt remains intact (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/fact_extraction.py:1187-1204`, call sites `1347-1356`, `2054-2063`). Observation configuration is different: `build_consolidation_input()` selects `observations_mission or _DEFAULT_MISSION`, so a configured mission replaces the native default mission (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/consolidation/prompts.py:193-213`); `consolidator.py` passes the bank value directly (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py:2621-2632`). | `test_observations_mission_config` and `test_consolidation_with_observations_mission` cover configuration/use (`H:/hindsight/hindsight-api-slim/tests/test_consolidation.py:1948-2009`); the cached-prefix test proves per-bank missions remain outside the system prefix (`H:/hindsight/hindsight-api-slim/tests/test_consolidation.py:3287-3317`). Retain brace/preamble behavior is pinned by `TestRetainBraceSafety` (`H:/hindsight/hindsight-api-slim/tests/test_prompt_brace_escape.py:105-132`). | Keep `observations_mission` semantics unchanged for compatibility. Add a separate configurable/template/API field (provisional name: `observations_instructions`) and append it in a clearly fenced section to `build_consolidation_input()` after the selected native/custom mission. Taki templates set only this new field, leaving `_DEFAULT_MISSION` and the native processing rules untouched. No new Retain mechanism is required; add a contract test proving the existing Retain path remains additive. |
| Monotonic change journal/cursor, upserts, tombstones | Current curation/list surfaces are offset based and not a change feed (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memories/pg/curation.py:81-130`, ordering/pagination `224-250`). Logical writes are distributed across the Memories store, consolidation, document mutation, curation, transfer import, mental-model, directive, and bank-config transactions. The default `PostgresMemories` delegates memory mutations into `engine/memories/pg/*` and explicitly relies on the caller's transaction (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memories/postgres.py:1-18`, `37-73`). | Existing tests cover mutation correctness but no journal/cursor/tombstone contract was found. Relevant native suites are `tests/test_memory_curation.py`, `tests/test_curation_http.py`, `tests/test_observation_invalidation.py`, `tests/test_document_tracking.py`, `tests/test_large_document_replacement.py`, `tests/test_consolidation.py`, `tests/test_mental_models.py`, `tests/test_document_transfer.py`, and `tests/test_http_api_integration.py`. The previously assumed files `test_document_delete.py`, `test_document_update.py`, and `test_directives.py` do not exist; directive coverage is in `test_mental_models.py`. | Add a per-bank lineage/cursor table plus append-only logical change table in one Alembic migration. Journal sequence allocation must be serialized by a per-bank cursor row held until transaction commit; a plain global `BIGSERIAL` is insufficient because allocation order can differ from commit order and let a poller skip a late commit. Publish journal rows from the same authoritative transaction after each logical aggregate is complete. The exact writer coverage is frozen below. |
| Record revision + `expected_revision` CAS | Public mutation request `UpdateMemoryRequest` has text/context/dates/fact type/entities/state/reason but no revision or idempotency field (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:1743-1819`); the route forwards those fields unchanged (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4312-4353`). `MemoryEngine.update_memory_unit()` performs slow preparation outside a transaction, then re-reads and applies all visible changes inside the Phase-2 transaction (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:7629-7683`, `7743-7757`, `7904-8069`). The current re-read is an ordinary addressed read; `pg.reads.get_memories()` has no revision column or row lock (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memories/pg/reads.py:100-128`, `142-158`). | Existing curation tests exercise edit/invalidate/revert, derived cleanup, and race handling; no `expected_revision`, precondition response, or mutation-id replay test was found. | Add monotonic `revision` to live and invalidated records and surface it through `StoredMemory`, get/list/journal/snapshot, and HTTP response models. Add `expected_revision` and a client mutation UUID. Enforce the precondition inside Phase 2 before any entity/link/tag/state change, under the write transaction; return a typed HTTP 412-style response with current revision and make the mutation UUID idempotent. The live/archive move must preserve identity and increment exactly once. |
| Cursor-bound logical snapshot + manifest | Existing transfer export is portable migration, not replica snapshot: IDs/embeddings are deliberately omitted (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/transfer/export.py:1-6`), invalidated records are explicitly skipped (`80-97`), and bank export replays facts/observations while carrying selected bank rows (`286-365`). `export_documents()` reads multiple tables on one connection without an explicit repeatable-read transaction (`201-210`). A correct consistency precedent exists in admin backup, which uses `conn.transaction(isolation="repeatable_read")` across all table reads (`H:/hindsight/hindsight-api-slim/hindsight_api/admin/cli.py:260-318`). | `test_document_transfer.py` checks transfer-table classification and portability, not cursor binding, stable IDs, concurrent writes, or page/manifest integrity. | Do not retrofit transfer ZIP semantics. Build a separate logical-snapshot service that captures `end_cursor` and canonical records from one repeatable-read view, materializes immutable snapshot pages plus hashes/counts, then serves pages by snapshot ID. Keeping an exported PostgreSQL snapshot transaction open across HTTP page requests is not an acceptable lifecycle. Exact table names, page sizing, TTL, and cleanup remain explicit implementation-time decisions. |
| Independent extension capability/version handshake | `/version` is registered in core HTTP and returns runtime API version plus feature flags (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:3748-3750`, route implementation around `4032-4070`). Hindsight also has an `HttpExtension` router mounted under `/ext`, plus an optional root router (`H:/hindsight/hindsight-api-slim/hindsight_api/extensions/http.py:19-25`, `60-101`; mounting at `H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:3893-3906`). | HTTP extension loading/mounting/lifecycle is tested by `SampleHttpExtension` and `TestHttpExtensionIntegration` (`H:/hindsight/hindsight-api-slim/tests/test_extensions.py:833-987`). `/version` feature reporting has focused coverage such as `test_version_endpoint_reports_store_document_text` (`H:/hindsight/hindsight-api-slim/tests/test_store_document_text.py:206-208`). | Prefer an adjacent, independently versioned compatibility manifest under a built-in HTTP extension (for example `/ext/taki-memory/version`) rather than overloading base API `0.9.0`. It must report extension contract versions, provider lineage, supported database/storage mode, journal retention, and snapshot schema. If the extension route must appear in the pinned generated OpenAPI, the generator must instantiate that built-in extension explicitly; otherwise use a separate checked-in extension OpenAPI document. |
| Atomic `taki-layer:*` entity/tag projection | Retain-time controlled labels support `tag=true`: `_inject_label_tags()` parses configured label groups, selects their keys, and appends matching `key:value` entities without duplicating existing tags (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/fact_extraction.py:2753-2771`; call sites `2452-2453`, `2658-2659`). Curation resolves replacement entities using the bank taxonomy (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:7729-7735`, `7800-7822`) and replaces `unit_entities` inside the Phase-2 write transaction (`7933-7955`), but `store.apply_edit()` does not update tags (`7980-8004`; PostgreSQL implementation `H:/hindsight/hindsight-api-slim/hindsight_api/engine/memories/pg/writes.py:512-568`). Thus entity and tag projections can diverge. | Unit coverage for injection and preservation is at `H:/hindsight/hindsight-api-slim/tests/test_entity_labels.py:405-488`; the multivalue integration test asserts tag-enabled labels appear in both tags and `unit_entities` (`1870-1944`). Document tag changes already demonstrate atomic tag/observation maintenance inside one transaction (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:6589-6685`) and are covered by `test_observation_invalidation.py:699-750`. No entity-edit/tag-rederivation regression test was found. | Reuse the parsed bank label taxonomy to separate controlled `tag=true` label tags from unrelated caller/document tags, derive the new controlled tag set from the resolved entity set, and pass the final tags through `MemoriesExtension.apply_edit()`/`MemoryPatch` in the same Phase-2 transaction. Do not expose a free-form tag replacement on single-memory curation if server-side re-derivation can preserve the invariant. |

### Frozen journal object kinds and authoritative writer coverage

The smallest replica-complete object-kind set is:

- `bank`: public bank profile plus replica-relevant config. Template application is represented by the bank/config and resource mutations it actually performs; no separate persisted template object was found.
- `document`: stable source/document identity, public metadata/tags/hash, and a tombstone on permanent deletion.
- `memory_unit`: facts and observations in one canonical kind, carrying public fact type, lifecycle state, revision, source IDs, entities, tags, provenance, and timestamps. Entities, tags, links, chunks, histories, embeddings, and indexes are not separate journal kinds; the canonical unit upsert contains the public projection Taki needs.
- `mental_model`: pinned/derived public mental-model state.
- `directive`: public directive state.

Operational rows (`async_operations`, audit/LLM traces, webhooks, graph-maintenance queues), private embeddings/indexes, chunks, links, entity-registry rows, and history tables are deliberately excluded from the logical replica. If a future Taki feature needs one of them, that is a contract-version increase rather than an implicit expansion.

Every path below must append its upserts/tombstones in the same authoritative transaction; putting publication only in HTTP routes is incomplete because workers, imports, and internal maintenance bypass them:

| Mutation family | Authoritative source seams that require journal publication | Required logical events |
| --- | --- | --- |
| Retain and document replacement | `_insert_facts_and_links()` writes facts plus retrieval-critical entity/link state (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/orchestrator.py:476-576`). Streaming commits at `1783-1911`, including zero-fact replacement transactions at `1677-1726` and `2045-2093`; delta retain commits document/chunk/unit changes at `2507-2657`; metadata-only delta commits document and unit tag/metadata changes at `2707-2744`. Document replacement/upsert helpers are `fact_storage.py:196-395`, and survivor metadata/tag propagation is `398-438`. | Tombstones for outgoing document units and derived observations; document upsert; one upsert for every inserted or metadata-changed fact. Journal after the final canonical state for that transaction is known, not in the extraction phase. |
| Observation consolidation and dedup | Direct update transaction (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py:2160-2346`), create transaction (`2726-2878`), delete helper (`2391-2416`), create-time fold (`269-340`), update-time fold-and-delete (`343-458`), plus stale-observation deletion/reset (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memories/pg/writes.py:232-310`). | Observation upsert after create/update/fold; tombstone for delete/dedup victim/stale derived observation; source fact upserts only when replica-visible fields actually change. |
| Explicit document and memory curation | `MemoryEngine.delete_document()` transaction (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:6448-6555`), `update_document()` (`6589-6685`), single/bulk deletion (`6781-7111`), fact-type/all-bank deletion (`7112-7300`), clear-observation paths (`7332-7426`, `7527-7598`), and the authoritative Phase-2 edit/invalidate/restore transaction (`7904-8069`). | Document and unit tombstones, derived-observation tombstones, unit upserts for tag/metadata/edit/revision changes, archived-state upsert on invalidate, live-state upsert on restore. A permanent delete is distinct from invalidation. |
| Transfer import/restore | Document import enters through `MemoryEngine._run_import_documents()` and the transfer importer (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:4516-4550`; `H:/hindsight/hindsight-api-slim/hindsight_api/engine/transfer/importer.py:128-349`). Bank restore calls `import_bank()` (`memory_engine.py:4391-4459`); imported observations are written directly in `transfer/importer.py:798-861`, bypassing consolidation helpers. | Same document/unit/bank upserts as native writes. No special "import" event kind; restored logical records must be indistinguishable to consumers. |
| Mental models | Create is transactional with lazy bank creation (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:11770-11880`). Refresh funnels through `update_mental_model()` (`12456-12613`, `12707-12914`); clear and delete write at `12958-13040`. | Mental-model upsert after create/update/refresh/clear; tombstone on delete. Current update/history code needs an explicit transaction before a same-transaction journal append can be guaranteed. |
| Directives | CRUD writes are `H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:13834-14016`. | Directive upsert on create/update and tombstone on delete. Each current statement needs to be wrapped with the cursor/journal append in one explicit transaction. |
| Bank lifecycle/config/admin | Lazy creation occurs through `retain/bank_utils.py:178-270` and `retain/fact_storage.py:124-152`; disposition/mission writes are `bank_utils.py:274-355`; config persistence/reset is `H:/hindsight/hindsight-api-slim/hindsight_api/config_resolver.py:474-530`; profile updates are `memory_engine.py:14534-14648`; hard deletion is in `memory_engine.py:7112-7300`. Default/template imports fan out through these APIs plus mental-model/directive creation. | Bank upsert after each public profile/config change; provider-lineage bank tombstone on hard delete. The deletion marker must survive deletion of `banks`, so it cannot depend on a cascading bank FK or a route that requires the deleted bank row to exist. |

For ordering, lock one provider-lineage/per-bank cursor row in every authoritative transaction, reserve the required contiguous cursor values while that lock is held, write all journal rows, and release only at commit. This serializes allocation with commit visibility. A standalone sequence or `BIGSERIAL` does not provide that guarantee. Large transactions may emit many consecutive events; a batch token can additionally carry the transaction ID/ordinal for diagnostics, but the consumer cursor must remain unambiguous.

### Proposed minimal patch surface and dependency/order notes

Provisional dependency order:

1. Add schema primitives first: provider lineage, per-bank cursor state, logical change rows, snapshot metadata/pages, per-record revisions, and mutation-id receipts. Follow the mandatory dual-dialect migration shape (`H:/hindsight/CLAUDE.md`, "Adding Database Migrations"; `H:/hindsight/hindsight-api-slim/tests/test_migration_shape.py:1-57`). Taki's initial supported deployment can capability-gate the extension to PostgreSQL if Oracle parity is deliberately out of scope; it must not falsely advertise support.
2. Add pure canonical serializers and journal allocator/append helpers in a new focused replication module. The allocator must run on the caller's connection/transaction.
3. Thread revision, mutation identity, controlled-tag projection, and journal append through the existing Phase-2 curation transaction before exposing the REST fields.
4. Cover retain/consolidation/document/derived/admin mutation sources and only then enable the change endpoint. An endpoint over incomplete writers is worse than no endpoint.
5. Build materialized logical snapshot creation on top of the same canonical serializers and journal cursor state.
6. Expose the independent compatibility manifest last, and advertise a capability only after its behavior tests pass.
7. Regenerate OpenAPI/clients after HTTP models/routes are final (`H:/hindsight/CLAUDE.md`, "Generating Clients/OpenAPI").

### TDD / contract-test matrix

| Contract | First failing test to add | Required proof | Concrete command |
| --- | --- | --- | --- |
| Additive observation instructions | Focused prompt/config tests in `tests/test_consolidation.py` plus template round-trip in `tests/test_bank_templates.py` | Default native mission remains present; fenced addendum is present; existing `observations_mission` replacement behavior remains backward-compatible; cached system prefix remains bank-agnostic. | `cd H:/hindsight/hindsight-api-slim; uv run pytest tests/test_consolidation.py tests/test_bank_templates.py -q` |
| Revision/CAS/idempotency | New focused curation contract tests plus HTTP integration cases | matching revision applies once; reused mutation UUID returns original result; stale revision returns typed precondition without any row/entity/tag/derived mutation; archive transitions increment once. | `cd H:/hindsight/hindsight-api-slim; uv run pytest tests/test_memory_curation.py tests/test_http_api_integration.py -q` |
| Atomic layer projection | Regression in `tests/test_entity_labels.py` | editing from `taki-layer:a` to `taki-layer:b` changes entity and tag atomically, preserves unrelated tags, and rollback leaves both old projections. | `cd H:/hindsight/hindsight-api-slim; uv run pytest tests/test_entity_labels.py -q` |
| Journal | New `tests/test_taki_replication_journal.py` plus focused native writer suites | complete writer coverage; commit-order cursor; no rows from rolled-back txns; explicit tombstones; deterministic pagination; cursor expiry/reset; transfer imports and internal consolidation are visible without passing through HTTP. | `uv run pytest tests/test_taki_replication_journal.py tests/test_memory_curation.py tests/test_document_tracking.py tests/test_large_document_replacement.py tests/test_observation_invalidation.py tests/test_consolidation.py tests/test_document_transfer.py tests/test_mental_models.py -q` |
| Snapshot/manifest | New `tests/test_taki_logical_snapshot.py` | concurrent write is either inside the materialized snapshot or strictly after `end_cursor`; page hashes/counts compose to manifest; stable IDs/revisions, documents, invalidated state, mental models, directives, bank state, and provider lineage are included; pages remain immutable after creation. | `uv run pytest tests/test_taki_logical_snapshot.py tests/test_migration_shape.py tests/test_alembic_dag.py -q` |
| Handshake/OpenAPI | New `tests/test_taki_extension_contract.py`, existing extension tests, generated OpenAPI test, and compatibility check | base `0.9.0` and independent extension versions are separately reported; unsupported database/storage capability is not advertised; exact schemas are generated from the route actually mounted in the compatibility build. | `uv run pytest tests/test_taki_extension_contract.py tests/test_extensions.py tests/test_store_document_text.py -q`; then from `H:/hindsight/hindsight-dev`, `uv run pytest tests/test_generate_openapi.py -q` and `uv run generate-openapi`; finally `uv run check-openapi-compatibility <pinned-0.9.0-openapi.json> ../hindsight-docs/static/openapi.json`. |

Baseline native quality commands from `H:/hindsight/CLAUDE.md`:

```powershell
Set-Location H:/hindsight/hindsight-api-slim
uv run pytest tests/
uv run ruff check .
uv run ruff format --check .
uv run ty check hindsight_api/
```

Implementation verification sequence (not executed during this read-only research):

```powershell
Set-Location H:/hindsight/hindsight-api-slim
uv run pytest tests/test_migration_shape.py tests/test_alembic_dag.py -q
uv run pytest tests/test_taki_replication_journal.py tests/test_taki_logical_snapshot.py tests/test_taki_extension_contract.py -q
uv run pytest tests/test_memory_curation.py tests/test_curation_http.py tests/test_entity_labels.py tests/test_consolidation.py tests/test_bank_templates.py -q
uv run pytest tests/test_document_tracking.py tests/test_large_document_replacement.py tests/test_observation_invalidation.py tests/test_document_transfer.py tests/test_mental_models.py tests/test_extensions.py tests/test_store_document_text.py -q
uv run ruff check .
uv run ruff format --check .
uv run ty check hindsight_api/

Set-Location H:/hindsight/hindsight-dev
uv run pytest tests/test_generate_openapi.py -q
uv run generate-openapi
uv run check-openapi-compatibility <pinned-0.9.0-openapi.json> ../hindsight-docs/static/openapi.json

Set-Location H:/hindsight
./scripts/generate-bank-template-schema.sh
./scripts/generate-clients.sh
./scripts/generate-docs-skill.sh
./scripts/hooks/lint.sh
```

The repository CI performs the same generation family and fails when generated artifacts differ (`H:/hindsight/.github/workflows/test.yml:4953-4996`); OpenAPI compatibility is checked separately at `5022-5048`. `generate_openapi.py` constructs a plain `MemoryEngine` and calls `create_app(_memory)` without installing an HTTP extension (`H:/hindsight/hindsight-dev/hindsight_dev/generate_openapi.py:42-68`). Therefore a compatibility route implemented only as an optional runtime extension will not enter the canonical OpenAPI unless the generator explicitly installs that built-in extension, or the patch maintains a separate checked-in extension OpenAPI and verifies it independently.

### Verified versus inferred

Verified from current local source:

- All version declarations listed above are `0.9.0`; the checkout points at local `main` commit `4b2041e...`; no local tag ref was found.
- Retain mission input is additive to the native extraction prompt; observation mission selection replaces the default mission value.
- Curation already has a two-phase design with one short authoritative Phase-2 transaction, which is the correct CAS/tag/journal seam.
- Entity-only curation replaces entity links but does not re-derive label-backed tags.
- Transfer export is not a stable-ID, invalidation-complete, cursor-bound snapshot.
- HTTP extension, repeatable-read backup, migration shape, and generated OpenAPI seams exist.
- The current canonical OpenAPI generator does not mount an optional HTTP extension by default.
- Migration files live in one Alembic DAG and must dispatch `upgrade()`/`downgrade()` through `run_for_dialect`; the lint permits an explicitly `None` slot but does not by itself make PostgreSQL-only runtime capability truthful (`H:/hindsight/hindsight-api-slim/tests/test_migration_shape.py:1-57`; `hindsight_api/alembic/_dialect.py:1-43`).
- Current mental-model, directive, and bank-config writers do not all expose a caller-owned explicit transaction, so same-transaction cursor publication requires small refactors rather than a route-only callback.

Inferred/proposed, not yet implemented or runtime-verified:

- The exact new field and endpoint names.
- The snapshot materialization schema and retention/TTL.
- PostgreSQL-only versus dual PostgreSQL/Oracle Batch 0 support.
- Exact HTTP status/body for CAS conflicts and cursor expiry.
- Exact schema/table/endpoint names and whether extension OpenAPI is merged into the base document or published separately.

## Files Found

- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/orchestrator.py` — retain transaction orchestration, document replacement, fact/entity/link insertion, delta and zero-fact paths.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/fact_storage.py` — document upsert/replacement helpers, fact insertion delegation, unit metadata/tag propagation.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/consolidation/consolidator.py` — observation create/update/delete/dedup transactions and additive-instruction call path.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py` — public document/curation/bank/mental-model/directive mutation orchestration and CAS Phase-2 seam.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/memories/pg/writes.py` — PostgreSQL memory archive/restore/edit and stale-observation writes.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/transfer/importer.py` — direct transfer restore writers that bypass normal consolidation entry points.
- `H:/hindsight/hindsight-api-slim/hindsight_api/config_resolver.py` — bank-config persistence/reset outside a caller-supplied transaction.
- `H:/hindsight/hindsight-api-slim/hindsight_api/extensions/http.py` and `api/http.py` — extension router mounting, base version route/models, and OpenAPI app construction.
- `H:/hindsight/hindsight-dev/hindsight_dev/generate_openapi.py` and `H:/hindsight/.github/workflows/test.yml` — generated-contract path and stale-generated-file/compatibility gates.
- `H:/hindsight/hindsight-api-slim/hindsight_api/alembic/`, `tests/test_migration_shape.py`, and `tests/test_alembic_dag.py` — dual-dialect migration convention and DAG checks.

## Code Patterns

- Slow LLM/embedding/entity preparation is performed outside a pooled connection, followed by a short authoritative write transaction; new CAS and journal work belongs in that second phase (`memory_engine.py:7743-7757`, `7904-8069`; `consolidator.py:2181-2183`, `2218-2342`).
- Store mutation helpers accept the caller's live connection/transaction rather than owning commits (`engine/memories/pg/writes.py:1-11`), which is the pattern the journal append helper should follow.
- Document replacement captures outgoing IDs before cascade and removes stale observations in the same transaction (`retain/fact_storage.py:234-307`; `memory_engine.py:6478-6555`). Journal tombstones must be generated from those captured IDs before they disappear.
- Optional HTTP extension routers are mounted after core routes under `/ext`, but generation only includes them when the `MemoryEngine` passed to `create_app()` has that extension configured (`api/http.py:3893-3906`; `hindsight-dev/hindsight_dev/generate_openapi.py:50-60`).

## External References

No web or external documentation was used, per task boundary. Version and API claims come only from the local Hindsight checkout, its generated OpenAPI, package manifests, release scripts, tests, and CI configuration.

## Related Specs

- `H:/TakiAgent/.trellis/tasks/08-09-hindsight-compatibility-extensions/prd.md` — six Batch 0 contracts and acceptance criteria.
- `H:/TakiAgent/.trellis/tasks/08-09-hindsight-memory-provider/prd.md` — authority, replica, snapshot, CAS, migration, and cutover requirements.
- `H:/TakiAgent/.trellis/spec/guides/source-grounding-guide.md` — verified/inferred evidence labeling.
- `H:/TakiAgent/.trellis/spec/guides/cross-layer-thinking-guide.md` — cross-layer contract and failure-path review.
- `H:/TakiAgent/.trellis/spec/backend/database-guidelines.md`, `error-handling.md`, `quality-guidelines.md`, and `mcp-tool-schema-compatibility.md` — migration, typed failure, verification, and schema compatibility constraints.

## Caveats / Not Found

- No Hindsight service was started and no tests were executed in this research pass; all current statements are source/OpenAPI/test-code inspection.
- No public monotonic journal, cursor expiry contract, record revision, expected-revision mutation, cursor-bound logical snapshot, or independent Taki extension version is present in the inspected 0.9.0 surface.
- The local checkout is not proven to be the immutable `v0.9.0` tag because tag refs are absent; pin/verify the exact release artifact before implementation acceptance.
- Bank deletion is a critical contract edge: the current implementation hard-deletes all bank-scoped state and then the `banks` row in one transaction (`memory_engine.py:7223-7290`). A bank-scoped journal with a cascading FK or an endpoint that requires a live bank cannot deliver that tombstone. Implementation must use a provider-lineage journal/tombstone that survives the bank row, or explicitly adopt a soft-delete lifecycle.
- Revision semantics for invalidated rows are not present. The implementation must decide whether invalidate/restore increments one continuous revision across both live/archive tables (recommended) and ensure the archive schema carries it.
- Cursor expiry/retention, snapshot page size/TTL/cleanup, exact CAS response body/status, schema names, and Oracle support remain implementation-time contract decisions. They must be frozen by the new tests before the capability manifest advertises support.
- Transfer import performs direct observation writes and must not be omitted from journal instrumentation. Other unverified extension-owned writers must be found by the implementation diff review before enabling the endpoint.
