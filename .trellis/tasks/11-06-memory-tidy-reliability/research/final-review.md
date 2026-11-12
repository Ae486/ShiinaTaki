# Final memory tidy reliability review

Date: 2026-11-06. Workspace: `H:/TakiAgent-worktrees/t4`; branch:
`task/t4-skills-mcp-productization`. Task authority is the explicit
`11-06-memory-tidy-reliability` assignment, not the obsolete global task pointer.

## Result

Three confirmed defects were reproduced and fixed by this reviewer. The bounded
final review has no remaining confirmed blocker. Source changes are frozen after
the clean-retry correction. The parent owns the final workspace gates, spec sync,
deployment decision, and owner acceptance; the results below do not replace them.

## Findings fixed by this reviewer

### 1. An unrelated successful edit could dismiss a known failed target

- Files: `packages/core/src/memory/tidy-issues.ts`,
  `packages/core/src/memory/canonical-tidy-review.ts`,
  `packages/core/src/memory/canonical-local-maintenance.test.ts`.
- Reproduction used the real Canonical tools and in-memory SQLite. Block A became
  stale, its write failed, and a later write to Block B succeeded. Explicit finish
  incorrectly accepted B's call as the correction for A, returning `complete: true`
  and one recovered issue while A had not been corrected.
- The ledger now retains a separate internal stable target identity. A correction
  for an identifiable rejected target must cite a later success on that target.
  The target excludes payload so a genuinely revised request remains possible.
  Malformed input without an identifiable target can still use explicit recovery.
- The regression rejects the cross-Block acknowledgement, preserves A, and then
  accepts a corrected write with a revised payload on A. Existing exact-action CAS
  repair and explicit not-needed decisions remain covered.

### 2. An unknown failure did not stop later tool writes in the same SDK step

- Files: `packages/core/src/memory/canonical-tidy-review.ts`,
  `packages/core/src/memory/canonical-local-maintenance.test.ts`.
- A scripted multi-tool SDK response reproduced a first `memory_reinforce` call
  throwing an unknown repository error while a second call in that same step still
  committed. SDK `stopWhen` applies only after the complete step.
- `guardedTidy` now refuses new calls after the review contains a blocking issue.
  Already cached receipts remain readable; refusing subsequent calls does not
  multiply the original unresolved cause. Known recoverable no-write input errors
  continue to permit correction.
- The real runner regression verifies one repository invocation and zero later
  mutation. Existing tests were updated where they had expected writes after an
  unknown or authority failure; they now assert refusal and preserved content.

### 3. A successful clean retry left automatic maintenance permanently stopped

- Files: `packages/core/src/memory/tidy-pass.ts`,
  `packages/core/src/memory/tidy-reliability.test.ts`.
- Reproduction with the actual Local view/checkpoint repository: retry state was
  `{ pending: true, failures: 3, retryAt: null }`; explicit `runNow` returned `clean`
  without a model call but left that state unchanged. Future automatic work stayed
  disabled even after a successful operator recovery.
- The existing clean fast path now calls `checkpoints?.succeeded(characterId)`
  before returning success. Legacy callers without checkpoints preserve their
  behavior. A persistence exception is allowed to fail the operation rather than
  claim recovery that was not saved.
- The new regression failed before this change and passed afterward. It confirms
  the retry state resets with zero model calls, then adds a new memory and verifies
  `maybeRun` invokes the model and checkpoints the new work.

## Related parent-owned correction

The producer and Home previously did not explain when repeated failures had stopped
automatic retry. Current source includes the Shared `manual-retry` next action,
derives it from the successfully persisted exhausted retry state, and renders
`自动重试已暂停` with manual recovery guidance. The producer stop-budget regression
passed in this review's focused run. Desktop regression and final UI acceptance
remain the parent's evidence; this reviewer did not edit that assertion region.

## Review scope and integration evidence

The review followed the PRD/design through Canonical maintenance tools, the issue
ledger, report/coverage and retry repository, migration, operation owner/RPC/runtime,
Shared contracts, and the Home projection. The operation slice is documented in
`operation-integration-review.md`; producer and Home delivery documents retain
their own evidence. This reviewer independently ran the real Local runtime
integration tests after the final source correction. Broad workspace checks and
the parent's reported real Node Legacy/Local boot and seven-case controlled-producer
browser checks are not relabeled as reviewer-run evidence here.

The parent was asked to sync the Canonical spec with the same-known-target rule,
same-step mutation stop, and reset of retry eligibility after a clean success.
These changes stay in the existing owners and add no framework, dependency,
external queue, or live-data operation.

## Verification

- Red then green: `pnpm --filter @taki/core exec vitest run
  src/memory/tidy-reliability.test.ts -t 'rearms automatic maintenance'
  --maxWorkers=1` — the new regression initially failed on retained retry state;
  the final run passed (1 passed, 10 skipped).
- Final focused tests: `pnpm --filter @taki/core exec vitest run
  src/memory/canonical-local-maintenance.test.ts src/memory/tidy-issues.test.ts
  src/memory/tidy-reliability.test.ts
  src/memory/operations/memory-tidy-runtime.integration.test.ts --maxWorkers=1`
  — **4 files, 71 tests passed**.
- Scoped ESLint for `tidy-pass.ts`, `tidy-issues.ts`, `canonical-tidy-review.ts`,
  `canonical-local-maintenance.test.ts`, and `tidy-reliability.test.ts` — **pass**.
- `pnpm --filter @taki/core typecheck` — **pass** after the final correction.
- Scoped `git diff --check` — **pass for tracked diffs**. This command does not
  inspect untracked files; the new source/tests were included in ESLint, typecheck
  and the focused test run. Git emitted only its CRLF-to-LF normalization notice.

## Findings not fixed and validation limits

No further confirmed defect remains within this bounded review. The following are
evidence limits, not additional speculative repair requests:

- No paid model or production database mutation was performed. Scripted models
  establish control flow and storage behavior, not reliable semantic judgment by
  every real model.
- The original failed live tool arguments were not retained, so the exact cause
  of the historical invalid archive/refile requests is still unknown.
- Timeout cancellation is cooperative. The actual compatible HTTP abort path is
  covered, but arbitrary injected providers that ignore cancellation have no hard
  deadline guarantee.
- Human acceptance and release readiness remain the owner's decision after the
  parent completes the final gates and deployment notes. No commit, push, archive,
  task transition, or unrelated source edit was performed by this reviewer.
