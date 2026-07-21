# desktop/src-tauri/src/capabilities_impl/exec/
- parser.rs — pure structural sieve: analyze(raw) → Complex | Simple{argv,program,extension}; hand-rolled tokenizer (ruling 1-5)
- policy.rs — ExecPolicy: mode (deny/allowlist/full) + allow/blocklist + sandbox knobs; classify → gate::ExecClass argClass keys; load-or-degrade-safe (ruling 7/10/11)
- resolve.rs — D3 argv[0] resolver: resolve_program(program, cwd, SearchConfig) cwd-excluded + PATHEXT; env wrapper + is_path_qualified (research §4)
- sandbox.rs — run(command, sandbox): resolved-absolute-path spawn (D3), NO shell, scrubbed env, hand-rolled timeout + capped dual-thread readers (ruling 12-15)
