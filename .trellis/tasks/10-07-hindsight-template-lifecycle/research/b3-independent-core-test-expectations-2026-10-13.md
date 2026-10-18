# Independent correction of four Core regression expectations

Status: scoped PASS. The four authorized test files are corrected and frozen; all 41 cases and the four-file
ESLint check passed against unchanged recorded inputs. Root has reclaimed the sole heavy-check slot for the
remaining Core/Healthy diagnostics. This report does not establish a whole-Core or whole-Stage-5B pass.

## Scope and preserved failure evidence

Root transferred only these four tests and this review's research artifacts:

- `packages/core/src/db/pending-memory-repo.test.ts`
- `packages/core/src/db/scheduled-task-repo.test.ts`
- `packages/core/src/memory/hindsight-backup/hindsight-backup-receipts.test.ts`
- `packages/core/src/memory/hindsight-backup/hindsight-backup-native-route.test.ts`

Production, migrations, schemas, locks, specs, common fixtures/harnesses and other tests were not modified.
Other agents continue in separate scopes; no preexisting change was reverted and no nested agent was started.

The original `b3-whole-core-tests-01-result.json` and log remain unchanged: 522 files, 31 failed / 4,077 passed /
one skipped; exit 1, 3,761.61 seconds. This review addresses five failed expectations in four files, not all
31 failures. There is no repeat of the full Core suite or Healthy matrix in this scope.

## Findings (fixed)

### C1. Historical migration-tail assertions stopped at 057

- Files: `pending-memory-repo.test.ts:172`, `scheduled-task-repo.test.ts:12`.
- Evidence: the canonical explicit registry `db/migrations/index-list.ts` appends migration 058 (template
  overlays) and 059 (template execution). The full-suite failures showed exactly those two successful additions.
  The append-only lineage contract requires the complete current tail while preserving historical values.
- Fix: append literal `58, 59` to the existing explicit `35..57` and `30..57` expected arrays. Keep the populated
  database, ownership/data-preservation assertions and the second-reopen/idempotency assertions unchanged.
  No expected array is derived from the production registry, and no migration implementation was changed.

### C2. The pinned receipt map omitted two accepted template proof kinds

- File: `hindsight-backup-receipts.test.ts:53`.
- Evidence: `hindsight-backup-receipts.ts:37` already includes the original published template Apply receipt and
  the persisted semantic refresh-result marker. Native's immutable receipt/result tables supply these proofs;
  `includeTemplates` remains an explicit v2 choice for membership and leaves historical v1 bytes intact.
- Fix: add the exact independent expectations `B2 original template Apply receipt, published` ->
  `memory_template_receipts` and `B2 persisted semantic refresh-result marker claim` ->
  `memory_template_refresh_results`. Preserve every original mapping and the native-table/id nullability check.

### C3. Two route tests expected capture-level errors before the client could return a valid response

- File: `hindsight-backup-native-route.test.ts:68`.
- Preserved inputs: a successful HTTP body echoing another `backupId`, and a proof with `banks: "none"`.
- Contract proof:
  1. `.trellis/spec/backend/error-handling.md:105` requires `HINDSIGHT_RESPONSE_INVALID` for an invalid declared
     payload, with no partially accepted evidence.
  2. `hindsight/hindsight-backup-client.ts:110` parses the strict v1/v2 wire response and verifies version,
     echoed backup ID and v2 request hash before returning the response to the route.
  3. `hindsight/hindsight-client.ts:272` converts parser failures to `HindsightError/HINDSIGHT_RESPONSE_INVALID`;
     its request catch preserves that typed error.
  4. `hindsight-backup-native-route.ts:70` logs only the sanitized code and rethrows it. The adjacent existing
     tests already require this same behavior for authentication, unsupported-build and malformed-artifact errors.
  5. `hindsight-backup-service.ts:221` wraps the route's promise in `stepAsync(..., () => NATIVE_FAILED)`.
     `hindsight-backup-failure.ts:29` maps non-backup errors at that step. The operator capture outcome therefore
     still follows `.trellis/spec/backend/memory-hindsight-backup.md:284` and remains `NATIVE_FAILED`.
- Fix: retain both bad responses, change only the test description and expected typed error to the existing
  client-layer refusal, and document the capture mapping in a short comment. No production defect was found
  at this boundary and no error handling or validation behavior was changed.

## Source and exact diff

`b3-independent-core-test-expectations-source-01.json` records the four pre-edit hashes, the four final test
hashes, ten read-only registry/producer/spec inputs, the exact four-file diff and planned argv.

The diff contains only one changed line in each migration test, two explicit mapping entries, and the two-case
route expectation/comment correction. All four source files were frozen immediately after this review and
released for root's serial check scheduling.

## Verification

Both commands ran serially under root's explicit slot grant through the existing `run-b3-whole-check.py`,
using its isolated environment and temporary root. The original full-suite failure remains the red baseline.

| Check | Exact scope | Result | Recorder duration | Evidence prefix |
| --- | --- | --- | --- | --- |
| Tests | The four existing files, `pnpm --filter @taki/core exec vitest run --maxWorkers=2` with the recorded `src/...` paths | Exit 0; 4 files / 41 cases passed; Vitest 8.20 seconds | 14.187 seconds | `b3-whole-independent-core-expectations-tests-01` |
| Lint | Root-configured `pnpm exec eslint` over exactly the four owned test files, without auto-fix | Exit 0 | 8.532 seconds | `b3-whole-independent-core-expectations-lint-01` |

- Tests ran from `2026-10-13T05:28:42.424828+00:00` to `2026-10-13T05:28:56.601852+00:00`.
  Per-file counts are 23 (pending memory), 3 (scheduled tasks), 3 (receipt map), and 12 (Native route).
- Lint ran from `2026-10-13T05:31:45.633507+00:00` to `2026-10-13T05:31:54.166487+00:00`.
- Each prefix has a `-result.json`, `.log`, `-inputs.json`, and `-inputs-after.json`. Each result records
  2,417 inputs, `changedInputs: []`, `temporaryRootRemoved: true`, and `remainingFixtureEntries: []`.
- The original static source record was not rewritten. Its SHA-256 remains
  `c7011bfba2cd4fb8a92ab599c8cd523abea03619d6893b9febf58795e4002b85`; the four tests and ten read-only
  dependencies matched their recorded hashes before verification. No source changed during either command.
- Recovery after the tool-server interruption read the completed test artifacts without rerunning the tests.
  Both processes have exited, and root reclaimed the sole check slot after the lint completion.
- Typecheck/build: not rerun for this expectation-only correction; root owns the consolidated quality gate.
  The earlier Native Linux typecheck is separate evidence and does not cover these Core tests.

## Findings (not fixed)

No unresolved issue remains within these four corrected expectations, and no production defect was established
at their boundaries. The other whole-Core failures remain with root and the Core reviewer and cannot be
accepted by this report. No full-Core, Healthy, Native, SDK, or generator check was repeated in this batch.
