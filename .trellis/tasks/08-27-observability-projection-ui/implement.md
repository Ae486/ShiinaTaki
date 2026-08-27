# DSH-style Observability Projection and Monitor Implementation Plan

## Protocol

This is one cross-layer Slice with one implementation agent and one final formal check agent. Do not split it into
separate backend/frontend children unless implementation evidence proves the context no longer fits the agreed Slice.
Every subagent prompt must be in English, state that YCE is disabled, require `jbcontext` for unknown semantic code
locations, and explicitly forbid spawning or delegating to any subagent.

The task remains planning until the owner reviews these artifacts and `task.py start` activates it.

## Preconditions

1. Verify cwd, branch, worktree list, HEAD, current task pointer, dirty files, and main drift.
2. Preserve the Heartbeat documentation changes already staged in this worktree; do not revert or mix Heartbeat
   production implementation into this child.
3. Read the child PRD/design, parent DSH/Phase D/E/G research, archived Slice 2/3/4 evidence, backend/frontend specs,
   and DSH trajectory/query reference files.
4. Recheck current Run/Event schemas, repository/index coverage, WS method/subscription patterns, config store, Desktop
   client routes, Home page registry, and shared page/state primitives.
5. If a migration is needed, inspect every live/synchronized registry before assigning the next version.

## Wave A - Shared Contracts and Read Model

- Add strict observability schemas for mode, filters, cursors, Run summaries, trajectory rows, inspector detail, and
  subscription notifications.
- Implement a deterministic closed presentation mapper with meaningful labels and `current/shadowed/log-only` rules.
- Extend repositories with bounded indexed query helpers and keyset pagination; add only proven additive indexes.
- Implement `ObservabilityQueryService` with Character/Run authorization, Run summary aggregation, trajectory replay,
  effect/attempt grouping, usage/timing/count projections, and bounded errors.
- Add schema, filter, pagination, projection determinism, privacy, corrupt-row, and restart/replay tests.

Rollback point: read-only Core code and optional additive indexes; no WS or UI surface enabled.

## Wave B - Operator Query and Live Subscription

- Add operator-only methods for mode/state, Run list, Run detail/trajectory, and inspector detail.
- Adapt the existing connection-scoped subscription pattern over `RunEventLiveBus`: authorize, backfill, attach live,
  dispose on close, and surface overflow/invalidation without touching Run correctness.
- Register the methods through one narrow composition seam in Core.
- Add method/role/schema/application-error tests plus live backfill, ordering, overflow, failure isolation, close,
  reconnect, and restart tests.

Rollback point: query methods can remain unregistered; ledger/Run behavior remains unchanged.

## Wave C - Mode Configuration and Desktop Client

- Add the closed monitor mode to the existing Core config authority, defaults, list/set validation, and `config.changed`
  propagation. Default is `DISABLED`.
- Extend Desktop `WsClient` request/notification contracts and generation restoration for monitor reads/subscription.
- Add a framework-free page controller/store that ignores retired-client reads/events, handles cursors and reconnect,
  and never persists monitor data to `localStorage`.
- Prove disabled mode hides the page entry and stops subscriptions while the canonical ledger remains intact.

## Wave D - DSH-style Home Monitor UI

- Add the conditionally visible Home page and registry/navigation integration.
- Build compact Run filters/list, selected Run trajectory, Attempt/effect grouping, older-page loading, search/filter,
  selection, and an inspector panel using shared page components.
- Render loading, empty, reconnecting, stale-live/overflow, error, and unsupported/corrupt states truthfully.
- Keep ordinary rows semantic and compact. Technical fields are inspector-only with labeled copy-diagnostic actions;
  do not render raw JSON as the main detail view.
- Add component/controller/navigation/accessibility tests. Build without adding a UI framework or icon dependency.

## Wave E - Integration, Documentation, and Acceptance Preparation

- Update touched `index.md` files and executable specs. Update roadmap/Handoff/deferred decisions only where evidence
  changes or completes a contract.
- Record later metrics/export/retention/Character aggregation and MCP/Skills presentation cleanup without widening the
  current Slice.
- Run isolated Core boot with monitoring disabled and enabled. Seed representative primary, Scheduled, Effect, Usage,
  Recovery, and failure Runs; query them through the real operator WS surface and verify live continuation/backfill.
- Build Desktop and prepare a concise owner manual acceptance checklist for mode visibility, readable fields,
  filtering, trajectory selection, inspector boundaries, live updates, reconnect, and disabled-mode disappearance.

## Verification

Focused tests cover Shared schemas; Core projection/query/authorization/pagination/rebuild; live WS commit-only,
backfill, cursor, overflow, failure isolation, disposal and reconnect; config mode transitions; Desktop retired-client
suppression, page visibility, states, filters, selection, older pages, inspector boundaries, and accessibility; plus
primary chat, Scheduled Task, Effect, Recovery, Timeline, config subscription, and Home navigation regressions.

```text
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/shared test
pnpm --filter @taki/core typecheck
pnpm --filter @taki/core test
pnpm --filter @taki/desktop typecheck
pnpm --filter @taki/desktop test
pnpm --filter @taki/desktop build
pnpm lint
git diff --check
python ./.trellis/scripts/task.py validate 08-27-observability-projection-ui
```

Run broader E2E/Rust checks if Shared protocol or existing cross-process surfaces are affected. Operator-only monitor
methods require no Rust serde mirror unless the Shell becomes an actual consumer.

## Final Formal Check

One xhigh check agent reviews scope/no-second-authority, DSH fidelity and Taki adaptation, schema/query/cursor
correctness, restart/live isolation, privacy/modes/authorization, ordinary versus inspector fields, Desktop reconnect/
states/accessibility, tests/docs/migrations, unrelated diffs, and residual risks. It must not spawn or delegate to any
subagent. Fix blocking findings before commit. Commit/archive only after owner authorization; do not push.
