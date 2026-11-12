# Packaged-Build Defect Classes (WebView2 / CSP / boot silence)

> Four rounds of packaged B-testing (#18) each surfaced a defect class INVISIBLE under `pnpm tauri dev`. "Works in dev" is zero evidence for the packaged app — smoke the packaged build for every UI-facing change, and check these classes first when "packaged-only" breakage appears.

## CSP is enforced ONLY packaged

Dev serves without enforcing the `tauri.conf.json` CSP; packaged WebView2 enforces it strictly. Eval-dependent code breaks only after packaging (pixi.js did: stage init died with "does not allow unsafe-eval").

- Fix pattern: `import "pixi.js/unsafe-eval";` as the first pixi-touching import in the renderer entry (self-installing polyfill).
- NEVER weaken the CSP to unblock a library; `wasm-unsafe-eval` (Cubism core) is the only sanctioned eval-adjacent grant in `script-src`.
- Model provider icons use the explicitly approved `https://models.dev` entry in `img-src` only. Preserve local fallback
  when an image cannot load; do not broaden `connect-src` or script policy for metadata. The installed Zod parser may
  emit a caught `script-src`/`eval` capability probe before using its non-JIT path; this is distinct from blocked images
  or a failed UI. Verify actual rendering and the image directive without granting `unsafe-eval` to suppress that probe.

## Selected-profile Character assets

- Native `CharacterAssets` captures `local_auth::selected_profile()/workspace/characters` as an absolute path once per
  Desktop process. `local_characters_root` accepts no renderer path and returns that same root only to the actual
  Home/Pet app-origin windows. It lazily grants only that subtree through Tauri's asset protocol scope.
- The static asset scope is empty. A custom profile must not retain access to the default profile's Character files;
  neighboring Workspace data and credentials remain outside the grant. Do not widen CSP or accept a Core-supplied
  absolute path as a local asset grant. Remote resource synchronization is not implied by this local bridge.
- Root selection and scope registration require no running Core, credential access or directory creation. An absent
  first-import directory must work after Core creates it; failure stays feature-scoped and never prevents Home boot.
- Packaged test overrides should override only the required build paths. Copying the complete old Tauri config into
  an override can silently restore an obsolete asset scope or CSP after production configuration changes.

## WebView2 quirks — failures with no error anywhere

- `window.alert` / `confirm` / `prompt` are silent NO-OPS (native JS dialogs unimplemented). A dialog-based error surface shows nothing — this masked a dead chat-window opener for a full test round. User-visible failures go through `components/toast` (`pushToast` works from non-React code) or rendered error chips, never native JS dialogs.
- Emoji/glyph-only button labels can render INVISIBLE (blank glyph) while the button stays clickable — the control "doesn't exist" to the user (two real instances: the attach button, the open-chat button). Icon buttons use inline SVG, never emoji/glyph text.

## Boot-critical paths: no silent catch, always a visible floor

A transparent overlay + a swallowed boot error = "nothing on screen" with zero leads; ONE silent catch on the initial-costume promotion cost a full diagnosis round. Invariants for the pet boot chain (`use-pet-scene.ts` / `use-initial-costume.ts` / `pet-scene.ts`):

- Stage initialization and costume attempts are timeout-bounded. A profile without imported avatar resources may
  have a transparent, model-less Pet with its ticker stopped; Home and resource management remain usable. A later
  successful import/selection must attach without restarting the application. The `/spike-assets/` fallback is
  development-only and must never be copied into a packaged build to conceal missing profile resources.
- A hung boot still reveals the window (10s failsafe) so failure is visible instead of an invisible click-through overlay.
- Unexpected stage boot failures leave a `console.warn`/`error` breadcrumb (CDP-readable) and a rendered error state.
  An unavailable development fallback is an expected model-less state in packaged builds, not a stage failure.
  A bare `catch {}` on an actual boot failure remains a review-blocker.
- Async switches carry a ticket (`isStale`) so a wedged or superseded load can never clobber a newer model; keep the pattern when touching costume switching.

## Debugging the packaged app

- Release builds keep the tauri `devtools` cargo feature while pre-1.0 (`Cargo.toml` `features = ["protocol-asset", "devtools"]`); remove at release (docs/deferred-decisions.md D18).
- Live CDP without rebuilding: launch the exe with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`, GET `http://127.0.0.1:9223/json` for pages, open a WebSocket to a page's `webSocketDebuggerUrl` and drive `Runtime.evaluate` / `Network.enable` / `Page.reload`. This proved the boot race live (page healthy, stage model-less) after static analysis was exhausted.
- Windows native fixtures that instantiate a Tauri manager can pull `TaskDialogIndirect` into the executable, unlike
  the pure library tests. The generated `resource.lib` supplies the Common Controls v6 manifest; `build.rs` links it
  to examples only because Tauri already links it to binaries. A global duplicate link produces CVT1100/LNK1123.
  Keep pure path/authorization tests in the library harness and verify actual resource-scope behavior in the packaged
  fixture. A loader exit `0xc0000139` before tests start requires import/manifest diagnosis, never copying DLLs.
