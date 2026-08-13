# core/approval/

Retained pre-Slice-3 approval implementation. These modules remain for focused regression tests and the explicit
Slice-4 migration seam, but `main.ts` does not construct them, does not register `approval.respond`, and does not pass
an Approval gate to the production Agent. They are not current authorization authority.

- approval-broker.ts — dormant ask/await broker retained for Slice-4 migration reference and tests
- decision-store.ts — legacy `mcp-approvals.json` writer implementation retained for tests; production Slice 3 reads only exact legacy denies through `mcp/legacy-mcp-deny.ts`
- approval-gate.ts — dormant AI SDK `toolApproval` adapter; production Slice 3 returns `APPROVAL_REQUIRED` before execution instead of invoking this lane
