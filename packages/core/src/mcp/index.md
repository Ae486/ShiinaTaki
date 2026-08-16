# core/mcp/
- mcp-config.ts — strict zod schemas + parseMcpServers body parse for mcp-servers.json (operator-owned; NEVER agent-reachable; env/header values may be `secret-ref:` markers post-migration) — the file is a SEED-ONLY legacy input consumed once by mcp-desired-repo
- mcp-connect.ts — sanctioned MCP transport-construction boundary (ADR 0006); builds a stdio/http transport + connects
- mcp-schema-compat.ts — deep-clone definitions; narrow verified optional-nullable properties; isolate unsafe tools
- legacy-mcp-deny.ts — read-only mcp-approvals.json deny adapter; missing is empty, allows inert, corrupt/ambiguous state fail-closed
- mcp-tool-identity.ts — shared namespacing/identity helpers: sanitizeKey, stableSubjectId (governance subject), publicConfigFingerprint (secret-free revision), wrapExecute ({ok:false} error envelope)
- mcp-candidate.ts — the frozen candidate body: JIT `secret-ref:` resolution -> connect -> LOCALLY paginated tools/list under one bounded deadline (the SDK does not paginate) -> schema-compat preparation -> selected-tool filter -> namespaced closures; close-on-failure guaranteed; a candidate NEVER publishes by itself
- mcp-generations.ts — plane-3 generation records + acquireLease/releaseLease/retireGeneration/closeGeneration: a draining generation takes no new leases and its client closes exactly once (at lease-zero or the drain budget); never persisted, never restored
- mcp-turn-tools.ts — the per-turn ToolSet assembly: governance (Approval/presentation) wrapper plus the OUTER generation lease (acquire -> authorize/execute -> release in finally; retired generations fail closed, never redirect)
- mcp-boot.ts — the lifecycle's composition seam (repo + legacy seed + manager + secret-clear-aware catalog view) so main.ts stays a thin wiring root; boot order pinned: seed only while the table is empty and only after the secret migration
- mcp-manager.ts — the runtime generation machine: reconcile (desired -> candidates -> publish, per-server isolation), applyDesired (candidate + atomic publish under lock, last-good retention), disable/remove/secretCleared (lease blocking + drain), test (diagnostics-only ephemeral candidate), statuses, per-turn governed+leased ToolSet assembly, describe(), close (stop publication -> cancel candidates -> bounded drain -> force close, idempotent)
- mcp-desired-repo.ts — plane-1 SQLite desired state (migration 017) with transactional per-row optimistic configRevision writes; seedFromLegacyFile imports mcp-servers.json ONLY while the table is empty and only after the secret migration rewrote every plaintext value to opaque refs
- mcp-lifecycle-service.ts — the operator plane-2 controller: persists the desired row first, then reconciles the runtime (no restart for add/edit/enable/disable/remove/test/reconnect); typed conflict/refusal errors before the WS surface

Invariant (grep-verifiable): only files in this directory may import `@ai-sdk/mcp` / `@ai-sdk/mcp/mcp-stdio`.
The child-process spawn lives inside @ai-sdk/mcp (shell:false) — no module in mcp/ imports node:child_process (invariant 1);
the package's one other sanctioned spawn site is the taki-secret-key helper launch in secrets/master-key.ts (08-12,
per .trellis/spec/backend/secret-catalog.md — boot-time, operator-configured, never agent-initiated).
