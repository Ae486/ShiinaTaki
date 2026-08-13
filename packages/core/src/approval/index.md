# core/approval/

Batch A installs the canonical durable Approval authority modules but deliberately leaves production `ask` fail-closed.
`main.ts` does not compose the new service or any prompt/method lifecycle yet. The retained legacy modules remain
compatibility/test inputs only and are not current authorization authority.

- approval-binding.ts — pure current/stored binding validation, fixed-order SHA-256 digesting, and inert-reason classification
- approval-state-repo.ts — sole Approval SQL owner; strict rows plus atomic optimistic grant/revoke/reconcile/generation mutations
- approval-decision-service.ts — process epoch, historical-registry reconciliation, current durable grant/list/revoke, and generic generation seam
- approval-broker.ts — dormant ask/await broker retained for Slice-4 migration reference and tests
- decision-store.ts — legacy `mcp-approvals.json` writer implementation retained for tests; production Slice 3 reads only exact legacy denies through `mcp/legacy-mcp-deny.ts`
- approval-gate.ts — dormant AI SDK `toolApproval` adapter; production Slice 3 returns `APPROVAL_REQUIRED` before execution instead of invoking this lane
