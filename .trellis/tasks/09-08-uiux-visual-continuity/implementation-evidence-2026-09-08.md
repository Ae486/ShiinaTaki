# Home visual continuity implementation evidence

Status: engineering implementation, independent source review, final frozen-build native verification and owner visual acceptance complete. The owner authorized local closeout after the 2026-09-08 normal-window confirmation. Code commit: `d6ddf2e5f932a096ff6162d31b05caeb16e7286e`; the completed task directory is retained.

Worktree: `H:/TakiAgent-worktrees/t4`
Branch: `task/t4-skills-mcp-productization`
Baseline: `82e0a4ae887129c64fffa61539dae7979cafc3e2`
Task: `.trellis/tasks/09-08-uiux-visual-continuity`

## Delivered behavior

The owner approved this class-wide follow-up after manual inspection of the completed event-triggered refresh work. The request concerns content continuity, small pending affordances and transient feedback across Home.

| Area | Result |
| --- | --- |
| Monitor Run and Inspector selection | A coherent committed view remains while the requested replacement loads. Latest request wins, and the replacement identity, content and actions commit together. Run-local history cursors and reading state do not leak between Runs. |
| Authority and lifecycle | Missing records, disabled monitoring and reduced detail authority evict their affected projections. Live mode changes also reach hidden controllers; returning pages reconcile current authority before paint. Retired reads cannot reopen or restore removed detail. |
| Shared pending feedback | An existing reserved slot displays a subdued indicator only after 250 ms of actual pending work. Fast responses paint no loading text. Results settle immediately; fixed dimensions and baseline-independent alignment prevent content movement. |
| Perception and cross-page refresh | Existing card/row identity remains through ordinary invalidation. Sampling qualification and Privacy Pause busy state use stable header slots. Successful empty responses still become honest empty states; persistent failures remain available. |
| Mutation feedback | Settings, MCP, character import and media cleanup emit once-consumed outcomes into the existing fixed Toast host. Fresh attempts may repeat the same wording; stale echoes and old success/new failure combinations are suppressed by event identity and replacement ownership. |
| Reading and useful errors | Unheld Toasts expire after six unpaused seconds. Pointer/focus reading pauses expiry; deliberate click/keyboard hold lasts until dismissal. Field validation, conflicts, failed/unknown operations, resource warnings, Skill inspection and useful results remain at their owning views. |
| Chat attachments | Native image picks cannot publish thumbnails or failure notifications into a draft already consumed by Send or unmounted. Multiple valid picks inside the same active draft remain additive. |

Implementation uses ordinary React state publication, batching, stable keys and reconciliation around existing controllers/stores. It adds no parallel rendering tree, new data framework, polling, delayed data publication, protocol, database change or dependency.

## Independent source review and corrections

The independent reviewer read all 91 original source/test/index/spec paths plus four necessary related files, freezing **95 files**. The report is `target/uiux-continuity-20260908/checks/review.md`; the exact inventory is `target/uiux-continuity-20260908/check/final-source-review.json`.

The review repaired eight groups: live Monitor authority delivery; pre-paint hidden-page reconciliation; pending-slot baseline movement; image-pick draft retirement; unknown import/purge outcomes across reconnect; unverified conflict/read-back claims; missing Skill disclosure attributes; and a legacy availability regression that conflated unchanged authority with a downgrade. No known task-owned source defect remains at this checkpoint.

Candidate-1 native artifacts reproduce the baseline movement, late attachment success/failure and hidden-mode stale detail. Those artifacts precede the fixes. The separate final-1 native proof below verifies the corrected source and build.

## Completed checks

All commands ran in the T4 worktree. Logs are under `target/uiux-continuity-20260908/checks/`.

| Check | Command or method | Result | Evidence |
| --- | --- | --- | --- |
| Desktop regression suite | `pnpm --filter @taki/desktop test` | 155 files, **952 tests passed** | `review-final-desktop-4.log` |
| Workspace types | `pnpm typecheck` | CLI, Core, Desktop, e2e and Shared passed | `review-final-typecheck-4.log` |
| Root lint | `pnpm lint` | Zero errors; one existing `packages/core/src/db/run-repo.ts` unused-disable warning | `review-final-lint-4.log` |
| Whitespace | `git diff --check` | Exit 0; existing parent-task CRLF notice | `review-final-diff-4.log` |
| Reviewed bytes | Strict UTF-8/BOM validation and SHA-256 read-back | 95/95 matched | `review-manifest-validation.log` |
| Production Desktop build | `pnpm --filter @taki/desktop build` | Passed; existing large-chunk advisory | `final-1-build.log` |
| Build provenance | Pre-build input capture and post-build comparison | 375 actual inputs unchanged; all 95 reviewed bytes still match | `../final-1-build-verification.json` |

Review inventory SHA-256: `e8ed51df3c6f93db70030e5f5ea9d95ce6241a0f046f1a8bb931e763b24320c2`.

The build-input record includes concurrent Lab/config/public assets because they are real build inputs. This Home acceptance does not certify those separate features. The successful source gates are not rerun merely because documentation changes.

## Final native verification

**14/14 cases passed**, from `2026-09-08T10:13:05Z` to `10:14:21Z`, with zero page/console errors and zero fixture errors. The run used a hidden, independent WebView2 host, frozen production Home assets, synthetic RPC data and port 8975. A narrowly scoped constructor/CSP port substitution isolates QA from the real Core on 8974; production JavaScript assets remain unchanged.

Evidence root: `.trellis/.runtime/uiux-qa/continuity-preview-20260908/`. The directory name retains the harness's preparation origin; `builds/final-1/snapshot.json` is explicitly final and uses the reviewed build. `final-1-results.json` requires a complete matrix and the matching passing `final-1-assets.json`, and rejects stale source or a different host.

| Native group | Observed result |
| --- | --- |
| Small and long Run selection | A remains paint-visible while B is held; C-before-B replies settle on C. Long ledgers retain 100 initial rows, append 25 older rows through the real pager and preserve reading anchors. |
| Inspector and authority | 87 replacement frames preserve matching title/row/detail. Close rejects late replies. Live mode retirement and stale mode/detail replies pass; hidden downgrade/reveal exposes the old local-detail marker in **0/61 frames** on the same authenticated socket. |
| Pending layout | Fast reads display no transient status. Slow reads use the reserved indicator; title/header/card rectangles are exactly equal before, during and after at DPR 1.5. The same checks pass with reduced motion. |
| Perception | 127 held-refresh frames and 77 fast-refresh frames preserve populated content. Actual row nodes, selected text and scroll position survive. Card geometry is identical across the three captures, with `scrollTop=108`; a successful empty response renders the empty state. |
| Mutation feedback | Permission, config, MCP and media each display one card. Unheld lifetimes are 6,003.4 / 5,998.3 / 6,001.2 / 6,000.0 ms. Read/re-entry does not replay success, later attempts remain distinct and expiry does not move the page. |
| Reading and dismissal | Pointer/focus pauses, resumed remaining lifetime, deliberate click hold, keyboard activation hold, Tab and labelled close pass. |
| Chat picks | Invalid file attempts notify separately. Native FileReader PNG completion and native bitmap TIFF failure after Send/clear produce neither a new thumbnail nor a stale failure Toast. The OS file picker is not simulated as accepted. |

The actual served asset/CSP proof passes: **21 frozen Home resources**, **375 unchanged build inputs**, all **95 reviewed files**, exact fixture-only WebSocket destinations and the ordinary-eval CSP restriction. The root separately read the final result, source proof, key frame/geometry records and Monitor/Inspector/MCP/Perception screenshots. See [native-harness research](research/native-harness.md) for the full index and reproduction commands.

`launches/final-1/cleanup.json` records graceful fixture shutdown at `2026-09-08T10:18:50Z`, retirement of all eight owned QA PIDs, and no remaining owned processes or listeners. Prior candidate evidence remains available and is not overwritten.

The root's final closeout record, `target/uiux-continuity-20260908/root-final-verification.json`, confirms no drift in the 95 reviewed files or the 61 protected unrelated files. `final-index-validation.json` independently checks all 31 hashed file references in the native artifact index. The task context manifests and final whitespace check pass.

## Manual acceptance and operational boundary

After Desktop relaunch and the normal-window checklist, the owner reported no issues on 2026-09-08. This records personal acceptance of this follow-up's visual/interaction scope separately from the automated renderer checks. The subsequent inactive sampling observation was attributed to the owner's switch to standard permissions; the owner stopped that investigation and explicitly deferred the permission-state, authorization-entry and recovery improvements as D78. No permission-system fix is claimed here. Native OS file picker, real Core/Host mutation outcomes, IME behavior and production security enforcement are not proved by synthetic UI responses or inferred from this bounded visual confirmation.

| Manual check | Method | Expected result |
| --- | --- | --- |
| Run and Inspector continuity | Alternate among several Runs and their detail records, including rapid selections | Existing content remains until the matching new content is ready; no intermediate empty page, mislabeled detail or late reversal |
| Perception reading | Scroll/select an activity row while normal sampling invalidation refreshes the page | Existing rows and viewport remain stable; new/empty data is truthful; routine refresh adds no vertical banner |
| Action outcomes | Perform an intended permission/config/MCP action, revisit the view, then perform a distinct attempt | One floating outcome per attempt, no replay on read/re-entry, automatic expiry when unheld, and no displaced page content |
| Reading and retry | Hover/focus a Toast, deliberately hold/dismiss it, and inspect a refused or failed action | Reading pauses expiry, dismissal works by pointer/keyboard, and persistent corrective information remains discoverable |

No release, new environment variable, dependency or migration is required. Rollback restores this task's frontend files with unrelated work preserved. This task performs no automatic commit, push, archive or shutdown of the owner's processes.

On 2026-09-08 the owner explicitly approved local commit closeout and entering T4 Heartbeat planning. The 95 reviewed source/test/index/spec files were committed as `d6ddf2e` after a fresh hash-equality and staging-scope check. Existing successful gates were retained because the reviewed source did not change. Acceptance/task/handoff documentation and only the owned D78 registry entry are recorded separately; the unrelated D71-D74 working-copy additions remain excluded.

At the final runtime observation (`2026-09-08T10:26:48Z`), the original Core is still PID 4660 on port 8974. The earlier manual Desktop and port 1420 listener are absent; no claim is made that a normal user window currently displays the updated source. Native evidence above comes from the separately launched and cleaned QA host. Reopen Desktop for personal visual acceptance.
