# desktop/src-tauri/src/capabilities_impl/
- screenshot.rs — the screenshot capability: xcap primary-monitor capture → PNG → base64 (blocking; run off-reactor)
- process_list.rs — the process-list capability: a stateless sysinfo snapshot (pid/name/parentPid/memoryBytes/startTime; no cmd; read-only)
- clipboard.rs — the clipboard-read + clipboard-write capabilities (arboard, text-only; empty read → "")
- shell_open.rs — the shell-open capability: opener free fns + URL scheme allowlist + dialog detail (url/path launch)
- exec.rs — the exec capability handler: classify (gate Shape B) + spawn via sandbox; opaque `{command}` pass-through (ruling 16)
- exec/ — the exec governance pipeline: parser (structural sieve) + policy (mode/allow/blocklist) + sandbox (spawn/timeout/caps)
