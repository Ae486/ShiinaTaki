# Batch 2 Legacy Migration - Tracer-Bullet Execution Plan

## Execution protocol

Planning only until the task is explicitly activated. Each wave follows RED -> GREEN -> focused gate -> rollback point.
Tests use temporary roots, immutable snapshots, and SQLite; no Hindsight service or network. Do not mark manual owner
acceptance complete. This is a one-time, non-destructive migration: the original Markdown tree is preserved read-only,
and converter/runner code is offline/operator-only, never a permanently resident dual-format runtime adapter.

## Wave 0 - Evidence, fixtures, and contract inventory

**Ownership:** migration fixtures/builders/tests and research/index notes only. No production runtime wiring.

**RED:** Add exact live-code fixtures for missing origin, arbitrary non-empty IDs, quoted/unquoted scalars, unknown scalar
keys, CRLF/LF, no terminal newline, independent `updated`/`reinforce_count`, archived/expired, whitespace-only entry
bodies, duplicate physical evidence, ownership mismatch, malformed frontmatter, reparse/traversal, and every registered
Block including note-stripped-empty content.

**GREEN:** Table-drive from the live codec and registry. Assert raw byte/hash/path preservation, exact closed diagnostic
codes, and that a supported well-formed fixture failing conversion is an implementation defect, not an exclusion.

**Gate:** focused fixtures plus existing entry/frontmatter/store/indexer/block-store/block-isolation/registry suites.

**Rollback:** Remove only new fixtures/harness; never alter legacy codec behavior.

## Wave 1 - Snapshot, normalizer, sanitizer, and identity

**Ownership:** New `legacy-source-normalizer.ts`, `legacy-format-variants.ts`, `legacy-retain-sanitizer.ts`,
`legacy-identities.ts`, `legacy-snapshot.ts`, and focused tests.

**RED:** Prove strict UTF-8/BOM behavior, flat parser grammar, arbitrary legacy IDs, path ownership, safe segments,
timestamp offsets, exact Batch 1 JavaScript string bounds, body/Block empty semantics, sanitizer refusal policy, and
length-delimited domain-separated hashes. Test canonical JSON ordering, set-array ordering, duplicate evidence, and
hash collision resistance.

**GREEN:** Implement allow-listed root walk without following reparse points, exact raw capture, private dry-run snapshot
cleanup, complete immutable backup publication before conversion, free-space preflight, and deterministic normalization.
Do not NFC-normalize entry bodies without an explicit compatibility test.

**Gate:** focused normalizer/snapshot/identity/privacy tests, parser/frontmatter tests, Core typecheck.

**Rollback:** Remove only uncommitted snapshot/normalizer implementation if evidence or ownership checks are wrong.

## Wave 2 - Durable migration ledger and migration 021

**Ownership:** Additive migration 021, migration index/list docs, ledger repository, and ledger tests.

**RED:** Test `(run_id, source_id)` ownership, phase transitions, retries, bounded diagnostics, durable exclusions,
zero/one/many result rows, explicit `result_count`, operation/result hashes, reopen, stale lease rejection, monotonic
fencing, readiness/activation receipts, and changed path/hash exclusion non-inheritance.

**GREEN:** Add runs, sources, attempts, results, exclusions, leases, readiness, and singleton `legacy-markdown` /
`canonical-local` selection state. Raw bytes stay in snapshots. Every mutating statement checks the current lease fence;
expired workers cannot commit. Dry-run creates none of these rows.

**Gate:** migration/reopen/rollback tests and Core typecheck. Applied migrations are never edited in place.

**Rollback:** Before shipping, correct forward SQL/code together. After shipping, use a forward migration; preserve old
rows and snapshots.

## Wave 3 - Canonical Local staging and migration-only importer

**Ownership:** `legacy-canonical-converter.ts`, `legacy-canonical-import-repo.ts`, deterministic retain-payload builder,
Block converter, and focused tests; narrow Batch 1 repository interfaces only for idempotent staging support.

**RED:** Test Bank routing, field mapping, proofCount/lifecycle/expiry rules, exact provenance, canonical tags,
archived exclusion from canonical FTS, whitespace-only versus truly empty bodies, zero-result without a fake unit,
deterministic one-result IDs, synthetic many-result ordering, Block scope/order/writer policy, note stripping, and
conflicting destination hashes.

**GREEN:** Stage source/unit/policy/FTS/Block rows through the migration-only importer. Exact operation replay returns the
same results; different payload hashes fail closed without replacement. The importer uses `actor: migration` internally,
never impersonates `user`/`background`, and never exposes a runtime bypass. Build sanitized provider-neutral payloads only;
never call Local `retain` for zero-result or rely on random ID generation.

**Gate:** converter/importer tests plus canonical repo/provider/Block suites and Core typecheck.

**Rollback:** Drop/rebuild canonical staging from the immutable snapshot while retaining ledger/snapshot and leaving
Markdown/index untouched.

## Wave 4 - Dry-run, resume, and completeness verification

**Ownership:** `legacy-migration-runner.ts`, operator-only migration method, shared params/results, and runner tests.

**RED:** Snapshot ledger/canonical/authority/Markdown/Block bytes before and after dry-run; assert no durable artifact or
temporary copy remains. Interrupt after each phase and resume to identical identities/results. Test exact exception pages,
explicit exclusions, FTS rebuild equivalence, FK/tag/hash/count mismatches, and zero/one/many cardinalities.

**GREEN:** Implement fenced one-flight leases, bounded paginated operator results, deterministic retry from the earliest
safe phase, isolated dry-run cleanup on all paths, staged-run publication, and final completeness/integrity verification.
The runner is constructed only for an explicit offline/operator request; it is excluded from startup, retain, recall,
mutation, assembly, and background maintenance. Every unresolved non-excluded source remains blocking.

**Gate:** focused runner/operator tests, full Core memory/migration tests, Core typecheck.

**Rollback:** Mark attempts failed and rebuild staging from the snapshot; never delete evidence or mark cutover ready on
partial verification.

## Wave 5 - Quiescence, activation marker, runtime selection, and recovery

**Ownership:** `legacy-activation-repo.ts`, the narrow authority gate/runtime facade, startup seam in
`memory/bootstrap.ts`/`main.ts`, and activation/startup tests.

**RED:** Fence admission/drain timeout, final live hash mismatch, reparse/addition/deletion, unresolved ledger, stale
lease, marker transaction rollback, restart-after-commit, marker corruption, post-commit facade-swap failure, no-dual-
write, and no-simultaneous-tool-suite cases.

**GREEN:** Prepare and verify outside SQLite; acquire a shared bounded runtime fence; stop and drain every legacy reader,
writer, reconcile/sweeper, detached auto-memory/flush/compaction, image writer, tidy, retention, Block, prompt, tool, and
operator path; rehash live sources after drain; then run one short synchronous marker transaction with no filesystem I/O
or async gap. Swap to the prepared canonical runtime before reopening admissions. Startup reads the marker before legacy
engine construction. Marker corruption fails closed; post-activation runtime never falls back to mutable Markdown. After
the marker commits, bind only the canonical Local runtime; do not retain a converter, legacy translator, or dual-format
adapter in normal startup or background paths.

**Gate:** activation/recovery tests, filesystem sentinel tests for every retirement seam, legacy/canonical tool-set tests,
full Core memory/agent/startup tests, Core typecheck and boot smoke where startup wiring changed.

**Rollback:** Before marker commit, discard/rebuild staging. After commit, recover canonical selection from the marker;
never silently revert to Markdown. If the in-process swap fails after commit, keep the process fenced and fail/restart;
do not reopen legacy.

## Wave 6 - Privacy, regression convergence, and handoff

**Ownership:** focused privacy/regression tests, affected directory indexes, and final planning gates. No UI or Hindsight.

**RED/GREEN:** Sentinel content/query/secret tests prove logs, receipts, errors, status, and operator pages are bounded.
Run legacy store/indexer/tools/Blocks/auto-memory/tidy/retention/image/compaction tests, Batch 1 canonical suites,
restart/failure matrix, and startup smoke for both authority markers. Review the diff for forbidden Hindsight, replica,
UI, deletion, dual-write, permanent compatibility-adapter, or fallback scope.

**Gate:**

```powershell
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/shared test
pnpm --filter @taki/core typecheck
pnpm --filter @taki/core test
pnpm lint
pnpm -r --parallel typecheck
git diff --check
python ./.trellis/scripts/task.py validate .trellis/tasks/08-09-memory-legacy-migration
```

**Rollback:** If activation is unsafe, leave the marker on legacy and remove runtime binding while preserving canonical
staging, ledger, and snapshots for inspection. Fix only verified defects.

## Final review gate

Compare the implementation diff against `prd.md`, `design.md`, the migration map, Batch 1 contracts, ADR 0009, backend
database/error/logging/quality specs, and all affected legacy/canonical suites. No Acceptance Criterion is marked complete
in planning artifacts; manual operator acceptance remains pending.

## Accepted verification evidence

- Shared verification scope: 31 files and 319 tests passed.
- Core verification scope: 232 files and 1,549 tests passed; focused migration suites covered 9 files and 42 tests.
- Repository gates passed: `pnpm lint`, recursive workspace typecheck, `git diff --check`, and
  `python ./.trellis/scripts/task.py validate .trellis/tasks/08-09-memory-legacy-migration`.
- UTF-8/no-BOM validation passed for 35 reviewed files.
- Isolated Core boot smoke passed on port `18975`; startup applied migrations 1 through 21 and reported the WS server listening.
- Manual operator Acceptance Criteria remain pending and are not claimed complete by this evidence.

## Post-activation Governance repair

- Owner acceptance reproduced `GOVERNANCE_DENIED` for canonical `recall` and `retain`: the Core Governance adapter
  still bound only legacy `memory_search`, `memory_write`, and `memory_archive` keys after canonical Local activation.
- Canonical names now reuse the existing default-auto stable policy identities: `recall`/`reflect` -> memory search,
  `retain`/`update_memory`/`restore_memory` -> memory write, and `invalidate_memory` -> memory archive. Unknown Core tools
  remain fail-closed.
- The regression test failed before the binding repair and passes after it. Focused Governance/Memory/Chat Agent tests
  pass (6 files, 18 tests); full Core passes 232 files and 1,551 tests; Core typecheck, root lint, task validation, and
  `git diff --check` pass.
- Final owner confirmation must come from retrying canonical Memory tools through the real Agent; automated evidence
  does not mark that manual acceptance complete.
