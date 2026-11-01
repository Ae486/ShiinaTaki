# Live cache metric: final independent review

Date: 2026-11-01. Checkout: `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`, base HEAD `9326955` plus the current changes.

## Verdict

No confirmed blocking defect was found in the reviewed implementation. The
change satisfies the added PRD's central behavior: Monitor shows the weighted
global input-cache ratio since the current primary summary, updates from durable
settlements, resets only on a successful primary summary commit, and preserves
unknown data and connection uncertainty.

This is an independent source/evidence review, not a declaration that the
parent's final repository gates or owner acceptance are complete. The separate
real `main.ts` integration evidence was inspected as described below. No
additional production changes are requested by this review.

## Requirement checks

| Requirement | Evidence and conclusion |
| --- | --- |
| Weighted valid pairs and explicit zero | `db/cache-usage-repo.ts:92` aggregates the same positive-safe-input/nonnegative-cache pairs for numerator and denominator and rejects cache greater than input. It includes marked explicit zero, excludes ambiguous legacy zero and counts unpaired observations separately. It does not average percentages or include output/cache-write tokens. |
| Foreground and background, once each | The aggregate reads `run_usage` once and terminal auxiliary rows once. Existing unique Effect/call identities and Run-owned auxiliary suppression remain intact. It does not add `usage.settled` events or Run totals to the same sum, and does not filter by successful Run/call outcome. Monitor Run selection and filters do not affect this fixed population. |
| Raw-cache prerequisite | `primary-cache-usage.ts` reuses the existing raw-aware normalizer in both SDK callback and direct middleware paths. Missing/conflicting/out-of-range raw cache becomes unobserved; explicit upstream zero remains observed. `cache_read_observed` persists the distinction without storing raw metadata or rewriting historical values. Current production model factories use the inspected OpenAI-compatible path, supporting the documented legacy-positive compatibility rule. |
| Exact successful-summary reset | `compaction-operation-repo.ts:257` captures the cumulative baseline inside the successful summary transaction. Its identity matches Character, revision, operation and commit time. A query subtracts this baseline from current totals in one SQLite snapshot. This handles equal timestamps and requests that begin before reset but settle afterward. Generation, failed/cancelled/stale compaction, tidy and private summaries do not reach this successful reset branch. |
| Optional metric isolation | Baseline capture uses the existing nested transaction/savepoint and is caught separately. Ordinary metric read/storage failure leaves the valid primary summary committed; a missing matching baseline yields unavailable rather than a fabricated replacement. Invalid/negative deltas also yield unavailable. Observer/read/logger/socket failures are isolated from model and summary outcomes. |
| Post-commit notification, no duplicates | The final `effect-repo.ts:163` queues publication with `db.afterCommit`, including when called inside an outer transaction. The new regression proves outer rollback removes both usage and notifications, outer commit publishes once, and duplicate settlement does not republish. Auxiliary settlement and summary commit use the same outermost-commit mechanism. |
| Actual Core wiring | `main.ts` constructs the service after DB/bootstrap, attaches auxiliary settlement and primary `usage.settled`, passes summary notification through `memory/runtime-composition.ts`, registers the independent operator RPC methods, reacts to mode changes and disposes the service during shutdown. No fake Run or selected-Run subscription is used. |
| Efficient live subscription | `cache-usage-service.ts` does no repeated aggregate work without observers, coalesces synchronous hints into a microtask, shares one computed snapshot per Character scope and contains failing observers. Initial subscribe reads durable current state. There is no polling or frontend accumulator. |
| UI lifecycle and truthfulness | The controller registers pushes before the initial response, compares service revision within the current physical client generation, retires hidden/old responses, accepts a replacement process's lower revision, and refreshes on re-entry/reconnect. Disable clears the optional metric; failed reads and disconnect retain a clearly stale result. The Home connection exposes authenticated/restored generations, so this hook does not need a separate unauthenticated request phase. |
| Small visible result | The strip shows `本次摘要以来`, weighted percentage, `有效缓存数据 N / M 次请求`, global scope and actual computation time. Empty/unavailable is `--`; a reported zero is `0.0%`. There is no client-side reset/math or implied savings claim. |

The same-millisecond/crossing, duplicate summary, rollback, interrupted/unknown,
optional-callback, hidden, mode and replacement-generation regression bodies were
inspected. This review did not rerun their suites.

## Migration and integration evidence inspected

`target/cache-metric-20261101/rehearsal.json` records migration 66 on an isolated
real-data copy. It preserves summary revision 6 at `2026-11-01T11:06:47.639Z` and
initializes the historical window with 55 observed / 55 paired requests:
2,403,862 input tokens and 2,230,784 cache-read tokens, ratio 92.80000266238245%.
The UI rounds this to 92.8%. This is the retained sample's value, not a guarantee
for later active usage.

`preservation.json` records preservation of 150 original business tables and
22,183 rows. The only changed pre-existing table is the migration receipt table;
the new provenance column defaults to NULL. The rehearsal reports `quick_check`
as `ok`. Historical seeding uses original primary `recorded_at` and auxiliary
`finished_at`; it declines to fabricate a boundary when completion times are
unknown, invalid or tied. It does not use auxiliary import `updated_at` or force
a new summary/model call.

Inspected `research/verify-cache-ui.mjs`, the resulting private
`ui-integration.json`/log and the partial-coverage/narrow screenshots. The harness
uses production SQLite repositories, model meter, RPC/WS server and browser
client, `useCacheUsage` and `MonitorWorkspace`. Eleven observed scenarios cover:
historical initial value; empty reset; explicit zero; absent-cache coverage;
weighted 40%; hidden re-entry at 60%; reset while a call is in flight; its later
50% contribution; disconnect; reconnect; and a 620px viewport. All recorded
overflow checks are false. The viewed screenshots retain legible scope/coverage
and fit the narrow layout.

The harness reports five scripted provider invocations, zero paid calls and no
live-data writes. Its reset directly exercises the production compaction
repository and the model is a test double; these facts distinguish the evidence
from a natural production-model compaction or a full Tauri owner acceptance.

Also inspected `research/verify-cache-core.mjs` and the private
`core-integration.json`/log. This boots the actual `packages/core/src/main.ts`
entry on a database copy, authenticates a real WS operator, subscribes, and sends
one real `chat.send` to a local HTTP OpenAI-compatible provider stub. Its single
streamed invocation produces one usage row with input 100, cache-read 50 and
`cache_read_observed=1`, then exactly one global cache push. Observed/paired
counts advance from 55/55 to 56/56 and sums advance by exactly 100/50. The Core
shutdown log reaches MCP client closure. This closes the composition-wiring gap
without a paid provider call or live-user database write.

## Limits and parent-owned completion

- Final full gates remain owned by the parent. Do not substitute this code review
  for those checks, or mark manual acceptance without the owner.
- The aggregate covers recorded observations. Existing primary stream failure
  paths may lack later provider usage; the metric cannot reconstruct unrecorded
  upstream bills and does not retry requests for accounting.
- Historical zero remains conservatively unpaired. Unknown historical boundary
  timing remains unavailable until a natural successful summary establishes an
  exact captured baseline.
- The fixed baseline assumes normal immutable terminal ledgers. Future explicit
  history imports, corrections or retention need an intentional baseline rebase;
  they are outside this authorized change. No generic recovery framework is
  needed now.
- Update the PRD/design status and existing observability documentation around
  the final delivered contract after gates; the inspected design still contains
  its earlier planning-status wording.

Only this review document was written. No production files, databases, processes,
model calls, Git history or task pointers were changed; no duplicate full-suite
test run was started.
