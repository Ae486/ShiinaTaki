# desktop/src-tauri/src/bin/
- taki-node.rs — debug-only headless node bin: env-configured build_node (optional device name/capability catalog) + retained ScriptedApprover injection + stdin pairing + process-local file-backed secrets (parallel nodes use distinct temp dirs); governed requests execute only from the Core projection
- taki-secret-key.rs — release-safe catalog master-key helper: framed get/create/credential commands; Windows create is cross-process serialized and never overwrites a winner
