# core/mcp/
- mcp-config.ts — load/validate mcp-servers.json (operator-owned; NEVER agent-reachable); missing/malformed -> []
- mcp-connect.ts — sanctioned MCP transport-construction boundary (ADR 0006); builds a stdio/http transport + connects
- mcp-schema-compat.ts — deep-clone definitions; narrow verified optional-nullable properties; isolate unsafe tools
- legacy-mcp-deny.ts — read-only mcp-approvals.json deny adapter; missing is empty, allows inert, corrupt/ambiguous state fail-closed
- mcp-manager.ts — connect-at-boot; list/prepare/convert definitions; stable raw server/tool identity sidecars; build per-turn exact-Connection Approval wrappers around raw SDK closures; describe(); closeAll

Invariant (grep-verifiable): only files in this directory may import `@ai-sdk/mcp` / `@ai-sdk/mcp/mcp-stdio`.
The child-process spawn lives inside @ai-sdk/mcp (shell:false) — our code never imports node:child_process (invariant 1).
