# Delegation maturity assessment — 2026-10-30

Owner question (Claude Code session `0d1f3e80-677e-4e02-8be0-8781cef96719`): before continuing S7, is the implemented
delegation/subagent mechanism mature and usable? Read-only assessment of the T4 worktree at checkpoint commit `6b36d0d`:
one external-comparison agent (official docs/source only), one internal code audit, coordinator verification of every
finding below against live source. No code changed and no tests were run for this assessment.

## Verdict

Not yet a mature, generally usable mechanism; usable for internal trials. Durability, restart truth, Stop latches and
child isolation are strong. Blocking gaps: the current contract has no real-model evidence, children have no runaway
fence, several stuck states need hidden manual recovery, model-facing payloads remain identifier-heavy, retained data
grows without bound, and S7 is still open.

## Verified strengths

- Children run the shared `ToolLoopAgent`; the 2026-10-24 retrieval defect is fixed: `read_self_history` is an intrinsic
  child tool (`packages/core/src/agents/run-message-store.ts:43`).
- Durable accept/deliver/handle records; restart marks generic work as explicit-continue (`harness/subagent-service.ts:129-137`);
  uncertain effects are not replayed; parent input cannot clear a user Stop (`db/subagent-input-repo.ts:77`).
- Children receive no base persona prompt or Memory context (`agents/agent-attempt.ts:60-61`); Memory writers are removed.
- Bounds that do exist: 16 active children globally / 4 per Character (`subagent-service.ts:281`); 1,000 unconsumed inputs
  per child (`subagent-service.ts:259-263`); inbox batches of at most 8 events / 16 KiB (`db/subagent-inbox-repo.ts:94,99`).

## Findings, ranked by impact on real use

Paths are under `packages/core/src/` unless stated. `[inference]` marks behavior derived from code but not executed.

1. **No real-model evidence for the current contract.** All post-10-25 runs use local scripted providers
   (`research/implementation-checkpoint.md:102-103`). The 10-21 live campaign used the older contract, dictated tool
   names/arguments in the prompt and sent the correction through a test RPC (`e2e/src/agent-context-real.e2e.test.ts:22-26,34-37`):
   it shows instruction following, not autonomous use. Unproven with a real model: inbox read→handle, needs-input round
   trip, full 8-event batches, compaction rollover and long uncapped children.
2. **No runaway fence for children.** The child stop condition is `isLoopFinished()`, which the installed SDK documents as
   "never returns true" (`agents/agent-attempt.ts:114`); compaction rollover loops without a count (`agent-attempt.ts:183-210`);
   generic work is `until_cancelled`; no token/cost budget; children use the main model (`agent-attempt.ts:65`). This followed
   PRD requirement 5, but every surveyed system that drops time limits keeps another fence (see comparison). Compaction also
   removes the natural stop of a full context window. Not recorded in `docs/deferred-decisions.md`.
3. **Unattended handler can create children.** The idle inbox handler receives the full main delegation tool set, including
   `delegate_subagent` (`harness/subagent-inbox-execution.ts:126`, `harness/subagent-composition.ts:24`,
   `agents/subagent-tools.ts:19-21`). Child result → event → handler → new child forms a chain with no depth or total limit;
   only the 16/4 concurrency cap applies. Codex issue #35463 is the real-world failure mode of a missing depth path.
4. **Stuck states with hidden or no recovery.**
   - Delivered but unhandled events (model omission, or the handler's default 10-step cap, `agent-attempt.ts:25,122`) settle as
     `reconciliation_needed` (`db/subagent-inbox-terminal.ts:19-22`) and are excluded from later claims
     (`db/subagent-inbox-repo.ts:91-94`). The only entry is a collapsed Subagents-page panel with no notification
     (`apps/desktop/src/features/subagents/subagent-inbox-recovery.tsx:19-20`).
   - Pre-intent idle failure locks the Character until a fresh opportunity or restart; no timer
     (`harness/subagent-inbox-execution.ts:34-39`). `authorityChanged()` has no production caller (`harness/subagent-service.ts:62`).
   - A `needs_user_input` disposition is only recorded; outside its schema (`packages/shared/src/subagent-inbox-schema.ts:33`)
     no Core or Desktop code acts on it.
5. **Model-facing payloads remain identifier-heavy (requirement 7 partly met).**
   - The delegate acknowledgement is compact (`agents/subagent-control-output.ts:13-16`), but its target needs an exact
     control version (`db/subagent-input-repo.ts:48-50`) that increments on admission, terminal, Stop and Continue
     (`db/subagent-execution-repo.ts:122`, `db/subagent-terminal.ts:50`, `db/subagent-repo.ts:52`, `db/subagent-input-repo.ts:78`).
     The acknowledged target is therefore stale once the child starts; the refusal is a fixed generic message
     (`agents/subagent-tools.ts:30-33`), so the model must rebuild the target from list fields `[inference]`.
   - Inbox lines carry event ID, child UUID, work UUID, a 64-hex digest and source references (`db/subagent-inbox-repo.ts:162-166`);
     the digest feeds no model action.
   - `inspect_subagent` with `completionId` returns the whole internal result group — run/attempt/receipt IDs, child and parent
     digests, parent Run, publication — with a body of up to 1,000,000 characters and no truncation
     (`harness/subagent-queries.ts:38-45`, `packages/shared/src/subagent-result-schema.ts:13,31-58`). All read failures collapse
     into `SUBAGENT_READ_UNAVAILABLE` (`agents/subagent-inspect-tool.ts:31`).
   - Old-contract residue: `workExpiresAt` in results (`subagent-result-schema.ts:38`).
6. **Unbounded retained state.** No delete/archive path exists for subagent or run-message tables; in-memory bindings are
   reordered, never removed (`harness/subagent-service.ts:290`); startup loads every generic route and each schedule pass
   walks all bindings (`subagent-service.ts:129-137,270`).
7. **S7 open.** Independent rechecks of the checkpoint-failure (P1) and bounded live-retention (P2) fixes are missing; full
   Core/Desktop and native reruns predate them; the hidden-row cursor gap is unconfirmed; all PRD boxes are open.

Lower impact: approval-gated tools in background children fail closed without durable authority
(`governance/governed-tool.ts:124-126`) `[inference]`; the child model cannot be selected separately; the idle prompt says
"Plain text is retained privately" while the shared inbox header says "Public text is real speech"
(`harness/subagent-inbox-execution.ts:124`, `db/subagent-inbox-repo.ts:161`) `[inference: ambiguous to a model]`.

## External comparison

| | TakiAgent | OpenClaw | Hermes | Claude Code | Codex |
| --- | --- | --- | --- | --- | --- |
| Nesting | children cannot delegate; idle handler can | default depth 5 (1-5) | depth 1 | default depth 3 | V1 depth 1; V2 unenforced (#35463) |
| Concurrency | 16 global / 4 per Character | 5 active children / 8 running per session | 3 | 20, fails fast with "do not retry" | 6 (V1) / 4 (V2) |
| Step or spend cap | none | no default timeout | 50 iterations, then tool-free summary | optional `maxTurns`; SDK USD budget | none found |
| Stuck detection | none | unconfirmed runs stop counting after 2 h | 450 s idle / 1,200 s in one tool | not verified | not verified |
| Result size | pushed events bounded; full read up to 1M chars | 160k chars across child results | ≤24k chars, scaled to parent headroom | not verified | not verified |
| Retention | none | archive after 60 min | not found | transcripts deleted after 30 days | not verified |

Spot-verified against source: Hermes `references/hermes-agent-main/tools/delegate_tool.py:119,126,587-616`; Claude Code
<https://code.claude.com/docs/en/sub-agents>; OpenClaw <https://docs.openclaw.ai/tools/subagents/nesting.md> and
<https://docs.openclaw.ai/tools/subagents/operations.md>; Codex <https://github.com/openai/codex/issues/35463>.
Other rows come from the comparison agent's cited official docs/source (OpenClaw announce/tool-policy pages, Codex
`multi_agents` handlers, Claude Agent SDK cost tracking).

TakiAgent leads on direct user conversation with a child and on durable, restart-truthful records. It lags on boundary
fences and stuck-state recovery.

## Owner decisions — 2026-10-30

- Agreed follow-up order (mirrored in [implement.md](../implement.md#follow-up-order-owner-approved-2026-10-30)); the fix
  groups below are folded into this task so the full verification runs once.
- Previously pending item: pre-intent idle failure must not wait only for fresh opportunities; add a bounded timer retry.
- Runaway fence direction: periodic progress check-in instead of a hard total cap. Owner asked whether a task finishing
  before step N ends normally; answer recorded below. N and the unattended-approval escalation K await confirmation
  (recommended N = 50, K = 3).
- Real-model and E2E runs are approved and encouraged: "批准使用真实模型/e2e，而且鼓励使用，真实模型能暴露真正的问题".
- Deferred, not scheduled here: retained-data cleanup (T4-D88) and routed approvals for background children (T4-D89).

### Check-in semantics (recommended; for design)

- Count model steps since work start or the last check-in, across compaction segments (each rollover restarts the SDK
  step counter, so use the global step number). Parent messages do not reset it.
- Completion, needs-input, Stop or failure before step N ends exactly as today. A completion submitted in step N is a
  completion, not a check-in.
- At step N, after the step's tools finish, the child writes a progress report and its work pauses as a durable wait. The
  report reaches the main conversation through the existing inbox; continue or redirect resumes the same work and resets
  the counter.
- After K consecutive main-Agent continuations without user input, the next check-in requires the user.
- Show cumulative token usage per child in the UI.
