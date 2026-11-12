# Auxiliary usage final review

## Findings (fixed)

No confirmed defect was found in the reviewed auxiliary-usage implementation, so this review made no production-code change.

The production flow matches the approved bounded design:

- `UtilitySlot` wraps its resolved model once and establishes an immutable task ID/label only while the existing serial task executes. The meter is invoked at the AI SDK provider middleware boundary, so zero-call tasks create no rows while multi-step calls and SDK retries create one row per actual invocation.
- `createModelEffectMiddleware` marks only its actual `doGenerate`/`doStream` dispatch as Run-owned. A nested auxiliary meter therefore skips private summaries and any other model already owned by canonical Run/Effect accounting; the authoritative settlement path itself is unchanged.
- Main composition reaches all approved new producers: the shared Utility model, detached image-memory VLM, and the shared on-demand/ambient screenshot describer. Foreground Chat text/vision models remain on their existing Run observer.
- Start, terminal settlement, and explicit boot reconciliation are separated. Old `started` rows become `interrupted` without a fabricated finish time or replay. Meter metadata, repository, and diagnostic failures are contained after/before the original provider call as applicable; returned responses and thrown provider exceptions are preserved. Stream observation locks and forwards the existing stream, does not drain it, preserves backpressure/cancellation, retains usage from an error-then-finish sequence, and keeps finish-before-cancel completed.
- OpenAI-compatible raw field presence removes adapter-synthesized cache/reasoning zeroes. Explicit raw zero remains zero; absent, malformed, conflicting, unsafe, or out-of-range observations remain null. Reasoning is not added again to output totals.
- Repository reads use UTC-normalized `[from,to)` filtering, stable descending `(startedAt,callId)` keysets, page-independent full-filter totals, nullable sums with `knownCount`, and a cache ratio only across rows with both input and cache-read counts. The operator-only RPC refuses `DISABLED` instead of returning a false empty bill.
- Migration 065 is additive and indexed, and the observability spec documents the producer, unknown-value, isolation, query, and non-invoice boundaries.

## Findings (not fixed)

None.

## Verification

- Focused Core tests: pass — 6 files, 34 tests covering normalization, invocation/retry/Run suppression, failure isolation, stream terminal ordering, repository persistence/paging/aggregation/timezones, migration, RPC authorization/mode gating, and Utility ownership.
- Focused Shared tests: pass — 1 file, 4 tests covering strict bounds, missing versus zero, raw-field exclusion, and aggregate schema limits.
- Lint: not independently rerun; the parent reviewer owns the full required gate and explicitly requested no duplicate broad workspace checks.
- TypeCheck: not independently rerun for the same reason.
- Full tests: not independently rerun; only the scope-focused suites above were run.

## Limits

- This was a code-path and focused-test review only. It did not make paid/provider calls, write a real application database, import historical calls, run the reasoning comparison, or claim invoice completeness.
- Main boot/RPC real-composition acceptance and the full lint/typecheck/test result remain with the parent reviewer.
- `.trellis/.current-task` is stale and points to a missing older task; this review used the session-authoritative `.trellis/tasks/archive/2026-11/11-01-cache-token-cost-diagnosis` task stated in the PRD and assignment.
- Extensive unrelated worktree changes were left untouched.
