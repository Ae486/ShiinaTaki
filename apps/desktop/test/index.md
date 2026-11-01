# Desktop isolated native checks

- subagent-native-manifest.mjs — shared before/after source and executable hashes for both private-conversation smokes, including frontend assets, native sources/examples/permissions/configuration, fixture drivers and build inputs; no environment or credentials

- s7-subagent-runtime-smoke.mjs — actual Home/WsClient/Core/SQLite/SDK with scripted HTTP: two children/main/drafts, user Stop/Continue, default N50 pause across compaction, exact UI continuation of the original 56-step work, operator K0 user-required attention while private page is hidden, complete actual usage, paging/reconnect/source/privacy. Evidence uses TAKI_E2E_EVIDENCE_DIR or target/acceptance-implementation-20261030/native-runtime; retained profiles/assets live under the actual OS temp root and are recorded in fixture-location.json before building. No real model or human acceptance.

- s7-subagent-native-smoke.mjs / s7-subagent-native-server.mjs / s7-subagent-data.ts — supplemental UI-only WebView2/Home/WS with Shared-validated scripted continuous conversation/activity/attention state; exact combined Stop/Continue, receipts, paused Co-Watching navigation, draft/selection retention and no unknown-send replay. All independent cleanup/evidence failures fail a passing run. Evidence uses TAKI_E2E_EVIDENCE_DIR or target/acceptance-implementation-20261030/native-ui-only; fixture-location.json records the retained OS-temp fixture before building. Cleanup closes owned processes/connections without deleting retained profiles/assets. No model/Core lifecycle/human acceptance.

  Continue checks wait for the actual client's refreshed controls and cleared submitted draft, not merely the server's
  receipt count. Lost-ACK checks hold canonical history to observe the retained unknown draft, then release it and verify
  that the same accepted operation clears uncertainty and renders once without replay. Failure evidence includes DOM,
  visible buttons, draft value and fixture control receipts alongside native screenshots.

- c4-backoff-native-smoke.mjs / c4-backoff-native-server.mjs — the existing frozen Home fixture and C2 WebView2 shell with scripted Shared-validated Monitor/backoff/Timeline data; checks dynamic stages, refresh/reset/reconnect behavior and actual Chat result selection/accessibility. Writes screenshots and source-hash JSON to C4 `research/validation/backoff-native-*`; no real Core/model/C2 opportunity or owner acceptance.

- c3-pattern-native-smoke.mjs — frozen Home assets plus actual WebView2 and production PatternService/SQLite review, conflict, lifecycle, history, draft/selection and lost-ACK recovery checks.
- c3-pattern-fixture.tsx / c3-pattern-fixture.html — production HomeShell with the same Home height/overflow contract; the secondary native fixture window is passive.
- c3-pattern-native-server.mjs — scripted transport/setup/Timeline with real isolated Pattern mutations/history; no model, real user data or ordinary application process.

C3 command: `node apps/desktop/test/c3-pattern-native-smoke.mjs`. It reuses the already-built isolated
`c2-presence-fixture` shell, creates fresh assets/profile/SQLite, and records screenshots plus `evidence.json`
under the selected Cargo target's `c3-pattern-native-evidence/`. This is engineering UI/domain evidence,
not primary-model, Skill-import, real OS IME or owner acceptance. Its emitted bundle-size warning is advisory.

- c2-presence-native-smoke.mjs — isolated C2 native Home/Chat/Pet rendering, trusted-input age, hidden/minimized exposure, reconnect and timezone checks; builds fixture-only UI assets from production components under React development StrictMode.
- c2-presence-fixture.tsx / c2-presence-fixture.html — actual HomeShell/ChatPage and model-free Pet ChatBubble composition; the test opener changes only local bubble visibility.
- c2-native-server.mjs — scripted, Shared-validated operator protocol and captured producer reports; acceptance here does not certify Core policy.
- c2-native-driver.mjs — bounded CDP commands and actual WebView2 input/window transitions.

C2 commands: `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --example c2-presence-fixture`, then
`node apps/desktop/test/c2-presence-native-smoke.mjs`. Set `CARGO_TARGET_DIR` consistently for both commands if needed.
The fixture serves its own built assets and CSP on an ephemeral loopback origin; it does not launch the production
Node, use a real Core/provider, load a renderer/model or touch the user's WebView profile. Evidence and screenshots
are written to the Cargo target's `c2-native-evidence/` directory. Full occlusion and human reading remain unproven.

- qqmm-home-native-smoke.mjs — real built Home/production native adapter/QQMM helper/Host/SQLite flow, explicit temporary installation and WebView data. Exercises access denial, Core independence, paging, route hiding, message/summary/source details, retention, restart and untouched Agent progress. Uses the QQMM-owned disposable summary seed; no model generation. Run after building QQMM, Home and `qqmm-home-fixture`.

## M3 tool-result fixture contract

The same native command now also uses QQMM's `native-tool-result-fixture.mjs`.
It creates retained results through the production three-tool execution boundary
over temporary SQLite and fake producers. All management browsing is compared
with the actual post-invocation feed/read progress and tool-record baselines;
tool execution legitimately advances progress before that baseline is captured.

The checks cover exact saved multi-part Unicode/NUL text, original names and
recall semantics, status/empty/error/local mark-read results, actual occurrence
counts, whole-result conversation filtering, restart and three-level mixed-date
source expiry. All parts retire with the parent while young original messages
remain readable. Existing M1/M2 source, Channel, other-window denial and Core
isolation assertions still run. Fresh M4 runs go to `qqmm-evidence/m4-*`;
the normal Taki binary is never launched. Automated evidence is not human UI
acceptance.

## M4 full-management fixture contract

The command also imports QQMM's `native-m4-scenarios.mjs` and runs a separate
fresh Profile through the built Home, production native adapter/helper,
composed Host, default Runtime, SummaryQueue, protected Secret Store and SQLite.
Only external login and model execution are replaced at existing injected
runtime seams in the fixture-only Host process; control uses parent-child IPC,
not a product endpoint. No real QQ/model or ordinary Taki process is started.

The extra scenarios exercise full settings conflict and explicit save, raw IME
and oversized dimension input, field and confirmation focus across actual
polling, PNG/session recovery and ephemeral clearing, supported PMHQ controls,
and one durable original-input retry after a deliberately lost accepted reply.
A second independently authenticated production ManagementSession verifies
idempotency/conflict. Temporary Host state, screenshots and result files are
written under the run's `management/` evidence directory. The fixture-only
provider/seed validation script can run without any GUI; it is not native
acceptance. M1-M3 assertions and the three-day-tool/one-day-summary expiry order
remain required before these new scenarios.

## M1 validation

The final Channel-based Home integration passed desktop typecheck, scoped ESLint,
four Vitest files / 23 tests, Vite production build, the production native binary
build and the isolated native example build. Three native tests cover actual-label
denial, the capability inventory and the generated Tauri authority, including
legacy local command compatibility and remote-origin denial.

The real native smoke additionally proves:

- Actual response CSP blocks Core WebSockets while Home automatically loads the fixture Host's retained history.
- Main, Pet and another real WebView cannot call any QQMM command. Default Any and explicit Home-target event listeners in other WebViews receive no QQMM event.
- Repeated native open replaces the Channel, ends its previous callback and delivers changes only to the current owner Channel.
- Older history preserves the visible row anchor; detail is literal text with bounded pages; hide/resume, pause, local clear and filtering work.
- Changing 30 days to 7 deletes old fixture content. An actual Home WM_CLOSE leaves Host alive; recreating Home through the existing Pet capability reconnects safely with the same label.
- Restarting the independently owned Host preserves young history and the saved policy, does not revive expired messages and leaves both Agent progress tables untouched.

Evidence: `G:/Temp/taki-qqmm-m1-20260925/qqmm-evidence/result.json`,
`acl-denials.json` and the successful screenshots. The temporary target avoided
an earlier H-drive out-of-space failure; no existing files were removed or moved.

To use another build volume, set `CARGO_TARGET_DIR` consistently for Cargo and the
smoke script. The successful native builds used `CARGO_PROFILE_DEV_DEBUG=0` and
`CARGO_PROFILE_DEV_INCREMENTAL=false`; test equivalents were also set to zero/false.

This is automated fixture acceptance using the built production Home and exact
production QQMM adapter. The normal Taki executable was built but not launched,
since that would boot its real Node/Core path. Human UI acceptance is still separate.

## M2 build and fixture contract

Build the example with the dependency feature explicitly enabled:

```text
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --features tauri/custom-protocol --bin taki-desktop --example qqmm-home-fixture
node apps/desktop/test/qqmm-home-native-smoke.mjs
```

Plain `cargo build` selects the configured development URL, even after Vite has
built local assets. It is not evidence for the packaged-asset fixture. Set the
same target directory and profile flags described above for both commands.

The M2 fixture seeds 108 real queued/running/completed/failed history facts and
23 primary sources through QQMM repository APIs. Current configuration uses a
different dimension description. The script checks stage fidelity, nonempty
saved sections, Unicode text paging, missing/recorded/recalled sources, deletion
holes, full parent cleanup and young originals before/after Host restart.
It also retains the M1 window/Channel and Host lifetime checks. The normal Taki
binary is never launched by this fixture.
