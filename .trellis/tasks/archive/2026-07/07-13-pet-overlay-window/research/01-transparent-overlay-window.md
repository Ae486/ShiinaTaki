# Research: Transparent + borderless + always-on-top overlay window (Tauri 2)

- **Query**: exact `tauri.conf.json` window fields + programmatic `WebviewWindowBuilder` equivalents for a transparent, borderless, always-on-top overlay; Windows/WebView2 gotchas
- **Scope**: mixed (installed config schema + Tauri 2 docs)
- **Date**: 2026-07-13

## Findings

### Verified config fields (source: installed CLI config schema)

Source of truth checked directly: `node_modules/.pnpm/@tauri-apps+cli@2.11.4/node_modules/@tauri-apps/cli/config.schema.json`, `definitions.WindowConfig.properties`. These are the fields (with schema defaults) relevant to an overlay:

| Field | Default | Meaning / Windows note (verbatim from schema where quoted) |
| --- | --- | --- |
| `transparent` | `false` | "Whether the window is transparent or not." (macOS needs `macos-private-api`; Windows/WebView2 works out of the box) |
| `decorations` | `true` | "Whether the window should have borders and bars." Set `false` for borderless. |
| `alwaysOnTop` | `false` | "Whether the window should always be on top of other windows." |
| `alwaysOnBottom` | `false` | inverse; not used here |
| `skipTaskbar` | `false` | "If `true`, hides the window icon from the taskbar on Windows and Linux." |
| `shadow` | `true` | **Windows-critical (verbatim)**: "`false` has no effect on decorated window, shadow are always ON. `true` will make undecorated window have a 1px white border, and on Windows 11, it will have a rounded corners. Linux: Unsupported." |
| `visible` | `true` | can start hidden and show after first paint to avoid a flash |
| `focus` | `true` | "Whether the window will be initially focused or not." An overlay pet usually wants `false` so it doesn't steal focus on launch |
| `focusable` | `true` | if `false`, window can't take keyboard focus at all |
| `resizable` | `true` | overlay wants `false` |
| `windowEffects` | null | acrylic/blur/mica; "Requires the window to be transparent." Not needed for a Live2D cut-out |
| `contentProtected` | `false` | blocks screen capture of the window; leave `false` |

### The load-bearing Windows gotcha: `shadow` vs `decorations`

Per the schema text above, on Windows an **undecorated (`decorations:false`) window with `shadow:true` gets a 1px white border AND rounded corners on Win11.** For a clean per-pixel Live2D cut-out you want `shadow:false`. So the borderless overlay baseline is:

```jsonc
{
  "label": "pet",
  "url": "pet.html",          // its own HTML entry — see 02-multi-window-capabilities.md
  "width": 480, "height": 640,
  "transparent": true,
  "decorations": false,
  "shadow": false,            // else Win11 adds a 1px white border + rounded corners
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "resizable": false,
  "focus": false,             // don't steal focus on launch (overlay, not a dialog)
  "visible": true             // consider false + show-after-first-paint to avoid a white flash
}
```

- Transparency also requires the **web side** to be transparent: no opaque `<body>`/root background. The document background must be `transparent` (or `rgba(...,0)`); any opaque CSS on `html`/`body`/`#root` defeats `transparent:true`. WebView2 composites the transparent regions through.
- `decorations:false` removes the OS title bar AND the native resize border — so a borderless window is not natively resizable by edge-drag (fine for a fixed-size pet; dragging handled in `03-window-dragging.md`).
- Whether `shadow:false` alone fully removes the Win11 rounded corner + thin border in all cases is the open question that `05-win11-dwm-polish.md` covers (DWM belt-and-suspenders).

### Programmatic equivalent — `WebviewWindowBuilder` (Rust) / `WebviewWindow` (JS)

Config is the recommended path for a window that exists at launch. Runtime creation is available if the overlay is spawned later. Verified JS setters exist on the `Window` class (`node_modules/.pnpm/@tauri-apps+api@2.11.1/.../window.d.ts`): `setDecorations(boolean)` (L777), `setShadow(boolean)` (L797), `setAlwaysOnTop(boolean)` (L817), `setSkipTaskbar(boolean)` (L986), `setPosition(...)` (L900), `setIgnoreCursorEvents(boolean)` (L1074 — that last one is for click-through, issue #15, noted not designed here).

JS `WebviewWindow` constructor (verified `webviewWindow.d.ts` L43):
```ts
constructor(label: WebviewLabel, options?: Omit<WebviewOptions,'x'|'y'|'width'|'height'> & WindowOptions)
```
Options carry the same names (`transparent`, `decorations`, `alwaysOnTop`, `skipTaskbar`, `shadow`, `focus`, `visible`, `url`, `width`, `height`).

Rust equivalent is `tauri::webview::WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("pet.html".into())).transparent(true).decorations(false).shadow(false).always_on_top(true).skip_taskbar(true).resizable(false).build()?` (builder method names mirror the config keys; verify each against `tauri-2.11.5/src/webview/webview_window.rs` when implementing).

## Caveats / Not Found

- Did not empirically test whether `transparent:true` + WebView2 leaves any residual compositing artifact on this exact GPU/driver — needs a `pnpm tauri dev` smoke (an AC-level check).
- `focus:false` at config level is documented; confirm it actually prevents launch focus-steal on Windows during the smoke (some window managers focus on show regardless).

## Sources

- Installed schema: `node_modules/.pnpm/@tauri-apps+cli@2.11.4/node_modules/@tauri-apps/cli/config.schema.json` (WindowConfig) — the authoritative, version-matched field list
- Tauri 2 window config docs: https://v2.tauri.app/reference/config/#windowconfig
- Installed JS types: `@tauri-apps/api@2.11.1` `window.d.ts`, `webviewWindow.d.ts`
