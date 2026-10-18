# B3 / whole-5B independent Home review

## Current verdict and ownership

**Scoped Home PASS.** Both independently reproduced source defects are corrected and have affected green
regressions. The actual Core/WS matrix, complete browser scenario, scoped lint and Desktop type gate pass.
The browser uses the already installed matching Chromium Headless Shell after isolated launch diagnostics
proved the full Chromium executable fails before application code. This does not accept whole Stage 5B.

The explicitly dispatched task is `.trellis/tasks/10-07-hindsight-template-lifecycle`; root confirmed the empty
global `.current-task` is expected. Workspace `H:/TakiAgent`, branch `main`, HEAD
`2e244d0fdee49fb2c582a4333a9ef1573fa9112a` were checked. Scope follows `b3-independent-dispatch.md` and the 26-path
`b3-home-source-release-01.json`. This checker changed only owned Home source/frontend specs and its research
evidence. Core, Shared, Native, backend specs, task metadata and `docs/HANDOFF.md` remained read-only.

Root granted the follow-up browser diagnosis and confirmed a short stable Core/Shared window. All checks are
finished; the heavy slot and Core/Shared freeze were explicitly released after `lint-browser-final-01`.
Final Home ownership is released with `b3-independent-home-source-release-01.json`; no further source edit or
check is active. Root must reconcile later cross-owner changes against the recorded dependency snapshots.

## Findings (fixed)

### H1 — A same-connection configuration change did not retire reviewed consent

- File: `apps/desktop/src/windows/home/pages/operations/hindsight-template-state.ts:52`.
- Issue: `templateFrameIdentity()` compared authority, selected/default revisions and plan identity, but omitted
  connection configuration/drift and setup/Bank identity. A real Core configuration write disabling Hindsight,
  observed through the same authenticated WS client, left the old ready preview in Home. Re-enabling the
  connection could expose that obsolete consent again. Core's final guard remained in place; no Native write
  bypass was demonstrated.
- Fix: include Core setup revision/fingerprint/compatibility, sorted Bank bindings, exact observed replica
  lineage/generation and connection config/drift in the Home frame identity. Preserve unsubmitted intent and
  mark it stale after an observed identity change. Ordinary scheduler/job/cursor/timestamp progress is excluded.
- Verification: `controller-red-01` failed at the actual disabled-state observation with the stale preview still
  present. `controller-green-02` passes the regression and a positive control in which ordinary fake-scheduler
  completion and the real WS observation timestamp advance without retiring usable consent. The full 15-case
  controller file passes, including zero duplicate submits after disabled/enabled observation.

### H2 — Escape from a Bank detail did not cancel its preview

- File: `apps/desktop/src/windows/home/pages/operations/hindsight-template-preview.tsx:20`.
- Issue: the Escape listener belonged only to the confirmation footer. A keyboard user inspecting the
  `BeforeImages` summary or another Bank consequence control was outside that subtree, so Escape did nothing.
- Fix: move the listener to the complete preview region and retain the existing cancellation/opener focus
  lifetime. Document that any focused preview detail or confirmation control can dismiss the preview.
- Verification: real Chromium `browser-red-01` focused the actual Bank detail summary, pressed Escape and found
  the preview still present. The complete `browser-diagnose-01` scenario now passes that same detail-focus
  regression and confirms the opener receives focus after dismissal. No assertion or timeout was relaxed.

## Findings (not fixed)

- No unfixed production defect remains within the released Home scope.
- Environmental limitation, outside the Home fix scope: full Chromium 1181 exits with `0x80000003` even in the
  isolated launch probe with no Core/Vite/application navigation. Its matching installed Headless Shell passes
  the same probe and the complete application scenario. The failure is preserved, not attributed to Home or
  represented as repaired. Native/Core pairing, global quality consolidation, installed acceptance and the
  whole-5B verdict remain the responsible owners' work.

## Additional regression coverage and spec synchronization

- Expanded the actual Core/WS removal case to compare the complete user document: nested label fields, model
  tags/trigger/response schema, and an inactive directive with tags and negative priority all survive removal.
- Added incomplete all-Bank detail gating and wrong-preview-hash refusal, a real active original executor with
  Core-owned recovery unavailability, sanitized mutation failure with consumed confirmation/no replay, and a late
  retired client's derived result that cannot replace the new client's unavailable observation.
- Extended the browser scenario to keep an unfinished resource form across actual client replacement while
  preview stays disabled and the submit count remains unchanged. This assertion passes in the complete browser run.
- Rechecked the implementer's three backup error mappings and three no-manual-export-bypass assertions in the
  actual 16-case backup state suite. The common subscription formatter and default behavior pass their existing
  six-case suite and the real Core/WS subscription-failure assertion.
- Updated Operations `index.md` and `.trellis/spec/frontend/home-window.md` for the H1/H2 behavior. Production
  module headers and the existing adapter/hook/controller boundaries remain intact. No backend spec was edited.

## Verification

Every command below ran serially under root's single check slot. Vitest used at most two workers, and the real
browser used one. The `b3-independent-home-<name>-result.json`, matching `.log` and `-inputs.json` retain complete
argv, cwd, timestamps, exit code, input hashes, runtime changes and temporary-root cleanup. Names containing
`green` identify an attempted post-fix run, not an implied passing result.

| Check / evidence name | Result |
| --- | --- |
| `controller-red-01` | Exit 1; genuine H1 assertion failure; 1 failed / 10 skipped |
| `browser-red-01` | Exit 1; genuine H2 DOM assertion failure in full Chromium |
| `standalone-green-01` | Exit 0; 4 files / 31 tests: adapter 4, full resources 5, common controller 6, backup state 16 |
| `controller-green-01` | Exit 1 before test collection: one missing closing brace in the newly expanded model fixture |
| `controller-green-02` | Exit 0; full actual Core/WS controller file, 15 tests |
| `browser-green-01` | Exit 1 before navigation; bundled Chromium launch `TargetClosedError` |
| `browser-green-02` | Exit 1 before navigation; same launcher failure reproduced |
| `lint-green-01` | Exit 0; all 23 owned TypeScript/TSX source and test files |
| `types-green-01` | Exit 0; final `pnpm.cmd --filter @taki/desktop typecheck` / `tsc --noEmit`, 23.844 seconds |
| `browser-full-probe-01` | Exit 1; isolated full Chromium launch, process exit `2147483651` / `0x80000003` |
| `browser-shell-probe-01` | Exit 0; same installed revision's Headless Shell launch and local static DOM |
| `browser-green-03` | Exit 1; shell launched/navigated, but the initial Home section did not appear before the unchanged 25-second assertion |
| `browser-diagnose-01` | Exit 0; complete browser scenario, 1 test, 4 durable submits, no page errors |
| `lint-browser-final-01` | Exit 0; the one subsequently changed browser test file |

The controller parse error was in the checker's new nested model fixture, not production code; the missing brace
was corrected without weakening any assertion. All unsuccessful runs remain unchanged.

The shell's first initial-section timeout had no recorded page-error detail. Immediate page/console error logging
and startup failure artifacts were added to the harness; the next complete run passed without changing production,
assertions or waiting limits. The original timeout's cause was not established, and logging is not claimed to fix
it. This review preserves that failed run instead of inferring a Home defect or inventing a cache/timing diagnosis.

`run-b3-independent-home-check.py` runs from the repository root with the existing isolated runner's clean
environment, disabled dotenv loading, dummy fail-only provider configuration, unique TEMP/TMP and no Node
compile cache. The later Core/Shared handoff added 15 source modules absent from the implementer's inventory;
the independent runner now also scans the current Desktop/Core/Shared source graph and detects files added
during a run. Each final batch records 2,042 input paths with **zero changed inputs during execution**. The
Desktop typecheck consumed the coherent frozen Core/Shared graph; no cast, exclusion or schema weakening hid
the earlier union/public-export diagnostics. Root explicitly authorized reuse of the already green units,
controller and types after the later browser-only executable/diagnostic edit. Only that affected browser test
and its lint were rerun; production TypeScript and the typed controller fixtures did not change afterward.

The first genuine H1 red left only a Node compile-cache subtree; exact path resolution, child inventory and
absence of reparse points were verified before deleting that owned subtree. The separate
`b3-independent-home-controller-red-01-cleanup.json` proves removal and preserves the original result's hash.
Every other run listed above removed its empty temporary root directly. No other owner's directory was removed.

The implementer's `b3-home-adjacent-01` remains a historical 7-file / 92-test PASS. This checker did not modify
those Home test files or their adjacent Home behavior. However, Core configuration/compatibility/transition and
Shared dependencies changed after its input manifest; the 92 tests are not represented as a rerun against the
current whole graph. Current affected cross-layer closure belongs to root's whole-source gate. Counts from
earlier overlapping standalone/controller runs are not added to this review's numbers.

## Read-only adjacent browser runner handoff

Both unchanged adjacent browser tests still select the full Chromium executable that failed the isolated probe:

| Existing harness | Explicit executable seam | Launch consumption |
| --- | --- | --- |
| `apps/desktop/src/windows/home/pages/operations/hindsight-configuration-browser.test.ts` | Hardcoded `chromium` at line 12; passed to Python at line 41 | Python reads `sys.argv[1:]` at line 76 and calls `p.chromium.launch(executable_path=chromium, headless=True)` at line 79 |
| `apps/desktop/src/windows/home/pages/operations/memory-transitions-browser.test.ts` | Hardcoded `chromium` at line 13; passed to Python at line 46 | Python reads `sys.argv[1:]` at line 80 and calls the same explicit launch at line 83 |

The common literal is `G:/AppDataMove/ms-playwright/chromium-1181/chrome-win/chrome.exe`. Neither harness imports
a shared executable helper or reads an executable override. They only spread `process.env` and add
`PYTHONIOENCODING`; Playwright's default browser lookup variables cannot replace the explicit `executable_path`.
Their existence-based skip guards also do not detect this launch failure. This checker did not edit or run either
adjacent browser file. Future whole-5B serial Desktop validation must account for this known runner limitation and
the changed 5A/W7 Core/Shared dependencies. Under the owner's final stop boundary, those extra gates remain pending
for a later session; current Home handoff completes without marking the task or whole stage complete.

## Actual path and fixture boundary

The reviewed path is the strict `ws-client-hindsight-templates.ts` adapter through real operator registry/WS
dispatch, template status/preview/detail and `memory.operations.submit`, into the existing Core lifecycle and
operation owners, then the Home generic-controller seam, template controller/hook and Operations components.
Read/preview/derived methods never become client-inferred Native writes, refreshes or recovery actions.

`hindsight-template-test-fixture.ts` uses actual method registration, loopback operator authentication, sockets,
push subscriptions, Core services, SQLite publication and physical reopen. A single owned operation service is
active per fixture lifetime; cleanup releases gates, drains owners, closes sockets/databases and removes owned
storage. Native transport/results, checkpoint advancement and runtime binding are explicitly synthetic. Their
behavior proves Home/Core orchestration, not Native SQL/authentication or production runtime composition.

The earlier implemented full browser scenario proves two actual Chromium observers, lost ACK, partial original
plan recovery, explicit equal-value preservation, removal/remount and truthful current derived failure on its
recorded source. Its four screenshots were inspected. The independent pre-fix DOM red is preserved under
`b3-home-browser/7a4a90d5-82da-4ca9-baff-2fef3588177b/`; post-fix launch failures are under
`b3-home-browser/041da0f9-d2ec-49a5-a738-064f07ce2ebb/` and
`b3-home-browser/9111fdf2-b2dc-4b93-965e-040770558ae7/`.

The final independent browser artifacts are under
`b3-home-browser/1cc9c7df-3b52-4f1d-b015-bd772b75ed79/`. All four new screenshots were also inspected:
complete two-Bank consequences, original partial plan, explicit customization/provider consequences and current
derived failure. `result.txt` records `TEMPLATE_HOME_PASS`, four durable submits, original operation
`78a9e42b-6b8b-46a7-a51a-26b3f8e110c7`, both new regressions and an empty page-error list. The browser is
`G:/AppDataMove/ms-playwright/chromium_headless_shell-1181/chrome-win/headless_shell.exe`, version
`139.0.7258.5`, SHA-256 `64316957e2368125e872fe36877e959b37737d862000a7893676db9ad6019455`, with
Playwright `1.54.0`. The full executable's retained SHA-256 is
`9ae095668bd68e469fdba86004c74e77c460a74e9b9e49a6f2a4a10b6aeca0b3`.

No installed WebView2/CSP, real Native instance, original data/credentials, live model-provider call, manual
owner acceptance, dependency change, Git lifecycle, finish/archive or Stage 5C work was performed.
