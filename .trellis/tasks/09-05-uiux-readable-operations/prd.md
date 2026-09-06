# Readable operation names and approval content

## Goal

Make tool, capability and approval surfaces explain the real operation and target in readable Chinese
without exposing internal routing/binding identifiers or changing execution/permission semantics.

## Requirements

- Continue the owner-approved G1/G4 UI/UX sequence after the pure-frontend information cleanup.
- Cover N1/N2/N5/N7/I1: shared capability labels, tool names, permission groups/cells, durable decisions
  and approval dialog copy. Use real server/tool/operation identity; no invented names or raw-ID fallback.
- Cover N3/D64: command approval must display useful bounded, redacted command context bound to the
  actual pending operation. Preserve the existing challenge, expiry, decision and revalidation contract.
- Keep canonical keys, IDs, generations, CAS and authorization internal. Changing a displayed name
  must not change permission matching, routing, or which operation is approved/revoked.
- System-owned copy is Chinese; actual tool/model/server names, commands, paths and results retain
  their meaning. Do not expose secrets or add raw authorization/debug payload panels.
- Reuse existing Core/Shared/Desktop/Rust ownership boundaries. Main-branch Hindsight/memory work is
  outside this task. No new dependency without an explicit need and approval.

## Acceptance Criteria

- [x] Supported operations render useful names/targets across live tool cards, settings and approvals.
- [x] Primary/expanded/accessibility/copy content contains no meaningless internal binding metadata.
- [x] Durable decisions remain correctly bound when listed, revoked, refreshed or restored.
- [x] Command approval shows sufficient permitted context to understand the exact proposed action.
- [x] Redaction, stale challenge, expiry, reconnect, hard constraints and confirmation behavior retain
      their existing guarantees; tests cover changed contracts and meaningful failure cases.
- [x] Relevant package gates and real-window operator checks pass; owner visual acceptance is recorded
      separately from automated evidence.

Engineering acceptance completed on 2026-09-06: see
[A1/A2 evidence](implementation-evidence-a1-a2-2026-09-06.md) and
[D64 evidence](implementation-evidence-d64-2026-09-06.md). Real-window engineering checks were
performed under the owner's execution delegation; personal owner visual inspection remains
unclaimed and is not substituted by automated results.

## Notes

- Planning child created with owner consent on 2026-09-05. Complete the current-source contract map,
  design and execution plan before activation; task creation itself is not a completed design review.
- Source requirements: [G1–G5](../08-22-t4-agent-architecture-observability/research/uiux-grill-2026-09-05.md)
  and [G4 inventory](../08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md).
- Monitor belongs to D68. Live event delivery and Pet bubble lifecycle belong to
  [the live-feedback child](../09-05-uiux-live-tool-feedback/prd.md). D77 error taxonomy remains deferred.
