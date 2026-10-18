# B1 independent Core check

## Scoped verdict

PASS for the assigned B1 Core composition, evidence validation, overlay/default storage, migration 058 and
registry slice after the fixes below. This is not acceptance of all B1, Stage 5B, B2/B3, Native execution or
manual/operator behavior. Root must reconcile the separate Native/Shared/compatibility review before B2.

The review ran in `H:/TakiAgent`, branch `main`, HEAD
`2e244d0fdee49fb2c582a4333a9ef1573fa9112a`, under the explicitly assigned
`10-07-hindsight-template-lifecycle` task and main session
`codex_01a115ba-a485-7342-a980-c16dbc3f3496`. The global `.current-task` file is empty; no pointer, task or
session was created or changed by this checker.

The assigned 25-file release matched every entry hash at review entry. Root additionally authorized the
four adjacent migration tests, and this review added one receipt regression file: 30 owned files in total.
Nine existing files changed and one was added relative to review entry. The only production-code fix is in
`template-receipt.ts`; all other review changes are tests, fixture support or the local directory index.

Final identities and evidence hashes are recorded in
[`b1-independent-core-final-source.json`](b1-independent-core-final-source.json), SHA-256
`210b2009940b5efae6c645395d660fe2a7d4426f00fc7a3a176ab3400880ed7f`.

## Findings (fixed)

### 1. Current object progress was checked only for refresh children

- File: `packages/core/src/memory/hindsight/template-lifecycle/template-receipt.ts:38,62`.
- Issue: a model or directive without a refresh child could present a regressed revision, different payload at
  the same revision, or a changed definition without advancing its revision. Matching the effective projection
  and a rehashed original receipt did not reject those inconsistent current proofs.
- Fix: compare every currently present model/directive with its expected-snapshot proof. Revisions cannot
  decrease; equal revisions require equal payload hashes and complete definitions. Consequently a definition
  update must advance the revision. Existing child-specific identity/revision checks remain in force.
- Regression: `template-receipt-guards.test.ts:28` exercises both resource kinds, revision rollback,
  same-revision payload inconsistency and definition changes without version progress. It also accepts valid
  unchanged/currently advanced proofs while checking that the original receipt is not rewritten.

This deliberately does not require a later current snapshot hash or clock to equal the original apply-time
receipt. Legitimate refresh/content progress remains compatible with an unchanged applied definition.

### 2. Original receipt journal movement was not tied to the effective Core delta

- File: `packages/core/src/memory/hindsight/template-lifecycle/template-receipt.ts:36,55`.
- Issue: a receipt could claim no logical progress after effective config/resource changes, or claim progress
  for a Core no-op, while all earlier hash/identity/projection checks still passed.
- Fix: a pure Core preview with effective deltas requires `journal_after > journal_before`; a no-op or
  refresh-admission-only preview requires equality. The guard checks the original receipt only and does not
  prescribe an exact event count.
- Regression: `template-receipt-guards.test.ts:59` constructs correctly rehashed inconsistent receipts for
  both changed and unchanged requests. Existing refresh-only and later-current-proof coverage remains green.

The Native reviewer confirmed that the actual non-memory-unit producer advances the logical journal for
definition changes. These guards do not infer Native behavior solely from the Core test double.

### 3. Full-registry migration tests stopped at 057

- Files: `041-canonical-memory-maintenance.test.ts:57`,
  `053-memory-transition-candidates.test.ts:34`, `054-memory-transition-publication.test.ts:66`, and
  `lineage-reopen-matrix.test.ts:48,85,211` under `packages/core/src/db/migrations/`.
- Issue: current-head and upgrade-tail assertions excluded the newly registered 058 migration. The explicit
  historical lineage tail also omitted 058, and the final schema check did not assert its tables.
- Fix: update only current full-registry heads/tails to 058, include 058 in the explicit upgrade list, and
  require all eight overlay/default tables. Preserve fixed historical versions and their byte/history checks.
- Evidence: the four original test files first produced 16 failures and 13 passes. After correction, all
  29 cases pass inside the final 80-test run, including physical reopen and historical lineage preservation.

All 59 historical production migration source files with versions below 058 are tracked and have no diff
against the entry HEAD. Migration 058 itself retains its released hash; no historical migration was edited.

### 4. Adjacent physical migration fixtures leaked after early assertions

- Files: `packages/core/src/db/migrations/053-memory-transition-candidates.test.ts:10` and
  `packages/core/src/db/migrations/054-memory-transition-publication.test.ts:10`.
- Issue: physical database handles and temporary roots were not registered for failure-path teardown. The
  retained migration red run exposed leftover files after assertions aborted normal cleanup.
- Fix: register every opened fixture database and temporary root, close handles in `afterEach`, and validate
  the resolved root against the current temporary directory and the fixture-specific prefix before calling
  the existing `rmTempDir` helper. No original database or unrelated temporary directory is touched.

### 5. Outermost COMMIT failure lacked a combined selection/default regression

- File: `packages/core/src/memory/hindsight/template-lifecycle/template-overlay-store.test.ts:118`.
- Issue: earlier tests covered guard failures and nested rollback but did not directly prove that selection
  and default publication remain atomic when the enclosing SQLite COMMIT itself fails after both final guards.
- Fix: add a real deferred foreign-key violation triggered by default-history insertion. Assert both guards
  executed, selection/default histories and pointers rolled back together, and desired enrollment/user history
  survived. Remove only the fixture trigger, then successfully publish on the same connection and check FKs.
- Result: production transaction code required no change; the new failure-path regression passes.

## Supporting fixture and specification changes

- `template-test-fixtures.ts:47,68` now preserves unchanged proofs, advances changed-definition proofs and
  keeps no-op journals unchanged. It remains explicitly a Native-shaped Core unit-test double, with no claim
  to prove Native authentication, PostgreSQL atomicity, provider execution or exact event accounting.
- `template-integrity.test.ts:17` and `template-test-fixtures.ts:77` use structurally valid object/properties
  response schemas while retaining Unicode, prototype-like-key and complete-trigger hashing coverage. This
  follows the Native reviewer's coordinated Shared validator correction; Shared production files were read-only
  for this reviewer.
- `template-lifecycle/index.md:12,17` describes the updated receipt and fixture boundaries.
- The Native reviewer owns `.trellis/spec/backend/hindsight-template-lifecycle.md`. The final live text at
  lines 30-36 includes both Core contracts above. Its lines 87-89 explicitly preserve the boundary between
  Shared structural validation and Native `croniter` semantics; this report does not claim identical complete
  cron input semantics across both languages.

## Verification

All test, typecheck and lint commands were serialized. Every Vitest command used at most two workers.
Every log below has a same-stem `-result.json` with the exact command and exit code.

| Evidence stem | Exact observed result | Role |
| --- | --- | --- |
| `b1-independent-core-red-01` | Exit 1; 1 failed file; 8 failed / 2 passed | Receipt guards before the production fix; retained |
| `b1-independent-core-lineage-red-01` | Exit 1; 4 failed files; 16 failed / 13 passed | Adjacent migrations before correction; retained |
| `b1-independent-core-green-01` | Exit 0; 10 files / 80 passed; Vitest 11.63 s | Final Core scope and adjacent migrations |
| `b1-independent-core-shared-01` | Exit 0; 2 files / 44 passed; Vitest 698 ms | Requested validation of frozen Shared inputs |
| `b1-independent-core-typecheck-01` | Exit 0; wrapper elapsed 33.55 s | Current Core package typecheck |
| `b1-independent-core-lint-01` | Exit 0; wrapper elapsed 55.84 s | Actual root `pnpm lint` script |
| `b1-independent-core-hygiene-01` | Exit 0; all 30 owned files pass | Scoped diff/UTF-8/no-BOM/trailing-whitespace check |

Exact receipt red command:

```text
pnpm --filter @taki/core exec vitest run src/memory/hindsight/template-lifecycle/template-receipt-guards.test.ts --maxWorkers=2
```

Exact adjacent migration red command:

```text
pnpm --filter @taki/core exec vitest run src/db/migrations/041-canonical-memory-maintenance.test.ts src/db/migrations/053-memory-transition-candidates.test.ts src/db/migrations/054-memory-transition-publication.test.ts src/db/migrations/lineage-reopen-matrix.test.ts --maxWorkers=2
```

Exact final Core command:

```text
pnpm --filter @taki/core exec vitest run src/memory/hindsight/template-lifecycle src/db/migrations/058-hindsight-template-overlays.test.ts src/db/migrations/index-list.test.ts src/db/migrations/041-canonical-memory-maintenance.test.ts src/db/migrations/053-memory-transition-candidates.test.ts src/db/migrations/054-memory-transition-publication.test.ts src/db/migrations/lineage-reopen-matrix.test.ts --maxWorkers=2
```

Exact Shared, typecheck and lint commands:

```text
pnpm --filter @taki/shared exec vitest run src/hindsight-template-validation.test.ts src/hindsight-template-schema.test.ts --maxWorkers=2
pnpm --filter @taki/core typecheck
pnpm lint
```

The hygiene result records the full `git diff --check -- <30 owned paths>` argument array. A separate strict
UTF-8/no-BOM/trailing-whitespace read includes all owned files, including untracked additions that ordinary
`git diff --check` cannot cover.

The final 80 Core cases comprise the previous 40 Core cases, 11 added regressions and 29 adjacent migration
cases. The earlier 66-case Core compatibility/composition run already included those original 40; its count
must not be added again to this result. Shared's 44 cases are reported separately.

## Source identity, prior evidence and cleanup

- `b1-independent-core-source-before.json` records the original 25 Core files and three Shared consumers;
  every entry matched the released hashes. `b1-independent-core-lineage-before.json` records the four
  subsequently assigned migration tests before correction.
- For the final Core tests, Core typecheck and root lint, all 30 owned file hashes plus three Shared consumer
  hashes match before execution, after execution and at final manifest creation. The Shared result likewise
  records equal before/after/final hashes for its three inputs and two test files.
- The immutable `packages/core/src/memory/hindsight/taki-bank-template-v1.ts` remains 6,401 bytes with SHA-256
  `9d1f05100444af6c03f319df98cb04bfcf5bfe2504d0c059f2731ee531346952`.
- Original implementation reports, `b1-composition-final-source.json`, `b1-final-source.json`, the root handoff,
  `pre-b1-baseline.json`, and the old Core 66/typecheck/lint evidence were read for provenance and scope.
  Source-identity evidence is reused for untouched release files. Prior tests are not presented as new
  independent runs or as final verification of the modified receipt/Shared semantics. Existing logs,
  release manifests and the root handoff were not overwritten; this review emits new artifacts.
- The two physical Core runs used distinct TEMP/TMP roots under `.trellis/.runtime/`. The migration red run
  left six files and the green run left one file after their processes exited. Each exact isolated root was
  checked and removed only after process exit; both roots are absent at final verification. The retained
  result files record this cleanup. Receipt red and Shared tests did not need physical database fixtures.
- `python3` was an unusable Windows Store alias. The existing `python` successfully loaded the fallback
  context package list and performed local evidence checks; no dependency was installed.
- No Core-owned validation process remains. After the Core/Shared tests, Core typecheck and root lint completed,
  the heavy-check slot was explicitly handed to `stage5b_b1_native_check` and root was notified. Remaining
  work after that handoff was static identity/format validation and this report.

## Changed-file manifest

Paths below are relative to `packages/core/src/`. The final source JSON contains the full 30-file manifest,
before/after SHA-256 values, unchanged entries, Shared input identities and evidence hashes.

| Path | Change |
| --- | --- |
| `db/migrations/041-canonical-memory-maintenance.test.ts` | Current full-registry head/tail includes 058 |
| `db/migrations/053-memory-transition-candidates.test.ts` | Current tail plus physical fixture teardown |
| `db/migrations/054-memory-transition-publication.test.ts` | Current tail plus physical fixture teardown |
| `db/migrations/lineage-reopen-matrix.test.ts` | Explicit 058 tail, latest-head assertions and eight tables |
| `memory/hindsight/template-lifecycle/index.md` | Receipt/fixture responsibility descriptions |
| `memory/hindsight/template-lifecycle/template-integrity.test.ts` | Valid structured response-schema fixture |
| `memory/hindsight/template-lifecycle/template-overlay-store.test.ts` | Outermost COMMIT rollback regression |
| `memory/hindsight/template-lifecycle/template-receipt-guards.test.ts` | Added ten adversarial/positive receipt cases |
| `memory/hindsight/template-lifecycle/template-receipt.ts` | All-resource proof progress and original journal checks |
| `memory/hindsight/template-lifecycle/template-test-fixtures.ts` | Consistent proof/journal doubles and response schema |

## Findings (not fixed) and boundaries

No unresolved finding remains within this assigned Core scope. Operation orchestration, durable unpublished-effect
holds, trusted per-fact policy wiring and complete current-Bank publication belong to B2. Home/operator flows
and paired backup/restore equality belong to B3. Their absence is not represented as passing behavior here.

Native authentication, provider execution/guards, PostgreSQL transactions, Native backup inventory,
compatibility adapters, generation and Native platform typecheck limitations belong to the separate reviewer.
This Core report cannot close those gates. Automated source tests do not establish installed/manual acceptance.
No real service, original database, credential, actual model call, new dependency, Git lifecycle operation or
task finish/archive was used or authorized by this report.

The checker releases all 30 Core source/test files with this report. Root owns subsequent acceptance and
dispatch; the Native reviewer owns the current heavy-check slot.
