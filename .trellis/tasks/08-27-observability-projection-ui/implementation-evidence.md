# Implementation Evidence

## Implemented

- Added strict Shared monitor mode, Run list, trajectory, inspector, cursor, and live notification schemas.
- Added a Core read-only observability query service over the existing Run/Event authority.
- Added operator-only WS state/list/trajectory/inspect/subscribe methods and post-commit live projection.
- Added `TAKI_MONITOR_MODE` to the Core config authority with default `DISABLED`.
- Added Desktop WsClient request/notification support and a conditionally enabled Home monitor surface.

## Automated evidence

- Shared typecheck and 349 tests passed.
- Core typecheck and 1,741 tests passed with one existing skip.
- Desktop typecheck and 433 tests passed.
- Desktop production build passed.
- Root lint, task validation, and `git diff --check` passed.
- Isolated Core boot passed with a fresh data directory, `FULL_LOCAL`, and a dedicated port. A real operator WebSocket
  authenticated and returned `observability.state={mode:FULL_LOCAL,enabled:true,detail:safe-local}` plus an empty
  bounded Run page; the temporary database and identity were deleted afterward.

## Formal-check fixes

- Added fail-closed list and trajectory cursor validation plus bounded keyset batch scanning for projection filters.
- Added connection-scoped subscription replacement, explicit unsubscribe, close cleanup, observer isolation tests, and
  durable-cursor recovery in the Desktop controller.
- Removed the Home monitor entry entirely while monitoring is disabled and subscribed the shell to live mode changes.
- Added semantic filters, Run and trajectory older-page controls, explicit inspector access, loading/empty/error/stale
  states, effect context labels, and generation-safe Desktop tests.
- Fixed sparse-filter pagination at the bounded scan boundary: a continuation cursor is preserved whenever the scan
  budget, rather than durable history, ends before the result set is exhausted.
- Added executable backend and frontend specs for monitor modes, cursor/backfill/live behavior, redaction, and
  generation-safe restoration.

## Acceptance and residuals

- The query service intentionally performs event/category projection predicates in bounded keyset batches; dedicated
  additive indexes remain a measured-volume optimization rather than a correctness dependency.
- The owner manually confirmed that primary chat, tool use, and the Monitor are functional. No blocking acceptance
  defect remains in this child.

## Post-acceptance owner feedback (2026-08-27)

The owner confirmed that primary chat, tool calls, and the Monitor are functionally usable, then identified three
productization gaps. These are follow-up work, not failures of this child:

1. **Reactive UI and streaming experience** — Perception and Monitor data should update while their pages remain open;
   Chat should expose the actual incremental order of assistant text, tool calls/results, and approval states. A future
   UI slice must unify lazy loading, refresh/stale/error states, generation-safe reconnect restoration, and tail-follow
   behavior instead of adding unrelated page timers.
2. **Useful DSH-style observability** — the current projection can only show facts already emitted by the Run Event
   ledger. A producer-first follow-up must add replayable model/provider, tool lifecycle, usage/token, context,
   timing, governance/approval, delivery, recovery, retry, and real cache-semantics events before presenting those
   fields. The UI must not fabricate missing metrics or expose raw sensitive payloads.
3. **Avatar tool and loop behavior** — the reported missing-argument behavior of `avatar_set_expression` requires a
   reproduction matrix across schema validation, execute result/throw, model-visible tool results, and next-step
   generation. The current fire-and-forget structured result and dynamic vocabulary are evidence about the existing
   contract, not proof of a general ToolLoopAgent retry bug.

The authoritative deferred entries are D67–D69 in `docs/deferred-decisions.md`; the global sequencing is recorded in
`docs/ARCHITECTURE-ROADMAP.md` and `.trellis/tasks/08-22-t4-agent-architecture-observability/research/phase-g-slices-gates.md`.
