# Private child conversations

- subagent-controller.ts — coherent child/work selection, serialized exact-target commands, acknowledged observation and reconnect retirement
- subagent-state.ts — disposable Shared read projections and exact displayed target comparison
- subagent-reads.ts — bounded list reads and legacy raw-history adapter retained for existing consumers
- subagent-conversation-pages.ts — retained newest/older/newer windows, digest-fenced complete-body reads and full-body preservation
- subagent-drafts.ts — per-Character/child/work drafts with captured targets, submission revisions and unknown-outcome reconciliation
- subagent-conversation-header.tsx — truthful child state, historical-order disclosure and explicit work addressing without transcript filtering
- subagent-conversation-transcript.ts — trusted sender-aware ordered rows, input/report identity and real activity interleaving
- subagent-message-projection.ts — private native-part text/tool mapping to shared Chat items without relationship exposure targets
- subagent-live-coverage.ts — exact complete-batch coverage and explicitly previewed body linkage
- subagent-activity-retention.ts — window-wide live snapshot count/byte admission budget with explicit unavailable state and no observed-text eviction
- subagent-activity-hydration.ts — bounded complete-body recovery planning for terminal/obsolete live Runs
- use-subagent-activity.ts — selected-child adaptation of shared stream recovery with retained observed content and unsubscribe on hidden/rebind
- subagent-tool-display.ts — readable delegation results and navigation from exact known child targets
- subagent-inbox-controller.ts — explicit parent-event recovery reads and serialized operation-identity-preserving continuation
- use-subagent-inbox.ts — visibility/current Home client binding for parent-event reconciliation
- subagent-inbox-recovery.tsx — compact existing-page parent handling recovery disclosure, separate from child Stop/Continue
- subagent-labels.ts — truthful progress, receipt, completion, delivery and refusal wording
- subagent-navigation.ts — local addressed navigation into the registered child page; no execution command
- use-subagents.ts — Home client, visibility and navigation binding with immediate readiness gates
- subagent-list.tsx — readable child navigation and cold/empty states
- subagent-detail.tsx — continuous private conversation using shared Chat scroll/rows/Markdown/tool cards and complete-body actions
- subagent-composer.tsx — retained private draft, asynchronous Send, Stop and single-RPC Send-and-continue using shared Chat geometry
- subagent-inputs.tsx — sender/material display and separate accepted versus model-intent-included receipts
- subagent-transcript.ts — Run/Attempt-scoped private text/tool projection without relationship or presence identity
- subagent-results.tsx — retained child outcome, linked parent decision and actual delivery truth

State is memory-only. Queries restore each authenticated generation after subscription acknowledgement;
mutations are never replayed. Child messages reuse existing Chat presentation without writing or
pretending to be Character relationship Timeline entries. Read failures retain permitted content,
while explicit unavailable/forbidden detail removes the affected projection.
