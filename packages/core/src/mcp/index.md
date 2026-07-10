# core/mcp/
- mcp-config.ts — load/validate mcp-servers.json (operator-owned; NEVER agent-reachable); missing/malformed -> []
- mcp-connect.ts — THE sanctioned @ai-sdk/mcp import site (ADR 0006 carve-out); builds a stdio/http transport + connects
- mcp-manager.ts — connect-at-boot (allSettled), namespace + error-wrap tools into one ToolSet, describe(), closeAll

Invariant (grep-verifiable): only files in this directory may import `@ai-sdk/mcp` / `@ai-sdk/mcp/mcp-stdio`.
The child-process spawn lives inside @ai-sdk/mcp (shell:false) — our code never imports node:child_process (invariant 1).
