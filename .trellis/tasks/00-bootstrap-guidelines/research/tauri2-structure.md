# Research: Tauri 2 Project Structure Conventions

- **Query**: Official/production Tauri 2 layout, command organization into modules, plugin-style splitting
- **Scope**: external
- **Date**: 2026-07-07

## Findings

### 1. Canonical layout (official)

Source: https://v2.tauri.app/start/project-structure/

```
app/
├── package.json / index.html / vite.config.ts   # frontend (normal Vite project)
├── src/                                         # frontend source
└── src-tauri/                                   # Rust backend (normal Cargo project)
    ├── Cargo.toml
    ├── build.rs                # calls tauri_build::build()
    ├── tauri.conf.json         # app identifier, windows, bundle, dev server URL
    ├── icons/                  # output of `tauri icon`
    ├── capabilities/           # Tauri 2 ACL permission files (JSON, per window)
    └── src/
        ├── main.rs             # thin shim: fn main() { app_lib::run() }
        └── lib.rs              # real entry: run() with Builder, plugins, invoke_handler
```

Official rules:
- **Don't modify `main.rs`; modify `lib.rs`.** The lib/main split exists so mobile builds (which load the app as a library via `#[cfg_attr(mobile, tauri::mobile_entry_point)]`) share one entry point. `app_lib` corresponds to `[lib].name` in Cargo.toml.
- `capabilities/` is where commands/plugin permissions must be allow-listed per window; a missing permission is a build/runtime error, and capability JSON is lint-able/greppable in CI.
- Rust-only projects can use `src-tauri/` as a workspace member.

### 2. Command organization (official)

Source: https://v2.tauri.app/develop/calling-rust/ ("Defining Commands in a Separate Module")

- Official recommendation for many commands: define them in a separate module "instead of bloating the `lib.rs` file" — e.g. `src-tauri/src/commands.rs`, then in `lib.rs`:

```rust
mod commands;
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![commands::my_custom_command])
```

- **`generate_handler!` must be called exactly once** with ALL commands; multiple `invoke_handler` calls — only the last wins.
- Command name = bare function name regardless of module path (`commands::` prefix ignored on the JS side).
- Pitfall (official + https://tauritutorials.com/blog/tauri-command-fundamentals): a `pub` command defined directly in `lib.rs` produces a confusing `__cmd__foo is defined multiple times` macro error — commands in `lib.rs` must not be `pub`; commands in submodules must be `pub`.
- Async commands recommended for anything slow (prevents UI freeze); state via `Builder.manage()` + `tauri::State` parameters.

### 3. Production-scale layout (community consensus)

Sources: https://www.codegiz.com/blog/tauri-patterns-episode-1-tauri-2-0-project-setup-for-production-capabilities-plugins-the-real-structure/ , https://users.rust-lang.org/t/putting-functions-in-a-separate-mod-project-structure-best-practice/115300 , https://github.com/bobmatnyc/claude-mpm-skills/blob/HEAD/toolchains/rust/desktop-applications/references/tauri-framework.md , https://www.projectrules.ai/rules/tauri

Common expanded structure once `commands.rs` outgrows one file:

```
src-tauri/src/
├── main.rs            # thin shim only
├── lib.rs             # run(): Builder, plugin registration, generate_handler list, setup()
├── commands/          # one module per domain: commands/screenshot.rs, commands/clipboard.rs
│   └── mod.rs (or commands.rs + commands/ dir, new style)
├── services/          # business logic (project_service.rs, task_service.rs)
├── state.rs           # managed app state structs
├── models.rs          # serde structs crossing the IPC boundary
└── utils.rs
```

Conventions repeated across sources:
- **Commands are thin controllers**: `#[tauri::command]` fns only validate/deserialize and delegate to service modules; business logic lives in services with private internals (module privacy is the encapsulation boundary — endorsed on the rust-lang forum thread).
- **Keep `main.rs` empty of logic** ("Putting business logic in main.rs" is listed as a top mistake — codegiz deep dive https://www.codegiz.com/blog/hzt754lj/).
- **Plugins are first-class in Tauri 2**: core is intentionally minimal; fs/http/dialog/notification/updater/sql are opt-in plugin crates. Adding one = 3 steps: Cargo.toml dep, `.plugin(...)` in `lib.rs`, permission identifier in a capability JSON — forgetting step 3 compiles but throws at runtime.
- **Two halves never mix**: `src/` (TS) and `src-tauri/` (Rust) communicate only via `invoke()` / `#[tauri::command]` / events. IPC types are duplicated (Rust struct ↔ TS interface) unless generated — teams use type-binding generators (e.g. specta/tauri-specta, ts-rs) to keep them in sync.
- Per-window capabilities: separate capability files for separate windows (e.g. pet window vs settings window) is the intended security pattern.

### 4. Splitting into a plugin (when a feature is truly standalone)

- Tauri's own guidance and the plugin ecosystem model: a self-contained native feature (own commands + own permissions + own JS API) can become a local plugin crate (`tauri-plugin-xxx`), registered with `.plugin(init())`. Useful heuristic: if a module needs its own capability permission set, it is plugin-shaped. (https://v2.tauri.app/develop/plugins/ — plugin development docs; structure follows the same commands-module pattern.)

## Caveats / Not Found

- Tauri's official docs only demonstrate a single `commands.rs` module; the `commands/` directory-with-submodules layout is community convention, not official doctrine (but is the natural Rust module-system extension and appears in every production writeup found).
- No official Tauri max-file-size guidance exists; apply clippy `too_many_lines` (100/function) and a project file cap instead.
