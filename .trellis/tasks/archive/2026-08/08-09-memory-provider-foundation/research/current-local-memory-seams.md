# Current Local Memory Seams

## Purpose

This note freezes the live implementation baseline that Batch 1 must build beside. It is not a description of the
target architecture. The target is defined by `design.md`, the parent PRD, `docs/MEMORY-DESIGN.md`, and ADR 0009.

`jbcontext search` was attempted first for semantic localization on 2026-08-19, but the service returned a connection
timeout. The task already identified the relevant subsystem paths, so the evidence below was verified by direct file
reads and exact `rg` searches. YCE, fast-context, and ACE were not used.

## Executive Findings

- Markdown files are still the authoritative searchable-memory store. SQLite metadata and FTS are explicitly derived
  and are rebuilt by walking the files.
- `createMemoryEngine` constructs the concrete file store, SQLite repository, tokenizer, FTS retriever, assembler,
  and tool operations internally. There is no live provider registry, coordinator, or authority abstraction.
- Foreground and background toolsets currently expose `memory_write`, `memory_search`, and `memory_archive`.
- Post-turn work is detached and serialized per character in the order episodic -> flush -> tidy -> compact.
- Memory Blocks are a separate pure-Markdown tree, read fresh per turn, and structurally excluded from the FTS entry
  walk.
- The current `Retriever` and assembler seams are synchronous. The assembler has no automatic retrieved-memory
  section; search-policy rows reach the model only after an explicit tool call.
- No live authority epoch, provider capability envelope, revision-checked mutation, replica checkpoint, pending
  outbox, Hindsight client, or vector implementation exists in the memory subsystem.
- The repository now has a separate Core-owned Secret Catalog, added after the parent memory research. The Desktop
  Shell keyring remains node-token/device-identity infrastructure. Batch 1 does not consume either secret path.

## Evidence

### Markdown authority and rebuildable SQLite projection

- `packages/core/src/memory/store.ts:1-6` declares the entry store as the sanctioned filesystem authority, while
  `store.ts:95-107` walks and parses user-editable Markdown files. New entries are allocated as `*.md` and atomically
  written at `store.ts:126-145`.
- `packages/core/src/memory/indexer.ts:1-5` states that the DB is rebuildable from Markdown. Reconciliation compares
  file hashes with indexed rows and repairs inserts/deletes at `indexer.ts:30-57`.
- Migration 002 calls `memory_entries` and `memory_fts` derived data and creates the metadata plus FTS tables at
  `packages/core/src/db/migrations/002-memory.ts:8-25`. Migration 008 later rebuilds FTS as unicode61 and deliberately
  blanks hashes to force a file-driven reindex (`packages/core/src/db/migrations/008-memory-fts-unicode61.ts:9-19`).
- `packages/core/src/db/memory-repo.ts:89-97` joins FTS content to metadata and applies the active, unexpired,
  global-or-current-character scope. Its BM25 query is defined at `memory-repo.ts:111-121`; metadata and FTS updates
  are transactionally paired at `memory-repo.ts:155-173`.

### Concrete composition and synchronous seams

- `packages/core/src/memory/memory-engine.ts:82-103` directly constructs `MemoryStore`, `MemoryRepo`, tokenizer,
  `Fts5Retriever`, assembler, event repository, and tool operations. The production engine therefore cannot swap a
  provider without a new composition seam.
- The write path remains file-first then index (`memory-engine.ts:101-103`, `memory-engine.ts:216-237`). A crash
  between the two is repaired by startup reconciliation.
- `packages/core/src/memory/retriever.ts:22-32` defines synchronous `retrieve(...): RankedEntry[]`.
- `packages/core/src/memory/assembler.ts:55-77` synchronously builds persona, blocks, pinned rows, and at most one
  intention. Its comment at `assembler.ts:63-65` explicitly excludes a retrieved section.
- `packages/core/src/memory/bootstrap.ts:65-121` constructs the concrete engine and background passes. Production
  roots remain `workspace/memory` and `workspace/blocks` (`bootstrap.ts:124-139`).

### Current model-facing tools

- `packages/core/src/memory/memory-tools.ts:50-68` returns the foreground and background toolsets with exactly
  `memory_write`, `memory_search`, and `memory_archive`; the background write schema is more restricted.
- `packages/core/src/memory/memory-tools.ts:148-179` implements synchronous search/archive execution and translates
  thrown I/O failures into the current narrow tool result.
- `packages/core/src/agents/base-prompt.ts:40-42` instructs the foreground model to call `memory_search` for prior
  events. Canonical Hindsight-aligned tool names are therefore target behavior, not active behavior.

### Detached maintenance chain

- `packages/core/src/memory/auto-memory.ts:73-90` serializes post-turn passes per character and defers them with
  `setImmediate`, keeping foreground completion independent.
- The exact chain is visible at `auto-memory.ts:94-100`: episodic, flush, tidy, then compact. Each optional maintenance
  failure is swallowed and logged for later retry (`auto-memory.ts:102-121`).
- `packages/core/src/memory/bootstrap.ts:85-116` binds all automatic writes to the same concrete engine and creates
  the shared flush writer, tidy pass, and optional compactor.

### Memory Blocks are separate and never indexed

- `packages/core/src/memory/block-store.ts:1-5` defines Blocks as pure Markdown outside the entry tree and never
  FTS-indexed. Reads are fresh synchronous filesystem reads (`block-store.ts:31-55`); writes replace the whole block
  after registry writer checks (`block-store.ts:58-74`).
- Global and per-character files resolve under a sibling `blocks/` tree at `block-store.ts:84-95`.
- The assembler iterates registry order and injects each present block with its policy budget at
  `packages/core/src/memory/assembler.ts:80-97`.

### Foreground runtime seam

- `packages/core/src/agents/chat-agent.ts:175-202` composes instructions and tools synchronously before creating the
  model request. `chat-agent.ts:198-202` documents that the dynamic `<turn-context>` tail changes only the outgoing
  projection and never persisted history.
- This is the later automatic-recall insertion seam, but Batch 1 deliberately does not wire automatic recall or swap
  the production toolset. The provider/coordinator API must nevertheless be asynchronous now so that Batch 6 can use
  a network provider without changing the contract.

### Secret boundary drift

- The Desktop keyring remains a Shell-owned `SecretStore` whose documented keys are node token and device identity
  (`apps/desktop/src-tauri/src/secrets.rs:1-20`). It is not a Core memory-provider configuration API.
- The repository now also has a Core-owned encrypted Secret Catalog composed at
  `packages/core/src/main.ts:180-200`. This postdates the original parent research conclusion that Core had no general
  secret backend. Adopting it for a Hindsight connection belongs to the later connection/setup batch; Batch 1 has no
  provider credential, endpoint, or network dependency.

## Batch 1 Consequences

1. Build a new structured Canonical Local Provider beside the legacy engine. Do not retrofit provider behavior into
   `MemoryStore` or reinterpret the existing derived tables as authority.
2. Keep all provider/coordinator methods Promise-based, even though SQLite work remains synchronous inside Core-owned
   transactions.
3. Add new canonical tables and a new FTS projection with distinct names. Do not mutate or dual-write
   `memory_entries`, `memory_fts`, or the Markdown trees.
4. Store Memory Blocks as structured Taki policy documents in the canonical subsystem. They remain excluded from
   generic facts and FTS.
5. Preserve existing production composition until Batch 2 performs deterministic legacy migration and explicitly
   activates the new Local Provider. Batch 1 can expose factories and isolated canonical tools for tests, but `main.ts`
   and `createMemorySubsystem` continue to instantiate the legacy engine.
6. Treat the canonical source/unit model as Hindsight-aligned logical data. Do not copy Hindsight PostgreSQL tables,
   worker queues, indexes, or other operational state.

## Strong Existing Regression Suites

- `packages/core/src/memory/store.test.ts`, `indexer.test.ts`, `fts5-retriever.test.ts`, and `memory-engine.test.ts`
  cover file authority, index reconciliation, sparse retrieval, and composition behavior.
- `packages/core/src/memory/block-store.test.ts`, `block-isolation.test.ts`, and `assembler-blocks.test.ts` cover block
  writer policy, structural FTS isolation, and deterministic injection.
- `packages/core/src/memory/memory-tools.test.ts` and `packages/core/src/agents/chat-agent-tools.test.ts` freeze the
  current advertised tool surface.
- `packages/core/src/memory/auto-memory.test.ts`, `tidy-pass.test.ts`, and
  `packages/core/src/agents/compaction-pass.test.ts` cover the detached maintenance ordering and failure behavior.
- `packages/core/src/db/migration-runner.test.ts`, `sqlite.test.ts`, and the numbered migration tests are the patterns
  for additive SQLite schema/reopen/rollback proof.
