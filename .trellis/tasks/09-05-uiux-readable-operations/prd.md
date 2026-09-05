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

- [ ] Supported operations render useful names/targets across live tool cards, settings and approvals.
- [ ] Primary/expanded/accessibility/copy content contains no meaningless internal binding metadata.
- [ ] Durable decisions remain correctly bound when listed, revoked, refreshed or restored.
- [ ] Command approval shows sufficient permitted context to understand the exact proposed action.
- [ ] Redaction, stale challenge, expiry, reconnect, hard constraints and confirmation behavior retain
      their existing guarantees; tests cover changed contracts and meaningful failure cases.
- [ ] Relevant package gates and real-window operator checks pass; owner visual acceptance is recorded
      separately from automated evidence.

## Notes

- Planning child created with owner consent on 2026-09-05. Complete the current-source contract map,
  design and execution plan before activation; task creation itself is not a completed design review.
- Source requirements: [G1–G5](../08-22-t4-agent-architecture-observability/research/uiux-grill-2026-09-05.md)
  and [G4 inventory](../08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md).
- Monitor belongs to D68. Live event delivery and Pet bubble lifecycle belong to
  [the live-feedback child](../09-05-uiux-live-tool-feedback/prd.md). D77 error taxonomy remains deferred.
