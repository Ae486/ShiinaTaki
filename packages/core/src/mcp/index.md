# core/mcp/
- mcp-config.ts — load/validate mcp-servers.json (operator-owned; NEVER agent-reachable); missing/malformed -> []
- mcp-connect.ts — sanctioned MCP transport-construction boundary (ADR 0006); builds a stdio/http transport + connects
- mcp-schema-compat.ts — deep-clone definitions; narrow verified optional-nullable properties; isolate unsafe tools
- mcp-manager.ts — connect-at-boot; list/prepare/convert definitions; namespace + error-wrap tools; describe(); closeAll

Invariant (grep-verifiable): only files in this directory may import `@ai-sdk/mcp` / `@ai-sdk/mcp/mcp-stdio`.
The child-process spawn lives inside @ai-sdk/mcp (shell:false) — our code never imports node:child_process (invariant 1).
