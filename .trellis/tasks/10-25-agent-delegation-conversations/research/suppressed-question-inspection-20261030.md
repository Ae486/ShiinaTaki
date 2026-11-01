# Explicit inspection of suppressed worker questions

## Verified gap

Requirements 7/14 require useful readable evidence and exact actionable targets; requirement 10 preserves existing
`record_only` work. The latter suppresses automatic routing, not deliberate Character-scoped inspection.

A bounded local probe used the real SQLite/ChatAgent/SDK/SubagentService fixture with one scripted model request:
the worker called only `interact_parent({ kind: "needs_input", text: question })` under `record_only`. It reached an
open `pendingRequest`. The canonical accepted event retained the exact question, `eligible=false`, and
`suppressionReason=record_only`, while the inbox consumer count remained zero.

Before this correction:

- All five `inspect_subagent` categories (`workers`, `messages`, `inputs`, `results`, `materials`) omitted the question.
  Completion-ID inspection omitted it too.
- `run-message-repo.ts` intentionally deletes native tool-call inputs; the collector's result is only
  `{ ok: true, proposed: true, accepted: false }`. Neither messages nor raw tool results reconstructs accepted text.
- `subagent-queries.ts` exposed wait identity/state/reason but no question body in the summary.
- A known event ID did not bypass `read_agent_inbox`: the probe returned `SUBAGENT_INBOX_NOT_CLAIMED`. With a current
  claim, `subagent-inbox-context.ts` additionally requires actual intent and exact delivered membership.
- Operator `service.conversation` and `conversationBody` did expose the canonical question. Those UI projections
  deliberately withhold unmapped active output through `presentationPending`, so reusing that gate for an immediate
  accepted-event model read would introduce an unrelated presentation-timing dependency.

The gap was therefore an absent explicit model projection, rather than missing event persistence or a reason to
change automatic event eligibility.

## Delivered correction

`inspect_subagent` now accepts category `events`. It reuses the canonical event repository through a scoped query
and existing model inspection conventions: opaque cursor, captured sequence frontier, at most 20 records and 3000
body characters per call, and explicit within-body continuation. Unicode surrogate pairs are not split.

The paged body contains only immutable accepted identity, kind, text, source context and acceptance time. Current
event state, suppression facts and the full current child action target are separate record metadata, so a later
answer or control-version change cannot shift previously selected body offsets. New events after the captured
frontier appear in a fresh read, not midway through an old traversal.

Every page verifies the trusted Character and child; cursors also bind child/category/record identity. Malformed
cursors fail explicitly. Storage failure is a refused read, never a successful empty category. Existing wrong-scope
refusals remain detail-free. Digests, producer receipts and collector acknowledgements are not copied into body text.

No new RPC, storage, summary preview state or model tool was added. `read_agent_inbox` still requires current exact
delivery. Explicit reading does not create a consumer, mark delivery/handling, alter suppression, resume a worker,
publish text or grant action authority. Ordinary questions can be answered using the existing exact
`send_subagent_message` target plus `replyToEventId`; check-in and user Stop retain their existing separate gates.

## Files

- `packages/shared/src/subagent-tool-schema.ts`: additive `events` selector.
- `packages/core/src/agents/subagent-inspect-tool.ts`: selector routing and discovery wording.
- `packages/core/src/agents/subagent-event-inspection.ts`: bounded body traversal and current target metadata.
- `packages/core/src/agents/subagent-evidence-output.ts`: immutable model event projection.
- `packages/core/src/harness/subagent-queries.ts`: Character/child-scoped canonical event frontier/read.
- `packages/core/src/harness/subagent-event-inspection.test.ts`: actual SDK/SQLite regression coverage.
- Respective `src/agents`, `src/harness`, and Shared `src/index.md` entries.

The coordinator owns concurrent message/delegate/refusal wording and live goal tests; this slice did not edit them.
Preimages are retained under `target/agent-delegation-20261030-validation/suppressed-question-inspection/preimages/`.

## Verification

```powershell
pnpm --filter @taki/core test src/harness/subagent-event-inspection.test.ts src/harness/subagent-followup-contracts.test.ts src/harness/subagent-interactive.test.ts src/db/subagent-conversation.test.ts
pnpm --filter @taki/core --filter @taki/shared typecheck
```

- Four focused suites: **13/13 passed**, 7.65 seconds.
- New actual SDK/SQLite tests reconstruct a long Unicode suppressed question, preserve canonical evidence, keep the
  inbox consumer count at zero, and resume through one exact answer without publishing relationship history.
- A body traversal remains stable after an answer and subsequent completion; fresh metadata carries the updated
  control version. Wrong Character, child/category/record cursor changes and unavailable storage refuse explicitly.
- Scoped ESLint and `git diff --check`: PASS; only existing CRLF normalization notices.
- Shared and Core typechecks: PASS.

These checks use a scripted model and establish the selected code paths, not real-model semantic or human acceptance.
The coordinator owns remaining live acceptance. No paid calls, user-data changes or Git delivery were performed here.
