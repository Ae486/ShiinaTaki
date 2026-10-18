# B1 Core composition implementation

Status: assigned Core slice complete and source ownership released to the leader/Native integration owner. Scope is the new `packages/core/src/memory/hindsight/template-lifecycle/` directory,
new Core migration 058 and its registry/index updates. No B2 executor/runtime/hold work or Home work.

## Baseline and authorization

- Workspace `H:/TakiAgent`, branch `main`, HEAD `2e244d0fdee49fb2c582a4333a9ef1573fa9112a` verified.
- Core head 057 verified before reservation. Legacy v1 and existing migrations remain unchanged.
- Assigned-path before hashes: `b1-composition-baseline.json`; parent baseline: `pre-b1-baseline.json`.
- Read B PRD/design/implementation/review-plan/leader-now, source research, Core/SQLite/quality contracts,
  current Shared wire definitions/codec, v1 source, canonical Bank identity and layer registry.
- Ownership transferred from Native/Shared owner; that owner retains Shared/Native/generator files.
- User communication is Chinese; engineering artifacts are English. No commit/push/archive, original data,
  credentials, service/model calls, dependencies or child agents.

## Current implementation

- Added detached immutable v2 catalog derived from legacy missions and existing scope layer registry.
- Added independent explicit user revisions, complete resource values, inherit/suppress distinction and strict
  canonical Bank/lineage/generation identity.
- Added frozen-codec hashing, snapshot proof/selector completeness checks and bounded request signer.
- Added evidence-qualified fresh/reviewed-existing enrollment captures, with no guessed legacy ownership.
- Added complete `entity_labels` composition preserving unrelated groups, original stored presence and free-form behavior.
- Added exact normalized Native preview/request/deltas, complete deletion consequences and explicit provider-work choices.
- Added original receipt validation and independent current-definition verification, with apply-time child evidence
  retained after a Sync refresh advances the model before Apply returns. This is configuration admission, never permission
  to execute an old child; Native keeps its strict apply-time revision/hash execution guard.
- Added additive 058 storage: immutable exact-incarnation identity, before-image captures, catalog/user/selection/default
  history and CAS applied/default pointers. No legacy ownership backfill and no operation executor/journal.
- Added narrow read/write adapters, full receipt/ownership reconstruction, final synchronous publication guards,
  nested-transaction rollback and independent desired/applied user revisions.

Native owner confirmed direct complete-definition hashing and normalized snapshot/request/receipt domain hashing.
Suppressing a preexisting model cannot silently claim success by deleting an unowned resource: it must refuse
unless a reviewed action has sufficient ownership evidence. Model refresh execution is exclusively Native-owned.

## API handoff

- `loadManagedTemplate(revision, scope)` returns detached `taki-bank-v2` contributions; source digests pin the revision.
  The old `loadTakiBankTemplate`/verifier is untouched. Revision `none` is an explicit selection, not a failed v1 import.
- `selectTemplateResources(...)` freezes a complete bounded selector set. The caller mints directive UUIDs before
  snapshot; it never adopts a UUID by name. `captureTemplateEnrollment(...)` accepts fresh absence or explicit
  `reviewed-existing` with the exact snapshot hash. `untracked` refuses. Later newly selected resources need new
  immutable captures; before-images from earlier captures are preserved.
- `previewTemplateOverlay(...)` takes enrollment, current snapshot, selected catalog/null, independent user revision,
  Core-minted request ID, and previous projection/receipt-proven ownership. It returns the exact Native request,
  effective projection/digest and bounded deletion/provider-work consequences. It performs no I/O/model calls.
  Ordinary drift refuses; an explicit exact `reviewedDriftSnapshotHash` permits current inherited-parent reconciliation
  or adoption of external edits that the new explicit user revision actually preserves. The hash alone cannot authorize
  overwriting an external value or deleting an unrelated label group. New/colliding resource capture drift still refuses
  and cannot become creation ownership.
- User `inherit` removes the user contribution (reveals current Taki/base); config `suppress` writes explicit empty
  text, label suppression removes the exact group, model/directive suppression deletes only receipt-proven created
  resources. Existing-base deletion is a conflict, never a silently successful suppression. Complete user resource
  definitions survive Taki removal. Directive selector names are identity/collision anchors, not name-based ownership.
- `createTemplateOverlayStore(db)` exposes `appendEnrollment`, `appendUser`, `storeCatalog`, read accessors and
  `publish`. `publish` validates stored revisions, exact request/receipt and current definitions, derives creation
  ownership, records immutable history and CAS-selects the applied revision. `assertCurrent` is mandatory, synchronous
  and runs after readback immediately before the transaction returns. B2 can nest all Banks in its outer transaction.
- `publishTemplateDefaults` independently CAS-selects per-lineage Global/Character defaults against exact selected
  Bank references. B2 owns complete current runtime inventory and supplies its final guard; per-Bank user edits do not
  become defaults. B2/B3 own operation holds, runtime wiring and paired-backup equality/receipt integration.
- Shared/Python fixed cross-language vectors and Native transactional/authentication gates remain Native owner's scope.

## Checks (actual exits; retained failures)

| Log | Command / result |
| --- | --- |
| `b1-composition-typecheck-01.log` | `pnpm --filter @taki/core typecheck`, exit 0, intermediate tree. |
| `b1-composition-tests-01.log` | One composition file, exit 1 during import: Zod forbids omit on refined objects. No tests executed. |
| `b1-composition-tests-02.log` | Same composition file after projection-schema correction, exit 0, 12 passed. |
| `b1-composition-tests-03.log` | Composition/store/058/registry, exit 0, 4 files / 29 passed. |
| `b1-composition-tests-04.log` | All owned tests plus 058/registry, exit 0, 5 files / 37 passed; before final receipt/drift regressions. |
| `b1-composition-tests-05.log` | Same 5 files, exit 0, 38 passed; includes separate historical-receipt/current-definition refresh readback. Before final external-edit adoption guard. |
| `b1-composition-typecheck-02.log` | Exit 2: a new union-array `flatMap` could not infer the projection element type. Fixed with the exact inferred projection-element union, no cast or suppression. |
| `b1-composition-typecheck-03.log` | Exit 0 after that type correction; before final external-edit adoption guard. |
| `b1-composition-lint-01.log` | Affected-file ESLint, exit 1, six unused destructuring locals. Fixed through the existing hash-omission helper and derived Shared schema fields. |
| `b1-composition-lint-02.log` | Same affected-file ESLint, exit 0. |
| `b1-composition-lint-03.log` | Exit 0, includes final external-edit adoption guard; subsequent small changes only normalize refresh consequences and add a stale-user-revision test. |
| `b1-composition-typecheck-04.log` | Final `pnpm --filter @taki/core typecheck`, exit 0, includes final external-edit adoption guard. |
| `b1-composition-tests-06.log` | Final `pnpm --filter @taki/core exec vitest run src/memory/hindsight/template-lifecycle src/db/migrations/058-hindsight-template-overlays.test.ts src/db/migrations/index-list.test.ts --maxWorkers=2`, exit 0, 5 files / 40 passed, 10.58 s. |
| `b1-composition-lint-04.log` | Final affected-directory/058/registry ESLint, exit 0. Exact command below. |

Focused tests always use `--maxWorkers=2`. Temporary physical SQLite directories are removed by `rmTempDir` in
`finally`; in-memory and file-backed connections are closed. No service/model/original database was opened.

Final lint command:

```text
pnpm exec eslint packages/core/src/memory/hindsight/template-lifecycle packages/core/src/db/migrations/058-hindsight-template-overlays.ts packages/core/src/db/migrations/058-hindsight-template-overlays.test.ts packages/core/src/db/migrations/index-list.ts packages/core/src/db/migrations/index-list.test.ts
```

The final 40 tests supersede the earlier 38-test tree. They cover explicit equal-to-old values, reset/removal,
inherited absent/tombstone and original stored wrappers, complete model/directive values, exact deletion consequences,
fresh/reviewed/untracked enrollment, new selector capture, current-definition and inherited-parent drift, explicit
preservation of externally added groups, strict hashes/triggers/bounds, original child evidence after refresh,
immutable history, stale applied/user CAS, final guard rollback, nested publication rollback, physical reopen,
admitted defaults, fresh/057 migration and SQL/receipt/deferred-COMMIT failure rollback.

## Final source and ownership release

- `b1-composition-final-source.json` records all 25 assigned source/index/test files and the three consumed Shared
  schema/codec file hashes at final validation. Fourteen new production modules, one test-support module, three
  colocated tests and the folder index live under the new lifecycle directory; migration 058 source/test and four
  registry/index files complete the inventory.
- Owned-source UTF-8/no-BOM and trailing-whitespace checks passed for all 25 files. Scoped `git diff --check` exited 0;
  Git only reported its existing CRLF-to-LF normalization notices. New untracked files were checked directly without staging.
- Legacy `taki-bank-template-v1.ts` SHA-256 remains `9d1f05100444af6c03f319df98cb04bfcf5bfe2504d0c059f2731ee531346952`,
  exactly matching the assigned baseline. Both legacy template digests are pinned by tests. No old migration was edited.
- Core production/test files are frozen. Heavy-check slot released to Native owner after final Core tests.
  Native owner is responsible for the parent `hindsight/index.md` integration entry and remaining Native/Shared/SDK work.

## Limits and follow-ups

- This is the assigned Core B1 slice, not whole Stage 5B acceptance. No full Core sweep, independent B1 review,
  live Native integration, real model call, actual-data migration or installed/manual acceptance is claimed here.
- Shared/Python cross-language vectors and actual PostgreSQL/authentication/refresh execution evidence belong to the
  Native owner's report. The Core fixture receipt double is explicitly not evidence of Native transaction atomicity.
- B2 must wire the existing operation journal, executor/hold, complete runtime inventory and all-Bank final publication;
  B3 must verify paired backup/restore equality and receipt accounting. The Core effective-definition digest is over the
  normalized snapshot minus `snapshot_hash` and per-resource `proof`, not an interchangeable generic Native Bank digest.
- Untracked legacy resources, unsupported/oversized state, ambiguous or retargeted directive selectors and suppression
  requiring deletion of an unowned preexisting resource refuse. No original data is adopted or repaired automatically.
- No B2/B3 work, commit, push, finish or archive was started. Per the owner's stop point, independent review is a later
  follow-up, not an unreported pass. All remaining batch integration is handed to the existing Native owner and leader.
