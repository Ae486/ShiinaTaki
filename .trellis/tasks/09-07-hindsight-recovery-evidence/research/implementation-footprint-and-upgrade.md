# Research: Recovery implementation footprint, contracts and upgrade gates

- Query: What exactly changes in Hindsight/Taki for finite logical recovery and stable append results, and how can the patch be verified and maintained?
- Scope: internal, cross-repository design; proposed changes only.
- Date: 2026-09-07
- Baseline: leader-verified Hindsight `7eca2056dae5d70a682b755abfff8a107f6b08a0`, API package `0.9.0`; preserved Taki Wave 3 working tree. No production dispatch or implementation occurred in this research.

## Findings

### Preferred direction and scale

This is a cross-cutting producer consistency patch, not a few response fields. The preferred design combines:

1. Durable provider-owned request/result receipts and logical-work associations, independent of native operation pruning.
2. Native source-version completion recording; after one root's exact source/survivor set settles, seal its finite native-eligible automatic-MM set. Preserve native source fetch/batching; reuse native scope/staleness/refresh logic. This **changes opt-in automatic-MM trigger timing and potentially call frequency**, not the extraction/consolidation algorithm.
3. Explicitly tracked-only atomic retain publication, preserving native append preparation and delta behavior. Buffer extraction before the authoritative transaction, CAS the producer-read base, and commit full document/facts/journal/result together. Do not reuse present streaming recovery as if it already had durable per-part results.
4. A real Taki producer-evidence adapter that preserves the current local Authority/Bank guards and second-pull fence.

The companions provide the source chain and RED/GREEN cases: `recovery-producer-contract.md` (the decision addendum is the final preferred finite-boundary recommendation) and `append-result-contract.md` (the preferred atomic path supersedes a hook-only/per-part assumption).

**Required feasibility gate before freezing atomic implementation:** prove a tracked full-retain fallback can reuse native chunk extraction, phase-1 resolution and connection-taking storage helpers, publish once, and roll back at every fault point. `_try_delta_retain` already supplies a real single-transaction pattern (`retain/orchestrator.py:2642-2865`); an atomic full fallback is a proposed implementation, not an existing proven mode. Do not infer it from helper signatures alone. Test zero-fact, duplicate-chunk, JSON-array, delta survivor and source-cleanup equivalence against the native path.

Buffering needs an explicit supported envelope. Native `retain_batch_tokens` / `retain_chunk_batch_size` can define a conservative first single-publication envelope, checked against the **prepared combined document** and actual resolved strategy. They are batching thresholds, not measured memory-safety limits: validate that interpretation in the spike. Larger atomic buffering requires measurement or a larger durable-part protocol. Taki's 256 references / 512 KiB wire / 2 MiB state bounds are consumer serialization limits; they must not be repurposed as provider buffering limits. Bounds and excluded native cases must be reported, and bounded support must not be advertised as completion of every large native append case.

### Concrete public contract proposal

These names/routes are proposed additions, not discovered existing endpoints.

- Add optional `recovery: TakiRecoveryOptions` to native `RetainRequest` and conditional mutation request. Fields: `contract_version`, `expected_provider_lineage`, `expected_bank_generation`, and an optional explicit caller result-reference bound. Tracked retain requires `async=true`, the native UUID and the supported one-input request shape. Untracked native behavior is preserved.
- Add `GET /ext/taki-memory/banks/{bank_id}/operation-receipts/{operation_kind}/{operation_id}`, through an authenticated engine method. Query the expected lineage/generation. Return typed `TakiOperationEvidence`; no source preparation/body, credentials, raw worker errors or debug metadata is returned.
- `TakiOperationEvidence`: `schema_version`, `receipt_id`, `operation_kind`, `operation_id`, `bank_id`, `provider_lineage`, `bank_generation`, producer-computed `request_hash`, `native_status`, immutable `native_result`/`native_result_hash` and `native_receipt_hash` when the native result is sealed, `native_through_cursor`, `logical_work_status`, `declaration_sealed`, then immutable `completion_id`/`completion_hash`, `through_cursor` and provider completion timestamp only on proven logical completion, plus a closed diagnostic reason otherwise. Define both hash manifests explicitly; progress updates never change the sealed native receipt hash.
- Retain native result: original input/document identity, update mode, producer base/prepared/result hashes, full result count/reference set/digest, created-count separately, native outcome and commit timestamp. Conditional result reuses its existing immutable original curation result and fingerprint, with the common receipt reference.
- The result manifest is immutable after seal; logical-work progress is separate mutable state. Page large immutable result references only against the receipt/result hash and stable ordinal, never the current fact table. Paging is optional for the bounded first contract; returning a truncated mapping is forbidden.

Use one shared typed error envelope per operation, following `engine/taki_compatibility.py:144-163` and `memories/conditional_mutation.py:99-109` (Progenitor 0.11 limitation). Proposed closed errors/status mapping:

| Condition | Result |
| --- | --- |
| Missing/invalid Bearer credentials | Existing authenticated 401 envelope. |
| Unsupported build/backend/storage mode or old untracked proof | Explicit unsupported/unavailable; no mutation or fabricated receipt. |
| Same tracked UUID with different normalized request | 409 `operation_request_conflict`; no new native work. |
| Wrong provider lineage/Bank generation | 409 generation/lineage mismatch, or 410 for a retired Bank lifetime; never apply to replacement. |
| Missing receipt | 404 is unknown, not evidence of an unapplied write. |
| Invalid tracked shape, or unsupported envelope/missing historical append body found in preflight | Typed 422 refusal before admission; no fallback to untracked streaming. |
| CAS re-preparation exceeds the envelope or loses the required stored base after admission | Persist a typed native refusal on the existing operation, with no canonical publication. Evidence reads return that state; a worker cannot retroactively change the original acceptance into HTTP 422. |
| Internal append base CAS changed before publication | Retry preparation under the original request identity after proving no committed result. No new caller revision or public stale-mutation semantics is required. |
| Native extraction/defense/result-bound failure | Explicit native failure with no atomic canonical publication. Preserve admission identity and sanitized reason. |
| Source/model logical work fails/cancels/changes definition | Preserve successful native receipt; derived failure/pending, never overall completion. |
| All required logical outcomes succeeded and declarations sealed | Immutable completion ID/hash and generation-bound journal prefix. |

Canonical hash encoding must be specified once and tested in Python/TS: schema version, field normalization/defaults, ordered arrays, sorted object keys and Unicode. Native mutation's current Pydantic fingerprint is not automatically byte-equivalent to Taki's sorted canonical JSON; keep its meaning intact and define the common public fingerprint explicitly.

### Provider proof versus local correlation

Taki `pending-memory-schema.ts:30-60` currently stores a locally assembled native receipt, and `hindsight-pending-recovery-stages.ts:64-68` hashes that receipt (including its client-resolved completion timestamp) while adding local `authorityEpochId`. Those are not provider-owned facts.

The new wire receipt must authenticate **provider-computed normalized input and immutable result hashes**. Taki verifies those against its frozen native request and the returned immutable manifest, then stores the provider receipt identity/hash in a versioned native receipt variant. The derived adapter verifies the provider receipt/result/lineage/generation/cursor and only then constructs the local `MemoryDerivedCompletionEvidence` envelope, inserting the captured local epoch and the hash of the locally persisted receipt. The provider must not echo a caller's local hash/epoch and call that proof.

Preserve readable legacy persisted receipt variants. Missing provider proof on an old row remains unavailable/unknown; do not upgrade it by hashing current provider state. JSON-state evolution need not add a SQLite table, but schema/reopen tests are mandatory. Do not rewrite migration 035 or historical intent hashes.

### Handwritten Hindsight footprint

Paths in this inventory are relative to `hindsight-api-slim/hindsight_api/`. The count is grounded in the listed files, not a LOC/time estimate.

| Existing file | Required responsibility |
| --- | --- |
| `engine/memory_engine.py` | Tracked admission/replay, common receipt/queue connection seams, conditional mutation linkage, root finalizer dispatch, native MM input/result proof, Bank-lifetime cleanup. |
| `engine/retain/orchestrator.py` | Reuse/extract native append preparation, route tracked atomic publication, delta/no-op callback context after journal; preserve ordinary streaming. |
| `engine/consolidation/consolidator.py` | Record actual consumed source versions/scopes and partial outcomes; root-ready notification; reuse native MM eligibility with proof-aware coalescing. |
| `engine/memories/base.py` | Optional source revision/proof projection in the existing typed store result. |
| `engine/memories/pg/reads.py` | Fetch revision with the same source text snapshot; `_MEMORY_COLUMNS` currently omits it (`:45-49`), while `find_unconsolidated` preserves native predicates/order (`:355-396`). Avoid a later separate revision read attached to stale text. |
| `engine/memories/conditional_mutation.py` | Link the existing normalized claim/original result to the common provider receipt without weakening native CAS. |
| `engine/taki_compatibility.py` | Advertise independent new contracts, exact build, runtime schema/storage/auth capability checks and shared errors. |
| `api/http.py` | New optional native input models/forwarding and typed refusal envelopes; no SQL in the router. |
| `extensions/builtin/taki_memory.py` | Typed read-only result/evidence endpoint and error mapping. |
| `worker/poller.py` | Carry/check execution claim identity and preserve real outcomes through retry/cancel/recovery; no generic job engine. |
| `admin/cli.py` | Backup/restore coverage and validation for new durable tables. |

That is **11 named existing backend files** in the preferred inventory. Suggested new responsibility modules are **3**: typed `engine/recovery_contracts.py`, persistence/finalization `engine/operation_receipts.py`, and native-helper-based `engine/retain/recovery.py`. Exact file splitting may change at implementation review; these are proposed module names, not existing files. Add **one forward migration** for the bounded two-table design below. The mandatory backend surface therefore spans the API, admission/retain, consolidation/MM, worker, persistence and administration layers.

Conditional additional files: `engine/maintenance.py` only if repair uses its existing loop instead of a fully durable fixed-purpose queue task; `engine/task_backend.py` if the transaction-taking enqueue helper belongs there; `engine/db/ops_postgresql.py` / `ops_oracle.py` if claim projection changes there; `engine/retain/fact_storage.py` if a reusable writer hook needs adjustment. `engine/memories/pg/writes.py:233-381` already exposes survivor reset upserts through `logical_changes`, so first reuse that evidence instead of adding another cleanup implementation. `engine/replication.py` is a required read/revalidation hotspot; its existing lock and `AppendedLogicalBatch` may suffice unchanged. Private ANN/graph algorithm files are outside the minimum.

### Additive schema, lifecycle and transfer

A static AST audit found **98 migration modules and one current head `f7d0a5c3e9b2`**, file `f7d0a5c3e9b2_add_replication_logical_snapshots.py`. Append a new unique revision after the current head; recheck at implementation dispatch. Do not rewrite any shipped migration.

Suggested bounded schema: `memory_operation_receipts` (typed admission/prepared/result state, request/result hashes, lineage/generation, native status, source/MM seal flags and completion cursor) and `memory_operation_work` (root association, fixed work kind, source/model identity and input version/scope hash, actual native task/claim identity, outcome and committed boundary). Unique keys prevent duplicate root admission and duplicate logical obligations. No FK to prunable async operations or removable source rows. This can use typed JSON for the single-input preparation/result manifest; normalized immutable result rows/pages are an optional expansion for larger mappings.

No existing canonical document/fact column change is required by the preferred complete base-state hash CAS. A private document generation column is an alternative optimization, not a free addition. No new advisory locks, general workflow DSL, global scheduler or vector/index schema is required.

- Migration uses `run_for_dialect`. Initial support remains PostgreSQL SQL-row authority; an intentional Oracle no-op must remain unsupported in negotiation, like `d5b8f1c3a7e2_add_memory_mutation_receipts.py:3-8,57-62`. Do not accidentally query a new PG-only revision column on Oracle.
- Add both tables to `BACKUP_TABLES` in dependency order (`admin/cli.py:39-77`). Full physical backup/restore must preserve receipts, pending work and matching queue/lineage; old archives without proof data cannot manufacture completed operations. Validate archive/schema compatibility before truncation.
- Keep request/result identity for the supported Bank-generation lifetime independently of operation TTL. Remove unnecessary private prepared bodies after terminal processing. Bank deletion must explicitly retire pending work and prevent old-generation replay; document deletion must not destroy the original result receipt.
- Portable document/Bank transfer must **exclude active operation receipts, pending work and replay identity**. Transfer carries canonical content into fresh identities, not execution history. Existing history classifications are only `mental_model_history`, optional `audit_log`/`llm_requests` (`engine/transfer/schema.py:25-29`); adding these tables to physical backup is not permission to add them to portable history. Preserve new-generation publication on import (`transfer/importer.py:428-468`).
- Downgrade loses producer proof and requires a stopped/blocked recovery consumer; retain the old authority/receipt backup. Never advertise the new build against a downgraded schema.

### API, generated clients and control plane

`taki_compatibility.py:21-28,87-105,185-235` currently declares compatibility `1.0.0`, build `taki-memory-hindsight-0.9.0-batch0-v2`, with PG/auth/SQL-store gating. Add separate versioned `operation_result` and `logical_completion` contracts and bump the exact local build identity. The leader must choose/freeze the final compatibility version/build after gates; base API `0.9.0` alone proves nothing. Old builds remain fail-closed for new recovery.

Regenerate from `hindsight-docs/static/openapi.json`, not hand edits:

- Python generated `hindsight-clients/python/hindsight_client_api/` and maintained `hindsight_client/hindsight_client.py` (`retain`, `retain_batch`, `aretain`, `aretain_batch` forwarding at `:301-390,845-964`).
- TypeScript generated `hindsight-clients/typescript/generated/` and maintained `src/index.ts` (`retain`/`retainBatch` at `:211-310`). Add equivalent result/evidence methods and options in both wrappers, with mapping tests.
- Rust generated at build time from `hindsight-clients/rust/build.rs`; build Rust client and `hindsight-cli` using locked dependencies. Progenitor is `0.11`.
- Go `api_*.go` / `model_*.go` and client output; preserve `go.mod`/`go.sum`. Current generator uses OpenAPI Generator `v7.10.0`, despite an old log mentioning ogen (`scripts/generate-clients.sh:8-14,432-509`).

TS generator is pinned `@hey-api/openapi-ts=0.88.0` (`hindsight-clients/typescript/package.json:38`). Python/Go generator runs in Docker; Rust uses Cargo.lock. The script restores wrappers/manifests and applies deterministic generated-file fixes; all four SDK families are required even when the script skips missing Go.

Native request parameter changes also touch control-plane forwarding/types: `src/app/api/memories/retain/route.ts:20-33`, `retain_async/route.ts:31-37`, and `src/lib/api.ts:509-529`. Async proxy currently drops even a caller operation UUID, so explicit recovery options must not silently disappear. Update the corresponding curation proxy only if exposing its recovery option there. A new control-plane evidence UI is optional; B5 calls the dataplane directly. This adds **2 maintained SDK wrapper files and 3 named control-plane files**, before tests/generated output. Preserve the unrelated `hindsight-control-plane/bin/cli.js` edit.

### Minimum Taki consumer changes

- Shared: `pending-memory-schema.ts` (versioned producer receipt references and local correlation), `hindsight-connection-schema.ts` (new exact build/contracts), `memory-replica-schedule-schema.ts` (closed errors), public exports/index records.
- Core: `hindsight-contracts.ts`, `hindsight-compatibility-service.ts`, `hindsight-client.ts`, `hindsight-pending-client.ts`, `hindsight-pending-retain.ts`, `hindsight-derived-completion.ts`, `hindsight-pending-replay.ts`, `hindsight-pending-recovery-stages.ts`. Add real producer wire parsing/result retrieval and completion checks; remove append refusal only for the negotiated supported atomic contract.
- Preserve existing authority admission, lease/deadline, same-lease reset, receipt-first mutation replay, unknown outcome, and second-pull transactional publication. `hindsight-replica-sync-runner.ts` / repository publication should need regression coverage rather than a new synchronization architecture.
- Extend existing client/repository/recovery/Shared tests and folder indexes. Old record reopening must preserve immutable identities and avoid unsupported replay.

### Verification and Windows commands

No tests/generators/services were run in this research. Executable discovery found uv, Python, Node, pnpm/npm, Docker and Cargo; **Go was not found**. `bash` resolves to `C:/Windows/system32/bash.exe`, not a verified Git Bash installation. `H:/hindsight/.venv/Scripts/python.exe` exists. Presence does not prove Docker daemon/image, Rust target/cache, WSL readiness or installed test extras.

Use a clean child environment and isolated test database in the later authorized implementation gate. `tests/conftest.py:124-146` explicitly loads the repository `.env` with `override=True`; its pg0 fixture can start/persist a service (`:149-174`). `uv --no-env-file` alone does not disable Python dotenv. The installed `.venv/Lib/site-packages/dotenv/main.py:409-414` supports `PYTHON_DOTENV_DISABLED=1`; set that in the isolated harness and do not inherit provider credentials/database URLs. Default test fixtures also include real-LLM configuration (`conftest.py:461,561`), so choose controlled extraction/embedding fixtures and exclude real-LLM tests explicitly. Offline DB tests are not service-free tests.

Representative later commands, each run in its stated package with locked/preinstalled tooling:

```powershell
# H:/hindsight/hindsight-api-slim; pure migration shape, no repository conftest
uv run --offline --frozen --no-sync --no-env-file pytest --noconftest tests/test_migration_shape.py -n 0
uv run --offline --frozen --no-sync --no-env-file ruff check hindsight_api tests
uv run --offline --frozen --no-sync --no-env-file ty check hindsight_api
# H:/hindsight/hindsight-dev; canonical OpenAPI generator (mock engine, no server)
uv run --offline --frozen --no-sync --no-env-file generate-openapi
# H:/hindsight/hindsight-clients/typescript
npm run generate
npm run build
# H:/hindsight/hindsight-clients/rust, then H:/hindsight/hindsight-cli
cargo build --release --locked --offline
```

`generate-openapi` is the registered canonical entry (`hindsight-dev/pyproject.toml:34`); its implementation creates a mock engine and calls `app.openapi()` (`generate_openapi.py:42-68`). The full repository `scripts/generate-openapi.sh` also runs the docs build. `scripts/generate-clients.sh` is mandatory for the combined SDK gate but needs a reviewed Bash/Docker environment and cached pinned generators. It performs deletes/builds and must not be run casually in this research scope. Missing Go/Docker/generator output is an incomplete gate, not a pass.

Provider test categories: real transaction rollback/fault injection, request/receipt idempotency after pruning, atomic append concurrency and full mapping, source/survivor/scope outcomes, continuous unrelated writes with finite MM closure, watermark-aware model coalescing, worker stale-claim/retry/cancel, auth/tenant isolation, migration/DAG/backup/restore/transfer and canonical OpenAPI/client compatibility. Reuse `test_taki_replication_retain`, `test_taki_conditional_curation`, `test_taki_replication_consolidation`, `test_taki_extension_contract`, `test_async_retain_operation_id`, native worker tests and the companion matrices; do not rely on fixtures that disable consolidation for the derived guarantee.

Taki later gates: `pnpm --filter @taki/shared test`, `pnpm --filter @taki/core test`, downstream CLI/Desktop tests, `pnpm -r typecheck`, and root lint with the protected backup exclusion. Native isolated startup only if startup/migration wiring changes. Existing baseline test counts are historical, not this task's results.

`scripts/hooks/lint.sh` is the Hindsight required combined hook, but it calls `uv sync`, auto-fixes/formats broad files and runs Git discovery (`:7,34-52,72-73`). The leader must run it in the approved implementation/check scope and inspect unintended changes; the narrow read-only research did not execute it. No new dependency is required by the proposed design.

### Patch ownership and upgrade record

Leader-owned `H:/hindsight/TAKI_PATCHES.md` is the live ledger; historical `TAKI-HS-001..008` remain in the archived Taki compatibility task. `009` is reserved research-only per leader message, not implemented/accepted. Record the new generic durability/result gap separately from Taki policy/compatibility plumbing, with exact source baseline, changed modules, migration/table/API/generated families, atomic envelope and trigger-timing decisions, test evidence and unrun environment gates.

On upstream updates, revalidate the listed admission/delta/streaming, source-fetch/marker, native MM trigger/cutoff, queue dedup/retry, cleanup/pruning and backup seams first. Replace/retire local code only when upstream proves equivalent durable request/result identity, finite logical closure and restart semantics; an added task-status field is insufficient. Keep shipped migrations immutable, regenerate all clients and re-admit the exact build. No LOC/time estimate or claim of a tiny patch is supported by this investigation.

## Related Specs and External References

Taki ADR 0009; `.trellis/spec/backend/memory-replica-sync.md`, database/error/quality guidelines and source-grounding guide. Hindsight `CLAUDE.md` and `.claude/skills/code-review/SKILL.md` govern typed models, engine-owned auth/persistence, no new advisory locks, dialect dispatch, backup coverage and wrapper parity. Version references above come from current checked-in manifests/scripts, not external web claims.

## Caveats / Not Found

- Atomic full-retain fallback and its resource envelope require a deterministic feasibility spike; they are not proven by current native streaming tests. A bounded release must name excluded larger/multi-input/pre-contract partial cases.
- Opt-in root MM trigger timing/call frequency and atomic publication granularity are material execution changes to freeze before production dispatch. Native algorithms/prompts and untracked request behavior remain the intended reusable base.
- No live/manual/provider acceptance or fresh test/build success is claimed. No protected backup, other worktree, user data, secret/.env content, production code or Git state was accessed/modified by this research.
