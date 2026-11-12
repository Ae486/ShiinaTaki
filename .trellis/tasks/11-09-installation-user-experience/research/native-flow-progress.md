# Native local entry implementation and evidence

Date: 2026-11-10. Workspace `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`. Work is under the explicit installation/flow
task assignment; the unrelated legacy global task pointer was not changed.

## Delivered behavior and ownership

- `tauri.conf.json` starts the real `home` window before fallible Node assembly.
  Node identity failures retry independently without replacing stored identity.
  The optional browser adapter now has one separate listener owner: malformed or
  inaccessible configuration is unavailable, valid disabled configuration is
  disabled, repair retries only while unavailable, and explicit enable/disable
  replaces that listener without restarting Node or duplicating subscriptions.
- Shared `connect-schema.ts` owns local begin/proof shapes and the canonical HMAC
  transcript. Core asynchronously caches a dedicated per-profile OS credential;
  native validates the server before returning a client proof or transmitting an
  existing token. Both connect phases use the same physical socket. Challenge
  consumption, expiry, role/device/endpoint/instance binding and retired endpoint
  refusal are implemented. Descriptor publication failure retains the old endpoint.
- Native Home/Pet commands validate actual window, exact app/dev origin, operator
  role and the stable native profile-owned operator ID. Node proof is internal.
  No bootstrap key enters JS, localStorage, logs, URL or ordinary config. Existing
  browser reconnect tokens are sent only after native server verification.
- DeviceRegistry remains the durable role/token owner. Concurrent windows do not
  rotate an existing token. Rejected existing tokens stay preserved and never
  trigger silent re-enrollment. Failed device-file writes cannot create trusted
  in-memory-only records. Default broad loopback trust is false; explicit legacy
  opt-in and headless/remote pairing remain separate. An explicitly remote Node
  `TAKI_WS_URL` retains the legacy pairing panel only when that endpoint requests it.
- `pnpm core:dev` / Core `start` prepare and discover the existing helper through
  Cargo, respecting `CARGO_TARGET_DIR` and explicit helper overrides. Core and
  Desktop remain independently launched; `desktop:dev` reads the same existing
  `.env.local` profile selection. No installer/process supervisor was introduced.

Changed source groups: native `lib.rs`, `node.rs`, `local_auth*`, `ws_local_auth.rs`,
`ws_client.rs`, `browser_attachment*`, `secrets.rs`, protocol errors, command build
inventory/capabilities and Cargo HMAC dependency; Core devices/local bootstrap
helper/connect/server config; Shared connect/errors; Desktop operator auth/native
transport/use-operator-connection and accepted-identity timezone binding; local
browser setup feedback; component launch scripts and package script entries.
Touched folder indexes and connection/Home/recovery specs were updated.

## User journey and explicit compatibility choices

Before: start Core -> start Desktop -> legacy connection panel -> copy console
code for Node -> open Home from Pet -> configure dependent features. An invalid
optional browser config could abort native setup entirely.

After: start either component -> Home immediately -> when Core arrives, each
independent Node/Home/Pet/Chat connection authenticates automatically -> use
history/configuration/navigation -> configure Main when text generation is needed.
Missing model/Character resources do not block Home. No test call or pairing
confirmation is added to the normal local flow.

Native operator identity adoption is deliberate: the old browser localStorage
identity remains untouched, and a new stable ID is held under the existing Shell
profile keyring namespace. This closes the arbitrary-renderer-device proof oracle.
The literal path hash namespace is preserved (T4-D83). Previously selected User
Timezone device authority is **not** silently reassigned. Reporting uses the
accepted physical-client ID; the existing explicit current-device selection is
the way to change that authority. Presence sources remain connection-owned.

Only new direct Rust dependency is `hmac = 0.12`, already locked transitively at
0.12.1; its installed documented `Mac::verify_slice` API and cross-language golden
vectors are used. Loopback-only CSP WebSocket ports are now dynamic for authenticated
listener changes; no remote WebSocket/script/eval origin was added.

`master-key.ts` changes only add `windowsHide: true` to existing helper spawn calls.
Its API, default catalog account, precedence, framing and create-only policy stay
unchanged. New async `local-bootstrap-key.ts` uses a different internally derived
account and no Hindsight source was changed by this owner. Automatic helper
availability also makes the existing catalog helper usable; catalog semantics
remain its owner's responsibility.

## Deterministic checks

Commands run in this T4 checkout:

- Core devices/connect/server-config/master-key focused Vitest: **66 passed**;
  subsequent device refactor/regression run: **34 passed**. Coverage includes
  actual WS admission, three concurrent operators, wrong token/role, challenge
  replay/wrong socket/expiry/replacement/identity mutation, async loading/disposal,
  failed descriptor publication and failed device persistence.
- Desktop operator-auth/generation/timezone Vitest: **24 passed**. Bootstrap
  unavailability/server failure preserve credentials; saved token is absent from
  begin and appears only after native proof.
- Shared connect schemas: **19 passed**, including canonical domains, begin
  credential exclusion, strict proof fields and role/Host constraints.
- Native full `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
  --lib`: **210 passed**. Helper binary unit suite: **7 passed**. Optional adapter
  repeated repair/enable/disable verifies listener release and one owner.
- `cargo clippy ... -- -D warnings` passed. Core/Desktop/Shared typechecks, scoped
  ESLint and owned `git diff --check` passed. Final remote compatibility branch
  received focused native auth/clippy verification after the full suite.

Native build environment for repeatability:

```powershell
$env:CARGO_TARGET_DIR='G:/taki-native-flow-build-20261110'
$env:CARGO_PROFILE_DEV_DEBUG='0'
$env:CARGO_PROFILE_TEST_DEBUG='0'
$env:CARGO_INCREMENTAL='0'
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --bin taki-secret-key
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

The original H-drive test build ran out of disk. Only this run's newly created
failed `target/debug/incremental/taki_desktop_lib-33yrbf5zjx1gh` directory was
removed after absolute-path/creation-time verification (47,177,511 file bytes).
No pre-existing cache/profile was deleted. Subsequent build artifacts went to G;
source remained in T4. H still has approximately 46 MB free and needs separate
owner-directed storage attention before large ordinary builds.

## Actual native/process evidence

All runtime data and credential accounts belong to the isolated fixture described
by `G:/taki-native-flow-artifacts-20261110/startup/fixture.json`. No daily profile,
paid model, external message, commit, push or task archive was used.

| Scenario | Actual evidence |
| --- | --- |
| Desktop first, Core absent, malformed optional config | Home navigation/Chat opens; screenshot `startup/snapshot-home.png` and `snapshot-probe.json`; Node independently reconnects. |
| Start actual Core without Main/Utility | Node connects; Home/Pet/Chat each do begin -> proof on their own sockets, then restore. `startup/reload-probe.json` logs redacted frame metadata only; no tokens/proofs. |
| Core first and subsequent Desktop launch | Stable native operator ID and Node reconnect, normal Home; `startup/subsequent-probe.json`. |
| Restart Core only | Home recovered around 5.2 s and Node around 6.2 s; both persisted device IDs/roles/token hashes unchanged. `startup/core-reconnect-check.json`. |
| Real helper create race | Random isolated account: two concurrent creates exit 0/4, winning key read-back true, ~264 ms total; exact account deleted and missing read verified. `helper-race.json`. |
| Packaged CSP/native commands | Embedded app at `http://tauri.localhost`, custom Core port 18976, Home/history/model-disabled hint usable; `startup/packaged-home.png`, `packaged-probe.json`. |
| Malformed browser adapter repair | unavailable -> configured -> disabled via native setup, `restartRequired=false`, Node remains connected; `startup/native-runtime-check.json`. |
| Native role/device/server refusal | Actual Home invoke rejects Node role, foreign ID and forged server proof; same runtime-check JSON. |
| Opaque web origin | Existing isolated Pet temporarily navigated to a `data:` fixture, bridge existed but `local_operator_identity` was rejected; original URL restored. `startup/native-origin-check.json`. |
| Model UI actual flow | Separate frontend owner ran real production UI + deterministic local HTTP model fixture: draft/reopen, keyless apply, explicit test, failed candidate, Utility modes, first reply and same-conversation switch, disable/history. `model-ui-final/model-ui-native-results.json`; zero paid calls. |

Reproduction scripts are colocated: `native-cdp-probe.mjs`,
`native-runtime-check.mjs`, `native-origin-check.mjs`, `native-reconnect-check.mjs`,
`native-helper-smoke.mjs`, and `native-auth-latency.mjs`. They require the explicit
isolated fixture/CDP port; they do not select the user's daily profile.

The packaged fixture build uses `tauri build --debug --no-bundle --config
G:/taki-native-flow-artifacts-20261110/packaged.config.json`. Its asset path must be
the Windows extended absolute form `\\?\G:\...\packaged-dist`; plain `G:/...`
was parsed by Tauri as a URL and produced a fixture-only `file:` origin failure.
This was corrected in the test override, without weakening production CSP.

An earlier runtime exposed detached-method `this` loss after the async authority
refactor. The factory now returns bound callbacks, and detached publication is
covered by regression. One CDP repair probe was interrupted by Vite HMR after
setup; the later packaged probe provides complete stable repair evidence.

## Performance observations and proof limits

Actual packaged native socket lifecycle (open -> begin -> native server validation
-> proof -> close), 20 samples: median **15.6 ms**, p95 **19.8 ms**, max **25.1 ms**.
The cached native/Core keys avoid helper/keyring processes on each connection.
`startup/native-auth-latency.json` owns the measurements.

A five-second post-probe process sample showed Core CPU 0 s/RSS 192 MB, native
RSS 45 MB, and multiple WebView processes around 569 MB combined. Desktop/WebView
CPU totaled ~1.53 s during that five-second interval. This is an observation after
CDP activity with visible windows, **not** a before/after idle-performance pass.
The broader task's comparable baseline, sustained idle/resource budget and owner
acceptance remain open. No additional broad performance reruns are claimed.

## Live2D clarification during handoff

The running packaged isolated fixture intentionally has no imported Character
resources. Vite's development fallback `/spike-assets/arbeit/model.json` returns
real JSON with two textures; the embedded packaged route returns fallback HTML
(200, `text/html`, 565 bytes), so its empty scene has no model. Pet is visible and
has a 720x960 canvas (480x640 CSS). `pet-inspection.{json,png}` and
`pet-fallback-comparison.json` record that distinction without reloading the page.
No renderer/Pet/Vite source was changed by this owner. This evidence supports a
development-versus-packaged resource difference, not a Hindsight regression.
Root owns any further avatar behavior decision; no asset import or source fix
was performed as part of this investigation.

At root's request the current isolated processes and credentials remain intact:
Core PID 31260 (2026-11-10 16:25:29 +08), packaged Desktop PID 11992
(16:34:46 +08), CDP 19224, Core 18976; Vite 1420 is still separate. Later cleanup
must stop only these owned processes and delete only fixture keyring accounts:
the catalog account in fixture.json, `local-bootstrap-<fixture host UUID>`, and
`device-id`, `node-token`, `operator-device-id`, `browser-attachment-token` under
the exact literal-path hashed `TakiAgent-<24 hex>` Shell service. Never delete
daily `TakiAgent` identities or alter real profiles.

## Final packaged rebuild after empty-scene renderer correction

2026-11-10 17:57 +08: root authorized reopening only this isolated packaged
fixture to validate the frontend owner's renderable-content gate. No real profile,
Hindsight code, imported assets or Core process was changed in this step.

- Verified and stopped old Desktop **11992** and only its captured descendant tree
  (PID + creation time + executable path checked before each remaining child stop).
  Inventory: `startup/renderer-rebuild-stopped-processes.json`. Core **31260** stayed
  running with its original 16:25:29.117 +08 start time.
- Rebuilt current frontend and native source, including the final explicit remote
  compatibility branch, using the existing extended-path packaged override:

  ```powershell
  $env:CARGO_TARGET_DIR='G:/taki-native-flow-build-20261110'
  $env:CARGO_PROFILE_DEV_DEBUG='0'
  $env:CARGO_PROFILE_TEST_DEBUG='0'
  $env:CARGO_INCREMENTAL='0'
  pnpm --filter @taki/desktop tauri build --debug --no-bundle --config G:/taki-native-flow-artifacts-20261110/packaged.config.json
  ```

  Build passed; Vite generated `pet-BRjp13g6.js`; Cargo completed in 26.65 s.
  All generated distribution/Cargo output remained on G. Existing chunk-size and
  macOS bundle-identifier notices remain unrelated warnings. No broad native test
  suite was repeated for this artifact-only validation step.
- Launched `G:/taki-native-flow-build-20261110/debug/taki-desktop.exe` with
  `Start-Process -WindowStyle Hidden -WorkingDirectory H:/TakiAgent-worktrees/t4`
  and only the fixture's `TAKI_DATA_DIR`, `TAKI_SHELL_DATA_DIR`,
  `WEBVIEW2_USER_DATA_FOLDER`, plus `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
  --remote-debugging-port=19224`. New Desktop is **36860**, start
  **2026-11-10 17:57:31.654 +08**. `startup/desktop.pid` now contains this PID.
- Static packaged smoke passed at `http://tauri.localhost`: Node connected, native
  operator ID stayed `3c281d4c-bd0f-4e3b-a07c-a0bb64eac7da`, Home renders the same
  history/navigation/model-disabled notice, and Pet is visible with the same
  transparent empty canvas (720x960 physical, 480x640 CSS). Screenshots were visually
  inspected. Evidence: `startup/renderer-fixed-probe.json`,
  `renderer-fixed-home.png`, `renderer-fixed-pet.json`, `renderer-fixed-pet.png`.
- CDP observation sockets were closed after screenshots; no build/test work runs
  during the frontend owner's subsequent 15-second after sample. That owner's
  measured comparison is recorded separately. The empty packaged fixture still
  intentionally has no imported avatar; this does not claim loaded-model visual
  acceptance or repair of missing assets.

Current live fixture supersedes the older PID inventory above: Desktop **36860**,
Core **31260**, CDP **19224**, Core port **18976**, with unchanged Core/Shell/WebView
paths. It remains running for the user as instructed.

## Final Core refresh: graceful-stop prerequisite unavailable

Root's complete Core gate passed before the attempted runtime refresh. The final
source refresh was requested with Desktop 36860 remaining open, exact fixture
configuration preserved, and no model call. Before any signal, the hidden stop
helper independently verified Core 31260's executable, command line and original
creation time. It then detached its own console and attempted `AttachConsole(31260)`.

Windows returned **error 6 (invalid handle)**. No console process membership could
be established, so the helper recorded `attached=false`, `consolePids=[]`,
`signalSent=false` and exited 2. `GenerateConsoleCtrlEvent` was never called. No
fallback termination, process restart, credential change or configuration read
claim was made. Core **31260** and Desktop **36860** both remain alive at their
original start times.

Evidence: `startup/final-core-graceful-stop.json`,
`stop-owned-core-gracefully.ps1`, `final-core-stop.{stdout,stderr}.log`, and
`final-core-before.json` (only device-file SHA256, not credential contents).
The prior detached/window-hidden launch provides no attachable console; updating
this running Core requires a separate explicit decision on isolated forced stop
or retaining the current source/runtime distinction. Root was notified immediately.
The requested post-refresh 83-live/bootstrap/stoplist read-only RPC confirmation
has **not** occurred because the refresh was not performed.

## Final Core refresh completed after explicit idle-stop authorization

2026-11-10 18:33 +08: root explicitly authorized a controlled stop of only the
owned isolated Core when a fresh authenticated read-only idle check passed. This
supersedes the previous blocked graceful-stop section for this fixture; the stop
is **not described as graceful**. The original reason remains Windows
`AttachConsole` error 6 (no attachable console).

Before stopping, `final-core-read-check.mjs` used the actual packaged Home native
proof command and one authenticated socket to read `run.queue`,
`memory.operations.list`, `config.modelProfiles`, `config.list` and
`scheduled-task.list`. It persisted only counts, states and selected non-secret
configuration metadata. Preconditions all passed:

- Run queue 0, no continuation cursor; active Memory Operations 0.
- Main disabled and no active binding; Utility inherit/unconfigured with no active
  binding; active schedules 0; initiative false with applied value false.
- Reported data root exactly matched the isolated fixture path.
- Core PID 31260 executable/command line/original creation time was rechecked
  immediately before literal `Stop-Process -Id 31260`. Desktop 36860 was verified
  separately and remained running. The stopped PID was awaited before launch.

Restart command was `Start-Process -FilePath 'C:/Program Files/nodejs/node.exe'
-ArgumentList 'packages/core/src/main.ts' -WorkingDirectory
H:/TakiAgent-worktrees/t4 -WindowStyle Hidden`, with logs redirected to
`startup/core-final.{stdout,stderr}.log`. Inherited `TAKI_*` and
`CREDENTIALS_DIRECTORY` values were removed, then the exact original fixture
values were restored from `fixture.json` and the recorded launch script:
`TAKI_DATA_DIR`, port 18976, the G native-helper path, the exact isolated catalog
account, loopback compatibility false, ambient screenshot false and initiative
false. No `.env` loader was used, no key values were read/printed, and no key slot
or real profile was changed.

New Core **37512** started **2026-11-10 18:33:19.549 +08**. Desktop **36860** kept
its original **17:57:31.654 +08** start time. Native Node and Home automatically
reconnected without a connection code. The entire `devices.json` SHA256 stayed
byte-identical, preserving both device roles and token hashes; native operator ID
remained `3c281d4c-bd0f-4e3b-a07c-a0bb64eac7da`.

The post-restart authenticated read returned **84 settings: 83 live, 0 restart,
1 env-only**. The data-root row retains the explicit bootstrap boundary.
`TAKI_MEMORY_STOPLIST=on` reports maintenance/applied with active value on;
`TAKI_MEMORY_BM25_WEIGHTS=2,1,2` reports component/applied with the matching active
value. Idle prerequisites remained true after refresh. These are actual live RPC
observations, not labels inferred from source. The read check made **zero model
calls**, sent no configuration/operation mutations, and closed all observation
WebSocket/CDP connections afterward.

Evidence in `G:/taki-native-flow-artifacts-20261110/startup/`:
`final-core-idle-before.json`, `final-core-restart.json`, `final-core-after.json`,
`final-core-verification.json`, and reproducible `final-core-read-check.mjs`.

**Current final live fixture:** Core **37512**, Desktop **36860**, CDP **19224**,
Core **18976**, unchanged Core/Shell/WebView profile paths. These PIDs supersede
all earlier runtime inventories in this report; the fixture is left running.

## Later packaged avatar repair and final runtime inventory

The subsequent real import/selection acceptance found and repaired configured-profile asset resolution and first-import
freshness. Its current implementation, checks, preserved fixture backup and visual/render evidence are recorded in
[packaged-avatar-acceptance-20261110.md](packaged-avatar-acceptance-20261110.md). After its final startup-focus correction,
Desktop is now **22468**, started **2026-11-10T20:03:26.028+08**; Core **37512**, CDP **19224** and Core port **18976** remain unchanged. The visible
isolated costume is `native_accept_c`; this inventory supersedes the earlier Desktop PIDs above.
