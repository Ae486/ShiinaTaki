# windows/home/pages/mcp/

The operator-only Secure MCP Lifecycle page. Core remains authoritative for desired rows and process-local runtime
status; this disposable Home view stores neither config snapshots nor secret values.

- mcp-page.tsx — page composition, extension convergence status, and editor lifecycle with partial-failure draft preservation
- mcp-server-card.tsx — desired/runtime owner-generation status plus enable, disable, reconnect, test, edit, and two-step remove actions
- mcp-server-editor.tsx — stdio/http desired-config form with write-only env/header values and opaque-ref retention rules
- use-mcp.ts — one authenticated-client-generation hook; late results are ignored and writes are never replayed
- mcp-controller.ts — serialized Core mutations, conflict refetch, test-result feedback, add/edit secret ordering, and partial-commit revision reporting
- mcp-state.ts — pure view transitions, draft validation, marker-only desired config, and deterministic secret-ref derivation

Tests cover controller races and partial commits, state validation, component states/actions, and the no-cache invariant.
