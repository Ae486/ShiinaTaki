# Implementation and verification evidence (2026-11-02)

> Follow-up on 2026-11-04: the approved maintained-model catalog extension is implemented. Settings now presents
> source-provided names, canonical IDs, provider logos, capabilities and declared limits. The parent Monitor's
> response-name mismatch is repaired. See the parent's [delivery record](../../11-02-context-attribution-token-efficiency/research/model-identity-catalog-delivery.md)
> for 147 real-data request checks, 19 Monitor and 16 Settings browser stages, exact full-test/recheck results and
> retained limitations. No user service restart, commit, push or archive was performed.

The owner-approved coordinated stage implements all-image unification and investigates context composition in parallel. Worktree: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`; baseline HEAD: `a2269ad`. Code is uncommitted. No push, archive, live-user service restart or historical-data rewrite was performed. Pre-existing `artifacts/` is preserved.

## Delivered behavior

- User images, explicit/opaque screenshots, standard MCP images/resources, selected ambient/perception/viewing frames and private-worker replay use the normal primary model with native image parts. There is no pre/post image-caption call or hidden vision fallback.
- Separate vision configuration, UI controls, provider/bootstrap slot, image-description writer, screenshot translator and semantic sentinel are removed. Obsolete stored settings are inert; historical descriptions/usage remain untouched.
- Original image refs use existing confined attachment storage. Native image hydration precedes history selection and pressure measurement. Retained originals support normal selected follow-up; expiry/missing originals produce unavailable evidence without recapture. Historical explicitly typed SDK media is normalized on read; arbitrary JSON is not reinterpreted as images.
- Temporary observations remain bounded to their actual Attempt/source/consent lifetime and are rechecked at dispatch. Private SQLite replay bridges temporary native sidecars in memory; it persists no raw pixels. Exact tool pairs/steps preserve association even when call IDs recur.
- Settings shows models.dev capability declarations with exact identity and honest unknown/unavailable states, separately from adapter support. Lookup failure cannot block native images. No automatic paid probe or new agent framework is used.
- Normal request usage remains the accounting authority. Images keep their enclosing user/tool/context source and have no separate meter.

## Verification matrix

| Check | Result and scope |
| --- | --- |
| Final `pnpm typecheck` | Passed across CLI, Desktop, Core, e2e and Shared after final legacy/private/MCP changes. |
| Root `pnpm lint` | Fails only on pre-existing `artifacts/runtime-inbox-preimages-20261025/packages/shared/src/index.ts` max-lines. Artifact and lint policy were not modified to hide it. |
| Final `pnpm exec eslint . --ignore-pattern 'artifacts/**'` | Passed for the active source tree. |
| Full workspace tests | Shared 704, CLI 50 and Desktop 1,347 passed. Initial Core: 4,508 passed, one obsolete compaction sampling assertion failed, six skipped; corrected it to measure peak/reduced/final pressure, then its four tests passed. |
| Final full Core rerun | Passed: 551 files passed, one skipped; 4,524 tests passed, six skipped. Duration 561.87 seconds. Run started after all final native/private/MCP production changes. |
| Final focused native suites | Native legacy/MCP/replay 51 tests/5 files passed; private replay 20 tests/3 files passed. Earlier native 194 tests/17 files and perception/viewing 75-test suite passed. Overlapping suites are not additive coverage. |
| Rust | Cargo Clippy with `-D warnings` passed; Cargo tests passed 204 library + seven secret-helper tests. No Rust source changed afterward. |
| Independent review | Completed with no remaining proven code blocker; corrected global viewing prerequisites and private retained/temporary/legacy replay. See [final-native-review.md](final-native-review.md). |
| Real provider | Four bounded synthetic-image requests passed against configured `deepseek-v4-flash`. |
| Actual Core/WS/Settings | Final isolated zero-paid run passed after final imports/composition, including catalog failure. Earlier run covers public catalog declared/unknown results. |

Commands: `pnpm -r --workspace-concurrency=1 test --maxWorkers=2`; final Core `pnpm --filter @taki/core test --maxWorkers=2`; `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.

The e2e workspace has a separate `test:e2e` script and is not counted as executed by recursive `test`. Broad real-device/paid L2 suites were not run; the bounded paths below provide the relevant integration evidence.

## Real primary-model evidence

Command: `node .trellis/tasks/11-02-native-multimodal-model-capabilities/research/verify-native-main.mjs --allow-paid`.

[native-main-evidence/result.json](native-main-evidence/result.json) records exactly four physical requests, one synthetic capture and native image counts `1, 1, 0, 1`. A generated red-left/blue-right PNG was used; no user screenshot was sent. User recognition, retained-image follow-up and the next request after a screenshot tool produced the correct colors. No translator call occurred. Output was capped at 1,024 tokens per request.

The two `usage` entries are foreground calibration samples, **not complete billing for all four calls**. Do not total them as the full bill or infer a savings percentage. This experiment preceded the last private/MCP/legacy patches; their native serializer paths were subsequently regression-tested without repeating paid calls.

## Actual runtime and UI evidence

Command: `node --experimental-strip-types .trellis/tasks/11-02-native-multimodal-model-capabilities/research/verify-runtime-ui.mjs`.

- Final [2026-11-02T07-25-14.277Z/evidence.json](runtime-ui-evidence/2026-11-02T07-25-14.277Z/evidence.json): actual Node v24.18.0 strip-only Core, fresh isolated DB, real operator WS and actual SettingsPage/client/hooks in headless Edge. Two `chat.send` image requests reached only the local fake primary provider, with one then two native images (retained replay), exact pixels and no base64 text leakage.
- Durable rows each report 200 input, four output, 80 cache-read tokens; cache aggregate is 400/160 = 0.4, auxiliary request count zero. These synthetic integration counters do not establish real-provider image sizing.
- Model edits, restart semantics, visibility/re-entry and 1,100/620-pixel widths passed without horizontal overflow. Final public catalog retrieval was unavailable; failure/retry UI rendered and chat still worked. Earlier [2026-11-02T06-50-20.871Z evidence](runtime-ui-evidence/2026-11-02T06-50-20.871Z/evidence.json) covers public declared `gpt-4o` and exact unknown-model results.
- Final narrow/failure screenshots and the earlier declared screenshot were visually inspected. This verifies browser rendering, not owner manual acceptance in native Tauri or a live OS screenshot workflow.
- Owned Core/Edge processes were stopped. An evidence-only `edgeClosed` flag originally ignored signal exits; the helper was corrected and [cleanup-audit.json](runtime-ui-evidence/2026-11-02T07-25-14.277Z/cleanup-audit.json) independently confirms no owned Edge process remains. Generated profiles were removed after absolute-path checks. Isolated Core data/profiles are excluded by the task-local `.gitignore`; screenshots and evidence remain.

## Material tradeoffs and limits

- Main now receives permitted original pixels. Removing the translator also removes its pre-main programmatic `SENSITIVE_SCREEN` barrier; deterministic process/permission/consent/Host screening remains. Main-model privacy guidance is not an equivalent semantic filter.
- Default ambient `drop` now means after consumption, expiry, replacement or withdrawal. Existing keep/days choices remain. Original files are available within their TTL/context selection; removing the description producer does not promise permanent visual memory.
- PNG/JPEG/WebP/GIF use existing retained storage. Other explicitly declared image MIME types are native but temporary. A legacy bare provider file ID without its binding is unavailable rather than guessed valid.
- Replaying originals can increase later native input while translator requests are removed. Net cost/savings needs representative new usage over equivalent tasks.
- Capability results describe the configured identity; runtime model changes require the normal Core restart. The user's current service was not restarted.

## Parent handoff and remaining work

The parent [source attribution report](../../11-02-context-attribution-token-efficiency/research/request-composition-attribution.md), sanitized baseline derivation and refined design are complete. Nine exclusive categories plus a separate content-origin axis are proposed. Historical exact shares are unavailable; the calibrator's estimator window is not a real-token denominator. Collection must bind the committed model Effect to native `onDispatch` **after** currentness/TTL filtering.

Parent Monitor instrumentation, new real-use cohorts and evidence-selected token reductions remain unimplemented. Its planning review recommends observability first and deferring broad prompt/history/loop changes. Child automated delivery is not parent completion, native-Tauri owner acceptance, or commit/archive authorization.
