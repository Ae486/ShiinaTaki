# desktop/src-tauri/src/capabilities_impl/
- screenshot.rs — the screenshot capability: xcap primary-monitor capture → PNG → base64 (blocking; run off-reactor)
- process_list.rs — the process-list capability: a stateless sysinfo snapshot (pid/name/parentPid/memoryBytes/startTime; no cmd; read-only)
- clipboard.rs — the clipboard-read + clipboard-write capabilities (arboard, text-only; empty read → "")
- shell_open.rs — the shell-open capability: opener free fns + Blocked refusal + dialog detail (url/path launch)
- shell_open/ — target.rs: the target classifier (url-safe/local-file/local-exec/blocked) feeding Gate::evaluate_shell_open (A1 fix)
- exec.rs — the exec capability handler: classify (gate Shape B) + spawn via sandbox; opaque `{command}` pass-through (ruling 16)
- exec/ — the exec governance pipeline: parser (structural sieve) + policy (mode/allow/blocklist) + sandbox (spawn/timeout/caps)
- foreground_window.rs — the foreground-window perception sampler (T3a): xcap focused window → app name + title (truncated 140) + GetLastInputInfo idle; no-focus → available:false (read-only; blocking)
