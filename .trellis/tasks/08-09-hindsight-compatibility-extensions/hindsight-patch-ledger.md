# Hindsight Compatibility Patch Ledger

## Purpose

This ledger is the durable maintenance index for every Taki-driven change made
to the pinned Hindsight source tree. It separates generally useful Hindsight
compatibility work from Taki-specific policy so future upgrades can rebase,
replace, upstream, or retire each patch deliberately.

This file records patch ownership and maintenance intent. Executable acceptance
evidence remains in `info.md`, the focused contract tests, and the referenced
research documents.

## Upstream Baseline

- Hindsight package/API version: `0.9.0`.
- Inspected source commit: `4b2041eb3de5c4235f4a3dd5619fc47cce782e29` on local `main`.
- The checkout is not proven to be the immutable `v0.9.0` tag target.
- Initial Taki replication support is PostgreSQL-only.
- No compatibility capability may be advertised until all Batch 0 contracts,
  public schemas, generated clients, and upgrade gates pass together.

## Patch Classes

| Class | Meaning | Maintenance rule |
| --- | --- | --- |
| `upstream-gap` | A generic authority, consistency, or operability capability missing from Hindsight 0.9.0. | Prefer an upstream-compatible implementation and evaluate upstream contribution or replacement on every upgrade. |
| `taki-policy` | Taki-specific memory policy, taxonomy, or compatibility signaling. | Keep isolated behind additive fields, extension routes, or explicit `taki-*` names; never alter native defaults silently. |
| `integration-plumbing` | Minimal schema, serialization, migration, backup, or client plumbing required to expose the contracts. | Regenerate and revalidate from canonical sources; do not hand-maintain generated drift. |

## Patch Inventory

| Patch ID | Status | Class | Contract and reason | Main maintenance hotspots |
| --- | --- | --- | --- | --- |
| `TAKI-HS-001` | Accepted | `taki-policy` | Add fenced observation instructions without replacing Hindsight's native consolidation mission. | Consolidation prompt/config/template plumbing and prompt cache boundaries. |
| `TAKI-HS-002` | Accepted | `upstream-gap` + `taki-policy` | Add stable memory revisions, conditional mutation/idempotency, and atomic controlled `taki-layer:*` entity/tag projection. | Curation request/response models, live/archive writes, mutation receipts, entity-label projection, HTTP/OpenAPI regeneration. |
| `TAKI-HS-003` | Accepted | `upstream-gap` | Add provider lineage, Bank generation, commit-visible per-Bank cursor state, append-only logical changes, retention/reset behavior, and frozen canonical serializers. | `engine/replication.py`, replication migrations, DB capability gates, backup/restore, migration DAG. |
| `TAKI-HS-004` | Accepted | `integration-plumbing` | Publish every frozen authoritative writer family in the same transaction as canonical mutation, including ordered tombstones and rollback exclusion. | Retain, consolidation, curation/document, observation maintenance, transfer, mental-model/directive, and Bank/config writers. |
| `TAKI-HS-005` | Accepted | `upstream-gap` | Materialize cursor-bound repeatable-read logical snapshots into immutable hashed pages with integrity manifests and expiry cleanup. | `engine/logical_snapshot.py`, canonical bulk serializers, snapshot migrations, backup/portable-transfer classification. |
| `TAKI-HS-006` | Under xhigh audit | `integration-plumbing` + `taki-policy` | Expose the independently versioned compatibility manifest, journal/snapshot APIs, fail-closed capability handshake, OpenAPI, and generated clients. OpenAPI-facing errors use one shared typed envelope per operation so Progenitor 0.11 can generate the maintained Rust client; the wire `error` discriminator and concrete JSON responses remain unchanged. | Built-in `/ext/taki-memory` routing and global auth; `TakiCompatibilityManifest`, `LogicalChangePage`, `LogicalSnapshotMetadata`/page, and Slice 0A CAS/revision schemas; canonical `hindsight-docs/static/openapi.json` and bank-template schema; Rust `build.rs`/Progenitor generation and runtime `uuid` dependency are green. TypeScript generation is blocked by missing locked `node_modules` (the unpinned `npx` fallback fetched 0.99.0 and fails under Node 24); Python and Go generation require Docker image `openapitools/openapi-generator-cli:v7.10.0` and the Docker daemon is not ready; docs-skill generation is blocked by the repository CRLF shell script under WSL. Do not mark accepted until maintained-client/docs generation and pinned 0.9.0 compatibility checks are complete. |

## Migration Ledger

| Revision | Patch | Purpose | Maintenance note |
| --- | --- | --- | --- |
| `c4a7e2d9b1f6` | `TAKI-HS-002` | Add authoritative memory-unit revisions. | Preserve live/archive revision continuity and migration backup coverage. |
| `d5b8f1c3a7e2` | `TAKI-HS-002` | Add mutation receipts. | Bank lifetime deletion clears receipts; individual record deletion does not. |
| `e6c9a4f2b8d1` | `TAKI-HS-003` | Add provider lineage, durable Bank state, and logical journal. | Durable Bank state intentionally has no `banks` foreign key. |
| `f7d0a5c3e9b2` | `TAKI-HS-005` | Add logical snapshot metadata and immutable pages. | Accepted on 2026-08-11; the final unshipped schema intentionally has no foreign key to mutable `replication_bank_state`. |

## Upgrade And Rebase Procedure

1. Record the new upstream version, immutable tag/commit, and schema head before
   changing the patch series.
2. Re-evaluate each patch ID against the new upstream source. Mark it `retire`,
   `replace-with-upstream`, `rebase`, or `taki-policy-still-required`.
3. Rebase migrations without rewriting any revision already shipped to users.
   Unshipped revisions may be squashed only before the supported build identity
   is frozen.
4. Re-run the patch's focused tests, migration/DAG/backup gates, native bounded
   regressions, and the final combined compatibility suite.
5. Regenerate OpenAPI and maintained clients from the canonical public surface.
6. Advertise compatibility only for the exact build identity that passed the
   combined gate. A healthy but unrecognized Hindsight build remains
   unsupported and must fail closed.

## Entry Requirements For Future Changes

Every new Hindsight modification must add or update one patch entry with:

- upstream baseline and affected patch ID;
- generic Hindsight gap versus Taki-specific behavior;
- exact source, migration, schema, API, and generated-file impact;
- data compatibility, rollback, backup/restore, and rebase implications;
- focused RED-to-GREEN evidence and final verification commands;
- known unsupported backends or deployment modes;
- upstream issue/PR or explicit reason the patch remains local.

## Evidence Index

- `prd.md`: frozen user-visible goal and acceptance criteria.
- `info.md`: checkpoint-by-checkpoint design and Leader acceptance evidence.
- `../08-09-hindsight-memory-provider/research/batch0-hindsight-source-exploration.md`:
  source seams, writer inventory, and TDD matrix.
- `../08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md`:
  authority, replication, recovery, and compatibility rationale.
