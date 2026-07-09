# cli/src/
- main.ts — REPL entry: parseArgs (--url, --character) + identity load + connect/pairing handshake, glued to repl
- repl.ts — readline loop; buffers lines from creation (no lost-EOF hang); drives authenticate then chat per line
- chat-client.ts — @taki/shared-typed WS/JSON-RPC client; connect() handshake + chat() resolves on complete/error + history()
- recent-history.ts — prints the last few timeline entries oldest-first after auth (AC-2 history-replay demo)
- device-identity.ts — sanctioned node:fs site; ~/.takiagent/cli-device.json {deviceId, token?}, create-on-first-run
