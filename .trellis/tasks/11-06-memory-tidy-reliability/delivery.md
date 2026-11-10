# Memory tidy reliability delivery

> 2026-11-10: implementation is included in prerequisite commit `2c761fb`; this
> task's previously local documentation is preserved by the T4 freeze. Human
> acceptance remains pending. Follow [the freeze handoff](../../../docs/T4-FREEZE-HANDOFF.md)
> before any restart; earlier rollout instructions below are historical.

## Backlog optimization delivered

The owner-authorized follow-up replaces the operation-wide 120-second/12-step budget with independently queued
batches: defaults are 100 candidates, 24,000 estimated initial input tokens, 48 model steps and 600 seconds per batch.
Initial input is capped at half the configured selected model window; full records and duplicate groups are preserved.
The same durable operation drains its admitted backlog and yields the Utility Slot between batches. New arrivals
remain eligible for later maintenance. Local and Legacy shutdown cancel active tidy work.

On one real-model observation using an isolated current-data copy, all 567 pending memories completed in six batches
and 398 seconds: 172 edits, 23 model calls, one corrected revision conflict, no unresolved issues, SQLite integrity ok.
Known usage was 522,103 input / 77,229 output tokens. The live database was not changed by verification.

All five typechecks, root ESLint, Rust Clippy, eight browser scenarios and real Legacy/Local startup passed. Full suites:
Shared 727, CLI 50, Desktop 1,368, Core 4,642 passed (6 Core skips); final boundary fixes also passed 22 focused Core
tests and 17 card tests. Independent review and exact evidence/limits are recorded in
[research/backlog-optimization.md](research/backlog-optimization.md).

Restart Core from this worktree to load new defaults (existing operator overrides still take precedence). No new
migration is required by this follow-up. Human acceptance remains pending. No commit/push/archive was requested.

The following sections retain the **preceding repair's historical evidence and rollout state**, including its old
120-second limit. They are not the current backlog configuration.

## Delivered

The existing Local tidy feature now separates rejected calls, committed changes, accepted review coverage and unresolved execution. Manual and automatic requests use the existing durable operation owner; no new framework, dependency or external queue was added.

- Known no-write mistakes can be corrected or explicitly acknowledged as unnecessary. A correction must reference a later successful call on the same known target; a changed corrective payload is allowed. Unknown failures block subsequent new mutations, including calls in the same SDK response.
- Only an accepted finish completes a batch. Short model references and disclosed current-record evidence support explicit conflict correction while retaining ownership and revision checks.
- Exact revision/time checkpoints cover only the visible accepted batch and its own resulting revisions. Complete duplicate groups remain available for comparison. Unseen and externally changed records remain pending; a small remaining tail can continue below the ordinary trigger threshold.
- All batches share the existing step limit and a 120-second execution budget. Repeated automatic failures back off for one then five minutes, then pause with an explicit manual-retry instruction. A confirmed clean retry re-enables future automatic work.
- Committed edit progress and the Local mutation share a transaction. Restart retains confirmed progress and marks incomplete work unknown; reconnect/remount queries the same Core-owned operation without replay.
- Home distinguishes candidates from proven defects, explains partial/interrupted results, separates corrected calls from intentionally unnecessary calls, and retires stale accepted feedback.

## Verification

Environment: Windows, H:/TakiAgent-worktrees/t4, Node v24.18.0, pnpm 10.22.0, ai 7.0.148, Rust 1.97.0.

| Check | Result |
| --- | --- |
| All five package typechecks | Passed |
| Root ESLint | Passed with the pre-existing artifacts/** snapshot exclusion |
| Shared full suite | 727 passed |
| CLI full suite | 50 passed |
| Desktop full suite | 1,366 passed; final manual-retry/card delta also passed its 15-test file |
| Core full suite | 4,633 passed, 6 skipped |
| Final review corrections | 4 focused files, 71 passed, plus Core typecheck and scoped lint after the last correction |
| Rust Clippy | Passed with -D warnings |
| Real Node strip-only startup | Legacy and Canonical Local both reached WS listening with isolated storage and dummy credentials |
| Rendered browser/WS integration | Eight scenarios passed, including an actual Canonical correction through SDK, SQLite, owner, WS, controller and DOM |
| Tracked whitespace check | Passed; new source files were also linted/typechecked |

The full suite and final focused checks are separate evidence: final small review fixes were covered by the focused run rather than misrepresented as another full-suite execution. Initial full-gate failures were investigated: explicit historical migration-tail expectations were extended to 067 while byte/receipt/reopen assertions stayed intact, and a real Legacy fenced-error remapping regression was fixed without changing its tests. Review also added red/green regressions for wrong-target correction, later same-step mutation after unknown failure, and the clean retry stop reset.

Reproducible commands:

```powershell
pnpm -r --workspace-concurrency=1 typecheck
pnpm lint --ignore-pattern 'artifacts/**'
pnpm --filter @taki/shared test --maxWorkers=4
pnpm -r --filter '!@taki/shared' --workspace-concurrency=1 test --maxWorkers=4
pnpm --filter @taki/core test --maxWorkers=4
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
node .trellis/tasks/11-06-memory-tidy-reliability/research/verify-tidy-ui.mjs
```

Evidence paths (private, ignored):

- `target/memory-tidy-quality-20261106/`: initial failure log, final full Core/typecheck/lint logs.
- `target/memory-tidy-boot-1793938682722/`: isolated Legacy/Local startup logs and environment metadata. No paid call was possible with the dummy loopback provider.
- `target/memory-tidy-reliability-ui-1793939207018/`: eight-case browser evidence and screenshots. Seven lifecycle cases use a controlled producer; the final correction uses the actual Canonical producer with a scripted model.

## One real-model observation

The recovered source session explicitly authorized real data and paid model calls. One bounded observation used a SQLite backup made through a read-only live connection, then applied migration and tidy only to `target/memory-tidy-real-observation-20261106/isolated.db`.

- Config route: existing main fallback, `deepseek-v4-flash`, resolved using repository environment plus the copied stored configuration.
- Time: 2026-11-06T04:33:51.934Z through 04:35:52.347Z.
- Initial pending candidates: 627. Accepted reviewed memories: 30. Applied changes: 22. Remaining: 597.
- Seven provider calls completed; the eighth reached the total deadline and aborted. No tool-error warning, unresolved tool issue or correction was observed.
- Outcome: partial / timeout with retained progress, a retry time, and explicit remaining work. This was retained as the result; no repeat-until-success experiment followed.
- Successful calls reported 64,756 input and 19,970 output tokens. Usage for the aborted call is unknown. These are known completed-call totals, not full-operation billing or a currency-cost claim. The coarse Utility usage object is marked unknown and its zero counters are not treated as free execution.
- SQLite quick_check returned ok. The observation retained source bodies only in the private database copy; ordinary evidence contains safe counts/codes/tool names.

The live database was rechecked read-only: schema version 66, no new tidy checkpoint tables, successful tidy watermark still 2026-11-01T13:36:53.701Z, and latest original tidy usage still from November 5. No live tidy, runtime update or real-data migration was performed.

## Material decisions and limits

- Old success timestamps cannot prove which records were shown. First adoption therefore revisits existing visible memories. The real sample demonstrates a substantial historical backlog; bounded continuation is intentional and must stay visible.
- Duplicate groups remain indivisible comparison units, so the seed cap can expand to a larger visible group. This preserves judgment evidence rather than silently weakening deduplication.
- Timeout is cooperative and validated through the actual compatible HTTP transport. An arbitrary injected provider ignoring cancellation has no hard termination guarantee.
- One real observation validates usable tool execution and timeout/progress behavior for that sample; it does not prove every model's memory judgments correct or replace owner acceptance.
- The original failed November 5 arguments were not retained. Their exact cause remains unknown; this delivery fixes reproduced lifecycle defects rather than inventing that historical cause.

## Rollout and rollback

Implementation is ready for owner review; the real environment has not been updated. Before updating an actual runtime, retain a consistent database backup, stop the old Core normally, then start this worktree so additive migration 067 runs. Verify the latest tidy state and use the UI's explicit continue/retry action as needed. Manual acceptance remains pending.

No old memory rows or historical receipts are rewritten by migration 067. Older code does not understand the new closed tidy operation-kind payload, so a binary downgrade over a database containing new tidy operations is not a guaranteed rollback. Preserve the pre-upgrade snapshot and evaluate any later data before choosing recovery; do not automatically restore/delete user state.

No commit, push, archive or persistent Codex-memory update was performed. The task remains active for rollout/owner acceptance.

## Why earlier green checks missed recurring failures

The earlier contract was narrower than the user's goal: it proved safe refusal and one exact revision repair, and some tests required other rejected calls to remain fatal. Single-pass fixtures did not cover accumulated candidate backlog, correction usability, same-step calls, queued changes, restart or page recreation. See [mature-patterns.md](research/mature-patterns.md) for source-backed pi, Letta, Hermes, AI SDK and AWS comparisons. Their useful practices are explicit effect state, bounded recovery, durable queryable outcomes, and retaining real failure scenarios as regression cases; they are not evidence that any system never fails.

## Background Monitor follow-up

Tidy and conversation compaction now have independent Run Monitor records; normal cache and latest-primary input remain separate. Final implementation, migration compatibility, review and acceptance evidence are recorded in [maintenance-monitor-delivery.md](research/maintenance-monitor-delivery.md). Earlier real-model backlog evidence above remains specific to the producer optimization.
