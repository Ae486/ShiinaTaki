# Memory tidy reliability and recovery

## Goal

Make the existing memory tidy feature dependable in everyday use: execute correctly where possible, recover from correctable failures, and clearly explain unresolved outcomes and the user's next action. Address the complete Local tidy path rather than another isolated error-code patch.

## Owner requirements and authorization

- The owner authorized creating this task and entering development on 2026-11-06.
- Preserve memory content, provenance, ownership, and necessary revision checks. Avoid speculative frameworks and defensive layers without a concrete failure mode.
- Compare mature implementations and explain why previous passing checks did not prevent recurring production failures.
- Work only in H:/TakiAgent-worktrees/t4. Preserve the pre-existing dirty worktree. No commit, push, archive, or production data mutation is authorized by this task alone.
- Human acceptance remains pending until the owner confirms it.

## Scope

The operator and automatic Canonical Local tidy paths, their model/tool contracts, candidate coverage, queue admission, bounded recovery, durable operator-visible outcome, and Home Operations feedback. Existing Legacy/Hindsight behavior must remain compatible. Source ingestion and conversation compaction are separate responsibilities and must not be redesigned here.

## Baseline

- Previous repair: archived 11-01-cache-token-cost-diagnosis. It fixed only exact revision-conflict correction and surfaced partial work.
- Recovered source conversation: 01a195e8-8475-7592-8114-74be61f1bef6, ending with a request for whole-chain inspection.
- Latest observed failed tidy: 2026-11-05T16:24:44Z to 16:25:41Z; four provider calls completed. Previous UI evidence reported eleven applied edits and invalid archive/refile calls. The original rejected arguments were not retained and their exact cause remains unknown.
- Read-only live verification: canonical-local authority; last successful tidy remains 2026-11-01T13:36:53.701Z.
- Reproduced with real tools and an in-memory database: rejected malformed reference, corrected refile, accepted finish still yields incomplete with one applied edit.
- Reproduced with synthetic report inputs: eleven fresh candidates with cap ten; the omitted candidate disappears from the new-candidate slice after the success timestamp advances.
- Other gaps to validate: capture before queue admission, failed-pass retrigger behavior, lack of queryable failed attempt state, misleading candidate labels.

## Acceptance criteria

- [x] One request drains a realistic 627-entry backlog with token-aware batches and fresh per-batch deadlines/steps; other Utility work can run between batches.
- [x] Input size includes actual tool schemas, instructions and full report; oversized indivisible evidence fails clearly without false coverage.
- [x] New arrivals and post-review revisions remain pending without extending an admitted operation indefinitely; shutdown cancels active tidy work.
- [x] Follow-up independent review, real-model backlog observation and required project checks are recorded separately from the preceding repair.

- [x] A correctable rejected tool call can be corrected or explicitly resolved without permanently poisoning a successfully completed review. Unknown or partially applied outcomes cannot be silently reported as success.
- [x] Tools offer usable references and specific safe correction guidance; ordinary model mistakes do not require user knowledge of internal identifiers.
- [x] Every pending candidate remains eligible until its actual review is completed; bounded reports must not silently advance over unseen candidates.
- [x] Manual and automatic triggers share coherent admission. Queued work uses a fresh view; concurrent triggers do not execute stale duplicate reviews.
- [x] Repeated failures stop or back off with bounded cost; retry behavior is visible and preserves unresolved work.
- [x] An operator can observe running, completed, partial, and failed/interrupted work after page recreation or reconnect, with committed effects and useful next actions.
- [x] Runtime interruption preserves committed memories and truthfully reports incomplete work; retries do not automatically replay an old uncertain operation.
- [x] User-facing labels distinguish candidates from confirmed defects, attempts from success, and unresolved outcomes from confirmed no-op failure.
- [x] Regression evidence exercises realistic multi-step correction, more-than-one-batch coverage, overlapping admission, failure/retry, and UI status recovery through production wiring.
- [x] Relevant package checks and full required project checks pass, or any pre-existing failure is evidenced and explicitly reported.
- [x] Mature-project comparisons, decisions, validation limits, and rollout/rollback notes are recorded without claiming human acceptance.

## Out of scope

Replacing the memory engine, adding a workflow framework or external queue, changing models by default, generalizing a new agent runtime, unrelated Avatar/exec/private-worker changes, and a guarantee that model judgment is infallible.

## Run Monitor follow-up (owner-approved)

Memory tidy and conversation compaction must appear as distinct background maintenance records in Run Monitor.
Their model calls must not contribute to ordinary cache-hit or input-occupancy metrics. Preserve ordinary Runs,
latest-primary attribution, successful summary boundaries, underlying memory correctness and independent execution.
Historical unknown associations and usage must remain explicitly unknown. No additional model calls, polling,
synthetic Runs, or scheduled time-based archival feature is required for this follow-up.

Acceptance: automatic/manual Local and Legacy tidy and compaction have durable records, meaningful status/progress,
proved model calls, known usage coverage and failure notices. Detail selection, reconnect and mode/visibility changes
remain coherent. Existing ledgers survive migration and normal metric values exclude exactly the two requested calls.

Automated follow-up acceptance passed: actual producer/SDK/SQLite associations, ordinary-metric exclusion, migrations,
reconnect/mode behavior and seven actual Core/MonitorPage browser cases. Final gates and limitations are in
`research/maintenance-monitor-delivery.md`; human acceptance remains pending.
