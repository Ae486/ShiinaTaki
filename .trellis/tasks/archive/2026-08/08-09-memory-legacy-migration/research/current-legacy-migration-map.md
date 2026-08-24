# Batch 2 Legacy Migration Map

## Evidence status

`jbcontext search` was run first on 2026-08-19 and returned the existing migration PRD plus relevant Batch 1 and
live-memory locations. Exact contracts below were verified by direct reads and targeted `rg`. YCE was not used.
This map records current behavior, not target-state implementation.

## Current legacy authority and discovery

- `packages/core/src/memory/store.ts` is the sanctioned Markdown entry authority. It writes one `NNNN-slug.md` per
  entry with temp-file plus rename and derives ownership from `global/<layer>` or `characters/<characterId>/<layer>`.
- `packages/core/src/memory/indexer.ts` and `packages/core/src/db/memory-repo.ts` are rebuildable metadata/FTS
  projections. Startup reconciliation indexes valid files and reports invalid files without crashing.
- `packages/core/src/memory/memory-engine.ts` composes the legacy store, repo, retriever, assembler, tools, retention,
  and tidy. `packages/core/src/memory/bootstrap.ts` constructs this engine, runs reconcile, wires auto-memory/tidy/
  compaction/retention, and exposes the bound `writeMemory` operation used by image memory.
- `store.ts:refileEntry` writes the destination then removes the source. A crash between those operations can leave
  duplicate physical evidence. Migration therefore identifies `(canonical relative path, raw SHA-256)`, not legacy ID,
  as source evidence.

## Supported legacy entry shape

`frontmatter.ts` accepts a flat scalar subset: fenced frontmatter, unique keys matching `[a-z][a-z0-9_-]*`, JSON-
quoted or tolerant literal strings, finite-looking decimal numbers, and booleans. It does not parse nested/multiline
YAML. `entry.ts` maps disk keys to `MemoryEntry`:

| Disk field | Verified current behavior and migration treatment |
| --- | --- |
| `id` | `MemoryEntrySchema` requires only non-empty text; the live codec does not apply `IdSchema`. Preserve every non-empty value as provenance; never use it as a canonical key. |
| `layer` | Resolve through `V1_MEMORY_LAYERS`; unknown layers fail normalization. |
| `importance` | Zod integer 1..10. |
| `disclosure` | Optional text; Batch 1 policy bound is 512 JavaScript string units. |
| `created` | Required non-empty text in the live entry schema; migration adds strict offset-bearing ISO validation before canonical projection. |
| `status` | `active`/`archived`; archived canonical units are invalidated and absent from active FTS. |
| `origin` | `self`/`observed`; missing key defaults to `self`, preserving pre-T5 files. |
| `emotional_weight` | Maps to `emotionalWeight`; finite number required for canonical policy. |
| `expires` | Optional retention timestamp; registry retention remains authoritative. |
| `updated` | Optional and independent from `reinforce_count`; used as recency/invalidatedAt anchor when present. |
| `reinforce_count` | Maps to `reinforceCount`; positive integer if present; migration records bounded provenance and maps `proofCount` to at least 1. |

The no-origin fixture is in `packages/core/src/memory/entry.test.ts`; writer fixtures are in `e2e/src/fixture/seed-memory.ts`.
A supported well-formed source failing conversion is an implementation defect, not an expected exclusion.

## Ownership, paths, and identity hazards

Ownership is path-derived, not frontmatter-derived: global layers have no character ID; per-character layers require a
safe path segment. The shipped `isSafeSegment` grammar is exactly `[A-Za-z0-9_-]+`; `IdSchema` is a separate writer ID
schema and must not be retroactively imposed on historical frontmatter IDs. Migration canonicalizes host separators to
POSIX `/`, rejects traversal/out-of-root/reparse paths and path collisions, and preserves original path spelling in
raw snapshot evidence.

The whole physical Markdown text, including newline style and frontmatter spelling, is SHA-256 hashed. Normalized body
and parsed fields are separate from raw evidence. Deterministic identities use domain-separated, length-delimited UTF-8
tuples:

```text
source_id    = H("legacy-source/v1", relative_path, raw_sha256)
content_hash = H("legacy-content/v1", normalized_content_utf8)
document_id  = H("legacy-document/v1", bank_id, source_id)
operation_id = H("legacy-operation/v1", bank_id, document_id, raw_sha256)
memory_id    = H("legacy-memory/v1", bank_id, document_id, result_ordinal, result_payload_hash)
```

The exact encoder is frozen in `design.md`. Content identity converts CRLF/CR to LF; it does not silently NFC-normalize
entry body text. Bank-specific document IDs remain collision-safe for Global/Character fan-out. Epoch scope is excluded
from migration IDs so retry and rebuilt staging produce identical identities.

## Memory Blocks

`block-store.ts` stores frontmatter-less Markdown beside the entry tree under `workspace/blocks`; `block-registry.ts`
declares scope, writer, order, headers, and budgets. `stripNoteBlock` removes the first contiguous editor-note block and
trims the resulting view; `BlockStore.readBlock` returns `undefined` for absent/unreadable/stripped-empty content.
`block-isolation.test.ts` proves Blocks never enter legacy FTS. Batch 2 snapshots every applicable Block, converts it to
`taki_memory_blocks` through a migration-only importer, preserves registry scope/order/writer policy, and never places
Block content in `canonical_memory_units` or either FTS table. Unknown IDs, malformed placement, and Block-shaped files
under `workspace/memory` remain exceptional evidence.

## Batch 1 canonical seams and constraints

- Migration 017 creates empty canonical tables and `canonical_memory_fts`; it does not initialize an epoch or change
  runtime authority.
- `canonical-memory-authority-repo.ts` only initializes/reads `initial-local` and creates Banks. It has no promote or
  switch method; Batch 2 adds a narrow activation transaction. Stage may create a canonical Local epoch/Banks for foreign
  keys while a separate runtime selection marker remains `legacy-markdown`; marker mode, not epoch existence, defines
  production authority.
- Canonical Local `retain` requires at least one unit and generates random memory IDs. Zero-result conversion therefore
  belongs to the migration ledger/import flow, and deterministic migration results require a dedicated importer.
- Canonical source/unit text bounds are `z.string().max(100_000)`, which follows JavaScript string-length semantics;
  migration must not claim a Unicode code-point bound or truncate over-limit evidence.
- Canonical provenance accepts `actor: system`, `origin: legacy-import`, and `sanitized: true`.
- Structured Blocks are revisioned whole documents with `user`/`background` writer enforcement and deterministic
  rendering; migration uses `actor: migration` internally and does not expose a runtime writer bypass.

## Runtime seams that activation must retire

`packages/core/src/memory/bootstrap.ts` and `main.ts` currently wire all of the following Markdown paths:

1. startup `engine.reconcile()` and legacy engine construction;
2. `chat-agent.ts` instruction assembly, Block/pinned/intention reads, and foreground/background legacy tool suites;
3. prompt/tool references to `memory_search`, `memory_write`, and `memory_archive`;
4. direct engine writes, archive/reinforce/disclosure/refile, and Block mutation;
5. detached auto-memory episodic writes, pre-compaction flush, tidy, compaction ordering, and watermarks;
6. image-description writes through the bound `writeMemory`/`writeEpisode` hook;
7. boot and six-hour retention listing/archive/hard-delete;
8. operator `memory.tidy`, status/maintenance dependencies, and any media/path byte-count seam that assumes the
   Markdown tree.

After a successful activation marker, startup must choose canonical Local before constructing any listed path. This is a
one-time migration boundary, not a permanent dual-format subsystem. Legacy
and canonical tools/prompts are one mutually exclusive bundle; no permanent dual-format adapter is loaded. The
converter/runner is an explicit offline/resumable operator migration or audit capability only. Preserved Markdown is
read-only evidence, and no mutable Markdown fallback is allowed.

## Regression evidence

Focused baseline: `store.test.ts`, `entry.test.ts`, `frontmatter.test.ts`, `indexer.test.ts`, `memory-engine.test.ts`,
`memory-tools.test.ts`, `block-store.test.ts`, `block-isolation.test.ts`, `structured-memory-block-repo.test.ts`,
`canonical-memory-repo.test.ts`, `local-memory-provider.test.ts`, `canonical-memory-authority-repo.test.ts`,
`auto-memory.test.ts`, `flush-writer.test.ts`, `image-description-writer.test.ts`, `tidy-pass.test.ts`,
`retention-sweeper.test.ts`, `compaction-pass.test.ts`, and migration 017 tests. Full Shared/Core typecheck, package
tests, lint, `git diff --check`, UTF-8/BOM validation, and Trellis task validation remain required.

## Caveats and not-found facts

- No live Batch 2 migration ledger, activation marker, runtime fence, canonical importer, or production canonical
  runtime selection exists yet; this task must add them.
- No automatic recall/provider switch/Hindsight network operation belongs in Batch 2.
- Current `scrubPii` masks credentials plus email/phone/card classes at the perception seam. Migration must make the
  retention policy explicit so intentionally stored legacy text is not silently changed without evidence; raw snapshot
  bytes remain exact either way.
