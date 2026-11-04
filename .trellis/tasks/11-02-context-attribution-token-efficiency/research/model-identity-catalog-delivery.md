# Model identity repair and catalog delivery (2026-11-04)

## Scope and authorization

The owner approved repairing the real-data Monitor outage, then extending the existing maintained model catalog
with names, canonical relationships, capabilities and provider icons. Work stayed in `H:/TakiAgent-worktrees/t4`,
branch `task/t4-skills-mcp-productization`, with the existing parent/child tasks. This is not a token-reduction pilot.
Existing native-image changes and unrelated work were preserved. No commit, push, archive, user service restart,
historical data rewrite, new dependency or paid model call was performed.

## Delivered behavior

- The latest-primary projection correlates usage by its existing Effect and Run/Attempt/provider lineage. It no
  longer treats a different response model name as corrupt accounting. Requested `modelId` retains its measurement
  and window scope; optional `responseModelId` preserves the existing usage identity. Monitor displays the response
  name only when it differs, with a full-name tooltip. Genuine source/measurement/lineage mismatches still fail.
- The configured-model reader reuses models.dev, its existing one-hour demand cache and `config.modelCapabilities`.
  Optional declared metadata exposes display/provider names, explicit canonical ID, provider SVG URL, reasoning,
  input/output modalities and context/output limits. Missing or malformed newly consumed optional fields remain null.
  Existing IDs and capability semantics remain intact; no local model alias registry was added.
- Settings retains the original configured model ID and displays catalog names, provider branding and capability
  facts. Canonical identity and catalog limits live in expandable details. Unknown routes and failed images retain a
  local generic icon. Only `https://models.dev` was added to packaged `img-src`; other CSP directives are unchanged.
- Metadata remains independent from runtime request accounting. Catalog limits do not rewrite runtime configuration,
  and current Settings metadata is not applied to historical requests without their serving-endpoint identity.

## Real-data regression

Command:

```powershell
node --experimental-strip-types .trellis/tasks/11-02-context-attribution-token-efficiency/research/verify-attribution-records.mjs --db C:/Users/55473/.takiagent/taki.db
```

The helper opens SQLite read-only, including WAL, and restricts candidate selection to each historical dispatch
without replacing stored facts. Before the fix, the current projection fails with `data-inconsistent`. After repair:

| Observation | Result |
| --- | --- |
| Captured primary requests | 147, all readable |
| Reported usage with different response name | 146, all preserved |
| Unknown usage | 1, remains unknown |
| Latest reported input / captured effective window | 97,444 / 131,000 tokens |
| Latest composition | Nine categories, 93,831 heuristic units |
| Latest unknown supplier | 10,638 tool-interaction units; no fabricated provenance |

All captured primary compositions remain partial because they include genuinely unrecorded supplier metadata.
That condition is displayed independently and no longer hides the full request. Exact historical provider token
components are not inferred from the heuristic units.

## Integrated verification

- Monitor command: `node --experimental-strip-types .trellis/tasks/11-02-context-attribution-token-efficiency/research/verify-monitor-runtime-ui.mjs`.
  [Evidence](monitor-runtime-ui-evidence/2026-11-04T10-48-05.343Z/evidence.json): **19 stages passed**, actual isolated
  Core/compatible SDK/WS/production client and components in Edge. Three requests preserve distinct requested and
  response names, including a tool continuation, source counts, normal cache arithmetic, re-entry, reconnect and
  narrow rendering. Synthetic missing/zero/estimate states are labeled separately.
- Settings command: `node --experimental-strip-types .trellis/tasks/11-02-native-multimodal-model-capabilities/research/verify-runtime-ui.mjs`.
  [Evidence](../../11-02-native-multimodal-model-capabilities/research/runtime-ui-evidence/2026-11-04T11-00-02.208Z/evidence.json):
  **16 stages passed**, actual isolated Core/WS/production Settings in Edge with the packaged CSP (only the test WS
  port substituted). Public catalog lookup, provider SVG decoding, canonical alias matching, details, unknown model,
  deliberately blocked-image fallback, re-entry and wide/narrow rendering passed. Configuration changes do not change
  the boot-captured synthetic running model. Public HTTP is real; model calls use a local synthetic provider.
- A separate current public reader check resolves `deepseek-v4-flash` and `deepseek-flash` to the same upstream
  `deepseek/deepseek-v4.1-flash-1017` canonical ID while preserving their configured IDs and display names.
- Screenshots for Monitor wide/narrow and Settings details/narrow were visually inspected. Provider branding is
  legible under the current light theme; the repository has no implemented dark theme to claim as accepted.
- Both Core/Edge fixtures confirm owned-process cleanup. Temporary databases/profiles remain ignored. This is
  executable browser/CSP evidence, not native Tauri owner acceptance or actual provider capability probing.

Two intermediate Settings helper failures were corrected without production changes: an all-CSP assertion treated
Zod's existing caught `allowsEval` probe as a blocked icon; it now accepts that documented fallback and rejects other
violations. A narrow-view predicate returned a DOM object to CDP instead of a boolean, causing serialization failure;
the predicate was corrected. The final evidence above covers the complete sequence.

## Quality gates

- Monitor-focused regressions: Core 20, Shared 7, Monitor 13. The actual SDK/ChatAgent/observer/SQLite regression failed
  before the fix and passes with three differently named responses; old DTO and real lineage conflicts are covered.
- Catalog-focused regressions: Shared 8, Core 20, Desktop 12. These overlap full-suite totals and are not additive.
- Full Shared: **727 passed**. Full CLI: **50 passed**. Full Desktop: **1,369 passed** with two workers.
- Core full run with two workers: **4,555 passed, 17 timed out, 6 skipped**, across 559 files, 687.34 seconds.
  All 17 failures were in `subagent-inbox-yield.test.ts`. The complete current file was then rerun with one worker:
  **17 passed**, 12.21 seconds, without changing assertions or timeouts. Every executed Core test therefore has a
  passing result across the full run plus focused recheck; there was not one wholly green full Core invocation.
- All-package type checking: Shared/CLI/Desktop/E2E passed. Core initially observed a concurrent unrelated
  `InboxActionReceipt` export change; after that workspace change settled, the Core recheck passed. This task did not
  edit that interface or revert its owner's changes.
- Active-source ESLint passed: `pnpm exec eslint . --ignore-pattern 'artifacts/**'`. Unmodified root `pnpm lint`
  remains blocked solely by the pre-existing archived `artifacts/runtime-inbox-preimages-20261025/packages/shared/src/index.ts`
  line-count violation. No ignore rule was added to the repository and no artifact was removed.
- Desktop production build passed; its existing large-chunk advisory remains. Rust Clippy passed; Rust tests **211 passed**.
- The first all-package concurrent test command exhausted available memory (about 500 MB free) and hit timeouts.
  Core/Desktop were rerun with `--maxWorkers=2`, without changing timeout thresholds or expectations. A group of 17
  inbox-yield tests encountered concurrently changing unrelated files; the current entire group separately passes.
- Independent scoped review found no verified defect in the identity/catalog implementation. Review findings were
  checked against actual lineage, SDK response semantics, preserved IDs, optional data, CSP and client lifetimes.
- `git diff --check`, edited task UTF-8/no-BOM/whitespace checks, JSONL context manifests and helper syntax checks passed.

Full test commands were `pnpm -r --parallel test` (memory pressure / first failure),
`pnpm --filter @taki/core exec vitest run --maxWorkers=2`,
`pnpm --filter @taki/desktop exec vitest run --maxWorkers=2`, and
`pnpm --filter @taki/core exec vitest run src/harness/subagent-inbox-yield.test.ts --maxWorkers=1`.
Core/Desktop test logs and typecheck/build/lint/Rust logs are under ignored `target/model-metadata-*` paths.
The concurrently changed inbox action implementation and tests were outside this turn's ownership and were preserved.
The first overload and later inbox timeouts are recorded separately; no unsupported single-cause claim is made.

## Remaining work

The parent remains active for new conversation/long-command analysis and evidence-selected token reductions.
The current code must be loaded by the user's Core/desktop instance before its screen reflects the repair; no
existing user service was restarted. Historical unknown supplier metadata remains explicit. Commit/archive and
owner manual/native acceptance have not been performed.
