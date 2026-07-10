# cli/src/
- main.ts — REPL entry: parseArgs (--url, --character) + identity load + connect/pairing handshake, glued to repl
- repl.ts — readline loop; buffers lines from creation (no lost-EOF hang); drives authenticate then chat per line; bindAsk shares the reader
- chat-client.ts — @taki/shared-typed WS/JSON-RPC client; connect() handshake + chat() + history() + onApprovalRequest (MCP gate)
- approval-prompt.ts — pure render/parse for the MCP tool-approval prompt (y/s/a/d/n -> approved+scope)
- recent-history.ts — prints the last few timeline entries oldest-first after auth (AC-2 history-replay demo)
- device-identity.ts — sanctioned node:fs site; ~/.takiagent/cli-device.json {deviceId, token?}, create-on-first-run
