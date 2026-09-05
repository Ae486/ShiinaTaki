# core/mcp/
- mcp-config.ts — strict zod schemas + parseMcpServers body parse for mcp-servers.json (operator-owned; NEVER agent-reachable; env/header values may be `secret-ref:` markers post-migration) — the file is a SEED-ONLY legacy input consumed once by mcp-desired-repo
- mcp-connect.ts — sanctioned MCP transport-construction boundary (ADR 0006); builds a stdio/http transport + connects
- mcp-stdio-launch.ts / mcp-stdio-relay.mjs — portable command/args launch tuple plus Windows cross-spawn relay; no platform adapter leaks into desired config
- mcp-schema-compat.ts — deep-clone definitions; narrow verified optional-nullable properties; isolate unsafe tools
- legacy-mcp-deny.ts — read-only mcp-approvals.json deny adapter; missing is empty, allows inert, corrupt/ambiguous state fail-closed
- mcp-tool-identity.ts — shared namespacing/identity helpers: sanitizeKey, stableSubjectId (governance subject), publicConfigFingerprint (secret-free revision), wrapExecute ({ok:false} error envelope)
- mcp-approval-labels.ts — one lazy current snapshot index per approval-list projection; exact owner/subject/revision matching and liveness evidence yield names without guessing historical targets
- mcp-client-close.ts — shared per-client close promise; candidate, generation, and shutdown races start transport close at most once and contain close failures
- mcp-candidate.ts — the frozen candidate body: JIT `secret-ref:` resolution -> connect -> LOCALLY paginated tools/list under one bounded deadline (the SDK does not paginate) -> schema-compat preparation -> selected-tool existence check -> collision-safe namespaced closures; repeated cursors and the 1,024-tool/page bound fail closed; close-on-failure guaranteed; a candidate NEVER publishes by itself
- mcp-generations.ts — plane-3 generation records + acquireLease/releaseLease/retireGeneration/closeGeneration: captures ownerHostId/configRevision/secret refs, rejects new leases while draining, marks leased calls outcome-unknown on forced close, and closes exactly once; never persisted or restored
- mcp-manager-state.ts — process-local desired/candidate ownership tokens, cancellation, serialization lock, active/draining sets, and revision/secret-ref tracking; no state here survives restart
- mcp-publication.ts — candidate-to-generation publication transaction: accepts only the still-current desired token, rejects cross-server key collisions, atomically swaps active truth, and drains the previous generation
- mcp-turn-tools.ts — per-turn MCP ToolSet assembly carrying late-bound Approval/Effect/tool-observer context inside the outer generation lease; Chinese approvals retain full server/tool names in bounded fields
- mcp-boot.ts — the lifecycle's composition seam (repo + legacy seed + manager + secret-update/clear-aware catalog view) so main.ts stays a thin wiring root; boot order pinned: seed only while the table is empty and only after the secret migration
- mcp-manager.ts — thin runtime orchestrator with immutable current-generation Run snapshots, governed leases, reload/retirement, status, test, and bounded shutdown
- mcp-runtime-status.ts — pure runtime-status projection for active/draining generations and sanitized candidate/close outcomes
- mcp-desired-repo.ts — plane-1 SQLite desired state (migration 018) with transactional per-row optimistic configRevision writes; seedFromLegacyFile imports mcp-servers.json ONLY while the table is empty and only after the secret migration rewrote every plaintext value to opaque refs
- mcp-lifecycle-service.ts — the operator plane-2 controller: persists the desired row first, then reconciles the runtime (no restart for add/edit/enable/disable/remove/test/reconnect); typed conflict/refusal errors before the WS surface

Invariant (grep-verifiable): only files in this directory may import `@ai-sdk/mcp` / `@ai-sdk/mcp/mcp-stdio`.
Unix child-process spawn lives inside @ai-sdk/mcp (shell:false); Windows stdio uses the colocated cross-spawn relay.
No module in mcp/ imports node:child_process, and persisted command/args remain portable (invariant 1);
the package's one other sanctioned spawn site is the taki-secret-key helper launch in secrets/master-key.ts (08-12,
per .trellis/spec/backend/secret-catalog.md — boot-time, operator-configured, never agent-initiated).
