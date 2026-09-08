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
- mcp-generations.ts — plane-3 generation records and leases; exact-once close observes immediate closed state separately from deferred cleanup, with forced-call unknown outcomes; never persisted or restored
- mcp-manager-state.ts — process-local desired/candidate ownership, cancellation, locking and active/draining sets; bounded observations follow candidate start/removal and active withdrawal
- mcp-publication.ts — current-token candidate publication; rejects key collisions, atomically swaps active truth, drains prior generations and observes publication/close without per-call noise
- mcp-turn-tools.ts — per-turn MCP ToolSet assembly carrying late-bound Approval/Effect/tool-observer context inside the outer generation lease; Chinese approvals retain full server/tool names in bounded fields
- mcp-boot.ts — desired/seed/manager/secret composition with change observation installed before reconciliation; seeds only an empty table after secret migration
- mcp-manager.ts — runtime orchestration with immutable Run snapshots, governed leases and observed reload/retirement/shutdown; ordinary reads/leases and private Test remain silent
- mcp-runtime-status.ts — pure runtime-status projection for active/draining generations and sanitized candidate/close outcomes
- mcp-desired-repo.ts — optimistic SQLite desired writes and seed-only legacy import; bounded observation follows actual commit before fallible read-back/logging, and skipped/refused writes remain silent
- mcp-lifecycle-service.ts — operator lifecycle wires commit observation into the desired writer before runtime reconciliation; partial commits stay observable and precommit refusals remain silent

Invariant (grep-verifiable): only files in this directory may import `@ai-sdk/mcp` / `@ai-sdk/mcp/mcp-stdio`.
Unix child-process spawn lives inside @ai-sdk/mcp (shell:false); Windows stdio uses the colocated cross-spawn relay.
No module in mcp/ imports node:child_process, and persisted command/args remain portable (invariant 1);
the package's one other sanctioned spawn site is the taki-secret-key helper launch in secrets/master-key.ts (08-12,
per .trellis/spec/backend/secret-catalog.md — boot-time, operator-configured, never agent-initiated).
