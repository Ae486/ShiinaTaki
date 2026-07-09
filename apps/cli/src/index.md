# cli/src/
- main.ts — REPL entry: parseArgs (--url, --character) + readline loop; streams tokens to stdout
- chat-client.ts — @taki/shared-typed WS/JSON-RPC client; chat() resolves on complete/error
