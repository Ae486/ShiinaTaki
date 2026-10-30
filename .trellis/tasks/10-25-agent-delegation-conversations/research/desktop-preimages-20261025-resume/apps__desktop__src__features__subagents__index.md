# Private child conversations

- subagent-controller.ts — coherent child/work selection, serialized exact-target commands, acknowledged observation and reconnect retirement
- subagent-state.ts — disposable Shared read projections and exact displayed target comparison
- subagent-reads.ts — independent bounded list, input, message and execution paging
- subagent-labels.ts — truthful progress, receipt, completion, delivery and refusal wording
- subagent-navigation.ts — local addressed navigation into the registered child page; no execution command
- use-subagents.ts — Home client, visibility and navigation binding with immediate readiness gates
- subagent-list.tsx — readable child navigation and cold/empty states
- subagent-detail.tsx — selected work, execution status without invented chronological ordinals, private messages and results
- subagent-composer.tsx — private draft and exact-target send/Stop/Continue controls using the shared Chat composer shell
- subagent-inputs.tsx — sender/material display and separate accepted versus model-intent-included receipts
- subagent-transcript.ts — Run/Attempt-scoped private text/tool projection without relationship or presence identity
- subagent-results.tsx — retained child outcome, linked parent decision and actual delivery truth

State is memory-only. Queries restore each authenticated generation after subscription acknowledgement;
mutations are never replayed. Child messages reuse existing Chat presentation without writing or
pretending to be Character relationship Timeline entries. Read failures retain permitted content,
while explicit unavailable/forbidden detail removes the affected projection.
