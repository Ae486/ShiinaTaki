# Batch 2: Legacy Memory Normalization and Canonical Local Migration

## Goal

Convert every supported historical Markdown memory entry and applicable Memory Block into Batch 1 canonical Local
records without losing raw evidence, creating duplicate imports, or changing authority mid-flight. Produce a durable,
resumable Migration Ledger and read-only migration snapshot. Only a fully successful, verified run may atomically select
canonical Local authority; this task does not activate Hindsight. This is a one-time, non-destructive migration, not a
permanent dual-format compatibility subsystem.

## Dependencies and evidence

- Batch 1: `.trellis/tasks/archive/2026-08/08-09-memory-provider-foundation/`.
- Parent design: `.trellis/tasks/08-09-hindsight-memory-provider/prd.md` and `info.md`.
- Authority rule: `docs/adr/0009-single-memory-authority-with-local-replica.md`.
- Current/runtime baseline: `docs/MEMORY-DESIGN.md` and `research/current-legacy-migration-map.md`.

## Requirements

### R1. Compatibility normalization

1. Accept the exact historical flat-frontmatter grammar and field matrix frozen in `design.md`, including absent
   `origin`, the snake_case `reinforce_count` disk key, quoted/unquoted scalar values, unknown flat scalar keys,
   CRLF/LF, arbitrary `.md` filenames, and the pre-T5 no-origin fixture. `updated` and `reinforce_count` are independent
   optional fields. A UTF-8 BOM, invalid UTF-8, nested/multiline
   YAML, duplicate key, unsafe placement, or value outside the Batch 1 canonical bounds is exceptional, not silently
   repaired or truncated.
2. Preserve exact raw bytes/text, raw SHA-256, relative path, parser diagnostics, and normalized representation.
3. Validate layer, path-derived ownership, safe character ID (`[A-Za-z0-9_-]+`), status, strict offset-bearing timestamps, importance,
   disclosure and content bounds using the exact Batch 1 JavaScript string-length semantics, optional retention, and Block registry placement. A source inside the frozen
   supported matrix that cannot convert is an implementation defect, not an exclusion category.
4. Keep corrupt, unsupported, ownership-conflicting, and out-of-root sources visible and unmodified; they block cutover
   until explicitly excluded. Exceptional rows use the closed durable diagnostic codes in `design.md`; raw parser/Zod/
   SQLite messages never become operator or log payloads.

### R2. Deterministic identity and provenance

1. Derive collision-safe source, bank-specific document, content-hash, operation, and Local memory identities from the
   frozen domain-separated, length-delimited byte encoding in `design.md`; canonical JSON and result ordering are part
   of that contract.
2. Preserve legacy ID as metadata/provenance, never as the sole canonical key. Physical path and raw hash distinguish
   crash-left duplicate evidence.
3. Canonical source provenance is `actor: system`, `origin: legacy-import`, `sanitized: true`. A versioned sanitizer
   refuses/redacts credentials and hidden prompt/tool envelopes; ordinary email/phone text is not silently deleted
   without an explicit migration policy. Raw evidence remains exact and logs expose no memory content or secrets.

### R3. Dry-run and durable ledger

1. Operator-triggered dry-run is durably read-only: it may use a private temporary copy for a race-free report, but it
   removes that copy before returning and changes no durable snapshot, ledger, canonical row, Block row, authority
   state, legacy file, or marker. It reports exact exceptional source IDs/paths/reasons and planned zero/one/many
   outcomes through a bounded paginated operator result.
2. Persist a Migration Ledger with source identity, snapshot ID, phase, attempt count, diagnostics, exclusion decision,
   canonical source/document/operation IDs, explicit result count, and zero/one/many resulting memory IDs. Runs,
   per-run sources, phase attempts, results, exclusions, fenced leases, and activation receipts survive reopen; resume
   must be deterministic and a stale lease owner must be unable to commit.
3. Exclusion is explicit, durable, scoped to one source identity, reasoned, timestamped, and auditable. It never deletes
   raw evidence and is the only way an exceptional source leaves the required cutover set.
4. The staged path must atomically publish a complete immutable backup/snapshot before any normalization or canonical
   conversion begins. The original Markdown tree remains untouched and read-only evidence throughout and after the run.

### R4. Canonical Local conversion

1. Convert searchable legacy entries to canonical source + Local policy/unit data, preserving lifecycle, layer ownership,
   importance, disclosure, origin, timestamps, expiry/retention projection, raw hash, and provenance.
2. Convert applicable Blocks to structured canonical Block rows under registry scope/order/writer policy. Migration is
   a one-shot preservation path, not an ordinary `user` or `background` writer: it never impersonates either actor,
   overwrites a conflicting canonical row, or exposes a runtime bypass. Blocks remain out of generic units and FTS.
3. Produce a deterministic provider-neutral retain projection and payload hash that later Batches 3/4 can adapt for
   Hindsight, without Hindsight fields, calls, Bank creation, or authority changes.
4. Permit zero-result conversion success in the ledger/source flow without manufacturing a canonical unit; Local retain's
   one-unit minimum remains unchanged.
5. Use a migration-only canonical import repository with deterministic IDs and exact payload-hash replay. It must not
   reuse Local retain's random ID generation or ordinary document-replacement semantics; a conflicting destination row
   blocks cutover.

### R5. Atomic Local cutover and retirement

1. Use an explicit bounded write fence and quiescence strategy. Prepare and verify the immutable snapshot outside the
   final SQLite transaction; after the fence drains every legacy writer, re-stat/rehash the complete candidate set and
   abort on any change or timeout. No legacy mutation may race the verified snapshot.
2. Require one short synchronous SQLite transaction, with no filesystem I/O or async gap, that rechecks the verified
   manifest digest, ledger completeness, canonical readiness, and lease fencing token, then commits one persisted
   runtime activation marker referencing the prepared Local epoch.
3. Dry-run, parse failure, interruption, failed verification, unresolved non-excluded row, or activation error leaves
   legacy Local authoritative. No dual-write is allowed.
4. Pre-activation rollback discards/rebuilds canonical staging while retaining ledger/snapshot. Post-activation ordinary
   runtime never silently falls back to, consumes, or produces legacy Markdown; the converter/runner remains available
   only for explicit offline operator migration/audit and is never a normal runtime compatibility path.
5. The marker is read before legacy engine construction, reconciliation, sweepers, detached writers, prompt assembly,
   or tool composition. A successful activation selects only canonical Local and retires every Markdown read/write path,
   including foreground tools/prompts, pinned/intention/Block assembly, auto episodic and pre-compaction flush writes,
   image-description writes, tidy, retention, and operator maintenance. Canonical and legacy tool suites are never
   advertised together; manual owner acceptance is not claimed complete.

### R6. Operational shape and privacy

Migration may run asynchronously and be operator-triggered where safe; only the final fence blocks legacy writers and it
has a configured timeout. The snapshot stores each raw source once, raw bytes are never duplicated into SQLite, and
preflight proves sufficient disk space before publishing a durable snapshot. Canonical fields obey the exact Batch 1
bounds with no truncation; over-bound sources remain raw exceptional evidence. Logs and ordinary status expose only
counts, stable opaque IDs, phase/status, and sanitized diagnostic codes, never source paths, memory/Block text, queries,
secrets, raw exceptions, or full payloads. Exact snapshot-relative paths are restricted to paginated operator review.
The operator migration/audit service is instantiated on demand and torn down after the request/run; it contributes no
normal startup reader, background worker, prompt/tool binding, or steady-state compatibility cost.

## Acceptance Criteria

- [ ] Fixture matrix proves all supported variants normalize to one validated representation while raw bytes, raw hash,
  path, and parser evidence remain exact.
- [ ] A supported well-formed fixture that cannot be converted fails the implementation test and is not an expected
  exclusion.
- [ ] Ownership, traversal, duplicate physical evidence, unknown layer, malformed Block, and invalid timestamp cases
  produce exact exceptional ledger rows without deleting evidence.
- [ ] Re-running a completed phase and resuming after interruption yields identical identities and no duplicate units,
  Blocks, or receipts.
- [ ] Dry-run proves zero writes by comparing ledger, canonical tables, activation state, Markdown bytes, and Block bytes.
- [ ] Dry-run also leaves no durable snapshot/temp artifact; staged runs publish one complete hash-addressed snapshot
  only after free-space and atomic-publish checks pass.
- [ ] Ledger represents zero, one, and many result IDs and records attempts, diagnostics, exclusion, and terminal state.
- [ ] Canonical records preserve lifecycle/policy/provenance; archived records are not active recall.
- [ ] Blocks convert with registry order/scope/writer policy and are absent from generic units and both FTS projections.
- [ ] Hindsight-ready payloads are deterministic and sanitized but no Hindsight network/Bank/authority operation occurs.
- [ ] Final verification blocks cutover for every unresolved non-excluded row and every integrity/hash/count mismatch.
- [ ] Fence, snapshot, activation marker/epoch, startup recovery, and rollback tests prove legacy remains authoritative
  until one successful activation transaction commits.
- [ ] After activation, startup selects canonical Local and normal runtime neither reads nor produces legacy Markdown or
  advertises legacy tools; only an explicit offline operator audit/migration path may inspect the preserved snapshot.
- [ ] Activation-path tests prove reconcile, auto-memory, flush, image memory, tidy, retention, Block reads/writes,
  prompt instructions, and operator methods cannot touch Markdown after the marker commits.
- [ ] Dependency/boot tests prove converter, importer, snapshot walker, and migration runner are absent from normal
  canonical startup, retain, recall, mutation, assembly, and background-maintenance graphs.
- [ ] Full legacy, canonical Local, Block, startup, tool, auto-memory, and compaction regressions remain green.

## Definition of Done

- English planning artifacts are complete and internally consistent; no owner-blocking product question remains.
- Focused tests are specified for parser, identity, ledger, staging, fence, activation, recovery, rollback, privacy,
  and regressions.
- Typecheck, lint, full relevant tests, `git diff --check`, and `task.py validate` pass during implementation.
- Rollback and operator-run procedures preserve original Markdown evidence.
- Manual operator Acceptance Criteria remain explicitly pending until the owner performs and confirms them.
- No Acceptance Criterion is marked complete before implementation begins.

## Explicitly out of scope

- Hindsight connections, API calls, Hindsight Bank creation/import execution, extension handshake, Hindsight authority, replica
  sync/outbox/outage recovery, or automatic recall/Write Gate overhaul.
- Operator UI, deleting original Markdown, rewriting timeline history, or automatic cleanup of evidence.
- A permanently resident Markdown/canonical dual-format adapter or compatibility layer in normal startup/runtime.
- Active-active Local/Markdown dual-write, automatic authority failover, or fallback from canonical authority to mutable
  Markdown after activation.

## Decision (ADR-lite)

**Context:** Batch 1 provides dormant canonical Local tables/provider but no migration ledger or switch; legacy Markdown
remains the only runtime authority.

**Decision:** Build an immutable filesystem snapshot plus SQLite Migration Ledger and canonical staging flow. Convert
entries and Blocks asynchronously, verify exact source disposition and rebuildable projections, then perform one short
quiescent transaction that records activation epoch/marker and retires legacy runtime selection together.

**Consequences:** Migration resumes safely and zero-result sources are first-class. A failed cutover intentionally leaves
the old system authoritative. Hindsight remains a later provider concern.

## Research references

- [`research/current-legacy-migration-map.md`](research/current-legacy-migration-map.md) - verified live codec/store,
  Block, canonical, authority, and regression map.
- [`../archive/2026-08/08-09-memory-provider-foundation/design.md`](../archive/2026-08-09-memory-provider-foundation/design.md)
  - Batch 1 schemas, transaction, and dormant-activation contract.
- [`../08-09-hindsight-memory-provider/info.md`](../08-09-hindsight-memory-provider/info.md) - parent migration and
  later Hindsight boundary.
- [`../../../docs/adr/0009-single-memory-authority-with-local-replica.md`](../../../docs/adr/0009-single-memory-authority-with-local-replica.md)
  - one-authority and migration safety decision.
