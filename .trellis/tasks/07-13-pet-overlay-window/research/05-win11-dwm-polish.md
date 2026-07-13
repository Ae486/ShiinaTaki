# Research: Win11 DWM polish (rounded-corner + border suppression) from Rust

- **Query**: `DwmSetWindowAttribute` to disable rounded corners (`DWMWA_WINDOW_CORNER_PREFERENCE=DWMWCP_DONOTROUND`) and border color (`DWMWA_BORDER_COLOR=DWMWA_COLOR_NONE`) via the `windows` crate; is the crate already a dep; exact API path; HWND from a Tauri 2 `WebviewWindow`; OS gating; is it load-bearing vs belt-and-suspenders?
- **Scope**: mixed (installed Cargo.lock/tauri source + windows-docs-rs + Win32 docs)
- **Date**: 2026-07-13

## Findings

### Is `decorations:false` + `transparent:true` enough? (load-bearing vs belt-and-suspenders)

**Partly load-bearing on Windows 11.** Per the installed config schema (`01-transparent-overlay-window.md`), `shadow:true` on an undecorated window "will make undecorated window have a 1px white border, and on Windows 11 ... rounded corners." So:

- Setting **`shadow:false`** in the window config is the first-line fix and removes the plugin-added shadow/border/rounded-corner in the common case. **Try this alone first.**
- The DWM calls (`DWMWCP_DONOTROUND` + `DWMWA_BORDER_COLOR=COLOR_NONE`) are **belt-and-suspenders** for cases where Win11 still applies a corner round or a thin DWM frame to a borderless top-level window regardless of the `shadow` flag (observed in the wild for custom-decorated Tauri windows). Treat DWM as a hardening step gated behind a smoke-test observation: if `shadow:false` alone yields a clean per-pixel cut-out in `pnpm tauri dev`, DWM is not needed; if a corner round / thin border remains, DWM is the fix. Recommend implementing it behind an OS-version check and only if the smoke shows residue.

### Is the `windows` crate already a dependency?

**Transitively yes, directly no.** `Cargo.lock` contains `windows` v0.61.3 and v0.62.2 (pulled in via tauri). `apps/desktop/src-tauri/Cargo.toml` does **NOT** list `windows` as a direct dependency. To call DWM you must add it directly.

**Critical version-match gotcha (verified):** Tauri 2.11.5 depends on `windows = "0.61"` with features `["Win32_Foundation","Win32_UI","Win32_UI_WindowsAndMessaging"]` (from `tauri-2.11.5/Cargo.toml`). `WebviewWindow::hwnd()` returns `windows::Win32::Foundation::HWND` from **that** crate version. If you add a *different* major (e.g. `windows = "0.62"`), the `HWND` you get from Tauri and the `HWND`/functions from your dep are **different types** and won't interoperate. So pin the direct dep to the same line Tauri uses:

```toml
# apps/desktop/src-tauri/Cargo.toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.61", features = ["Win32_Foundation", "Win32_Graphics_Dwm"] }
```
`Win32_Foundation` gives `HWND`; `Win32_Graphics_Dwm` gives the DWM functions/constants (tauri does NOT enable the Dwm feature, so you must). Keep it `cfg(windows)`-gated — invariant 8 (core/shared stay OS-neutral; Windows code only in `apps/desktop`).

### Exact API path (verified against windows-docs-rs)

From `windows::Win32::Graphics::Dwm`:
- `DwmSetWindowAttribute(hwnd, dwAttribute, pvAttribute, cbAttribute) -> windows::core::Result<()>`
- `DWMWA_WINDOW_CORNER_PREFERENCE: DWMWINDOWATTRIBUTE` (value 33)
- `DWM_WINDOW_CORNER_PREFERENCE(pub i32)` newtype; `DWMWCP_DONOTROUND` (= 1), `DWMWCP_DEFAULT`(0), `DWMWCP_ROUND`(2), `DWMWCP_ROUNDSMALL`(3)
- `DWMWA_BORDER_COLOR: DWMWINDOWATTRIBUTE` (value 34); border-none color sentinel is `0xFFFFFFFE` (`DWMWA_COLOR_NONE`). Pass it as a `COLORREF`/`u32`.

### HWND from a Tauri 2 WebviewWindow (verified in installed source)

`tauri-2.11.5/src/webview/webview_window.rs` L1847:
```rust
#[cfg(windows)]
pub fn hwnd(&self) -> crate::Result<HWND> { self.window.hwnd() }   // HWND = windows::Win32::Foundation::HWND
```
So from Rust: `let hwnd = pet_window.hwnd()?;` gives you the exact `windows` 0.61 `HWND` to pass straight into `DwmSetWindowAttribute`.

### Minimal Rust snippet (to run in setup, after the pet window exists)

```rust
#[cfg(windows)]
fn harden_overlay_frame(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWA_BORDER_COLOR,
        DWM_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    };
    let hwnd = window.hwnd()?;
    let corner = DWMWCP_DONOTROUND;                       // DWM_WINDOW_CORNER_PREFERENCE
    let none_color: u32 = 0xFFFF_FFFE;                    // DWMWA_COLOR_NONE
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd, DWMWA_WINDOW_CORNER_PREFERENCE,
            &corner as *const _ as *const core::ffi::c_void,
            core::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd, DWMWA_BORDER_COLOR,
            &none_color as *const _ as *const core::ffi::c_void,
            core::mem::size_of::<u32>() as u32,
        );
    }
    Ok(())
}
```
(The `windows` 0.61 `DwmSetWindowAttribute` returns `Result<()>`; ignore-with-`let _` since a DWM failure on older OS must degrade, not crash — per CLAUDE.md error-handling rule.)

### OS-version gating

- Corner preference (`DWMWA_WINDOW_CORNER_PREFERENCE`) works on **Windows 11 build 22000+**; on Windows 10 it's a no-op (corners are square anyway) — calling it is harmless but pointless.
- `DWMWA_BORDER_COLOR` requires **Windows 11 22H2 (build 22621)+**.
- The calls fail gracefully (return an error `HRESULT`) on older OS, so hard gating isn't strictly required, but gate with a build-number check (via `sysinfo`/`GetVersion` or just cfg + runtime check) to avoid noise. Recommendation: attempt unconditionally on `cfg(windows)`, swallow the `Result` — the failure is a no-op on Win10.

## Caveats / Not Found

- Whether `shadow:false` alone fully removes the Win11 corner round on this repo's setup is UNVERIFIED (needs `pnpm tauri dev` smoke). That observation decides whether the DWM code is needed at all — keep it behind that gate.
- `window-vibrancy` crate (0.6) is already a transitive tauri dep and offers acrylic/blur, but it does NOT expose corner/border control — DWM direct is still required for that; not needed for #14's opaque-pixel cut-out.
- The exact `windows` 0.61 return type of `DwmSetWindowAttribute` (`windows::core::Result<()>` vs `HRESULT`) should be reconfirmed against the pinned version's docs when wiring; snippet assumes `Result<()>`.

## Sources

- windows-docs-rs: `windows::Win32::Graphics::Dwm::DWMWA_WINDOW_CORNER_PREFERENCE`, `DWM_WINDOW_CORNER_PREFERENCE` — https://microsoft.github.io/windows-docs-rs/doc/windows/Win32/Graphics/Dwm/
- Microsoft Learn "Apply rounded corners in desktop apps" (enum values) — https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/apply-rounded-corners
- Tauri 2 example (hwnd + DwmSetWindowAttribute + DWMWA_BORDER_COLOR=COLOR_NONE 0xFFFFFFFE, "Windows 11 22H2+ only") — TabNews Bely Launcher writeup
- Installed sources: `Cargo.lock` (windows 0.61.3/0.62.2), `tauri-2.11.5/Cargo.toml` (windows 0.61 dep + features), `tauri-2.11.5/src/webview/webview_window.rs` L1847 (`hwnd()`), `apps/desktop/src-tauri/Cargo.toml` (no direct windows dep)
