# cli/src/
- main.ts — REPL entry: parseArgs (--url, --character, --call/--params) + identity load + connect/pairing handshake, glued to repl or one-shot operator call
- repl.ts — readline loop; buffers lines from creation (no lost-EOF hang); drives authenticate then chat per line; bindAsk shares the reader; askOnce for non-REPL prompts
- chat-client.ts — @taki/shared-typed WS/JSON-RPC client; connect() handshake + chat() + history() + call(); the legacy Approval callback remains compatibility-only until Batch B installs canonical methods
- operator-call.ts — the generic operator method surface: parses `/call <method> [json-params]` (and --call argv) and runs it, printing JSON or a structured error
- approval-prompt.ts — legacy compatibility renderer/parser for the dormant MCP-shaped prompt; Batch A does not activate the canonical Approval lifecycle
- recent-history.ts — prints the last few timeline entries oldest-first after auth (AC-2 history-replay demo)
- device-identity.ts — sanctioned node:fs site; ~/.takiagent/cli-device.json {deviceId, token?}, create-on-first-run
