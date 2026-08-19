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
| `TAKI-HS-006` | Accepted | `integration-plumbing` + `taki-policy` | Expose the independently versioned compatibility manifest, journal/snapshot APIs, fail-closed capability handshake, OpenAPI, and generated clients. Taki endpoints require explicitly authenticated tenant deployments; anonymous/default deployments fail closed. OpenAPI-facing errors use one shared typed envelope per operation so maintained clients decode actual 401/422 and operation failures consistently; the wire `error` discriminator remains stable. | Hindsight commit `52b5faad` implements the compatibility extension and focused contracts; `64fa85f8` regenerates the canonical OpenAPI, docs, and Rust/TypeScript/Python/Go clients and preserves the checked-in Go `go.mod`/`go.sum`. Hotspots include built-in `/ext/taki-memory` routing and Bearer security; compatibility, journal, snapshot, CAS/revision, and source-level `TakiDispositionTraits` schemas; canonical OpenAPI/bank-template artifacts; and maintained clients. HTTP/Supabase, migration/replication/snapshot, OpenAPI, client, lint/type, diff, and focused live `localhost:8888` gates pass. The full generated-client online suite was not rerun in the final turn, and Oracle end-to-end replication remains unavailable; neither is advertised as completed. |
| `TAKI-HS-007` | Accepted | `integration-plumbing` | Enforce an LF working-tree checkout for the standalone startup script so a Linux container can execute its shebang when the Hindsight checkout is built on Windows. This is a packaging/runtime portability fix only; it does not change startup behavior. | Hindsight commit `f700d9ac` adds `.gitattributes` with `docker/standalone/*.sh text eol=lf`. The tracked `docker/standalone/start-all.sh` blob was already LF; the attribute prevents Windows checkout conversion from reintroducing CRLF. A Windows-built `api-only` image executed the LF-only script, initialized embedded PostgreSQL, reached `/health`, and survived restart on 2026-08-18; the post-restart retest on 2026-08-19 again reached `/health` and the authenticated compatibility manifest. |
| `TAKI-HS-008` | Accepted | `integration-plumbing` | Normalize deterministic whitespace in generated clients so repeated regeneration cannot reintroduce trailing whitespace or multiple blank lines at EOF. This is reproducibility and maintenance plumbing only; it does not change the wire contract. | Hindsight commit `7eca2056` updates `scripts/generate-clients.sh` to normalize generated Python API/model source and Go text output at generation time, and normalizes the affected generated files. The defects were exposed by `git diff --cached --check` only after the new generated files had been staged; ordinary `git diff --check` could not inspect those untracked files. |

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
