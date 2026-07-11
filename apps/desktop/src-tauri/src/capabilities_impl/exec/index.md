# desktop/src-tauri/src/capabilities_impl/exec/
- parser.rs — pure structural sieve: analyze(raw) → Complex | Simple{argv,program,extension}; hand-rolled tokenizer (ruling 1-5)
- policy.rs — ExecPolicy: mode (deny/allowlist/full) + allow/blocklist + sandbox knobs; classify → gate::ExecClass; load-or-degrade-safe (ruling 7/10/11)
- sandbox.rs — run(command, sandbox): explicit-argv spawn, NO shell, scrubbed env, hand-rolled timeout + capped dual-thread readers (ruling 12-15)
