# Native acceptance examples

- c2-presence-fixture.rs — debug-only real WebView2 self-window lifecycle over isolated fixture assets; no Node/Core, model, keyring or user-profile boot. Its remote test origin receives only explicit fixture window/event permissions.

- qqmm-home-fixture.rs — debug-only real Home and production QQMM adapter; requires a temporary fixture installation, isolates the WebView profile, omits Node/Core boot, and blocks Core networking in fixture-only CSP.

Build Home assets first, then `cargo build --example qqmm-home-fixture --features tauri/custom-protocol`.
Drive it with `../test/qqmm-home-native-smoke.mjs`; the script owns all Host/helper fixture data and processes.

Windows examples link Tauri's generated `resource.lib` as well as ordinary bins.
This includes the Common Controls v6 manifest: without it, the example exits
before Rust with `0xC0000139` because `TaskDialogIndirect` cannot be resolved.
The production entry already receives this resource from `tauri-build`.
