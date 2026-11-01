# Live summary-window cache metric: completed implementation

Date: 2026-11-01. Worktree: H:/TakiAgent-worktrees/t4, base checkpoint9326955. The owner approved implementation after
choosing to extend this task and defining the window between successfully committed primary conversation summaries.

## Delivered behavior

Monitor now has a compact input-cache strip above its Run workspace. It shows the weighted cache-read ratio,
`本次摘要以来` / `首次摘要前`, foreground/background scope, valid-pair coverage and the actual update time. It receives
computed snapshots after individual model usage settlements, independently of the selected Run or list filters.
Opening/reconnecting the page does not reset statistics. Empty is unavailable data, not a fabricated 0%; a reported
zero is 0%. Unknown cache fields are excluded from both paired sums and remain visible in the coverage denominator.

Successful primary summary commits atomically capture the cumulative usage baseline. Current immutable-ledger totals
minus that baseline give the exact new window, including calls started before reset but settled afterward. Failed,
duplicate/private summary attempts and memory tidy do not reset it. Optional baseline/read/socket failures cannot
alter valid summary or request outcomes. New primary cache data reuse the existing raw-aware normalizer, preserving
explicit zero versus SDK-synthesized missing-field zero. Original ledger values are not rewritten.

The bounded addition comprises Shared contracts, migration066 with provenance/baseline metadata, SQL aggregation,
post-outer-commit producer notifications, a small subscription service and the existing Monitor/client integration.
It introduces no model call, polling, new dependency, pricing engine or additional request ledger.

## Verification

- Workspace tests: **6,591 passed, 6 skipped** (Shared704, E2E package50, Desktop1340, Core4497).
- Workspace typecheck, active-source root lint and Rust Clippy passed. Lint uses the established
  `--ignore-pattern 'artifacts/**'` exception for untracked copied historical source, not active product code.
- The prior tidy card's stale literal assertion was synchronized with its already-correct tool-operation wording.
  Migration-tail expectations were updated for version066; no execution/quality assertion was weakened.
- Independent [final review](live-cache-final-review.md): no confirmed blocking defect.
- [Browser driver](verify-cache-ui.mjs): actual SQLite, SDK meter, summary commit, service, MethodRegistry, WS client,
  production useCacheUsage and MonitorWorkspace; five scripted provider invocations, zero paid calls, no live writes.
  Eleven observed cases cover initial historical value, reset, explicit zero, missing-cache coverage, weighted40%,
  hidden re-entry60%, in-flight crossing/reset/completion50%, disconnection, reconnection and 620px width. Screenshots
  were inspected; no horizontal overflow occurred. Tests separately cover failed summary/rollback/duplicates/mode.
- [Actual Core driver](verify-cache-core.mjs): boots real main.ts with a private database and local HTTP provider,
  drives one chat.send through the real OpenAI-compatible stream and records input100/cache50/provenance1. Exactly
  one global cache update reflects that delta. This establishes real boot wiring, not real-provider quality or billing.

## Migration and live state

Consistent pre-change backup SHA256: `6ea1d0d496c184233a915d202c7705158611895d8c09290c91020cc3156a6a88`.
An isolated migration preserved all original columns across **150 business tables / 22,183 rows**. Only the migration
receipt changed; nullable provenance and the derived baseline were added. SQLite quick_check passed.

After all gates, an idle preflight found no running/queued/waiting requests, auxiliary calls or memory operations.
The old shutdown handler's known cancellation of three historical unresolved Runs was avoided with a checked,
individual idle-process replacement, retaining DB/WAL/SHM. The old MCP child exited. This skips final buffered
logs/in-memory cleanup but preserves committed durable data; it does not repair that unrelated shutdown behavior.
Core **PID47796** now serves port8974 with migration066. No new model call or historical request replay occurred.

The authenticated [read-only live query](query-cache-live.mjs) returned at **15:47:20 UTC**:

| Field | Actual value |
| --- | ---: |
| Primary summary | Revision6, committed11:06:47.639 UTC |
| Boundary recovery | Historical completion evidence |
| Observed / eligible requests | 55 / 55 |
| Paired input | 2,403,862 |
| Cache-read input | 2,230,784 |
| Weighted ratio | 92.8000026624%, displayed92.8% |

The value includes foreground and background observations since that summary, including manual tidy calls; it is
not the earlier96.06% normal-foreground-only cohort. Live data matched the isolated rehearsal exactly. Timeline,
primary summary, all prior usage columns, attempts, effects, events and auxiliary calls were unchanged after restart;
Run state/cancellation fields were preserved, with only expected recovery metadata refreshed.

## Reproduction and limits

```powershell
pnpm -r --workspace-concurrency=1 typecheck
pnpm lint --ignore-pattern 'artifacts/**'
pnpm -r --workspace-concurrency=1 test --maxWorkers=4
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
node .trellis/tasks/11-01-cache-token-cost-diagnosis/research/verify-cache-ui.mjs
node .trellis/tasks/11-01-cache-token-cost-diagnosis/research/verify-cache-core.mjs
node .trellis/tasks/11-01-cache-token-cost-diagnosis/research/query-cache-live.mjs
```

Private evidence is under `target/cache-metric-20261101/`: backups/manifests, preservation.json, rehearsal.json,
ui-integration.json and ui-*.png, core-integration.json, live-query.json, live-verification.json and gate logs.
The drivers use the local private snapshot, installed Edge and reserved local test ports; full packaged Tauri and
owner visual/semantic acceptance are not claimed. Isolated Vite harness single-bundle size warnings are fixture-only.

Historical boundaries with missing/tied completion evidence remain unavailable until the next natural successful
primary summary. Ambiguous legacy zero-cache records remain unpaired. Terminal historical imports/retention would
need to preserve/rebase aggregate baselines; no import engine was added. Existing upstream usage omissions after a
primary stream error are still coverage limits, not zero-cost claims. This display measures cache reuse, not monetary
savings or answer quality, and production model/reasoning defaults remain unchanged.

All requested implementation and automated/live-wiring checks are complete. Later normal-use observations remain
follow-up evidence rather than a reason to keep implementing indefinitely. No new commit, push or archive occurred.
