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

## WebView2 quirks — failures with no error anywhere

- `window.alert` / `confirm` / `prompt` are silent NO-OPS (native JS dialogs unimplemented). A dialog-based error surface shows nothing — this masked a dead chat-window opener for a full test round. User-visible failures go through `components/toast` (`pushToast` works from non-React code) or rendered error chips, never native JS dialogs.
- Emoji/glyph-only button labels can render INVISIBLE (blank glyph) while the button stays clickable — the control "doesn't exist" to the user (two real instances: the attach button, the open-chat button). Icon buttons use inline SVG, never emoji/glyph text.

## Boot-critical paths: no silent catch, always a visible floor

A transparent overlay + a swallowed boot error = "nothing on screen" with zero leads; ONE silent catch on the initial-costume promotion cost a full diagnosis round. Invariants for the pet boot chain (`use-pet-scene.ts` / `use-initial-costume.ts` / `pet-scene.ts`):

- Every boot step is timeout-bounded (`withTimeout`) and falls back to a KNOWN-GOOD state (the default costume) — never a model-less stage.
- A hung boot still reveals the window (10s failsafe) so failure is visible instead of an invisible click-through overlay.
- Boot failures leave a `console.warn`/`error` breadcrumb (CDP-readable) AND a rendered error state. A bare `catch {}` on a boot path is a review-blocker.
- Async switches carry a ticket (`isStale`) so a wedged or superseded load can never clobber a newer model; keep the pattern when touching costume switching.

## Debugging the packaged app

- Release builds keep the tauri `devtools` cargo feature while pre-1.0 (`Cargo.toml` `features = ["protocol-asset", "devtools"]`); remove at release (docs/deferred-decisions.md D18).
- Live CDP without rebuilding: launch the exe with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`, GET `http://127.0.0.1:9223/json` for pages, open a WebSocket to a page's `webSocketDebuggerUrl` and drive `Runtime.evaluate` / `Network.enable` / `Page.reload`. This proved the boot race live (page healthy, stage model-less) after static analysis was exhausted.
