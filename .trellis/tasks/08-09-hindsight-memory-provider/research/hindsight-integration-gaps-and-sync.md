# Research: Hindsight Integration Gaps and Synchronization

- Query: Which Hindsight 0.9.0 capabilities can TakiAgent use directly, which responsibilities belong in the Taki adapter, and which missing contracts require a minimal Hindsight patch for deterministic migration, replica synchronization, degraded writes, recovery, deployment, and secret safety?
- Scope: mixed
- Date: 2026-08-09

## Findings

### Decision summary

Hindsight 0.9.0 is suitable as Taki's semantic Memory Authority, but its public API is not currently a replication protocol. Taki can use Hindsight's retain/recall/reflect, extracted facts, observations, mental models, directives, lifecycle mutation, bank configuration, templates, deterministic document identity, and asynchronous operation idempotency directly. Taki must still own all Companion-specific policy and all authority/replica state.

The current Taki design cannot safely cut over to Hindsight using only an adapter. A small Hindsight extension series is required before Hindsight can be an authoritative source with a local logical replica. The minimum contract is:

1. additive observation instructions instead of replacement-only `observations_mission`;
2. a monotonic logical change journal with tombstones for every recall-relevant write source;
3. per-memory revisions and `expected_revision` conditional mutation;
4. a consistent logical snapshot/manifest bound to a journal cursor;
5. `/version` feature and extension-contract version reporting;
6. per-fact tag mutation, or equivalent automatic re-derivation of `tag=true` label tags, when a fact's entities are reclassified.

Without items 2-4, Taki cannot prove that a replica checkpoint is complete, distinguish a stale degraded mutation from a compatible one, or reconcile a snapshot with concurrent writes. Without item 6, changing a `taki-layer:*` entity can leave its recall-filter tag stale.

### Capability ownership matrix

| Classification | Capability / responsibility | Decision |
|---|---|---|
| Native Hindsight | One Bank retain, recall, and reflect | Use public HTTP/SDK contracts. Taki fans out Global + active Character queries itself. |
| Native Hindsight | One-to-many fact extraction, embeddings, graph links, deduplication, observations, mental models, directives, consolidation | Delegate generic semantic maintenance to Hindsight. Do not reproduce it in Taki. |
| Native Hindsight | Deterministic `document_id` and client `operation_id` idempotency | Use both for migration and pending-retain replay. |
| Native Hindsight | Reversible edit, invalidate, and restore of individual facts | Use through the provider adapter, subject to revision preconditions added by the patch. |
| Native Hindsight | Bank configuration and bank-template import/export | Use as the substrate; Taki owns overlay precedence and versioning. |
| Native Hindsight | Controlled entity labels, required enum labels, and `tag=true` label-to-tag injection | Use for initial extraction of `taki-layer:*`. Patch or redesign post-retain reclassification so entity and tag never diverge. |
| Native Hindsight | Database backup/restore, logical bank export/import, migrations, and repair commands | Use only in operator-controlled setup/upgrade workflows. Database backup is rollback protection; bank export is not a stable-ID replica feed. |
| Taki adapter | Canonical Memory Record and Hindsight-to-local logical mapping | Taki-owned provider-neutral domain. Never mirror Hindsight's private PostgreSQL schema. |
| Taki adapter | Global Bank / Character Bank routing and `keep | skip` Write Gate | Companion policy remains in Core. Submit the original sanitized source span to Hindsight. |
| Taki adapter | Migration normalization and durable Migration Ledger | Map each legacy source to deterministic document/operation IDs, then to the resulting fact IDs. |
| Taki adapter | Structured Local Provider, BM25/FTS5 retrieval, optional vectors | Required for Local authority and Hindsight degraded recall. |
| Taki adapter | Replica database, transactional batch apply, checkpoint, full reconciliation | Consume the patched journal/snapshot contracts; advance a checkpoint only after the local transaction commits. |
| Taki adapter | Durable Pending Memory outbox and recovery orchestration | Pull remote, replay compatible pending operations, wait for derived work, pull again. Never auto-promote Local. |
| Taki adapter | Automatic recall projection, budget, deduplication, visibility filtering, and feedback-loop prevention | Inject into volatile turn context; never retain injected recall again. |
| Taki adapter | Authority Epoch and Local/Hindsight cutover or takeover state machine | Persist explicit authority. Emergency Local takeover is a separate confirmed operation. |
| Taki adapter | Taki Bank Template additive overlay and user-override precedence | Taki owns template identity, version, merge rules, and drift reporting. |
| Taki adapter | Provider-neutral secret references and setup/status RPCs | Secret values must not enter ordinary config, logs, memory, UI cache, or general protocol responses. |
| Minimal Hindsight patch | Additive observation-instruction seam | Preserve Hindsight's native mission and append Taki policy instructions. |
| Minimal Hindsight patch | Logical change journal/cursor with tombstones | Required for lossless incremental replication. Offset pagination is insufficient. |
| Minimal Hindsight patch | Revision + `expected_revision` mutation | Required to classify degraded mutations as replayable or superseded. |
| Minimal Hindsight patch | Cursor-bound consistent logical snapshot and integrity manifest | Required for initial replica construction, cursor recovery, and full reconciliation. |
| Minimal Hindsight patch | Extension capability/version advertisement | Required to reject an apparently healthy but contract-incompatible server before cutover. |
| Minimal Hindsight patch | Per-fact tag update or label-tag re-derivation during entity edits | Required by the current layer-as-entity-plus-tag projection. |
| Not proven / unavailable | Stable public change cursor, tombstone feed, snapshot cursor, or conditional memory mutation | No such contract was found in the evaluated 0.9.0 API/source. |
| Not proven / unavailable | Retain receipt containing the one-to-many resulting fact IDs | The receipt reports counts/operation IDs, not fact IDs. Taki must query by deterministic `document_id` after completion. |
| Not proven / unavailable | Transfer archive preserving fact database IDs | The transfer schema explicitly treats memory-unit IDs as non-preserved. |
| Not proven / unavailable | Authentication enabled by default on every self-hosted deployment | A Bearer-key tenant extension exists, but deployment must explicitly enable and verify it. |

### Native contracts that are usable now

#### Retain identity and idempotency

- Each retain item accepts a caller-selected `document_id`; items with the same value are grouped as one document (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:608-649`). Taki should derive it from canonical bank + source identity, not random runtime state.
- Asynchronous retain accepts a caller UUID `operation_id`. Re-submission returns the original operation and creates no duplicate work; reuse for another operation returns HTTP 409 (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:723-771`). This is suitable for pending-retain replay.
- `RetainResponse` returns `items_count`, `operation_id`/`operation_ids`, and usage, but not the extracted fact IDs (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:841-874`). Since one input may produce multiple facts, the Migration Ledger must resolve the completed operation's deterministic `document_id` through the document/memory list APIs and record all resulting logical IDs.
- Recall results expose public logical fields such as fact ID, text, type, entities, context, dates, `document_id`, metadata, chunk ID, tags, and source fact IDs (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:371-406`). These are a useful basis for the Canonical Memory Record, but list/snapshot completeness still needs the patch described below.

#### Entity labels and Taki layers

- Entity-label groups support controlled values, `optional`, and `tag` flags (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/entity_labels.py:33-42`). Enum label groups with `optional=false` become required structured extraction fields (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/entity_labels.py:172-228`).
- At retain time, every label group with `tag=true` copies matching `key:value` entities into the fact's tag list (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/fact_extraction.py:2753-2771`). This can produce `taki-layer:<value>` as both a controlled entity and a recall-filter tag.
- The single-memory PATCH accepts text, context, dates, fact type, entities, lifecycle state, and reason, but has neither `tags` nor `expected_revision` (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:1743-1819`). The endpoint forwards only those fields (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4312-4353`).
- Entity edits re-run entity resolution using the bank taxonomy and replace `unit_entities`, but the edit path does not call retain-time `_inject_label_tags` or update the fact's tags (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:7729-7734`, `H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:7784-7822`, `H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:7933-8008`). Therefore a layer reclassification can leave an old `taki-layer:*` tag attached while the entity has changed.

Decision: extend the memory PATCH with an explicit tag update and preferably a server-side rule that re-derives `tag=true` label tags atomically with entity edits. If Taki declines this patch, it must not use those tags for authoritative layer filtering after edits; that would contradict the current projection design.

#### Lifecycle and derived maintenance

- Hindsight's edit path re-embeds a corrected fact, drops stale derived observations/links, and schedules consolidation/graph work. Invalidation moves a fact to an archive and restore moves it back (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:7630-7683`). This matches Taki's individual edit/invalidate/restore requirements.
- These operations are still insufficient for degraded replay because they have no public revision precondition. A local pending edit cannot safely distinguish "the target is unchanged" from "Hindsight changed it while offline."

#### Templates and observation policy

- Hindsight exposes bank-template import/export endpoints and carries mental models/directives in the template surface (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:6827-7100`). Taki can implement versioned additive overlays by rendering its desired overlay onto this native surface and keeping user overrides as a separate, higher-precedence layer.
- Current `observations_mission` behavior selects the custom mission instead of appending it to the default mission (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/consolidation/prompts.py:193-212`). Replacing the full native mission makes Taki responsible for copying upstream prompt behavior and creates patch drift. The extension should accept additive instructions that are appended in a clearly fenced section while leaving the upstream mission intact.

### Synchronization correctness gaps

#### Offset listing is not replication

The memory list path is offset/limit based (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memories/pg/curation.py:81-98`). Its public row projection does not provide a complete, stable replication envelope for every object and mutation; the response assembly is an ordinary table/list representation (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memories/pg/curation.py:239-310`). Concurrent inserts, edits, invalidations, restores, and derived writes can move rows across pages or mutate previously consumed rows. Deletion/invalidation also needs a durable tombstone rather than disappearance from a later page.

The patch should provide an append-only logical journal with at least:

- a server-issued monotonic sequence/cursor, scoped explicitly per Bank or globally;
- Bank ID, object kind, stable logical object ID, object revision, operation kind, and commit time;
- create/update/invalidate/restore/delete tombstones;
- source operation/document identity where applicable;
- coverage for retain and delta-retain output, single-memory curation, document tag/update/delete paths, consolidation-produced observations, mental models/directives, and any other state included in the replica/manifest;
- transaction ordering: publish the journal record in the same authoritative transaction as the logical mutation;
- a defined cursor-expiry response that forces a full snapshot/reconciliation rather than silent continuation.

Taki should consume batches transactionally. The local replica transaction writes canonical objects and tombstones, updates indexes/projections, and advances the checkpoint last. A failed batch leaves the previous checkpoint intact.

#### Revisions and stale degraded mutations

Each mutable logical fact needs a monotonically increasing revision returned by get/list/journal/snapshot. Mutation requests need `expected_revision`. On mismatch Hindsight must return a typed precondition failure carrying the current revision, without applying the change.

This enables the approved recovery rule:

1. pull remote changes to the latest checkpoint;
2. replay pending retains idempotently by `operation_id`;
3. replay a pending mutation only when its recorded target revision still matches;
4. mark a mismatch `superseded`, retain its audit record, and continue unrelated work;
5. wait for Hindsight derived operations to complete;
6. pull again to capture the authoritative derived results.

Timestamp comparison or last-write-wins in Taki is not an acceptable substitute. Hindsight's authoritative revision wins; Taki never force-merges a stale mutation.

#### Cursor-bound snapshot and reconciliation

Initial cutover and cursor recovery require a logical snapshot with a defined consistency point. The response or archive must include an `end_cursor` captured from the same logical view plus an integrity manifest. The manifest should include Bank identity/config/template contract versions, counts by object kind/state, and deterministic hashes over canonical records or pages.

Required flow:

1. begin/capture logical snapshot at cursor C;
2. stream all included canonical objects and tombstone-relevant state consistently;
3. build the local replica in a staging epoch;
4. validate counts/hashes and all one-to-many document/fact mappings;
5. atomically publish the replica and checkpoint C;
6. consume journal entries after C.

Hindsight's transfer archive is not this contract. Its schema explicitly does not preserve fact database IDs (`H:/hindsight/hindsight-api-slim/hindsight_api/engine/transfer/schema.py:41-66`), so it is useful for portable logical import/export, not stable-identity replication or cursor recovery.

#### Extension/version handshake

The evaluated service reports Hindsight package version 0.9.0 (`H:/hindsight/hindsight-api-slim/pyproject.toml:7`, `H:/hindsight/hindsight-api-slim/hindsight_api/__init__.py:56`) and `/version` reports API version/features (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:4051-4058`). Taki needs the endpoint to advertise the replication extension independently, for example:

```json
{
  "api_version": "0.9.0",
  "extensions": {
    "taki_replication": "1",
    "change_journal": "1",
    "conditional_memory_mutation": "1",
    "logical_snapshot": "1",
    "additive_observation_instructions": "1"
  }
}
```

Health alone must never authorize cutover. Setup verifies API authentication, exact supported base version, all required extension versions, Bank/template compatibility, and a small behavioral contract suite.

### Taki adapter responsibilities

#### Canonical records and migration ledger

The Canonical Memory Record should align with Hindsight's public logical model while adding Taki-owned fields that Hindsight does not own: provider/Bank reference, Global/Character ownership, layer policy, visibility/retention projection, authority epoch, replica revision/checkpoint metadata, provenance, confirmation state, and pending-operation linkage.

Migration should be deterministic and idempotent:

- normalize each supported Markdown/frontmatter source before any authority mutation;
- derive stable Bank ID, `document_id`, and retain `operation_id` from source identity and normalized content/version;
- submit the original safe source span, allowing Hindsight to extract one-to-many facts;
- wait for asynchronous completion and query the deterministic document;
- persist source -> operation -> document -> all fact IDs/revisions in a Migration Ledger;
- treat a well-formed supported source that cannot convert or map as a cutover-blocking implementation defect;
- never use transfer-generated fact IDs as a substitute for the Ledger.

#### Authority and degraded-state machines

Taki persists one explicit Authority Epoch. Local is authoritative while Hindsight is disabled. Hindsight becomes authoritative only after authenticated compatibility checks, deterministic import, derived completion, replica snapshot, integrity verification, and zero unresolved migration failures.

An outage changes availability, not authority:

- reads use the last verified local replica;
- new retains and mutations enter the durable Pending Memory outbox;
- optional degraded recall may include pending content only when clearly marked unconfirmed;
- Local is not automatically promoted and must not generate competing authoritative revisions;
- a planned switch back to Local requires final incremental pull, full reconciliation, zero pending operations, a short write fence, and a new Authority Epoch;
- permanent Hindsight loss requires separately confirmed Emergency Local Takeover.

#### Recall and feedback-loop filter

The existing Taki seams support the target design:

- `createMemorySubsystem` composes the shipped memory engine, auto-memory, utility, tidy, and write path (`packages/core/src/memory/bootstrap.ts:65-121`).
- `createMemoryEngine` is the persistence/retrieval/tool composition surface (`packages/core/src/memory/memory-engine.ts:82-108`).
- `createAutoMemory` already detaches post-turn ingestion from foreground latency (`packages/core/src/memory/auto-memory.ts:73`).
- Chat already appends a volatile `<turn-context>` suffix and triggers detached auto-memory (`packages/core/src/agents/chat-agent.ts:191-253`, `packages/core/src/agents/chat-agent.ts:312-339`). Automatic Memory Recall should use this volatile suffix, not stable system instructions.
- Shared protocol already has `memory.status` as an operator-owned status seam (`packages/shared/src/memory-schema.ts:11`).

The projector must remove system instructions, hidden prompts, recalled-memory fences, and unsafe/secret tool payloads before retain. Recalled results must carry an internal origin marker and be excluded from persistence, compaction source text, Write Gate input, and later Retain calls.

### Deployment and secret boundary

Hindsight officially supports Docker, Helm/Kubernetes, bare-metal pip, native Windows, a standalone npm Control Plane, and embedded Python modes (`H:/hindsight/hindsight-docs/docs/developer/installation.md:9-20`, `H:/hindsight/hindsight-docs/docs/developer/installation.md:71-110`, `H:/hindsight/hindsight-docs/docs/developer/installation.md:147-190`, `H:/hindsight/hindsight-docs/docs/developer/installation.md:194-251`, `H:/hindsight/hindsight-docs/docs/developer/installation.md:278-332`). Docker persistence is under `/home/hindsight/.pg0` via a named volume in the documented single-container setup (`H:/hindsight/hindsight-docs/docs/developer/installation.md:75-92`).

Taki's managed-local workflow must remain outside Agent Core:

- Core is OS-neutral and cannot directly install packages, run Docker, create services, choose filesystem paths, or manipulate Windows credentials (`CONTEXT.md:38-43`; `docs/HANDOFF.md:134-141`).
- Shell or a dedicated operator deployment helper owns process/service lifecycle, filesystem/volume selection, prerequisite checks, install/upgrade/rollback commands, and permission prompts.
- Core owns only the authenticated endpoint connection, provider contract handshake, Bank/template setup, migration, replica synchronization, and authority state machine.
- Connecting an already-running self-hosted instance remains fully supported when managed provisioning is unavailable.

Authentication must be mandatory even on loopback. Hindsight contains an `ApiKeyTenantExtension` that parses and validates Bearer credentials (`H:/hindsight/hindsight-api-slim/hindsight_api/extensions/builtin/tenant.py:44-74`), but Taki setup must explicitly enable it and fail health/compatibility checks when an unauthenticated request succeeds.

Taki currently lacks the general secret path needed for this integration:

- Core model-provider configuration reads the API key from process environment (`packages/core/src/config/provider-config.ts:2-17`).
- Ordinary config persistence explicitly refuses secret writes (`packages/core/src/config/config-writer.ts:38-43`).
- Desktop already has a Windows keyring abstraction, but its documented current keys are node token and device ID (`apps/desktop/src-tauri/src/secrets.rs:10-18`, `apps/desktop/src-tauri/src/secrets.rs:20-56`).

Therefore implementation needs a provider-neutral secret resolver with operator-only set/clear/presence operations. It must never return secret values to Pet/Home/CLI protocol clients. A Windows implementation belongs in Shell/Credential Manager; a headless implementation may resolve an environment override or an explicitly supported headless secret backend. Core consumes an injected secret reference/resolver and remains unaware of OS-specific storage.

Hindsight's own LLM, embedding, reranker, and database credentials belong to the Hindsight deployment environment/secret manager. They must not be copied into Taki's ordinary configuration database. The Hindsight connection API key used by Core follows the Taki provider-secret path above.

### Backup and upgrade implications

Hindsight's `hindsight-admin` talks directly to PostgreSQL, not the HTTP API, and must run with database access on the deployment host/container (`H:/hindsight/hindsight-docs/docs/developer/admin-cli.md:3-32`). It provides:

- full database/schema `backup` and destructive `restore` commands (`H:/hindsight/hindsight-api-slim/hindsight_api/admin/cli.py:396-467`);
- `run-db-migration` plus post-upgrade repair support (`H:/hindsight/hindsight-api-slim/hindsight_api/admin/cli.py:476-600`, `H:/hindsight/hindsight-docs/docs/developer/admin-cli.md:39-104`);
- logical `export-bank` / `import-bank` (`H:/hindsight/hindsight-api-slim/hindsight_api/admin/cli.py:731-844`).

The full backup includes logical and operational tables, so it is the appropriate rollback artifact before an in-place upgrade (`H:/hindsight/hindsight-docs/docs/developer/admin-cli.md:109-149`). Because restore directly rewrites database state, only the operator deployment helper may invoke it, after explicit confirmation and while the authority is fenced.

The bundled upgrade runner is useful but not sufficient for Taki. It executes the `hindsight-dev/upgrade_tests` suite (`H:/hindsight/scripts/run-upgrade-tests.sh:1-31`), while the current path list covers only `v0.3.0 -> HEAD` and basic memory/document/profile preservation (`H:/hindsight/hindsight-dev/upgrade_tests/test_upgrade.py:1-15`). It does not prove Taki's patch contract, journal continuity, revisions, tombstones, snapshot consistency, layer tag behavior, secret enforcement, or pending replay.

Required Taki staged-upgrade gate:

1. fence new authority writes and drain/record current checkpoints;
2. create and verify a full database backup;
3. restore/copy into a staging instance and apply migrations/upgrade;
4. run Hindsight's native upgrade suite where applicable;
5. run Taki's version/extension, auth, retain mapping, change journal, snapshot, revision, tag-reclassification, and recovery contract tests;
6. run `repair-bank` where the deployment path requires it;
7. build/reconcile a staging local replica and compare manifests;
8. promote only after all gates pass; otherwise restore/retain the previous deployment and authority epoch.

### Required compatibility and failure-path tests

| Test | Required proof |
|---|---|
| Version handshake | Unsupported base or extension version is rejected before migration/cutover. |
| Authentication | Missing/wrong Bearer key fails, including loopback; no secret value is echoed or logged. |
| Retain retry | Lost acknowledgement followed by the same `operation_id` creates no duplicate work. |
| One-to-many ledger | Deterministic document lookup records every fact ID/revision after derived work completes. |
| Journal ordering | All mutation sources, derived writes, invalidations/restores, and deletions appear exactly once in cursor order. |
| Transactional checkpoint | Crash during local batch apply leaves the previous checkpoint and no partially visible replica batch. |
| Cursor expiry | Server returns a typed reset requirement; Taki performs a cursor-bound full snapshot. |
| Snapshot race | Writes concurrent with snapshot appear either in the snapshot or strictly after its `end_cursor`, never neither/both inconsistently. |
| Conditional mutation | Matching revision applies; stale revision returns typed precondition failure and pending item becomes `superseded`. |
| Layer reclassification | Changing `taki-layer:*` updates both entity and recall-filter tag atomically. |
| Degraded writes | Recall uses last verified replica; retains/mutations persist to outbox across restart. |
| Recovery sequence | Remote pull -> compatible replay -> derived completion -> second pull produces identical replica/manifest. |
| Feedback prevention | Injected recall is absent from Write Gate and retain payloads. |
| Planned switch-back | Final sync + full reconcile + zero pending + write fence + new epoch are all mandatory. |
| Upgrade rollback | Backup/restore and old-version restart remain possible after a failed staged upgrade. |

### Files found

#### TakiAgent

- `.trellis/tasks/08-09-hindsight-memory-provider/prd.md` — approved provider, authority, migration, synchronization, degraded-operation, setup, and secret requirements.
- `.trellis/tasks/08-09-hindsight-memory-provider/info.md` — pre-implementation component model and state-machine design.
- `CONTEXT.md` — canonical domain language and Core/Shell ownership boundary.
- `docs/HANDOFF.md` — live architecture invariants and current project status.
- `docs/MEMORY-DESIGN.md` — shipped and target memory behavior.
- `docs/adr/0009-single-memory-authority-with-local-replica.md` — binding authority/replica decision.
- `packages/core/src/memory/bootstrap.ts` — memory composition root.
- `packages/core/src/memory/memory-engine.ts` — current persistence/retrieval/tool facade.
- `packages/core/src/memory/auto-memory.ts` — detached post-turn memory ingestion.
- `packages/core/src/agents/chat-agent.ts` — model request assembly and volatile turn-context seam.
- `packages/shared/src/memory-schema.ts` — operator memory protocol/status surface.
- `packages/core/src/config/provider-config.ts` — current environment-only model-provider credential load.
- `packages/core/src/config/config-writer.ts` — non-secret config writer and secret rejection.
- `apps/desktop/src-tauri/src/secrets.rs` — existing Windows Credential Manager abstraction with node-scoped keys.

#### Hindsight 0.9.0 checkout

- `H:/hindsight/hindsight-api-slim/pyproject.toml` and `hindsight_api/__init__.py` — evaluated version evidence.
- `H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py` — retain/recall/list/mutation/template/version HTTP contracts.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py` — mutation lifecycle, derived invalidation, entity edit, and list orchestration.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/memories/pg/curation.py` — offset-based memory listing and response projection.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/entity_labels.py` — controlled entity-label taxonomy.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/fact_extraction.py` — retain-time label-to-tag injection.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/consolidation/prompts.py` — replacement-only observation mission behavior.
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/transfer/schema.py` — portable transfer schema and non-preserved fact IDs.
- `H:/hindsight/hindsight-api-slim/hindsight_api/extensions/builtin/tenant.py` — Bearer API-key tenant extension.
- `H:/hindsight/hindsight-api-slim/hindsight_api/admin/cli.py` — migration, backup/restore, repair, and bank transfer administration.
- `H:/hindsight/scripts/run-upgrade-tests.sh` and `hindsight-dev/upgrade_tests/` — current upstream upgrade-test harness and limited path coverage.
- `H:/hindsight/hindsight-docs/docs/developer/installation.md` — supported Docker, Helm, pip, Windows, Control Plane, and embedded deployment modes.
- `H:/hindsight/hindsight-docs/docs/developer/admin-cli.md` — operator requirements and backup/migration/repair semantics.
- `H:/hindsight/hindsight-docs/blog/2026-08-07-version-0-9-0.md` — official 0.9.0 release notes and upgrade recommendation.

### External references and versions

- Evaluated Hindsight package/API source: version `0.9.0` (`H:/hindsight/hindsight-api-slim/pyproject.toml:7`).
- Official local documentation snapshot: `H:/hindsight/hindsight-docs/docs/developer/installation.md` and `developer/admin-cli.md`.
- Hindsight 0.9.0 release note recommends upgrading for reliability/correctness fixes, including connection-pool behavior (`H:/hindsight/hindsight-docs/blog/2026-08-07-version-0-9-0.md:66`).
- No broader supported Taki version range is proven by this research. Start with one pinned Hindsight 0.9.0 build plus the tested Taki patch contract; widen only after running the same compatibility suite against another release.

### Related specs

- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/agent-runtime.md`
- `.trellis/spec/backend/config-store.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/permission-authorization.md`
- `.trellis/spec/backend/tool-design.md`
- `.trellis/spec/guides/source-grounding-guide.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`

These specs reinforce the required boundaries: Core remains OS-neutral, secrets do not use ordinary config, durable data has one Core writer, protocol errors/capabilities are typed, and cross-layer state transitions need end-to-end proof.

## Caveats / Not Found

- `jbcontext status` confirmed the indexed TakiAgent repository before semantic localization. All material conclusions were then grounded by direct reads of the identified files and exact-symbol searches.
- No public Hindsight 0.9.0 endpoint or engine abstraction was found that provides a complete monotonic change journal, deletion tombstones, a cursor-bound consistent logical snapshot, or `expected_revision` conditional memory mutation.
- No native retain receipt containing all extracted fact IDs was found. Post-operation document lookup is required, and the adapter must test that the lookup is complete after derived processing reaches the expected terminal state.
- The ordinary list API is not sufficient for replication and may omit fields needed by a complete Canonical Record. The new snapshot/journal schemas must be specified explicitly rather than inferred from table/list responses.
- Hindsight bank transfer is not a stable identity backup for a live replica because fact database IDs are not preserved. Use full database backup for rollback and a new logical snapshot contract for replication.
- Entity-label `tag=true` injection is retain-time behavior. Current per-memory entity editing does not synchronize tags. This is a confirmed correctness gap for tag-backed Taki layer filtering.
- The evaluated API-key extension proves that Bearer validation exists, not that every documented deployment enables it by default. Setup must behaviorally test authentication.
- Hindsight's admin backup/restore is PostgreSQL-specific and directly mutates the database. Oracle and other backend implications are outside this Taki integration decision unless explicitly added to scope.
- The upstream upgrade suite's current `v0.3.0 -> HEAD` path is not evidence for the Taki-supported 0.9.0 patch series. Taki-specific contract and recovery tests remain mandatory.
- No implementation code, Trellis task binding, spec file, or Git state was changed by this research.
