# Monitor attribution implementation and UI verification

## Delivered behavior

The existing weighted cache statistic retains its primary-summary window and foreground/background population. The same revision-guarded subscription now atomically publishes an independent latest-primary request snapshot. The Monitor shows upstream-reported input against that request's dispatch-time effective real-token window; when upstream usage is absent, a clearly labelled estimator-units fallback uses the captured estimator window. Cached input remains context input.

Composition uses the nine exclusive raw categories through a small fixed presentation mapping. Counts are added before percentage formatting, so merging display groups requires no source-taxonomy or protocol rewrite. Percentages always use the composition estimator denominator, never a scaled provider total. Optional detail shows component counts and the independent builtin/MCP/Skill/unknown origin axis. Multimodal coverage stays within its owning message/tool group, with an explicit precision label and no image meter.

Model, completion time, human loop step and request outcome remain visible. Effect/Run identities and correlation fields stay internal. Missing, zero, empty, partial, unknown, stale and unavailable states remain distinct. Existing physical-client generation, revision, hidden-page retirement, reconnect and explicit retry guards are retained; no polling or mutation replay was added. A legacy response without the new optional sibling clears the latest-request detail and marks it unsupported instead of associating old detail with a fresh cache result.

## Changed Desktop files

- `cache-usage-controller.ts`, `use-cache-usage.ts`: coherent disposable cache/request view and existing lifecycle guards.
- `cache-usage-strip.tsx`, `cache-usage-strip.module.css`: preserved cache row plus request composition below it.
- `request-context-strip.tsx`, `request-context.module.css`: input/window, request labels and responsive presentation.
- `request-composition.tsx`, `request-composition-display.ts`: estimated chart, fixed grouping, count/provenance detail and display formatting.
- `cache-usage-controller.test.ts`, `cache-usage-strip.test.tsx`, `request-composition-display.test.tsx`, `src/lib/ws-client-cache-usage.test.ts`: lifecycle, combined-push, compatibility, ratios, outcomes and boundary regressions.
- The Monitor folder `index.md` records the new file ownership.

The UI slice did not edit Core, Shared, Settings, or the verified native-image child helper. The parent integration helper is `verify-monitor-runtime-ui.mjs`.

## Checks and actual integration evidence

Commands from `H:/TakiAgent-worktrees/t4`, Node `v24.18.0`:

```powershell
pnpm --filter @taki/desktop typecheck
pnpm --filter @taki/desktop test
pnpm --filter @taki/desktop test -- src/windows/home/pages/monitor/request-composition-display.test.tsx src/windows/home/pages/monitor/cache-usage-controller.test.ts src/windows/home/pages/monitor/cache-usage-strip.test.tsx src/lib/ws-client-cache-usage.test.ts
node --experimental-strip-types .trellis/tasks/11-02-context-attribution-token-efficiency/research/verify-monitor-runtime-ui.mjs
```

Desktop typecheck passed after the concurrent Core event-union narrowing fix. The full Desktop suite passed 224 files / 1,356 tests; after adding five explicit request-outcome cases, the focused suite passed 4 files / 35 tests. Explicit ESLint over all changed Desktop TS/TSX source/test files passed. The helper passed Node syntax validation.

Initial integration evidence: [`monitor-runtime-ui-evidence/2026-11-02T08-20-22.999Z/evidence.json`](monitor-runtime-ui-evidence/2026-11-02T08-20-22.999Z/evidence.json), with 19 recorded stages. The helper launches the real Core against a fresh test-only database and a local synthetic OpenAI-compatible provider, then mounts production `WsClient`, `useCacheUsage`, `CacheUsageStrip` and the request components in a real Edge browser. It dispatched native synthetic pixels through two foreground Runs: one single request, then an actual read-only `extension_discover` call and its continuation. Three distinct model Effects produced three durable measurements and three usage rows. Reported input/cache pairs were 200/80, 400/160 and 600/240; the cumulative cache snapshot was 1,200/480 = 40%, while latest occupancy used 600 / 131,072 = 0.5% after display rounding. The estimates were independently computed from actual dispatched content rather than those synthetic provider totals.

Wide (1,280px), narrow (420px), expanded explanations, hidden re-entry, disconnected stale results and replacement-client reconnection screenshots were captured and visually inspected. No horizontal overflow or displayed opaque IDs occurred. Loading, zero, missing usage and read-failed screenshots additionally use explicitly labelled synthetic display overrides of an actual captured snapshot; they are not observations of provider failure. The main screenshots are `monitor-tool-loop-wide.png`, `monitor-narrow.png`, `monitor-explanations-wide.png` and `monitor-fixture-estimate-only.png` in the evidence directory.

The natural final request was honestly partial: 18,855 estimator units; instructions 2,297; persona 0; injected memory 0; runtime context 210; summary 0; conversation 3,224; tool definitions 10,071; tool interactions 24; other 3,029. Coverage reported zero unestimated parts, 7,250 unknown-origin units and heuristic media. A fresh test DB has no persisted persona/memory/summary cohort. Unknown origins were passed to the runtime owner for independent source-binding assessment; the UI does not guess them.

The parent classified the avoidable fresh-source unknowns as a source-coverage finding. That first run proved transport, accounting and rendering while source coverage failed. It remains preserved as the before-fix evidence; historical unknown sources must still remain unknown.

After the runtime source-forwarding and factory fixes, the [`2026-11-02T08-29-53.380Z` evidence](monitor-runtime-ui-evidence/2026-11-02T08-29-53.380Z/evidence.json) passed all 19 stages, including assertions on the known fresh-source origins and actual fallback persona/tool result categories. The same final total, 18,855 units, now partitions as instructions 2,297; persona 2,996; injected memory 0; runtime context 215; summary 0; conversation 3,224; tool definitions 10,071; tool interactions 24; other 28. All suppliers are builtin in this deliberately extension-free test fixture; unknown-origin units and unestimated parts both equal zero from the measured producer facts. Media remains heuristic. The UI now says `内容已归类 · 多模态估算精度有限` for this case, reserving `覆盖不完整` for actual unknown suppliers or unestimated content. The final consolidated run below confirms the settled coverage contract.

## Limits and follow-ups

Final consolidated evidence after all runtime/source formatter changes is [`2026-11-02T08-36-30.266Z/evidence.json`](monitor-runtime-ui-evidence/2026-11-02T08-36-30.266Z/evidence.json). The process exited 0 and all 19 stages passed. The latest snapshot is `ready`, with composition coverage `complete`, zero unknown-origin units, zero unestimated parts and independent `hasHeuristicMedia: true`. The preceding 18,855-unit source partition is unchanged. The known-source assertions, all three exact Effect measurements, actual tool continuation, cache/current-request scopes, browser re-entry/replacement, wide/narrow rendering and cleanup passed against the final production code. Final wide/narrow PNGs were visually inspected. The source/media distinction regression additionally passed 12 component/display cases.

The task-local `monitor-runtime-ui-evidence/.gitignore` excludes only per-run `core-data/` and `edge-profile/`; screenshots and JSON evidence remain reviewable. Those excluded directories remain on disk. No evidence, user data or pre-existing artifacts were deleted.

The provider's token/cache counts are synthetic signals, proving dispatch/accounting/projection/render wiring rather than real model tokenizer accuracy, paid-model behavior or savings. The actual browser is Edge, not native Tauri/WebView2 owner acceptance. Core and owned browser cleanup completed; no live user service/data was used, and there were zero paid calls. No commit, push or task archive was performed.

The helper's Vite fixture build emitted the usual large-chunk warning because this focused verification bundles the imported application client surface without production code splitting. It did not fail or indicate a Monitor regression.
