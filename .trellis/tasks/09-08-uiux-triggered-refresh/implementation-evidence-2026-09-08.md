# Triggered refresh implementation evidence

Status: **engineering accepted on 2026-09-08**. Complete independent source review and the final frozen-build
native matrix passed. Personal owner inspection and real system IME testing were not performed.
Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, implementation baseline `b251474`.
The owner approved the reviewed refresh scope through the renewed autonomous execution goal. No personal inspection is inferred.
Implementation commit: `7d89191dba88c1a143be1de86eac4d86dcc20aa7`, containing exactly the 171 reviewed paths.

## Final result

Home now follows explicit entry, demand, producer, write and recovery policies. Refresh keeps permitted prior content,
drafts, focus, selection and disclosure identity. Core supplies opt-in, data-free Perception and targeted extension
notifications; Settings protects active drafts and observation gaps. No page polling, new persistence category,
dependency, database migration, capture-policy change or production Rust change was introduced.

| Final gate | Result | Evidence |
| --- | --- | --- |
| Independent complete source review | 171 paths: 168 present files and three intentional deletions; no unresolved source findings | [Review](../../../target/uiux-refresh-20260908/check/final-review.md), [exact inventory](../../../target/uiux-refresh-20260908/check/final-reviewed-source-manifest.json) |
| Whole Core suite, run alone | 325 files / 2,139 passed; one existing skip | [Log](../../../target/uiux-refresh-20260908/final-core-tests.log) |
| Whole Shared suite | 48 files / 453 passed | [Log](../../../target/uiux-refresh-20260908/final-shared-tests.log) |
| Whole Desktop suite after review fixes | 148 files / 877 passed | [Log](../../../target/uiux-refresh-20260908/reviewed-desktop-tests.log) |
| Workspace types / root lint | All five typechecks passed; lint has zero errors and one pre-existing unused-disable warning in unchanged `db/run-repo.ts` | [Types](../../../target/uiux-refresh-20260908/reviewed-workspace-typecheck.log), [lint](../../../target/uiux-refresh-20260908/reviewed-root-lint.log) |
| Actual isolated Core processes | Three files / four tests passed; two-operator Perception/extension changes and graceful shutdown | [Log](../../../target/uiux-refresh-20260908/core-process-final.log) |
| Final production build / native host | Passed; 366 recorded build inputs, 24 frozen frontend assets, 25 QA program inputs | [Build](../../../target/uiux-refresh-20260908/final-build.log), [host build](../../../target/uiux-refresh-20260908/final-host-build.log), [snapshot](../../.runtime/uiux-qa/refresh-final-20260908/snapshot.json) |
| Final actual WebView2 matrix | **20/20 groups passed**, zero browser/runtime errors and zero fixture errors | [Native result](../../.runtime/uiux-qa/refresh-final-20260908/final-run1.json), [served assets/CSP](../../.runtime/uiux-qa/refresh-final-20260908/artifact-verification.json) |
| Final read-back and cleanup | Source/assets/harness hashes match; all eight owned PIDs stopped, no remaining owned process or fixture/CDP listener | [Integrity](../../../target/uiux-refresh-20260908/final-evidence-integrity.json), [cleanup](../../.runtime/uiux-qa/refresh-final-20260908/cleanup.json) |

The review inventory SHA-256 is `984d8e07a28efdb3c5f702edb06dd34a12746605b51f9abd01e03ee000d2c8e0`.
The final native result SHA-256 is `828d784838a447591aad4b6bc0877cff04c163ee7f16bb1df037ccbcb6edbdeb`.
Engine: `Edg/152.0.4191.66`. Final native execution: `2026-09-08T02:51:05.790Z` to `02:51:34.861Z`.
The source reviewer also inspected the complete preview2 matrix and assertions; root then ran the same matrix
against the complete final inventory. The independent source flag and root's final native result remain distinct.

The final 20 groups cover cold/stale/empty states and retry; independent Operations demand; MCP disclosure, draft
and save lifetime; Skill inspection/reopen/removal; config conflict/composition/save/setup and cross-owner reads;
Perception native visibility and hidden pause settlement; extension targeting; reconnect; older-Core manual
fallback; independent Chat socket/draft recovery; and reduced motion. Saved frame traces contain 87 disclosure,
55 editor and 88 reduced-motion frames. Every trace includes before/held/settling/settled phases and retains its
connected focused node with **0.0 CSS-pixel x/y spread** in the fixture. DOM Range endpoints/direction and input
selection are checked separately. Root inspected the final retained-MCP-draft and qualified-config-feedback images.

## Implementation checkpoints (historical, before final integration)

| Scope | Current evidence | Limit |
| --- | --- | --- |
| Batch A Desktop state, demand, draft and read lifetime | [Engineering report](../../../target/uiux-refresh-20260908/implement-a/engineering-report.md): 38 focused files / 260 tests; Desktop typecheck, changed-file lint and diff check passed. [Inventory](../../../target/uiux-refresh-20260908/implement-a/source-inventory.json) records 83 paths, including 3 replaced obsolete files. | Earlier checkpoint before B/C Desktop channel integration; no native acceptance. |
| Completed Desktop A-C | [Final inventory](../../../target/uiux-refresh-20260908/implement-bc-desktop/source-inventory.json): 92 paths, 89 current hashes and 3 deletions. B/C adds 32 changed paths relative to A. Final focused checks passed 21 files / 167 tests, Desktop typecheck, owned-file lint and integrity. | Released for independent full-task review and native acceptance; no owner inspection. |
| Batch B Core/Shared Perception | [Report](../../../target/uiux-refresh-20260908/implement-b-core/report.md): Core 13 focused files / 111 tests, Shared 11 tests, scoped lint and types. | Shared/main composition hashes were subsequently superseded by C. |
| Batch C Core/Shared extensions | [Report](../../../target/uiux-refresh-20260908/implement-c-core/report.md): producer, commit/read-back, subscription and Shared focused gates; final typecheck/lint/integrity passed over 39 files. | Separate test runs overlap; their counts are not a cumulative total. |
| Actual Core process integration | [Final process log](../../../target/uiux-refresh-20260908/core-process-final.log): 3 files / 4 tests passed, covering Perception/extension two-operator refresh and graceful shutdown. | Synthetic local sources and isolated temporary storage/credential files; no user provider, Keyring or sensing Host. |
| Initial independent review | [Review](../../../target/uiux-refresh-20260908/check/initial-review.md): 69 Core/Shared/E2E/backend-spec files reviewed; 4 strict E2E typing errors fixed; Core/Shared/E2E types and scoped lint passed. Both real Core refresh E2Es passed again after the test fixes. | Partial review; final Desktop/native work remains with the same reviewer. |

The initial extension process test assumed that a never-tracked disabled MCP row reports the runtime phase
`disabled`. Current `runtimeStatus` returns its existing `disconnected` fallback with `enabled=false`, no runtime
generation and zero tools. The test was corrected after source inspection; runtime policy was not relabeled.

## Whole-package checkpoint before independent Desktop fixes

The following gates ran after Desktop's stable A-C source handoff. Core ran alone; the remaining independent
checks followed. These results do not substitute for final source review and native acceptance.

| Check | Result | Evidence |
| --- | --- | --- |
| Whole Core suite | 325 files, 2,139 passed / 1 skipped; 75.44 s | [Log](../../../target/uiux-refresh-20260908/final-core-tests.log) |
| Workspace typecheck | All five applicable workspace projects passed | [Log](../../../target/uiux-refresh-20260908/final-workspace-typecheck.log) |
| Root ESLint | Exit 0, no errors; one existing unused-disable warning in unchanged `packages/core/src/db/run-repo.ts` | [Log](../../../target/uiux-refresh-20260908/final-root-lint.log) |
| Whole Shared suite | 48 files, 453 tests passed | [Log](../../../target/uiux-refresh-20260908/final-shared-tests.log) |
| Whole Desktop suite | 145 files, 855 tests passed | [Log](../../../target/uiux-refresh-20260908/final-desktop-tests.log) |
| Production preview build | Passed; 364 source/config inputs recorded before build. Existing large-Pet-chunk and plugin-timing advisories remain. | [Build](../../../target/uiux-refresh-20260908/preview1-build.log), [inputs](../../../target/uiux-refresh-20260908/preview1-build-inputs.json) |

## Native preview and review findings

The isolated preview host was built offline with locked dependencies. Its actual WebView2 response passed
the production CSP, served-asset and 364-input checks: [artifact proof](../../.runtime/uiux-qa/refresh-preview-20260908/artifact-verification.json).
The first 18-group native run passed 15 groups. The three failures were verified against actual DOM and
source as harness mistakes: testing the MCP input instead of its disabled Save button, treating the Skills
page's permanent `SKILL.md` import hint as a late inspection, and clicking the extension strip's identically
named Refresh instead of the page resource's action. Corrected targeted reruns passed all three groups.
Both runs recorded zero browser-runtime and fixture errors. This is preview evidence, not a final full run.

- [Initial run](../../.runtime/uiux-qa/refresh-preview-20260908/preview-run1.json),
  [corrected targeted run](../../.runtime/uiux-qa/refresh-preview-20260908/preview-rerun2.json).
- [Cleanup proof](../../.runtime/uiux-qa/refresh-preview-20260908/cleanup.json): all eight owned PIDs stopped,
  graceful fixture shutdown, no remaining owned processes or fixture/CDP listeners.
- Actual DOM Range endpoints/direction, focused input selection, intermediate frame geometry, native WebView2
  controller visibility and reduced motion were exercised. The hidden top-level host does not certify an OS
  minimize gesture, real OS IME, or personal owner inspection. Representative screenshots were inspected by root.

The full Desktop review identified uncovered races in MCP post-write retirement/newer drafts,
cross-owner reuse of an obsolete shared config read, and the busy state of a trailing read started inside
a publication callback. These were fixed with meaningful regressions, including synchronous retirement,
later save attempts, actual-commit-derived retry versions and subscription-gap recovery. Settings now qualifies
old successful-save feedback when the current draft remains unsaved. The two additional native groups cover
MCP save/draft lifetime and the timing-owner/Settings config-read race; both passed in preview2 and the final
20-group run. Earlier source/build evidence retains its original checkpoint hashes.

## Implemented boundaries verified so far

- The Core emits strict opt-in data-free `perception.changed` and targeted `extension.changed` hints through
  authenticated, connection-keyed membership. Existing query DTOs remain unchanged and have no atomic hint revision.
- Actual Perception producer changes and one interested-observer absolute pause-expiry deadline drive invalidation.
  Pause persistence succeeds before changing live consent; the observer never resumes, writes on expiry or captures.
- MCP desired/candidate/publication/closure, Skill committed/rejected/publication and Host accepted set/matching
  deletion are observed at their actual owner boundaries. Surviving SQL commits still notify before fallible read-back.
  Ordinary resource/tool leases and read/Test paths do not invent shared lifecycle changes.
- Desktop's completed A checkpoint separates read visibility from mutation lifetime and protects draft/read epochs.
  Cold errors, successful empty results, retained refresh and stale failures have separate presentation. Five
  post-write-read hide/show races were reproduced and covered with regressions.
- No dependency, database migration, capture cadence/privacy policy, Rust wire mirror or new persistent cache category
  was introduced. Chat/Pet/Monitor feature ownership and concurrent Avatar Lab/OpenBiliClaw work remain separate.

## Release and rollback

Build the Desktop through the existing `pnpm --filter @taki/desktop build` path and deploy the matching Core and
Desktop changes through the existing release process. No new environment variable, migration, dependency or
permission grant is required. Older Core recognizes no new subscription method and receives the explicitly tested
bounded manual-refresh fallback. Rollback may first remove the new consumer wiring; existing read methods remain
available. This turn created local commits only, not a production deployment.

## Manual and separate follow-ups

- The native fixture uses synthetic RPC data; actual Core producers have separate process evidence. It does not
  prove normal Shell/Host capture, real provider behavior or real external MCP service changes.
- Native visibility means actual WebView2 controller visibility and observed `document.hidden`, not a user's
  top-level OS minimize/restore gesture. Composition-event automation is not a real system IME trial.
- Personal inspection of Chinese IME composition and normal-window editing/hide/restore remains a manual check;
  no owner/manual acceptance checkbox was marked from automation.
- Long-CJK Markdown profiling, D77, Avatar Lab/OpenBiliClaw, D69/D75/D76 and actual T4 initiative/Heartbeat/
  cross-device work remain separate. The frozen build includes current Lab/config inputs, while this task's Home
  interaction evidence certifies only the stated refresh scope. The architecture and original frontend parents
  remain open; this completion does not archive them.
