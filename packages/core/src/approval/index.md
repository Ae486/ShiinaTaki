# core/approval/
- approval-broker.ts — MCP-agnostic ask/await broker: notify + pending map + 60s deny-timeout + denyAll (M3 gate reuse)
- decision-store.ts — mcp-approvals.json persisted always/never + in-memory session; deny+always == never
- approval-gate.ts — the v7 toolApproval decision fn: non-MCP -> not-applicable, else remembered/asked; no notify -> deny (fail-closed)
