# Page state and event-triggered refresh

## Goal

Make Home refresh the right data at the right time, with truthful loading/error/empty states and uninterrupted reading and editing. Initial visits, actual producer changes, explicit inspection, local writes, reconnection, and visibility changes must each have a deliberate refresh policy.

## Authorization and status

- Engineering acceptance completed on 2026-09-08 in code commit `7d89191`. Independent review covers
  171 source paths; the final frozen WebView2 matrix passed 20/20. See [final evidence](implementation-evidence-2026-09-08.md).
  Personal owner inspection and real system IME testing remain explicitly unperformed.
- On 2026-09-08 the owner approved creating this task and entering planning.
- The owner extended the earlier four-page state-fix proposal to include the existing UX requirement for event- and demand-triggered refresh: some sections update when their producer changes, while others refresh when entered or expanded.
- The owner delegated the frontend technical choices and asked that refresh avoid clearing and rebuilding visible content.
- After presentation of the complete plan, the owner renewed the active goal on 2026-09-08: lead work on identified defects and optimization directions until a real requirements decision, discussion or manual-only test requires the owner. This authorizes implementation of this reviewed scope and supersedes the pending routine implementation-confirmation question.
- Product/authority changes outside this plan and unperformed personal/manual acceptance are not inferred from that delegation.
- Worktree: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`; inspected baseline: `b251474`.

## Requirements

- Inventory the eight registered Home pages and their independently refreshed sections. Assign each a data owner, first-read trigger, subsequent refresh trigger, hidden/closed behavior, and recovery behavior.
- Read initial state once when a surface first becomes usable. Reuse an existing valid read or subscription instead of starting duplicate requests.
- Keep frequently changing, currently visible information current from actual producer events. Perception follows accepted sampling/scheduling/pause facts; MCP/Skills lists and the extension strip follow actual lifecycle/catalog changes. Neither page timers nor inferred observation/execution states may stand in for a producer.
- Load expensive details when the user requests them. Closing or hiding a detail must stop unnecessary work; reopening reuses valid results and refreshes when invalidated or when the detail's explicit inspection contract requires it.
- Refresh affected projections after successful writes and recover them after connection replacement without replaying the write.
- Distinguish initial loading, successful empty data, refresh over existing content, initial failure, stale content after failed refresh, and unavailable transport.
- Fix the source-confirmed MCP refresh, Costume initial-failure, and Operations/Perception loading/error/empty branch defects from the preceding audit.
- Preserve stable content identity, selection, expanded sections, drafts, focus, and reading position while updating the affected data. User-owned reading and editing take priority over automatic scrolling or replacement.
- Keep active config/IME drafts when a server value changes. An unchanged or conflicted blur must not write an obsolete value; explicit conflict actions and current-attempt save results must distinguish local draft state from confirmed persistence.
- Bound event-triggered reads and discard retired-client, outdated-request, and closed-detail responses. Idle or hidden surfaces must not create recurring fetch loops.
- Preserve Core authority, the existing privacy/cache allow-list, command/approval identity, and the completed Chat/Pet and DSH Monitor contracts.

## Acceptance Criteria

- [x] Every registered page and meaningful detail section has an explicit, source-backed refresh policy.
- [x] Initial entry, re-entry, open/close, producer invalidation, local write, reconnect, and hide/show each cause only the reads required by that policy.
- [x] Relevant Perception producer changes reach an open page without leaving and re-entering it; hidden or closed consumers do not trigger continuous reads.
- [x] Visible MCP/Skills/extension projections settle after real asynchronous or cross-actor changes; ordinary tool leases and resource reads do not cause list refresh storms.
- [x] Error/empty/loading distinctions remain correct with and without a prior snapshot, and failed reads expose a working retry.
- [x] Refresh retains existing content and control identity where its authority permits reuse; unrelated updates preserve draft, focus, selection, expansion, and scroll anchors.
- [x] Same-field external changes, IME composition, no-op blur, failed/retired saves and editing during an earlier save do not silently discard or submit the wrong draft.
- [x] Event bursts, concurrent triggers, late responses, and connection/detail retirement do not cause duplicate work, lost invalidations, stale overwrites, or mutation replay.
- [x] No UI polling loop, new persistent authority/cache category, weakened privacy gate, or invented capture/execution state is introduced.
- [x] New subscription setup is idempotent and retryable; older Core support is distinguished from authentication or malformed-response failure, with an explicit bounded manual-refresh fallback.
- [x] Automated state/race tests and targeted real-WebView2 interaction evidence cover the changed paths; engineering verification and personal owner inspection remain distinct.

## Boundaries

- D67's remaining Home refresh work is part of this planning scope. Completed Monitor and Chat/Pet behavior is a reference and regression boundary, not a replacement target.
- Long-CJK Markdown performance remains a separate follow-up; this task does not assume that all React rendering is expensive or promise zero renders.
- D77 error taxonomy, Avatar Lab, OpenBiliClaw, theme/visual redesign, and T4 initiative/Heartbeat/cross-device work remain outside this task.
- No new dependency, data migration, user-data access, or change to capture/retention/privacy policy is assumed.

## Planning outcome and execution boundary

- No owner preference question is blocking. Technical choices were resolved from current source, official React documentation and focused design review.
- [design.md](design.md) defines the final trigger/state/identity contracts, two small opt-in invalidation channels, compatibility and limitations. [implement.md](implement.md) defines four internal implementation/verification batches.
- This plan reuses the completed G1-G5 evidence within its scope and adds tests for the newly identified gaps. No new runtime test or visual acceptance has been performed during planning.
- The renewed execution goal clears the implementation gate for batches A-D. Use `task.py start`, follow the recorded contexts and continue autonomously through meaningful verification; escalate only a real unresolved decision or manual-only boundary.

## Research references

- [Home inventory and old-AC alignment](research/home-refresh-inventory.md).
- [React and refresh continuity](research/react-refresh-continuity.md), including the focused draft/save review.
- [Perception producer and privacy boundaries](research/perception-producer-refresh.md).
- [Extension producers](research/extension-refresh-producers.md), with the root-selected single subscription superseding the initial passive-notification recommendation.
