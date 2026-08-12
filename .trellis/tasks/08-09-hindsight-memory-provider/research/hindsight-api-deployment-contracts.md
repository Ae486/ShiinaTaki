# Research: Hindsight API and Deployment Contracts

- Query: Determine the exact public Hindsight API, SDK, authentication, lifecycle, bank/template, model-configuration, health, deployment, and change-tracking contracts that Taki can rely on for the Hindsight Memory Provider.
- Scope: mixed
- Date: 2026-08-09

## Findings

### Decision summary

Hindsight 0.9.0 is usable as Taki's authoritative semantic-memory engine for retain, recall, reflect, raw-fact curation, bank administration, templates, mental models, directives, health checks, and supported self-hosted deployment.

It is not sufficient, without an additive extension, for the synchronization and recovery contract already approved in the Taki PRD:

1. No public monotonic bank change cursor or complete mutation journal was found.
2. No public per-record revision, ETag, If-Match, or expected-revision mutation contract was found.
3. Retain has an idempotency identity only for asynchronous retain; mutation calls do not expose an equivalent idempotency key.

Therefore:

- Pin the first supported compatibility target to exactly Hindsight 0.9.0, then widen only after contract tests pass.
- Use the REST/OpenAPI surface as the provider contract. Treat the generated SDKs as conveniences and MCP as an optional agent transport, not as the authority for Taki's adapter.
- Require API-key authentication even for loopback deployments.
- Configure provider/model credentials and provider/model selection at the deployment level, not through per-bank configuration.
- Add a small upstream-compatible change-feed and conditional-mutation extension before claiming PRD R5/R6 compliance or promoting Hindsight to authority.
- Keep periodic full logical reconciliation as repair and drift detection, not as a substitute for the missing incremental journal.

### Capability and gap matrix

| Area | Current 0.9.0 contract | Status for Taki | Decision |
| --- | --- | --- | --- |
| Version discovery | GET /version reports package version and feature flags; packages and Helm chart declare 0.9.0 | Ready | Pin 0.9.0 and reject unsupported versions before setup/cutover |
| Database readiness | GET /health returns 200 when the database is ready and 503 otherwise | Ready | Use for process readiness, not complete provider validation |
| LLM connectivity | POST /v1/default/banks/{bank_id}/health/llm probes retain, consolidation, and reflect without returning provider/model/key details; disabled by default | Ready with deployment flag | Require it during guided setup and cutover |
| Authentication | Runtime supports a shared API-key tenant extension and 401 failures; default deployment is unauthenticated | Ready with policy | Taki-managed and existing-instance setup must require auth |
| OpenAPI auth declaration | OpenAPI has no global security scheme/security requirement | Gap in generated contract | Add Taki-owned auth capability and negative tests |
| Retain | POST /memories supports source content, deterministic document_id, metadata, entities, tags, observation scopes, strategies, replace/append, sync/async | Ready | Use deterministic document_id and explicit fields |
| Retain idempotency | Client-supplied UUID operation_id is idempotent only when async=true; synchronous retain ignores it | Partial | Pending outbox must use async retain and deterministic operation IDs |
| One-to-many mapping | Retain response returns counts/operation IDs, not extracted fact IDs | Partial | After terminal completion, enumerate /memories/list filtered by deterministic document_id |
| Recall | POST /memories/recall supports types, budgets, max tokens, timestamps, tags/tag groups, score floors, trace, chunks/entities/source facts | Ready | Set all behavior-affecting defaults explicitly in the adapter |
| Reflect | POST /reflect supports budget, token cap, evidence inclusion, JSON Schema structured output, tag scoping, directives, and mental-model controls | Ready | Preserve text, structured output, evidence, usage, and trace separately |
| Edit/invalidate/restore | PATCH /memories/{memory_id} edits raw facts and reversibly changes valid/invalidated state | Ready with limits | Expose canonical edit/invalidate/restore; observations remain derived |
| Conditional mutation | No expected revision, ETag, If-Match, or record revision was found | Blocking gap for stale replay | Required extension before R6 stale-mutation supersession is safe |
| Bank administration | List, create/update, patch, and destructive delete are public | Ready | Keep destructive operations in Control Plane workflows |
| Missions | retain_mission is additive; observations_mission replaces built-in consolidation rules; reflect_mission is current; mission/background/profile aliases are deprecated | Ready | Use current fields only and contract-test precedence |
| Templates | Schema version 1 supports bank behavior, mental models, directives, entity labels, MCP allowlist, and audit flag; import supports dry-run | Ready | Taki templates should be versioned additive overlays |
| Mental models | CRUD, async refresh, dry-run refresh, clear, history, tags, full/delta triggers, cron or post-consolidation refresh | Ready | Represent as derived memory, not ordinary raw facts |
| Directives | CRUD with name, content, priority, active state, and tags | Ready | Preserve tag and priority semantics in canonical projection |
| Per-bank behavior config | Only an explicit safe-field allowlist is mutable | Ready | Use for missions, retrieval, consolidation, disposition, labels, and MCP policy |
| Per-bank provider/model config | Provider/model selection and credentials are static server-level fields | Not available | Advanced setup must configure the deployment, not assume bank overrides |
| MCP | Multi-bank /mcp and bank-scoped /mcp/{bank_id}/ exist with configurable tool exposure | Optional | Do not advertise native Hindsight tools beside Taki canonical tools |
| SDK parity | High-level clients cover common flows; low-level generated APIs expose broader endpoints | Partial | Bind to REST/OpenAPI or generated low-level SDK, not only convenience wrappers |
| Async operations | Offset-paginated job tracking, status, progress, cancel, retry, delete | Ready for job control | Do not treat operations as a mutation/change stream |
| Audit log | Optional, fire-and-forget, UUID/timestamp records, offset pagination | Insufficient for replication | Use for diagnostics/compliance only |
| Webhooks | Only retain.completed, consolidation.completed, and memory_defense.triggered | Insufficient for replication | Use as acceleration hints only, never correctness authority |
| Document transfer | Full logical ZIP export/import; re-embeds and re-resolves on import; IDs/embeddings are excluded | Ready for migration/backup | Not an incremental or identity-preserving replica feed |
| Monotonic change cursor | No public complete bank journal/change feed was found | Blocking gap for R5 | Add extension or revise the approved requirement |

### Contract authority and supported version

The current source tree, generated OpenAPI, generated low-level SDK, and package/chart versions agree on 0.9.0:

- H:/hindsight/hindsight-api-slim/pyproject.toml:7
- H:/hindsight/hindsight-clients/python/pyproject.toml:3
- H:/hindsight/hindsight-clients/typescript/package.json:3
- H:/hindsight/helm/hindsight/Chart.yaml:1-6
- H:/hindsight/skills/hindsight-docs/references/openapi.json:1

The OpenAPI document reports OpenAPI 3.1.0, title Hindsight HTTP API, and API version 0.9.0. It does not declare components.securitySchemes or global security. Current source and generated OpenAPI should outrank prose documentation when they disagree.

Initial Taki compatibility policy:

1. Supported version: exact 0.9.0.
2. Setup gate: authenticated /version, /health, and enabled per-bank LLM health probe.
3. Feature gate: verify required paths and enabled feature flags rather than inferring them from version alone.
4. Upgrade gate: backup, deploy candidate, run contract tests, reconcile logical state, then promote.

### Core REST contracts

#### Retain

Endpoint: POST /v1/default/banks/{bank_id}/memories.

MemoryItem supports content, event timestamp, context, metadata, document_id, entities, tags, observation_scopes, strategy, and update_mode. A null timestamp means now; the string unset represents timeless content. update_mode is replace or append for an existing document identity. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:608-701.

RetainRequest supports synchronous or asynchronous processing. A client UUID operation_id provides retry idempotency only for asynchronous retain; reusing it for a different operation returns 409, and synchronous retain ignores it. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:723-771.

RetainResponse returns success, bank, item count, async status, one or more operation IDs, and synchronous token usage. It does not return extracted memory-unit IDs. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:841-874 and H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:7672-7828.

Taki implication: use a deterministic document_id derived from the canonical source identity, submit outbox retains asynchronously with a deterministic UUID, await terminal operation state, then enumerate GET /memories/list?document_id=... to record the one-to-many fact mapping. The list endpoint explicitly supports document filtering but uses offset pagination and recency ordering. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4130-4202.

#### Recall

Endpoint: POST /v1/default/banks/{bank_id}/memories/recall.

The request supports query, fact types, observation preference, budget, max_tokens, trace, query timestamp, included entities/chunks/source facts, flat or compound tag filters, and score floors. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:276-365.

Results expose stable IDs, text, public type, entities, context, temporal fields, document_id, metadata, chunk_id, tags, source fact IDs, and stage scores. The response can include trace, entity state, chunks, and source facts. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:368-406 and H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:547-598.

Route evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4403-4419.

Taki should explicitly send types, tag semantics, budget, max_tokens, and include options. This avoids transport-default drift and keeps Automatic Memory Recall deterministic.

#### Reflect

Endpoint: POST /v1/default/banks/{bank_id}/reflect.

The request supports query, budget, max_tokens, optional JSON Schema structured output, flat or compound tag filtering, directive selection, fact-type filtering, and mental-model exclusions. The response exposes markdown text, optional supporting memories/mental models/directives, structured output, usage, and trace. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:925-1148.

The route runs the provider reasoning path and maps timeout to HTTP 504. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4604-4755.

#### Raw-fact curation

Endpoint: PATCH /v1/default/banks/{bank_id}/memories/{memory_id}.

Supported changes are text, context, occurred range, world/experience fact type, entity replacement, and reversible state transitions between valid and invalidated. Editing text re-embeds the fact and rebuilds derived state. Invalidation removes it from recall/consolidation, prunes links and derived observations, and is reversible. Observations cannot be curated through this contract because they are derived. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:1743-1819 and H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4312-4368.

No request field carries an expected revision or idempotency key. Consequently, Taki cannot prove that a queued mutation still targets the revision originally seen, which blocks the PRD rule that stale pending mutations become superseded rather than overwriting newer authority state.

### Banks, missions, templates, labels, and derived memory

Bank profile/create/update contracts expose current retain_mission, observations_mission, reflect_mission, disposition, and related safe behavior. mission, background, and profile/disposition routes are compatibility aliases and are deprecated. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:1151-1429 and H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:6562-6802.

Semantics to preserve:

- retain_mission adds instructions to built-in extraction behavior.
- observations_mission replaces built-in consolidation instructions.
- reflect_mission is the current reflection mission name.

Bank templates use manifest schema version 1 and can carry bank behavioral configuration, mental models, directives, entity labels, MCP tool allowlists, and audit settings while excluding credentials and infrastructure URLs. Import/export and JSON Schema endpoints are public; import supports dry-run and may schedule async work. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:2511-2773 and H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:6815-7104.

Entity label groups support value, multi-values, text, and map shapes, with optional/tag semantics and legacy-shape migration. Free-form entities remain separately configurable. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/entity_labels.py:14-104 and H:/hindsight/hindsight-api-slim/hindsight_api/config.py:2641-2643.

Mental models support metadata/content/full reads, async create and refresh, full or delta triggers, mutually exclusive cron or post-consolidation refresh, structured output, dry-run refresh, clear, history, update, and delete. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:2108-2276, H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:2452-2504, and H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:5050-5422.

Directives expose name, content, priority, active state, and tags, with full CRUD and tag-filtered listing. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:2063-2100 and H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:5797-5973.

### Authentication and secret boundary

Hindsight is unauthenticated by default. Shared-key authentication is enabled with:

- HINDSIGHT_API_TENANT_EXTENSION=hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension
- HINDSIGHT_API_TENANT_API_KEY=<secret>

The Authorization header accepts Bearer <key>; runtime authentication failures become 401. Evidence: H:/hindsight/hindsight-docs/docs/developer/configuration.md:1115-1137, H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:3924-4012, and H:/hindsight/hindsight-api-slim/hindsight_api/extensions/builtin/tenant.py:8-90.

The TypeScript and Python clients can send bearer credentials. Evidence: H:/hindsight/hindsight-clients/typescript/src/index.ts:82-97, H:/hindsight/hindsight-clients/typescript/src/index.ts:151-168, and H:/hindsight/hindsight-clients/python/hindsight_client/hindsight_client.py:152-189.

Taki must not infer authentication from OpenAPI because the generated document has no security scheme. The provider adapter needs explicit authenticated-success, missing-key, wrong-key, and key-rotation tests. Secrets belong in Taki's provider-neutral secret backend or deployment environment, never ordinary config rows, protocol responses, logs, memory, or UI caches.

### Model configuration boundary

Hindsight exposes global defaults and operation-specific retain, reflect, and consolidation LLM overrides, plus separate embeddings and reranker configuration. Recall itself does not call an LLM. Evidence: H:/hindsight/hindsight-docs/docs/developer/configuration.md:169-205, H:/hindsight/hindsight-docs/docs/developer/configuration.md:477-521, H:/hindsight/hindsight-docs/docs/developer/configuration.md:574-600, and H:/hindsight/hindsight-docs/docs/developer/configuration.md:884-905.

The executable per-bank allowlist contains safe behavioral fields but deliberately excludes credentials, infrastructure, provider/model selection, and most performance tuning. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/config.py:2569-2684.

The configuration documentation explicitly classifies llm_provider and llm_model as static server-level fields because presets are not implemented. Evidence: H:/hindsight/hindsight-docs/docs/developer/configuration.md:2112-2135.

This overrides misleading examples and route prose that show llm_model inside BankConfigUpdate. Taki's progressive setup must configure the default and advanced retain/reflect/consolidation/embedding/reranker choices at deployment level. Per-bank APIs remain appropriate for missions, labels, retrieval behavior, consolidation behavior, disposition, MCP allowlists, and audit toggles. Bank config endpoints are GET/PATCH/DELETE and may be feature-gated. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:1432-1450 and H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:7230-7329.

### MCP and SDK boundary

Current source registers retain, sync_retain, recall, reflect, bank management, mental-model management, directive management, memory read/update/invalidate, document management, operations, tags, and destructive administration tools. Tool metadata distinguishes read-only/destructive/idempotent behavior. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/mcp_tools.py:32-69 and H:/hindsight/hindsight-api-slim/hindsight_api/mcp_tools.py:203-352.

Transport defaults differ from REST:

- MCP retain defaults to asynchronous processing.
- MCP recall defaults to high budget, while REST recall defaults to mid.
- MCP reflect defaults to low budget and compact output choices.

Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/mcp_tools.py:601-713, H:/hindsight/hindsight-api-slim/hindsight_api/mcp_tools.py:834-995, and H:/hindsight/hindsight-api-slim/hindsight_api/mcp_tools.py:1009-1180.

HTTP MCP supports /mcp for multi-bank tools and /mcp/{bank_id}/ for a bank-scoped surface, with URL bank identity taking precedence over the header/default. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/mcp.py:303-341 and H:/hindsight/hindsight-api-slim/hindsight_api/api/mcp.py:408-485.

The current documentation's MCP tool list omits source-present tools such as sync_retain, update_memory, invalidate_memory, and clear_mental_model. Evidence: H:/hindsight/hindsight-docs/docs/developer/configuration.md:1764-1810 versus H:/hindsight/hindsight-api-slim/hindsight_api/mcp_tools.py:244-352.

The high-level Python client exposes low-level API accessors, and the TypeScript package re-exports the generated SDK namespace. Record curation is available in the generated TypeScript SDK but is not surfaced as a first-class high-level convenience method. Evidence: H:/hindsight/hindsight-clients/python/hindsight_client/hindsight_client.py:191-249, H:/hindsight/hindsight-clients/typescript/src/index.ts:1413-1460, and H:/hindsight/hindsight-clients/typescript/generated/sdk.gen.ts:381-388.

Taki should therefore implement one canonical Memory Tool Contract in Core and delegate through a REST-backed provider adapter. Native Hindsight MCP tools must not be simultaneously advertised, matching the PRD's no-duplicate-tool-suite rule.

### Health and asynchronous operations

GET /health is a database readiness endpoint: healthy returns 200; unhealthy returns 503. The payload includes database status, acquisition timing, and pool details or an error reason. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4014-4030 and H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:3629-3661.

GET /version returns the running package version and feature flags. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4032-4070.

POST /v1/default/banks/{bank_id}/health/llm makes real retain/consolidation/reflect provider probes and returns status without provider/model/key/error detail. It is disabled unless HINDSIGHT_API_ENABLE_BANK_LLM_HEALTH=true. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:1981-2023, H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4840-4877, and H:/hindsight/hindsight-docs/docs/developer/configuration.md:2130-2136.

Operations expose task type, timestamps, status, retries, next retry, coarse progress, optional child operations, and unstable result_metadata. Listing is offset-paginated and newest-first; individual jobs can be polled, cancelled, retried, or deleted. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:3088-3332 and H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:6364-6559.

Operations are job-control records, not a complete logical mutation stream. result_metadata is explicitly internal and may change without notice.

### Deployment contract

Hindsight supports Linux, macOS, and Windows. It requires PostgreSQL 14+ with a supported vector extension. Embedded pg0 is supported for development but is not recommended for production; production should use external PostgreSQL. Evidence: H:/hindsight/hindsight-docs/docs/developer/installation.md:9-45.

The single-container Docker quick start exposes API port 8888 and Control Plane port 9999 and persists pg0 under /home/hindsight/.pg0. A stable HINDSIGHT_API_WORKER_ID is recommended so interrupted work can be recovered after restart. Evidence: H:/hindsight/hindsight-docs/docs/developer/installation.md:71-100.

Bare-metal development data is stored under ~/.hindsight/data/. Native Windows with embedded pg0 or external PostgreSQL is supported. Evidence: H:/hindsight/hindsight-docs/docs/developer/installation.md:194-240 and H:/hindsight/hindsight-docs/docs/developer/installation.md:278-332.

The Helm chart declares chart/app version 0.9.0, exposes the API on 8888, probes /health, supports separate workers, and defaults to an in-chart PostgreSQL option with persistence. Evidence: H:/hindsight/helm/hindsight/Chart.yaml:1-6 and H:/hindsight/helm/hindsight/values.yaml:16-56, H:/hindsight/helm/hindsight/values.yaml:110-150, H:/hindsight/helm/hindsight/values.yaml:260-298.

Deployment rules for Taki:

1. Never deploy mutable latest as the compatibility identity; verify and pin a 0.9.0 image digest or immutable release tag.
2. Pin the PostgreSQL/vector image too; the chart default currently uses a mutable latest tag.
3. Add API-key auth explicitly because quick-start examples do not enable it.
4. Persist database storage, assign a stable worker identity, and define backup/restore before migration.
5. Prefer external PostgreSQL for supported production deployments; classify pg0 as local/development.
6. Keep Docker, process, filesystem, service, and upgrade actions outside packages/core. Core owns authenticated connection, health, compatibility, migration, and memory semantics.
7. Preserve existing self-hosted connection as a first-class path when managed provisioning is unavailable.

### Replication and stale-mutation gap

The following public surfaces were evaluated and rejected as a correctness source for incremental replication:

- Audit: entries have UUID identity and timestamps, can be disabled, are written fire-and-forget, and list through filters plus offset pagination. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/engine/audit.py:28-130, H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:8072-8113, and H:/hindsight/hindsight-docs/docs/developer/configuration.md:1913-1927.
- Webhooks: event types are limited to retain.completed, consolidation.completed, and memory_defense.triggered. They omit edit, invalidate, restore, bank, template, directive, and mental-model mutations. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/webhooks/models.py:9-82.
- Operations: they track asynchronous jobs, may be pruned, use offset listing, and are not emitted for every logical mutation. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:3110-3332 and H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:6364-6559.
- Memory/document lists: they use offset pagination and recency ordering and expose no monotonic cursor or typed revision contract. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:1541-1568, H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:1615-1715, H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4130-4202, and H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:5985-6037.
- Observation history: the public history route is observation-specific, not a bank-wide mutation journal. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4370-4401.
- Document transfer: it is a full logical archive operation, not incremental; import intentionally re-embeds/re-resolves and excludes database IDs. Evidence: H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:6976-7092.

No public change feed, revision, sync cursor, updated-since contract, monotonic sequence, ETag, If-Match, or expected-revision mutation parameter was found in the 0.9.0 OpenAPI/source search.

Minimum required additive extension:

1. A per-bank lineage identifier and monotonic sequence cursor.
2. A paginated changes-after endpoint that returns ordered upserts and tombstones for all recall-relevant logical entities.
3. Every change carries entity kind, stable ID, authoritative revision, operation, event time, and public logical payload or tombstone.
4. Batch response carries from cursor, next cursor, has_more, and an explicit cursor-expired error.
5. Mutations accept an idempotency key and expected revision, returning applied, already-applied, conflict/superseded, or not-found.
6. Change retention and full-reconciliation behavior are versioned and contract-tested.

Without this extension, Taki can perform periodic full logical reconciliation and detect drift, but it cannot meet R5's lossless checkpointed incremental synchronization or R6's safe stale pending-mutation supersession.

### Drift-prone assumptions requiring contract tests

- OpenAPI omits runtime authentication requirements.
- BankConfig examples mention llm_model even though executable safe-field policy and docs classify provider/model as static.
- MCP documentation omits tools present in source.
- Docker documentation promotes mutable latest and includes older specific-version examples.
- Several endpoints are feature-gated: bank config, document transfer, dry-run extraction, and LLM health.
- REST and MCP defaults differ.
- Convenience SDKs do not expose the full mutation/admin surface uniformly.
- Async result_metadata is explicitly unstable and must not become canonical state.
- Retain completion and derived consolidation completion are distinct operational concerns; cutover tests must prove the chosen completion predicate.

### Files found

| File | Description |
| --- | --- |
| H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py | Authoritative REST schemas, routes, validation, health, operations, templates, and curation |
| H:/hindsight/skills/hindsight-docs/references/openapi.json | Generated OpenAPI 3.1 contract for version 0.9.0 |
| H:/hindsight/hindsight-api-slim/hindsight_api/mcp_tools.py | Current MCP tool registry, defaults, annotations, and memory mutation tools |
| H:/hindsight/hindsight-api-slim/hindsight_api/api/mcp.py | HTTP MCP routing, bank scoping, and auth propagation |
| H:/hindsight/hindsight-api-slim/hindsight_api/config.py | Executable classification of credential, static, and per-bank configurable fields |
| H:/hindsight/hindsight-api-slim/hindsight_api/extensions/builtin/tenant.py | Built-in shared API-key tenant authentication |
| H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/entity_labels.py | Entity label schema and legacy migration |
| H:/hindsight/hindsight-api-slim/hindsight_api/engine/audit.py | Audit record shape and fire-and-forget behavior |
| H:/hindsight/hindsight-api-slim/hindsight_api/webhooks/models.py | Complete public webhook event-type set |
| H:/hindsight/hindsight-clients/python/hindsight_client/hindsight_client.py | Python high-level client authentication and low-level accessors |
| H:/hindsight/hindsight-clients/typescript/src/index.ts | TypeScript high-level client and generated SDK export |
| H:/hindsight/hindsight-clients/typescript/generated/sdk.gen.ts | Generated low-level TypeScript endpoints including updateMemory |
| H:/hindsight/hindsight-docs/docs/developer/configuration.md | Auth, model, MCP, audit, webhook, and hierarchical configuration documentation |
| H:/hindsight/hindsight-docs/docs/developer/installation.md | Platform, Docker, pg0, PostgreSQL, bare-metal, and Windows deployment guidance |
| H:/hindsight/hindsight-docs/docs/developer/api/bank-templates.mdx | Template compatibility and manifest behavior |
| H:/hindsight/hindsight-docs/docs/developer/api/memory-banks.mdx | Missions and controlled entity-label behavior |
| H:/hindsight/helm/hindsight/Chart.yaml | Current Helm chart and app version |
| H:/hindsight/helm/hindsight/values.yaml | API/worker/database services, persistence, and probes |

### External references and version identifiers

- Hindsight HTTP API: OpenAPI 3.1.0, API/package version 0.9.0.
- Python client: 0.9.0.
- TypeScript client: 0.9.0.
- Helm chart/appVersion: 0.9.0.
- Container registry documented by upstream: ghcr.io/vectorize-io/hindsight and related API/control-plane variants.
- Supported database baseline: PostgreSQL 14+ with a supported vector extension.
- Bank template manifest schema: version 1.

### Related Taki specs

- H:/TakiAgent/.trellis/tasks/08-09-hindsight-memory-provider/prd.md:55-83 — public Hindsight boundary, migration, monotonic synchronization, degraded outbox, and stale-revision requirements.
- H:/TakiAgent/.trellis/tasks/08-09-hindsight-memory-provider/prd.md:99-112 — setup, auth, secret, deployment-helper, and Core process-management boundaries.
- H:/TakiAgent/.trellis/tasks/08-09-hindsight-memory-provider/info.md — provider interfaces, canonical records, authority state, migration, replica, and recovery design.
- H:/TakiAgent/.trellis/spec/backend/agent-runtime.md — volatile memory injection, tool truthfulness, and agent tool-loop constraints.
- H:/TakiAgent/.trellis/spec/backend/tool-design.md — canonical tool ownership and tool-surface discipline.
- H:/TakiAgent/.trellis/spec/backend/mcp-tool-schema-compatibility.md — MCP schema compatibility constraints.
- H:/TakiAgent/.trellis/spec/backend/config-store.md — non-secret configuration boundary.
- H:/TakiAgent/.trellis/spec/backend/permission-authorization.md — operator authorization boundary.
- H:/TakiAgent/.trellis/spec/backend/database-guidelines.md — durable schema, transaction, and migration expectations.
- H:/TakiAgent/.trellis/spec/backend/error-handling.md — structured error and retry behavior.
- H:/TakiAgent/.trellis/spec/guides/source-grounding-guide.md — evidence/source authority discipline.
- H:/TakiAgent/.trellis/spec/guides/cross-layer-thinking-guide.md — cross-layer contract verification.

## Caveats / Not Found

- No live Hindsight server was started, so this is source/OpenAPI/documentation contract research rather than runtime interoperability testing.
- No container image digest or remote registry availability was verified. Taki must verify an immutable 0.9.0 image before declaring managed deployment support.
- No public monotonic change feed or record-level optimistic-concurrency contract was found. This is the critical blocker.
- No single retain response returns the extracted one-to-many fact IDs; a deterministic document query is required after completion.
- No single public receipt was found that atomically proves both retain extraction and all derived consolidation are complete; the cutover completion predicate needs an integration test.
- The OpenAPI security declaration, bank-config examples, MCP documentation, and mutable deployment examples contain drift risks described above.
- H:/TakiAgent/.trellis/.current-task points to another in-progress task. This research was explicitly assigned to H:/TakiAgent/.trellis/tasks/08-09-hindsight-memory-provider/research/ and did not modify task binding or any file outside that research directory.
