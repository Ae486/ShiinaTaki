# Harness prompt-prefix cache stability

## Goal

Reduce avoidable provider cost by keeping the reusable model-request prefix byte-stable across adjacent conversational
Runs. The fix must remove per-Run execution metadata from model-visible stable instructions without weakening Core's
Run/Attempt identity, immutable extension snapshot, Host ownership, governance, or tool routing. Effectiveness must be
proved both structurally and against the configured real DeepSeek upstream before D68-B Monitor UI work begins.

## Known Evidence

- Six current-database requests reproduced the reported problem. The four latest requests each carried approximately
  68,500 input tokens but exactly 6,912 cache-read tokens, for a roughly 10.1% cache-read ratio.
- These records are individual model requests, not a misleading multi-step aggregate.
- The provider does return authoritative cache data, so the problem is not an absent telemetry signal.
- `createExtensionRegistry()` renders the fresh Run UUID into `<extension-context>` and
  `ChatAgent.composeInstructions()` appends that context to the system instructions before replayed history.
- DeepSeek prefix caching stops at the first changed token. A fresh Run UUID therefore invalidates the later replayed
  history even when persona, tools, provider/model, memory state, and conversation history are otherwise reusable.
- Canonical memory is active in the observed environment; its pinned/block sources had not changed during the measured
  requests, so memory mutation is not the primary cause of this fixed 6,912-token breakpoint.

## Requirements

1. Keep the model-visible stable prefix deterministic across adjacent Runs when all semantically relevant inputs are
   unchanged. A different `runId`, `attemptId`, event id, generation id, timestamp, or correlation id alone must not
   change system instructions or tool schemas.
2. Preserve Run/Attempt identity in Core-owned state, durable events, telemetry, tool closures, governance, approvals,
   and extension snapshots. Removing an identifier from the prompt must never loosen or redirect authority.
3. Audit every request component that precedes replayed history: provider/model/call options, base and Character prompts,
   day context, memory assembly, Skill/avatar instructions, extension context, tool names/order/schemas, and history
   window/compaction projection. Classify each component as stable, append-only, or deliberately volatile.
4. Move or remove only non-semantic volatile material. If the model needs a per-turn fact, place it after the reusable
   history prefix unless doing so changes a documented safety or behavior contract.
5. Preserve deterministic tool ordering and schemas for an unchanged captured capability set. A new closure object alone
   must not alter its serialized model-facing schema.
6. Add a regression contract proving that two otherwise identical Runs with different execution identities assemble the
   same stable system/tool prefix and still route extension calls through their own sealed Run snapshot.
7. Add a DSH-shaped real-provider verification: after the first request, adjacent requests over an append-only
   conversation must report authoritative cache reads. The focused post-fix probe must materially outperform the
   reproduced roughly 10.1% baseline, not merely report a non-zero cache hit.
8. Record cache verification honestly per model request, including input, uncached input, cache-read tokens, ratio,
   provider/model, and whether the request included a tool continuation or a new conversational Turn.
9. Keep the change provider-neutral in production. DeepSeek-specific fields or thresholds may exist only in the focused
   live acceptance probe that reads the provider-neutral normalized usage contract.
10. Execute and close this task before beginning D68-B's Monitor layout and visual interaction implementation.

## Acceptance Criteria

- [x] Different Run UUIDs with identical semantic inputs produce byte-identical system instructions and deterministic
      tool definitions/order.
- [x] Extension discover/describe/call operations remain bound to the correct immutable Run snapshot after model-visible
      Run identity is removed.
- [x] No dynamic execution identifiers remain in the model-visible prefix ahead of replayed conversation history unless
      a documented semantic requirement and cache trade-off are recorded.
- [x] Existing Character isolation, memory authority, Host ownership, MCP/Skill generation safety, governance, approval,
      retry, and compaction tests remain green.
- [x] A deterministic request-shape test proves the honest TakiAgent boundary: system/config/tools and replay history
      before the prior newest user row remain stable; the prior plain user text remains the shared prefix; its old
      non-persisted `<turn-context>` tail is intentionally absent on the next conversational Turn. Tool continuations
      within one Run remain strict append-extensions.
- [x] A real configured DeepSeek probe records cache data for consecutive requests and raises the cache-read ratio from
      the reproduced approximately 10.1% baseline to at least 50% on a comparable long-history follow-up and by at
      least 30 percentage points.
- [x] The real probe verifies normal chat output and at least one tool path while measuring cache behavior; cache
      optimization must not break conversation or tool execution.
- [x] Relevant Core tests, typecheck, lint, task validation, and `git diff --check` pass.

## Definition of Done

- The root cause and complete audited prefix map are persisted under this task's `research/` directory.
- `design.md` records stable-prefix boundaries, authority preservation, compatibility, rollout, and rollback.
- `implement.md` defines one coherent implementation slice and one formal check.
- Production code and tests are implemented by one impl agent and reviewed by one check agent.
- The before/after real-provider evidence is recorded without prompt content, credentials, or raw tool payloads.
- Parent D68 planning explicitly places this task before D68-B UI work.

## Out of Scope

- Building a local KV cache or proxying provider cache storage.
- Provider-specific production request branches or fabricated cache-hit metrics.
- D68-B Monitor layout, general Home UI refresh work, Chat tool-icon streaming, or unrelated UI cleanup.
- Broad prompt shortening, memory redesign, semantic compaction redesign, or removal of useful Character context solely to
  improve a cache percentage.
- Guaranteeing cache reuse across provider/model/config changes, actual capability-set changes, compaction boundaries,
  day changes, image-budget changes, or upstream cache expiry/eviction.

## Research References

- [`research/prompt-prefix-cache-audit-2026-08-28.md`](research/prompt-prefix-cache-audit-2026-08-28.md) — confirms the
  Run UUID breakpoint, authority-preserving minimal fix, true `<turn-context>` reuse boundary, AI SDK tool serialization,
  DSH canonical-order pattern, and the real-provider acceptance protocol.

## Notes

- DSH's real cache E2E requires every request after the first to expose `cacheReadTokens > 0` over append-only history.
- This task uses a stronger project-specific success gate because TakiAgent already reports a low but non-zero 6,912-token
  prefix hit; the goal is material reuse of the long conversation history.
