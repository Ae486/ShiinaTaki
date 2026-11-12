# Native continuity acceptance harness

Strict native verification of reviewed final-1 passed all 14 cases after the candidate-1 diagnostics below.
Owner acceptance remains separate; this slice never builds production UI.

The ignored harness is `.trellis/.runtime/uiux-qa/continuity-preview-20260908/`. Only necessary source/config
was copied from the proven `refresh-final-20260908` reference; no previous evidence, frontend bundle, profile or
executable was copied. Work stayed in T4 on `task/t4-skills-mcp-productization`; the explicit continuity task
was used because the legacy global pointer names an older task.

## Isolation and version proof

- The owner's Core remains on `127.0.0.1:8974`, PID 4660 at preparation. The fixture uses separate loopback
  port 8975 and refuses an occupied port. It imports Shared schemas and synthetic data only.
- `use-operator-connection.ts:20` composes a fixed default URL and offers no URL override. The QA host's
  `isolation-init.js` rewrites only exact `ws://127.0.0.1:8974` / `ws://localhost:8974` constructors to
  `ws://127.0.0.1:8975`. Other WebSocket destinations are refused. Production assets are unchanged.
- QA CSP substitutes only those two loopback port tokens to 8975. All other directives stay equal to
  production; no new eval permission or broader origin is added. The artifact check validates actual response
  CSP, served asset digests and WebSocket destinations.
- The dedicated Tauri host keeps its top-level window hidden, uses a private `webview-data/` directory,
  and loads no production Shell library, Core, user DB, Keyring, provider or imported model. Its native
  visibility command changes the actual WebView2 controller, not `document.hidden`.
- Named `builds/<name>/` snapshots and staged executables are immutable. `active-build.json` and
  `runtime.json` are current pointers; `launches/<name>/launch.json` and cleanup logs preserve exact PIDs,
  executable/script paths, start times and ownership. Cleanup verifies PID/path/start time and only stops
  the recorded fixture, host and that host's descendants. It never targets 8974 or processes by image name.

## Prepared matrix

`node .trellis/.runtime/uiux-qa/continuity-preview-20260908/run-qa.mjs --list` lists 14 cases:
Monitor A-to-held-B and C-before-B replies; one 125-row switch/history variant using real 100-row tails and
25 older rows; coherent retained Inspector plus close/late reply, live mode downgrade and hidden downgrade/reveal; populated
Perception nodes/card rectangles/scroll/DOM Range across repeated fast and held invalidation, failed refresh
and genuine empty; title/extension/permission fast/slow slots; permission/config/MCP/media single Toast and
six-second unheld expiry; later failures replacing old success and repeated same-message attempts; pointer,
keyboard focus/Tab, click/Enter hold, close and Escape; invalid Chat file decode and a repeated pick; native
PNG FileReader/TIFF decode pending pick followed by Send/clear in the same browser task; reduced
motion on pending slots. Permission refresh uses the existing open-disclosure DOM `toggle` event. File pick
uses a synthetic `File`/`DataTransfer` change event, not the OS file picker.

All UI tests use public DOM/RPC controls. There is no import of production stores or hidden test-only
production API. Frame traces and before/during/after node references are saved separately from screenshots.
Monitor samples ancestor display/visibility/opacity, ledger data-ready/data-virtual and records intersecting the
viewport. The hidden downgrade trace starts before returning to Monitor, with the new mode read held, so the
first revealed paint is checked. Header, title and downstream-card geometry use a 0.05 CSS-pixel tolerance;
a 1px tolerance concealed a real one-physical-pixel shift at the tested devicePixelRatio of 1.5.
Store-level duplicate event delivery/StrictMode ownership is covered by the production regression suite;
this native harness covers readback/re-entry replay and distinct attempts without exposing a store seam.

## Commands after the root announces a reviewed build

The root owns the production build and pre-build inventory. A pre-build record must contain `stage`,
`scope`, and `files: [{path, sha256}]` (or `{path, status:"deleted"}`) under
`target/uiux-continuity-20260908/`. A final review inventory must be under its `check/` directory, have
`schemaVersion:1`, `task:".trellis/tasks/09-08-uiux-visual-continuity"`,
`source_review_complete:true` and its exact `files` inventory. The examples below assume those file names.

From `H:/TakiAgent-worktrees/t4`, sequentially:

```powershell
python .trellis/.runtime/uiux-qa/continuity-preview-20260908/snapshot.py final target/uiux-continuity-20260908/final-1-prebuild-inputs.json final-1
cargo build --offline --locked --manifest-path .trellis/.runtime/uiux-qa/continuity-preview-20260908/launcher/Cargo.toml --features custom-protocol --target-dir apps/desktop/src-tauri/target
python .trellis/.runtime/uiux-qa/continuity-preview-20260908/launch-detached.py stage-host --reuse-desktop-cache
python .trellis/.runtime/uiux-qa/continuity-preview-20260908/launch-detached.py fixture final-1
python .trellis/.runtime/uiux-qa/continuity-preview-20260908/launch-detached.py host
node .trellis/.runtime/uiux-qa/continuity-preview-20260908/qa-artifacts.mjs --final --review=target/uiux-continuity-20260908/check/final-source-review.json --output=final-1-assets.json
node .trellis/.runtime/uiux-qa/continuity-preview-20260908/run-qa.mjs --final --review=target/uiux-continuity-20260908/check/final-source-review.json --artifacts=final-1-assets.json --output=final-1-results.json
& .trellis/.runtime/uiux-qa/continuity-preview-20260908/cleanup.ps1
```

Use a new build name after a source/build change, and a new output/launch name for each rerun. Do not overwrite
failed evidence. Selected diagnostics use `--only=monitor-targets,inspector` without `--final`; they remain
partial. A final run refuses preview-stage assets, an incomplete review, stale source hashes, a different
host's asset proof, or a partial matrix. The parent must run cleanup even when acceptance fails.

The prior compile cache was verified from `apps/desktop/src-tauri/target/debug/taki-refresh-fixture-qa.d`
and its custom-protocol fingerprint. The owner authorized reuse for the new, uniquely named continuity crate;
cache guard JSONs under `target/uiux-continuity-20260908/qa/` prove Desktop and previous staged QA executables
were unchanged. A clean-cache fallback remains `--target-dir target/uiux-continuity-20260908/qa/cargo`
with `stage-host` without the cache flag. The first native compile using shared cache took 34.43 seconds.

Preview-only `--frozen-preview` records live source drift against the captured immutable pre-build inventory.
It still checks snapshot, build-input, served asset/CSP and staged-host hashes. It cannot be combined with
`--final`; final checks require current source equality and the complete independent review.

## Preparation checks and evidence limits

Initial JS module syntax, Python ASTs, Shared fixture validation and the original 12-case runner list passed.
Offline locked Cargo metadata resolved the copied host configuration. The matrix subsequently expanded to 14.
`target/uiux-continuity-20260908/qa/preparation-self-check-1.json` records a passing hidden synthetic fixture
transport check: constructor/CSP restrictions, schema-validated A/B/C/Inspector data, C-before-B parameter
release, permission mutation and synthetic media cleanup. Temporary PID 39632 was stopped by its exact child
process handle. Port 8974 remained owned by PID 4660; 8975 was free after the check.

## Candidate-1 native evidence (diagnostic preview)

Root supplied 375 frozen inputs and 20 assets, with Home SHA-256
`911ca22237a5826cd5c2c3f0a8754b66ea11a6accc92dce354d853638e866017`. Review changed production source
after this freeze; every preview records that drift and does not certify those fixes. Evidence paths below
are relative to the harness directory.

| Evidence | Observed result |
| --- | --- |
| `candidate-1-results.json` | Original matrix: painted A/B/C continuity, retained Perception nodes/range/scroll and genuine empty, four exactly-once Toast lifetimes of 5998.7-6001.5ms, reading affordances and invalid-file handling. Its initial 1px geometry tolerance is superseded below. |
| `candidate-1-retry2-results-pending-title-slow-geometry.json` and matching screenshots | Header height 63.8333 -> 63.1667 -> 63.8333px; h1 and downstream card move 0.6667 CSS px (one physical pixel). Perception has the same shared-header shift while scrollTop=108 and original nodes/Range survive. Strict gate fails. |
| `candidate-1-retry2-results-chat-draft-retirement-chat-cleared-draft-late-picks.json` | Same-task file pick then Send: native PNG success leaves one thumbnail in the cleared draft; TIFF failure emits a late Toast. Both paths fail on the candidate. |
| `candidate-1-extended2-results-monitor-long-long-ledger-switch-and-history.json` | 237 actual frames pass painted continuity; A/B each load tail100 + older25, enable virtualization, and retain the original row-26 anchor at exactly 30px. |
| `candidate-1-extended2-results-inspector-inspector-live-mode-downgrade.json` | Same-client config.changed downgrade does not remove the old FULL_LOCAL Inspector; delayed old mode/detail replies remain unsafe in the candidate. |
| `candidate-1-extended2-results-inspector-inspector-hidden-downgrade-reveal.json` | Trace installed before reveal: old FULL_LOCAL marker is painted in 48/69 frames, from 105.5 through 431.9ms; physical sockets remain the same. |

Harness errors were resolved from evidence: the Inspector fixture used `结果`, which the production row projection
correctly overwrites; it now uses a distinct semantic field. Permission failure intentionally has a generic Toast
and detailed inline error; assertions now check both. CDP wait predicates now return Boolean rather than serialize
DOM graphs. Startup waits for the actual Home target, and private storage reset uses the advertised CDP API.

Candidate favicon errors are retained: the minimal snapshot omitted `index.html`, which installed Tauri 2.11.5
`src/manager/mod.rs:423` uses as its last asset fallback. The next snapshot includes the real production index;
no synthetic favicon or altered Home HTML masks this error. Every candidate artifact and screenshot is preserved.
All three candidate launch groups have successful exact-PID cleanup logs under `launches/`; 8974 remained owned
by Core PID 4660 and 8975 was verified free after cleanup.

## Strict final-1 result

`final-1-assets.json` and `final-1-results.json` both pass, with `completeMatrix:true`, all 14 cases passing,
zero page/runtime errors, zero fixture errors, and unchanged source before and after execution. The independent
95-file review and all 375 build inputs match; 21 frozen assets and the staged native executable are verified.
The complete evidence entry point is `target/uiux-continuity-20260908/qa/final-1-artifact-index.json`.

- Home SHA-256: `5f5647fb25119da8ee9dcabf3cb8195043d8410a6ced11f6820ff0d0a9acbcf1`.
- Native host SHA-256: `606e3a70778e74632338e424139a481d62a968e36ba9208c25cda9eae21ed24d`.
- Header height stays exactly 63.16666793823242px; h1 and downstream-card rectangles also stay equal.
  Perception keeps the original rows/Range, card y=250.2916717529297px and scrollTop=108 in every sampled phase.
- Small Run switches pass 212 painted frames; the 125-row virtualized switch/history variant passes 203.
  Inspector replacement passes 87 coherent frames, live downgrade 102 frames, and hidden downgrade/reveal
  has **zero leaked frames out of 61**. Trace collection starts before returning to Monitor.
- Both consumed-draft image paths leave zero thumbnails and zero late notices. Permission/config/MCP/media
  notices appear once and expire in 5998.3-6003.4ms when unheld, without changing body/card geometry.
  Pointer/focus pause/resume, deliberate click/keyboard hold, dismissal and reduced motion pass.
- The shared-cache native compile took 9.40s. Guarded Desktop and earlier staged QA executables are unchanged.
  `launches/final-1/cleanup.json` records all eight owned process IDs retired, with no remaining processes or
  listeners. The original Core on 8974 remains outside the fixture; its latest observed PID is 4660.

Root independently inspected the final screenshots and raw geometry/visibility evidence. No further native
rerun or source fix is pending. Owner inspection is still separate. OS file-picker, actual Core/Host producers,
security enforcement and real OS IME are outside this synthetic renderer proof.
