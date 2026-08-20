# Canonical Memory Provider Foundation - Execution Plan

> Read `prd.md`, `design.md`, `research/current-local-memory-seams.md`, and the parent
> `.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md` before coding. This
> is a dormant foundation:
> implement and prove the canonical Local Provider, but do not activate it, dual-write, migrate legacy Markdown, or
> connect to Hindsight.

## Execution Protocol

- Dispatch implementation with high reasoning effort and the final check with xhigh reasoning effort.
- YCE is forbidden. Start unfamiliar semantic exploration with one focused `jbcontext search`; after a useful hit,
  switch to direct reads and exact `rg`. If `jbcontext` is unavailable, record the failure and use known paths/direct
  reads rather than substituting fast-context or ACE.
- Red before green for every wave. Keep each production file's INPUT/OUTPUT/POS header and update affected `index.md`
  files in the same wave.
- Use only the existing dependencies. Do not add an embedding/vector/network package.
- The implement agent owns the new canonical modules and narrowly required exports/migration registration. It must not
  rewrite the legacy engine or touch Hindsight source.
- Run one formal full-scope xhigh check after all waves converge. Mid-wave checks are focused tests/typecheck, not a
  substitute for the final review.

## Wave 0 - Shared canonical contract tracer

### Ownership

- New: `packages/shared/src/memory-provider-domain-schema.ts`
- New: `packages/shared/src/memory-provider-operation-schema.ts`
- New: `packages/shared/src/memory-provider-envelope-schema.ts`
- New: focused `memory-provider-*-schema.test.ts` files beside those modules
- Update: `packages/shared/src/index.ts`, `packages/shared/src/index.md`

### RED

1. Add schema tests for:
   - Authority epoch plus provider-instance lineage, global/character Bank scope, and Hindsight-aligned
     source/unit/derived shapes;
   - lifecycle/revision contradictions;
   - Taki policy visibility, exact live-registry retention projection, layer/Bank ownership, and one strict
     JSON-compatible metadata vocabulary;
   - capability snapshots and the one valid error code/category/retryability/next-action mapping;
   - retain/recall/reflect/edit/invalidate/restore request/result envelopes, including one-to-many retain IDs,
     bounded recall scores, reflect evidence/usage/trace, and mutation applied/unchanged results;
   - strict rejection of extra fields, invalid bounds, empty edit patches, and model-supplied internal call context.
2. Run the test and capture the expected missing-schema failure.

### GREEN

3. Implement the responsibility-split strict Zod schemas/types from `design.md` and explicit public exports. Keep each
   production file below 300 lines rather than collecting the domain into one schema bucket.
4. Keep Hindsight names only where concepts match (`documentId`, `memoryId`, logical fields); keep authority epoch and
   Taki policy visibly separate.
5. Verify that success/error envelopes are discriminated by `ok`, tool inputs exclude provider/epoch/request identity,
   and all arrays/maps/strings are bounded.

### Gate

```powershell
pnpm --filter @taki/shared exec vitest run src/memory-provider-domain-schema.test.ts src/memory-provider-operation-schema.test.ts src/memory-provider-envelope-schema.test.ts
pnpm --filter @taki/shared typecheck
```

### Rollback point

This wave is additive Shared code only. If the contract cannot express a required invariant without ambiguity, stop
and revise `design.md` before any database migration depends on it.

## Wave 1 - Additive SQLite schema tracer

### Ownership

- New: `packages/core/src/db/migrations/017-canonical-memory.ts`
- New: `packages/core/src/db/migrations/017-canonical-memory.test.ts`
- Update: `packages/core/src/db/migrations/index-list.ts`, `packages/core/src/db/migrations/index.md`

If another accepted migration takes version 017 before implementation starts, select the next available version and
update this plan's references; never reuse or reorder a shipped number.

### RED

1. Add migration tests proving:
   - all canonical authority/Bank/source/unit/lineage/derived/policy/receipt/block/FTS tables exist after a fresh apply;
   - migration is explicitly ordered and recorded once;
   - reopen is idempotent;
   - scope, lifecycle, revision, JSON, lineage FK/self-edge, unique-active-epoch, and one-Bank-per-scope constraints fail
     closed;
   - both global (`character_id=NULL`) and per-character Blocks insert, while duplicate logical scope is rejected;
   - an injected failing statement rolls back the whole migration;
   - legacy `memory_entries`/`memory_fts` rows and schema remain unchanged.
2. Run the focused test and capture RED before adding the migration.

### GREEN

3. Implement the normative DDL from `design.md` using new `canonical_memory_*` names plus
   `taki_memory_blocks`.
4. Normalize observation lineage through `canonical_memory_unit_sources`; use an internal integer primary key plus the
   expression-backed logical unique index for Blocks so `STRICT` does not make global `character_id` non-null.
5. Create the unicode61 `canonical_memory_fts` table with epoch/Bank/memory IDs unindexed and text/context/
   application-segmented terms searchable.
6. Register the migration explicitly. Do not seed an epoch, Bank, source, unit, or block from migration SQL.

### Gate

```powershell
pnpm --filter @taki/core exec vitest run src/db/migrations/017-canonical-memory.test.ts src/db/migration-runner.test.ts src/db/sqlite.test.ts
pnpm --filter @taki/core typecheck
```

### Rollback point

The schema remains empty and behaviorally dormant. Before acceptance, correct an unshipped migration in place. After
it ships, all repairs must be forward migrations.

## Wave 2 - Persisted Local epoch, Bank, and structured Block tracer

### Ownership

- New: `packages/core/src/db/canonical-memory-authority-repo.ts`
- New: `packages/core/src/db/canonical-memory-authority-repo.test.ts`
- New: `packages/core/src/db/structured-memory-block-repo.ts`
- New: `packages/core/src/db/structured-memory-block-repo.test.ts`
- Narrow update: `packages/core/src/db/index.md`

### RED

1. Authority tests:
   - first explicit initialization inserts one Local epoch, provider lineage, and singleton pointer atomically;
   - a database reopen returns the identical epoch and provider lineage;
   - repeated initialization is idempotent;
   - malformed pointer, multiple active rows, non-Local active provider, and expected-epoch mismatch fail as typed
     integrity/authority results;
   - global and per-character Banks roundtrip, invalid scope/nullability and duplicate scope fail;
   - no authority switch/close/promote method exists in the Batch 1 repository surface.
2. Block tests:
   - whole-document global/per-character read/write and revision increment;
   - registry scope/writer enforcement (`user-card` cannot be written by background);
   - missing row reads as absent;
   - deterministic registry-order render with headers/budgets;
   - no source/unit/FTS row changes after a block write.

### GREEN

3. Implement synchronous typed repositories over the existing `Database` wrapper. Parse JSON/rows with Shared Zod at
   every boundary.
4. Keep the epoch initialization call explicit; do not invoke it from migration, `main.ts`, or legacy bootstrap.
5. Store Blocks independently of provider epochs, validate policy through `V1_BLOCKS`, and expose only narrow read/
   replace operations.

### Gate

```powershell
pnpm --filter @taki/core exec vitest run src/db/canonical-memory-authority-repo.test.ts src/db/structured-memory-block-repo.test.ts
pnpm --filter @taki/core exec vitest run src/memory/block-registry.test.ts src/memory/block-store.test.ts src/memory/block-isolation.test.ts src/memory/assembler-blocks.test.ts
pnpm --filter @taki/core typecheck
```

### Rollback point

Repositories remain uncomposed. If epoch or block invariants are wrong, fix them before canonical record writes are
built on top.

## Wave 3A - Canonical record and atomic retain tracer

### Ownership

- New: `packages/core/src/db/canonical-memory-repo.ts`
- New: `packages/core/src/db/canonical-memory-repo.test.ts`
- New if required by the 300-line cap: `packages/core/src/db/canonical-memory-row-codec.ts` and focused test
- New: `packages/core/src/memory/local-memory-provider.ts`
- New: `packages/core/src/memory/local-memory-provider.test.ts`
- Narrow update: `packages/core/src/db/index.md`, `packages/core/src/memory/index.md`

Do not add sparse search here beyond the minimal projection write/delete calls needed for transaction proof; Wave 4
owns ranking and rebuild.

### RED

1. Retain transaction tests:
   - valid Local retain writes source + one experience unit + provenance + policy + controlled layer tag + FTS row +
     minimal receipt atomically;
   - no `*.md` file or legacy memory row is created/changed;
   - exact request replay returns the original IDs/revisions;
   - retain timestamp mapping proves null -> injected now, `unset` -> timeless null, and explicit ISO preservation;
   - same request ID with different canonical fingerprint returns `MEMORY_REQUEST_ID_CONFLICT`;
   - classified layer ownership must match Bank scope; `unclassified` remains a reserved fallback;
   - a second `replace` for one document increments source revision, invalidates/removes the prior Local unit from FTS,
     and commits one fresh valid unit; `append` or a non-null provider strategy returns capability unsupported with no
     write;
   - missing Bank, wrong epoch, invalid layer, and forced FTS/receipt failure leave zero partial canonical rows.
2. Canonical record roundtrip tests cover one document to many units, normalized same-epoch/Bank observation lineage,
   no self-edge, and mental-model/directive payload identity plus outer object revision.
3. Reopen tests prove structured source/unit/lineage/derived/policy/receipt state persists and Zod rejects semantically
   corrupt or cross-column-inconsistent JSON rows even when `json_valid` accepts them.

### GREEN

4. Implement stable-key canonical request hashing and minimal receipt serialization. IDs use `randomUUID` or injected
   deterministic test factories, never content-derived slugs.
5. Implement strict source/unit/lineage/derived/policy/receipt row parsing. Reconstruct `sourceMemoryIds` from the
   normalized edge table and prove all duplicated key/envelope fields agree.
6. Implement Local retain as one sanitized source -> one valid unit, including the frozen replace behavior. Do not call
   an LLM, dedupe semantically, generate observations, or imitate Hindsight maintenance.
7. Keep provider methods Promise-based, check an already-aborted signal before work, and re-read the active epoch inside
   the synchronous write transaction.

### Gate

```powershell
pnpm --filter @taki/core exec vitest run src/db/canonical-memory-repo.test.ts src/memory/local-memory-provider.test.ts
pnpm --filter @taki/core typecheck
```

### Rollback point

The Local Provider is still test-only and not registered with production. Any transaction defect can be repaired
without reconciling legacy data because no activation or dual-write exists.

## Wave 3B - Revisioned mutation tracer

### Ownership

- Update narrowly: `packages/core/src/db/canonical-memory-repo.ts` and its tests
- Update narrowly: `packages/core/src/memory/local-memory-provider.ts` and its tests
- Split named mutation/receipt modules if either production file would exceed 300 lines

### RED

1. Mutation transaction tests:
   - edit increments revision and sets `editedAt`, including an explicit same-value edit;
   - invalidate removes FTS, sets lifecycle fields, and increments revision only on a valid -> invalidated transition;
   - restore clears invalidation fields, reinserts FTS, and increments revision only on an invalidated -> valid
     transition;
   - a same-state invalidate/restore stores and replays an `unchanged` result without advancing revision;
   - layer reclassification validates Bank ownership, replaces exactly one `taki-layer:*` tag while preserving
     unrelated tags, and updates policy in the same transaction;
   - stale `expectedRevision` changes nothing and reports current revision;
   - exact mutation retry returns its receipt before rechecking the now-advanced revision;
   - empty edit, observation edit, permanent delete, and bank-wide operations are unavailable.

### GREEN

2. Implement revision-checked edit/invalidate/restore/reclassify as synchronous SQLite transactions with receipts.
3. Keep source/unit/policy/FTS/receipt publication atomic and schedule no vector work until after commit.

### Gate

```powershell
pnpm --filter @taki/core exec vitest run src/db/canonical-memory-repo.test.ts src/memory/local-memory-provider.test.ts
pnpm --filter @taki/core typecheck
```

### Rollback point

Mutation remains reachable only through the dormant Local Provider. Correct CAS or lifecycle behavior before sparse
recall and tools begin depending on the returned revisions.

## Wave 4 - Sparse recall, rebuild, and optional-vector seam tracer

### Ownership

- New: `packages/core/src/db/canonical-memory-sparse-repo.ts`
- New: `packages/core/src/db/canonical-memory-sparse-repo.test.ts`
- New: `packages/core/src/memory/memory-provider.ts`
- New: `packages/core/src/memory/memory-provider.test.ts`
- Update narrowly: `packages/core/src/memory/local-memory-provider.ts` and its tests
- Reuse: `packages/core/src/memory/search-tokenizer.ts`, `fts5-query.ts`, `token-estimator.ts`

### RED

1. Sparse tests cover:
   - active epoch/Bank/valid lifecycle isolation;
   - layer/fact-type filters;
   - unicode61 + application-segmented CJK query behavior;
   - BM25 order with deterministic importance/update/ID ties;
   - both result-count and token caps;
   - observed-origin fencing before model-facing projection;
   - invalidated and other-epoch rows never surface.
2. Rebuild tests delete/corrupt the projection, rebuild from valid canonical units, and prove equivalent result IDs and
   ordering. Blocks, sources, derived objects, and invalidated units remain absent. Injected failure rolls back to the
   prior complete index.
3. Vector-seam tests prove:
   - no vector implementation means `unavailable` and sparse recall succeeds;
   - an injected vector rejection still returns sparse results and reports bounded degraded diagnostics;
   - canonical retain/mutation completion never waits for vector projection;
   - no hybrid weight is frozen by Batch 1.

### GREEN

4. Implement the sparse repository with one tokenizer instance shared by index and query. Parse joined rows through
   Shared schemas.
5. Define the async `MemoryProvider` and `MemoryVectorProjection` interfaces from `design.md`; ship a disabled/absent
   vector path only.
6. Compose sparse recall into Local Provider. Keep `reflect` and derived-memory generation unsupported in its
   capability snapshot.

### Gate

```powershell
pnpm --filter @taki/core exec vitest run src/db/canonical-memory-sparse-repo.test.ts src/memory/memory-provider.test.ts src/memory/local-memory-provider.test.ts
pnpm --filter @taki/core exec vitest run src/memory/search-tokenizer.test.ts src/memory/fts5-query.test.ts src/memory/fts5-retriever.test.ts
pnpm --filter @taki/core typecheck
```

### Rollback point

Sparse projection is rebuildable. If optional-vector behavior threatens Local write/recall correctness, remove the
injected implementation path and retain only the frozen interface plus `unavailable` capability.

## Wave 5A - Authority coordinator tracer

### Ownership

- New: `packages/core/src/memory/memory-coordinator.ts`
- New: `packages/core/src/memory/memory-coordinator.test.ts`
- Narrow update: `packages/core/src/memory/index.md`

### RED

1. Coordinator tests:
   - every operation returns a Promise and a Shared-validated envelope;
   - an already-aborted signal prevents provider work and a live signal reaches the selected provider;
   - persisted epoch resolves exactly one matching provider ID and provider lineage;
   - capability denial happens before provider invocation;
   - missing provider, provider/epoch mismatch, malformed provider result, and unexpected throw normalize to typed,
     sanitized errors;
   - failures never select a second provider;
   - request IDs are runtime-generated when absent and stable when explicitly injected by tests/replay.

### GREEN

2. Implement the coordinator's authority/capability/dispatch/result-validation path. Use fixed sanitized error messages
   and count/ID-only logs.
3. Keep expected epoch as a stale-work precondition; never treat it as caller-selected authority.

### Gate

```powershell
pnpm --filter @taki/core exec vitest run src/memory/memory-coordinator.test.ts
pnpm --filter @taki/core typecheck
```

### Rollback point

The coordinator is still uncomposed. Resolve envelope, cancellation, or no-fallback defects before model tool adapters
depend on it.

## Wave 5B - Canonical tool-envelope tracer

### Ownership

- New directory: `packages/core/src/memory/canonical-tools/`
- New: `retain-tool.ts`, `recall-tool.ts`, `reflect-tool.ts`, `update-memory-tool.ts`,
  `invalidate-memory-tool.ts`, and `restore-memory-tool.ts`
- New: `canonical-memory-tools.ts` assembly factory, `canonical-memory-tools.test.ts`, focused per-tool tests where
  useful, and `index.md`
- Narrow update: `packages/core/src/memory/index.md`

### RED

1. Tool tests:
   - the assembly factory returns a Promise, awaits one capability snapshot, and execution rechecks capability through
     the coordinator;
   - exact advertised names are `retain`, `recall`, `update_memory`, `invalidate_memory`, `restore_memory`, plus
     `reflect` only when capability says supported;
   - small strict-ready inputs exclude request/provider/authority identity, resolve scope through a trusted
     active-Character Bank router, and use explicit null values instead of ambiguous optional fields;
   - retain derives one Bank from layer ownership, recall supports bounded global/character/both fan-out, and mutation/
     reflect remain single-Bank operations; no model-supplied opaque Bank ID is accepted;
   - retain's runtime enum contains only current foreground-writable registry layers, never `unclassified` or a
     machine-only layer;
   - `both` recall merges two calls to the same authority provider, reports a bounded partial branch failure when one
     Bank fails, and returns an error when neither succeeds; it never selects a second provider;
   - all outputs retain the canonical envelope and current revisions;
   - recall is bounded and observed content fenced;
   - unsupported tools are omitted, not advertised as a broken duplicate;
   - descriptions, field descriptions, never-throw behavior, retry posture, and module headers satisfy the tool birth
     checklist; the frozen Hindsight names are the documented naming exception;
   - a collision with any legacy/canonical key fails closed through existing tool-set assembly conventions;
   - production Core governance remains unchanged in Batch 1, and the Batch 2/6 activation handoff records that the
     canonical keys need explicit trusted bindings before they can execute in a real turn.

### GREEN

2. Implement the isolated async AI SDK tool factory over the coordinator, one tool per module. Keep it unreferenced by
   production `createMemorySubsystem`, `chat-agent.ts`, and `base-prompt.ts`; do not introduce a synchronous capability
   cache to fit the legacy composition seam.
3. Local capability advertises no `reflect`, so the Local toolset omits it. The Shared contract and coordinator method
   remain ready for the later Hindsight Provider.

### Gate

```powershell
pnpm --filter @taki/core exec vitest run src/memory/canonical-tools src/agents/tool-set-assembly.test.ts
pnpm --filter @taki/core typecheck
```

### Rollback point

The canonical tools are a dormant factory. If tool semantics diverge from the Shared contract, fix or remove the
factory without affecting current model-facing tools. Do not add production governance bindings merely to make these
isolated tests execute; activation owns that atomic registry change.

## Wave 6 - Activation boundary, privacy, and regression convergence

### Ownership

- Focused updates to affected `packages/core/src/memory/index.md`, `packages/core/src/db/index.md`,
  `packages/core/src/db/migrations/index.md`, and `packages/shared/src/index.md` only.
- Add a narrow activation-boundary test if ordinary imports cannot prove the boundary structurally.
- Do not modify product runtime merely to satisfy the test.

### RED/GREEN checks

1. Prove ordinary Core startup applies only the empty additive schema: no canonical epoch/Bank/source/unit/lineage/
   derived/block/receipt row is created until the explicit canonical factory is called.
2. Prove `packages/core/src/main.ts` and `createMemorySubsystem` still use the legacy engine; foreground tools remain
   `memory_write`/`memory_search`/`memory_archive`; no turn sees both suites.
3. Run legacy store/index/retriever/engine/tool/block/assembler/auto-memory/tidy/compaction tests. Repair only genuine
   regressions caused by canonical additions; do not refactor legacy behavior.
4. Add sentinel tests that retain/query/provenance/tag/text values never appear in logs, errors, capability payloads,
   or write receipts beyond the explicitly allowed canonical data rows.
5. Inspect the diff for accidental Hindsight client, endpoint, secret, checkpoint, outbox, migration, automatic-recall,
   prompt, UI, or vector dependency work. Remove all such scope creep.

### Focused convergence gate

```powershell
pnpm --filter @taki/shared exec vitest run src/memory-provider-domain-schema.test.ts src/memory-provider-operation-schema.test.ts src/memory-provider-envelope-schema.test.ts
pnpm --filter @taki/core exec vitest run src/db/migrations src/db/canonical-memory-authority-repo.test.ts src/db/canonical-memory-repo.test.ts src/db/canonical-memory-sparse-repo.test.ts src/db/structured-memory-block-repo.test.ts
pnpm --filter @taki/core exec vitest run src/memory src/agents/tool-set-assembly.test.ts src/agents/chat-agent-tools.test.ts src/agents/compaction-pass.test.ts
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/core typecheck
```

### Final activation handoff to Batch 2

Record these facts in the implementation checkpoint; do not perform them:

- canonical schema and Local factory are ready;
- the canonical store is empty for an ordinary legacy workspace;
- production authority and tools are still legacy Markdown;
- no dual-write exists;
- Batch 2 must normalize legacy files/blocks, populate migration ledger and canonical rows, verify completeness, then
  explicitly change production composition in one activation step;
- the activation/runtime batch must add trusted governance bindings for the canonical tool keys in the same change
  that selects the canonical suite; Batch 1 deliberately leaves production bindings and tools untouched;
- the activation/runtime batch must await the canonical tool factory before collision-safe final assembly; no stale
  synchronous capability cache is part of the handoff;
- rollback before that step is to leave the canonical factory unselected.

## Final Quality and Review Gate

Run after all waves, in this order:

```powershell
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/shared test
pnpm --filter @taki/core typecheck
pnpm --filter @taki/core test
pnpm lint
pnpm -r --parallel typecheck
git diff --check
python ./.trellis/scripts/task.py validate .trellis/tasks/08-09-memory-provider-foundation
```

Then dispatch one full-scope xhigh `trellis-check` against `prd.md`, `design.md`, `implement.md`, `check.jsonl`, and the
entire task diff. The check must review and fix:

- Shared/Core schema drift;
- transaction and idempotency holes;
- authority mismatch/fallback behavior;
- Hindsight logical-model compatibility without private-schema leakage;
- Taki layer/tag/Block invariants;
- FTS rebuild and optional-vector degradation;
- bounded/fenced tool results and privacy-safe logging;
- accidental production activation, dual-write, or later-batch scope creep.

Do not start Batch 2, archive, commit, or push as part of the implementation/check agents. Those actions remain Leader
workflow decisions.
