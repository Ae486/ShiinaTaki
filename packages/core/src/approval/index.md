# core/approval/

The canonical durable and interactive Approval authority is composed in production for Core-local and MCP `ask`
decisions. Pending/session authority is process-local and exact-Connection-owned; durable allow authority stays in
SQLite. Retained legacy modules remain compatibility/test inputs only and are not current authorization authority.

- approval-binding.ts — pure current/stored binding validation, fixed-order SHA-256 digesting, and inert-reason classification
- approval-state-repo.ts — sole Approval SQL owner; strict rows plus atomic optimistic grant/revoke/reconcile/generation mutations
- approval-decision-service.ts — process epoch, historical-registry reconciliation, current durable grant/list/revoke, and generic generation seam
- approval-broker.ts — dormant ask/await broker retained for Slice-4 migration reference and tests
- decision-store.ts — legacy `mcp-approvals.json` writer implementation retained for tests; production Slice 3 reads only exact legacy denies through `mcp/legacy-mcp-deny.ts`
- approval-gate.ts — dormant AI SDK `toolApproval` adapter; production Slice 3 returns `APPROVAL_REQUIRED` before execution instead of invoking this lane
- approval-interaction-binding.ts — exact canonical binding comparison, approval-memory choice ceilings, and usable durable-authority lookup
- approval-interaction-store.ts — process-local pending/session record shapes and exact-Connection collection ownership
- approval-interaction-state.ts — serialized request/respond/revoke/policy-invalidation/disconnect transitions with targeted close notifications
- approval-interaction-outcomes.ts — bounded terminal decision and response helpers
- approval-interaction-service.ts — public interactive authority facade, final current-authority verification, and isolated requested/decided Run Event observation
- approval-runtime.ts — production composition of durable authority, interaction service, methods, disconnect cleanup, Core tool adapter, and optional Run Event sink
