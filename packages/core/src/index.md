# core/src/
- index.ts — package public entry; empty until an external consumer exists (core runs as a process)
- main.ts — process entry: wires config → logger → model → device/connection registries → ws-server; SIGINT/SIGTERM shutdown
- config/ — env → validated boot config
- logging/ — pino root logger factory
- server/ — WS JSON-RPC server + method table + connection auth state
- devices/ — paired-device store + pairing/token registry (device identity security state)
- agents/ — streaming chat agent + in-memory history
- testing/ — test-only mock-model factories
