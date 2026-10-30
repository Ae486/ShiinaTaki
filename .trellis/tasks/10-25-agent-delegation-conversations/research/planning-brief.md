# Planning context entry point

Read the task PRD, design and assigned implementation slice first. Original requirements and planning authorization
were recovered from session `01a16d1d-191d-7070-a7e5-3181605428e8`; the owner subsequently authorized implementation
in session `01a17186-8409-7073-b737-845377a5e84f`, as recorded in the PRD. See [context recovery](context-recovery.md).
Existing production specs describe the baseline. In particular their generic task-expiry and single-terminal-notification
rules are intentionally changed by the proposed design; do not enforce old behavior against the new PRD or update the
production spec before delivering the replacement.

## Load only the full topic needed for the assigned slice

- S1–S3: [Runtime/lifecycle](runtime-lifecycle.md) — source table, real queue experiment, inbox receipts, restart routing,
  generic expiry removal, original-request validity and `record_only` compatibility.
- S4: [Worker context/SDK](worker-context-sdk.md) — installed SDK contracts, offline probes, same-Run segmentation,
  global step identity, full raw evidence, cache/disclosure continuity, summary failure and complete history retrieval.
- S5–S6: [Conversation UI](conversation-ui.md) — current source defects, exact private ordering, live producer/recovery,
  shared presentation boundary, stable drafts/targets/anchors and native scenario matrix.
- All slices: [independent architecture review](architecture-review.md) — verified plan corrections and limits.
- S1/S2/S7: [foreground private boundary](foreground-private-boundary.md) — coordinator-verified mixed native
  parts, private consumer admission, live/durable routing, public speech, Memory protections and failure cases.

The research is source/probe evidence, not implementation or acceptance. Do not reproduce the old vendor survey.

## Layer guidance to read when implementing

- Runtime/context: `.trellis/spec/backend/agent-runtime.md`, `shared-agent-delegation.md`, `compaction-harness.md`,
  `accepted-work-lifecycle.md`, `tool-design.md`, `tool-disclosure.md`, `permission-authorization.md`.
- Persistence/publication: `.trellis/spec/backend/database-guidelines.md`, `sqlite-migration-lineage.md`,
  `sqlite-transaction-isolation.md`, `initiative-runtime.md` and `host-operation-lifecycle.md`.
- Activity/UI: `.trellis/spec/backend/foreground-chat-activity.md`; frontend `home-window.md`,
  `foreground-chat-feedback.md`, `reactive-read-models.md`, `operator-connection-recovery.md`, `state-management.md`,
  `component-guidelines.md` and `hook-guidelines.md`.
- Checks: layer quality guidelines and `.trellis/spec/backend/e2e-harness.md`.

The manifests deliberately load this navigation document instead of all long reports/specs at once. Their remaining
files must be read from disk for the assigned responsibility; a truncated context injection is not full-spec coverage.
Shared owners stay single-writer. Implementation authorization comes from the owner's current request, not artifact
existence. Paid calls, actual-user data mutation, Git delivery and human acceptance remain outside that authorization.
