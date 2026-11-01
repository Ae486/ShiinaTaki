# Memory tidy repair and live verification

The current canonical Local Operations action is repaired and running in Core PID26756 on
127.0.0.1:8974. It maintains existing memories and writable memory-index/user-model blocks;
it is separate from primary-source ingestion and conversation summarization, and is not a Legacy-only button.

## Cause and bounded change

The failed November 1 pass completed four model calls and committed ten changes before returning the generic error.
Its first rejected tool and arguments were not retained, so that historical error cannot be reconstructed precisely.
The deterministic reproduction identified a real defect: a revision conflict permanently poisoned the review even
after the identical action succeeded with an admitted updated reference. The RPC/UI also discarded partial results.

The repair resolves only that exact conflict after fresh successful execution of the same verb/target/payload.
It preserves CAS, authority checks, uncaptured-reference rejection and sticky unknown errors. Canonical completion
requires an accepted finish and no unresolved errors; cached receipts and unchanged results do not inflate edits.
Partial work remains saved and is reported through strict Shared JSON-RPC error data and Chinese Operations feedback.
Unknown transport results remain unknown and do not trigger automatic retries. Legacy and Hindsight completion
semantics remain unchanged. The canonical writable block enum no longer offers the unsupported user-card target.

There is no migration, new endpoint, dependency or retry framework. See [the accepted design](tidy-repair-design.md),
[independent review](tidy-repair-final-review.md), and the updated backend/frontend specifications.

## Verification

- Workspace tests: **6,524 passed, 6 skipped**, including Local/Legacy/Hindsight regressions and Shared/RPC/UI tests.
- Workspace typecheck and Rust Clippy passed. Root lint passed with `--ignore-pattern 'artifacts/**'`; the excluded
  directory is the already-known untracked source snapshot, not active product code. No lint rule was weakened.
- The final UI wording refinement passed its complete 13-test file and the rendered integration again.
- Three browser integration cases use production Local runtime, TidyPass, MethodRegistry, WebSocket server/client,
  hook and card with isolated copies of the real database and a scripted model: exact correction succeeds with
  2 edits and advances the watermark; unresolved conflict reports partial with 1 edit; unadmitted reference fails
  with 0 edits. Both failures retain the watermark. All cases refresh state and clear prior success.
- The independent reviewer found no confirmed blocker. Scripted-model browser evidence is distinct from the real
  model observation below; it is not full packaged Tauri or owner UI acceptance.

Commands run from this worktree:

```powershell
pnpm -r --workspace-concurrency=1 typecheck
pnpm lint --ignore-pattern 'artifacts/**'
pnpm -r --workspace-concurrency=1 test --maxWorkers=4
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
node .trellis/tasks/11-01-cache-token-cost-diagnosis/research/verify-tidy-ui.mjs
```

The browser driver expects the private `target/tidy-repair-20261101/before-repair.db` snapshot, Edge at the installed
Windows path, and an available local port19367. It writes disposable fixtures below target, never the live database.
Screenshots and full logs are under `target/tidy-repair-20261101/`.

## Live update and one real tidy pass

An idle preflight found no active foreground work, auxiliary calls or memory operations. A consistent backup passed
SQLite quick_check; SHA256 is `a784b20064347b56bf3e897f785654e7ffc33d393094521804fa2ce8a779fd7a`.
The old shutdown handler would mark three historical reconciliation-required Runs as cancellation requested.
Instead of modifying that unrelated lifecycle or monkey-patching it through Inspector, the verified-idle old PID13956
was terminated individually and the same worktree/env startup command launched PID26756 with a hidden window.
This bounded choice preserves committed SQLite WAL data but can lose final buffered logs/in-memory counters.
The old MCP child exited; WAL/SHM were not deleted. Startup changed recovery metadata only: all Run state/cancel fields,
attempts, effects, events and model-usage rows were checked against the backup. No historical request was replayed.
The broader historical shutdown behavior is a recorded follow-up, not silently changed by this tidy repair.

The real operator action ran once, **13:36:53.697Z–13:37:33.148Z** on November 1:

| Observation | Actual result |
| --- | --- |
| RPC result | ran, 11 edits, 4 steps |
| Durable memory operations | 6 policy edits, 1 reinforcement, 2 reversible invalidations |
| Block updates | 2 |
| Successful watermark | 2026-11-01T13:36:53.701Z |
| Actual provider invocations | 4 completed, no retry-until-green loop |
| Input / cached / uncached | 70,952 / 58,240 / 12,712 |
| Output / included reasoning | 7,260 / 3,411 |
| Estimated public-tariff cost | CNY0.0429168, approximately CNY0.043 |

Pricing uses the current-day documented Flash Sunday off-peak rates, CNY0.02/1/4 per million cached input/uncached
input/output; it is an estimate, not a measured invoice deduction. Source and applicability are retained in
[the catch-up report](real-catchup-report.md#actual-calls-and-estimated-price).
The existing tidy `usage.calls=1` denotes its logical Utility invocation; the durable auxiliary ledger records the
four actual provider calls and is the cost-count authority. Reasoning is already included in output.

Timeline messages, conversation summary, Run usage, attempts and effects remained identical after this pass.
SQLite quick_check remained ok. This successfully processes one bounded review; the initial defect counts are
observations before the review, not a claim that every old memory has now been cleaned or that quality is perfect.
The live success does not establish the lost historical first-error identity or isolate the code change's cost effect.

Private evidence: before-live-update-manifest.json, restart-verification.json, live-tidy.json,
live-verification.json, ui-integration.json and ui-*.png in the same target directory.
`verify-tidy-live.mjs inspect` is read-only; its explicit `tidy` mode mutates live memories and can incur model charges.
It is a bounded verification driver, never an automated repeated acceptance loop.

## Continuation

The original cost investigation continues in [the new/old conversation report](new-conversation-cost-analysis.md).
The real verification calls above are excluded from normal-chat cohorts. Production reasoning/model defaults
remain unchanged. No new commit, push or task archive was performed.
