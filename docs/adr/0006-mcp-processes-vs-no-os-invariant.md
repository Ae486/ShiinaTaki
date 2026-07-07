# MCP servers are config-driven processes; the no-OS invariant governs agent-initiated actions

Architecture invariant 1 says the TS Agent Core never touches the OS — yet stdio MCP servers are child processes spawned by the Agent Core (that is how `@ai-sdk/mcp`'s stdio transport works, and routing it through the Rust Shell would break the transport for no security gain).

Resolution: the invariant is scoped to **agent-initiated** actions. MCP server processes are **operator-configured integrations**: the user adds them explicitly in the settings panel (an operator-role WS method — the LLM's tool surface has no path to MCP configuration), and spawning happens at connect time, not at the model's discretion. What the model CAN do — call MCP tools — goes through the same Approval model as local Capabilities (once / session / always / deny, remembered per server+tool). Secret-marked env vars and headers for MCP servers are stored in Windows Credential Manager, never in the config file.

Consequence: `packages/core` gets exactly one sanctioned `child_process` call site — the MCP stdio transport inside `mcp/` — and lint enforcement of invariant 1 carves out that single module. Agent-initiated execution (the `exec` Capability) still crosses the Rust Permission Gate without exception (ADR 0002).
