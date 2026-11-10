# Packaged avatar acceptance

Date: 2026-11-10. Worktree `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.

## Result

The actual packaged Home -> import -> select -> visible Pet path now passes without a Pet reload or application restart. Ten alternating costume switches, failed-replacement preservation, Home/Pet reload restoration and actual WebGL rendering also passed. Native and frontend repairs followed an independent review of the reproduced boundaries.

**Final live fixture:** Desktop **22468**, start **2026-11-10T20:03:26.028+08**; Core **37512**, original start **18:33:19.549+08**; CDP **19224**, Core **18976**. Core/Shell/WebView paths remain those in `G:/taki-native-flow-artifacts-20261110/startup/fixture.json`. The visible costume is **native_accept_c**. All acceptance CDP sockets are closed, temporary network blocking is removed, and temporary WebGL wrappers were restored before handing the fixture to root for resource sampling. The later focus correction below supersedes Desktop 29776's initial 30 FPS observation.

This driver made no provider requests, paid calls, real-profile writes, Hindsight changes, commit or push. Visual inspection by the agent is recorded separately from owner acceptance, which remains open.

## Reproduced defects and delivered repair

Before repair, actual Home import succeeded into the configured G profile, but Pet rejected the new costume as `unknown-costume` because its metadata was captured before import. Reloading Pet refreshed metadata, then the actual asset request went to `C:/Users/55473/.takiagent/workspace/characters/...` and returned **404** while the G manifest existed. Home also highlighted the imported default despite `reportSnapshot().costume` being absent. Original evidence remains under `avatar-acceptance/import-taki.zip.json`, `select-native_accept_a.json` and `reload-state.json`.

Native `character_assets.rs` now captures an absolute `local_auth::selected_profile()/workspace/characters` root once at Desktop setup. The fixed-purpose, no-argument `local_characters_root` command reuses actual-window/origin validation, lazily grants that exact subtree through the installed Tauri asset Scope, and returns the same root. Static scope is empty, so a custom profile does not inherit the default profile grant. This creates no directory, reads no credential, requires no running Core, and keeps selection/scope failures confined to the avatar feature. Remote resource synchronization is not added.

Native ownership changed `character_assets.rs`, command wiring in `lib.rs`/`build.rs`, reusable visibility of the existing source guard, the finite capability/generated permission, `tauri.conf.json`, the native folder index, a Cargo feature comment, and `packaged-build.md`. The final change adds no dependency. Frontend owner `model_ui` changed resource composition, bounded fresh metadata reads within the existing costume attempt, and Home observation of actual Pet attachment; its implementation/check details are recorded separately.

## Runtime isolation and preserved artifacts

The owner manually closed earlier Desktop 36860; that event is not a crash finding. Desktop 7000 was a coordinated same-artifact relaunch used to reproduce the defect. Before the final rebuild, an authenticated read verified zero queued Runs, zero active Memory operations/schedules, inactive Main/Utility and disabled initiative with the exact isolated data root. PID/executable/start-time checks preceded stopping only Desktop 7000 and its captured descendants. Core stayed running.

The old isolated `characters/taki` directory was moved, with root authorization, to `avatar-acceptance/prepatch-taki-backup`. Its **165 files** were inventoried and every SHA-256 verified after the move; no file was deleted. The final import used a separate `final-import/taki.zip`, containing `native_accept_c` and `native_accept_d`, SHA-256 `4aefb036a17428980d283c41334e3037f16cfe64cf43c4995615a1d14bc88ecb`. Each costume copies the existing local `models/extracted/taki/arbeit` artwork (82 files, 2,553,731 bytes). These distinct fixture identities use the same artwork; they do not demonstrate two different designs. No model asset was bundled or added to source control.

The G build override now contains only `build.beforeBuildCommand` and the extended-path `frontendDist`. The old full override is retained as `original-build-override.json`; it had copied an obsolete static scope and would have masked the repair. All generated output stayed on G. H disk exhaustion briefly prevented report writing; root's separately recorded scoped evidence relocation restored space, and this report is now back in the task directory.

## Packaged evidence

All final scenario JSON/screenshots are under `G:/taki-native-flow-artifacts-20261110/avatar-acceptance/postfix/`.

| Scenario | Actual observation | Evidence |
| --- | --- | --- |
| Empty Pet / Home state | Pet has no attached costume, ticker stopped, one canvas. Home preserves explicitly stale A/B list data but neither row has `aria-current`. | `inspect-costumes-state.json` |
| Actual first import | Real Home `.zip/.zst` file input dispatches `character.import`; C/D appear. Pet remains mounted with no reload. | `import-taki.zip.json` |
| First attachment | Click C; fresh Pet metadata/resolution, configured G manifest/textures return 200, `avatar.report` names C. Scene: renderable, ticker started, 43 motions, 30 expressions, one canvas. Screenshot visually inspected. | `select-native_accept_c.json`, `select-native_accept_c-pet.png` |
| Scoped resource access | Captured G Character manifest returns **200**; an owned sentinel in adjacent `workspace/native-scope-denied.txt` returns **403**. No daily-profile file is read. | `scope-native_accept_c.json` |
| Ten replacements | D/C alternation succeeds ten times, every observed scene has the requested costume and one canvas. Exactly ten Pet costume resolution and attachment report sequences. | `cycles-native_accept_d-native_accept_c.json` |
| Failed candidate | CDP blocks D's manifest (`blockedReason: inspector`). Home reports D's fetch failure; C remains attached/rendering/current and `last-costume` stays C. Blocking/cache controls restored in `finally`. | `failure-native_accept_d.json` |
| Home reload | Reloaded Home observes actual Pet C and marks only C current. | `reload-home-state.json` |
| Pet reload | New Pet scene loads remembered C, reports C and leaves Home truthful. | `reload-state.json` |
| Actual live rendering | In 1.2 seconds: **6,008** `drawElements`, **48** non-null framebuffer binds, **7,088** non-null texture binds; zero invalid framebuffer/texture handles from the visible canvas's GL context. Governed ticker time advances ~1,256 ms. Final screenshot visually inspected. | `render-proof-state.json`, `render-proof-state-pet.png` |

The initial avatar acceptance on Desktop 29776 observed governor inputs `activity: idle`, `focused: true`, `hidden: false`, `throttling: true`, `renderable: true`, `tickerStarted: true`, `maxFPS: 30`. This read the controller's state; it did not establish actual native focus. Root's subsequent measurement compared native focus and found the initialization mismatch corrected below. The helper reads actual mounted React scene state and `reportSnapshot()`; it does not infer attachment from localStorage. Draw instrumentation existed only during the bounded render proof and was restored before performance sampling.

Stable canvas counts and finite RPC observations do not prove the absence of every listener/resource leak. Listener retirement is covered by the frontend owner's deterministic observer tests; sustained process/resource results belong to root's separate measurement report. The first-import scenario starts without `characters/taki`; pure native tests separately prove that selecting a wholly absent profile does not create its directory. No claim is made that the running Core's top-level characters directory was absent.

Reload diagnostics are not zero: Home reload captured 11 `IPC custom protocol failed ... postMessage` warnings and
11 missing-callback warnings; Pet reload captured six of each, plus the expected development fallback warnings.
The controlled fault blocked only D's `model.json` URL and was removed before either reload, so these IPC messages
are not the injected asset failure. Installed Tauri 2.11.5 `scripts/ipc-protocol.js:59` emits the fallback when its
custom-protocol request rejects, while `scripts/core.js:40` warns when a callback no longer exists and explicitly
identifies reload during an asynchronous operation as a possible cause. Captured reload network requests include
`net::ERR_ABORTED`; later native root/scene and attachment operations succeeded. These observations are consistent
with reload transients but do not prove every callback's origin. CDP `Runtime.enable` can return earlier console
records, and later JSON repeats the same callback IDs, so those repetitions are not counted as new failures.
No persistent functional failure is demonstrated, and no new runtime investigation was run during resource sampling.

## Checks and build

Final native shape: **4** Character-root/config tests and **2** existing source/identity guard tests passed; the helper's **7** tests passed; native clippy with `-D warnings` and owned diff whitespace checks passed. These are exact final-tree checks. Earlier **215/215** library tests passed with a temporary mock-runtime test variant, but that variant is not the final test shape and its count is not claimed as a final full-suite run. Root separately records the full Desktop suite and the frontend owner's final focused checks.

The temporary Tauri mock tests pulled `TaskDialogIndirect` into the unit harness, triggering Windows loader `0xc0000139`. Passing the existing manifest globally made those tests run but duplicated Tauri's binary resource and caused CVT1100/LNK1123 during packaging. The mock feature/tests and global link were removed; existing examples-only linkage was restored, and real packaged scope acceptance supplies the integration proof. No DLL, crate or CSP workaround remains.

The avatar-repair packaged build succeeded (`final-packaged-build-v2.log`) with frontend `pet-hRLk2NMK.js` and `home-Cs9wxdak.js`; the later focus-only build is recorded below:

```powershell
$env:CARGO_TARGET_DIR='G:/taki-native-flow-build-20261110'
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
pnpm --filter @taki/desktop tauri build --debug --no-bundle --config G:/taki-native-flow-artifacts-20261110/packaged.config.json
```

The driver `research/packaged-avatar-acceptance.mjs` passes `node --check`. Set `AVATAR_ACCEPTANCE_OUTPUT` to preserve prior evidence; modes include `import <archive>`, `select <costume>`, `cycles <first>,<second>`, `failure <costume>`, `scope <costume>`, `reload-home`, `reload`, `render-proof`, and `focus`. `postfix/scene-snapshot-expression.js` is the reusable read-only scene helper for root's later measurements.

## Final startup-focus correction

Root's six-sample resource investigation then compared the actual native window with the controller:
`document.hasFocus() = false`, native `isFocused() = false`, but governor `focused = true`, `maxFPS = 30`.
`acceptance/loaded-scene-after.json` records this independently confirmed initialization defect. The existing hook
subscribed to future focus events without reading the current native state. Frontend owner `model_ui` repaired the
hook using listen-before-read seeding with event-revision/disposal fences; 16 focused tests, Desktop typecheck and
scoped lint passed. No native Rust or asset grant contract changed.

After that owner/root readiness signal, only identity-verified Desktop 29776 and its captured descendants were
stopped. Core 37512, Character files, selected costume, profile paths and credentials stayed intact. The same G-only
packaged command rebuilt frontend `pet-Dpng3Lqm.js` and embedded it; `focus-packaged-build.log` passed. There was no
repeat of broad Rust tests or the ten-switch suite because this narrow change did not alter those paths.

Desktop **22468**, started **20:03:26.028+08**, restored C automatically. Before any synthetic focus manipulation,
the actual packaged `focus` probe returned **document false / native false / governor false**, `maxFPS: 15`,
`hidden: false`, `renderable: true`, `tickerStarted: true`, one canvas and the same 43-motion/30-expression vocabulary.
`focus-fixed/focus-state.json` owns these observations. `focus-fixed/focus-state-pet.png` was visually inspected and
shows the restored model. All CDP connections closed before root's next six 30-second samples. This confirms the
startup tier correction; CPU/memory improvement is not inferred from the tier and remains root's measured result.

Remaining boundaries: loaded-model CPU/memory budgets are measured by root after this handoff; owner visual acceptance is not marked complete. Remote asset transfer and distinct-artwork switching are outside this fixture. Expected packaged development-fallback warnings and the explicitly recorded reload IPC warnings are not mistaken for a failed imported-model attachment or described as a clean console.
