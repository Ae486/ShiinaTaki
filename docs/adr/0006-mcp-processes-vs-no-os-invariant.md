# MCP servers are config-driven processes; the no-OS invariant governs agent-initiated actions

Architecture invariant 1 says the TS Agent Core never touches the OS — yet stdio MCP servers are child processes spawned by the Agent Core (that is how `@ai-sdk/mcp`'s stdio transport works, and routing it through the Rust Shell would break the transport for no security gain).

Resolution: the invariant is scoped to **agent-initiated** actions. MCP server processes are **operator-configured integrations**: the user adds them explicitly in the settings panel (an operator-role WS method — the LLM's tool surface has no path to MCP configuration), and spawning happens at connect time, not at the model's discretion. What the model CAN do — call MCP tools — goes through the same Approval model as local Capabilities (once / session / always / deny, remembered per server+tool). Secret-marked env vars and headers for MCP servers are stored in Windows Credential Manager, never in the config file.

Consequence: `packages/core` gets exactly one sanctioned `child_process` call site — the MCP stdio transport inside `mcp/` — and lint enforcement of invariant 1 carves out that single module. Agent-initiated execution (the `exec` Capability) still crosses the Rust Permission Gate without exception (ADR 0002).

---

**Amendment 2026-08-16 — second sanctioned spawn site (secret-catalog key helper):** `packages/core` now has
exactly two sanctioned `child_process` call sites: the MCP stdio transport inside `mcp/` (operator-configured,
connect-time) and the `taki-secret-key` helper launch in `secrets/master-key.ts` (boot-time master-key bootstrap,
operator-configured, never agent-initiated; frozen in `.trellis/spec/backend/secret-catalog.md`). Both are
operator-configured integrations under the same principle: no model-discretionary spawn path exists, and
agent-initiated execution still crosses the Rust Permission Gate without exception (ADR 0002).

---

**Amendment 2026-08-13 — standard MCP behind canonical governance:** the transport exception remains, but MCP tool
authorization is no longer a separate mutable server-name decision product. `@ai-sdk/mcp` still performs standard
discovery/conversion and calls the raw server tool name. A trusted sidecar maps that closure to a Host-qualified stable
subject and the shared `mcp.tool.call` descriptor; the model-facing sanitized key, descriptions, annotations, and trust
labels never grant authority. Legacy exact `never` entries may tighten; legacy `always` and session entries are inert.
Until Slice 4 installs canonical Approval, MCP `ask` fails closed and no temporary third decision writer exists.
Credential storage and desired-state CRUD/reload remain later Host-local lifecycle work, not evidence that the current
config file is an authorization source.
