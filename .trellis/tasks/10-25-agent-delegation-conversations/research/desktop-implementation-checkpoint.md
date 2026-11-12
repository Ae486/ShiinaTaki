# Desktop implementation checkpoint

## Recovery and authority

- Active assignment: S6 for `10-25-agent-delegation-conversations`, continuing the actual inherited Desktop edits.
- Verified workspace `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.
- Global `.current-task` still names the missing Avatar lab; the coordinator supplied the explicit current task path.
- Read task requirements/design/plan, UI research, implementation interfaces and relevant frontend contracts.
- Preserved live Desktop preimages under `research/desktop-preimages-20261025-resume/` before edits.
- Existing shared composer extraction and main/child adapters are retained. No Git delivery, dependencies, real-user data or other worktrees are authorized.

## Current milestone

- In progress: continuous newest/older/newer private projection, shared transcript frame and sender labels, per-target drafts, selected-child activity and exact control mapping.
- Runtime owner requested to supply complete batch references / native item identity and bounded long-body read contracts; the initial schema alone cannot prove complete UI handoff at a page boundary.
- Fresh intermediate checks: focused existing Desktop set passed 29/29; subsequent private feature set with new conversation paging/projection tests passed 22/22. Scope is deterministic Vitest only.
- Focused ESLint passed before the later body/recovery additions. First Desktop typecheck exposed fixture/API drift; corrected the production callback/sender issues and later test `ownerRef` mismatch. Final checks remain pending.
- Native rendering and owner acceptance are not claimed; coordinator owns the actual relay/Core smoke harness.

## Implemented surfaces at the current milestone

- `subagent-controller/state`, `subagent-conversation-pages`, `subagent-drafts`: newest/older/newer coherent projection; exact work targets; accepted-input echoes; retained revision-bound drafts and unknown-outcome no-replay guard; complete digest-fenced long-body reconstruction.
- Shared Chat `timeline-view`, `use-timeline-scroll`, `timeline-message`, `chat-transcript`: narrow reusable presentation contract, per-conversation reading positions, trusted sender/source labels, shared Markdown/tool cards and explicit full-body action.
- Private `subagent-detail/composer/conversation-header`: one continuous viewport; running asynchronous input plus Stop; user-stopped Continue/Send-and-continue uses one authoritative RPC.
- `use-subagent-activity`, `subagent-conversation-transcript`, `subagent-message-projection`: shared real stream recovery adapter with private selected-child transport, batch coverage and native item identities.
- Desktop `ws-client-subagents`, routes/client registration and `ws-client-subagent-inbox`: parsed Shared conversation/body/activity/recovery RPCs and isolated activity push.
- Compact `subagent-inbox-controller`, hook and panel: explicit parent handling recovery on the existing page; no new page or polling.
- Semantic delegation tool details/navigation reuse the existing tool-card seam.

## Still in progress

- Final edge-case pass for disconnected/live handoff and partial body previews; current native UI readiness has not been announced.
- Add focused draft/recovery/wire tests, rerun Desktop typecheck/lint/test/build, update touched directory indexes/spec.
- Coordinator native E2E plus owner visual/manual acceptance remain distinct gates.

## Final Desktop handoff (2026-10-25, source freeze for native verification)

### Delivered

- Continuous private Chat presentation across work/Run boundaries, true user/parent/Core/worker labels, accepted-input
  echoes, exact input-wait replies, report placement and semantic delegation navigation.
- Newest/older/newer pagination with retained reading windows, manual/automatic prepend anchors and per-conversation
  restoration. Full native batches preserve stream item keys and do not retire live items on the first durable row.
- Full digest-fenced body reads, explicit preview/failure UI and retained complete bodies across ordinary refreshes.
- Per-child/work drafts retain exact targets, revisions and submitted operation keys; newer edits survive an accepted
  older submission. Reconnect does not replay mutations, and a matching accepted input can reconcile an unknown send.
- Running asynchronous input plus Stop; user-stopped empty Continue and nonempty Send-and-continue submit one Core
  continuation. No child image input was added because the existing child RPC supports text/materials only.
- Selected-child real activity adapts the shared recovery reducer/coalescer, unsubscribes on hidden/rebind, and retains
  already observed pending content across connection replacement or a later Run until canonical coverage is available.
- Compact explicit parent inbox recovery on the existing page, with fresh Core resumability/reason, same-operation
  idempotent readback on an explicit retry, and no automatic execution during reads or reconnect.
- Updated touched folder indexes and the existing frontend Chat feedback specification.

### Final checks at this slice boundary

| Check | Result |
| --- | --- |
| `pnpm --filter @taki/desktop typecheck` | Passed on current frozen source |
| `pnpm --filter @taki/desktop test` | Passed: 210 files, 1,251 tests, 23.28 seconds |
| Focused ESLint over subagents, shared Chat, child page, changed WS modules and owned fixture | Passed on current frozen source |
| Focused private/Chat/wire suite before the final retention helpers | Passed: 20 files, 119 tests |
| `pnpm --filter @taki/desktop build` | Passed before final small retention/anchor helper changes; existing >500 kB chunk advisory remains. Coordinator final immutable native build is a separate gate. |

### Changed file ownership

- `apps/desktop/src/features/subagents/`: controller/state, drafts, continuous page/body read owner, message/live
  projections, shared-frame detail/composer/header, selected activity adapter, semantic tool display, explicit inbox
  recovery controller/hook/panel, associated focused tests and `index.md`.
- `apps/desktop/src/windows/home/pages/chat/`: narrow timeline presentation contract, sender/body/navigation rows,
  retained scroll anchors, semantic delegation formatter registration and `index.md`. Inherited shared composer and main
  adapter remain in place.
- `apps/desktop/src/windows/home/pages/subagents/`: continuous viewport layout and recovery disclosure; index updated.
- `apps/desktop/src/lib/`: child conversation/body/activity/inbox RPC adapters, isolated push registration and index.
- `apps/desktop/test/subagent-conversation-fixture.ts`: dedicated focused-test helper. Coordinator retains ownership of
  existing native harness and S7 fixtures.
- `.trellis/spec/frontend/foreground-chat-feedback.md` and this checkpoint.

### Remaining gates and limits

- Coordinator is running the actual frozen-source native WebView2/Core/WS-relay scenario. This slice does not claim
  native or owner acceptance, paid-provider behavior, real-user database changes, Hindsight validation or T4/main DB convergence.
- Private drafts/read positions remain window memory only; closing the entire Home window intentionally drops disposable
  state and does not stop child work. Historical ordering uncertainty remains explicitly disclosed.
- No Git commit, push, archive, dependency installation, Core/Shared edit or other-worktree modification was performed
  by this Desktop worker. Temporary size overruns were authorized by the owner; current focused lint nevertheless passes
  without new size suppressions.

### Native follow-up correction

- Coordinator's native harness exposed a send-button timing window while another child produced progress. Independent
  source verification confirmed all same-Character invalidations were clearing the selected detail's freshness.
- Narrowed detail invalidation to the addressed selected child; unrelated children continue refreshing the list only.
  Added a controller regression holding the unrelated list read pending while the selected child accepts Send.
- This is a product correction prompted by native observation, distinct from the coordinator's separate atomic click
  improvement. Follow-up targeted checks are recorded by the final worker report.
- Follow-up controller checks passed: 13/13 focused tests and scoped ESLint. Runtime separately corrected the observed
  early sidecar race: active unmapped native step rows/events remain outside the continuous projection until sidecars
  persist, then the existing invalidation announces them. This required no Desktop schema change; Runtime owns its
  3-file/7-test evidence and the coordinator owns the next native run.

### Bounded private activity correction (in progress)

- Verified the independent P2 reproduction: obsolete terminal snapshots stay retained while canonical entries are
  previews, and the original cross-Run map had no aggregate budget.
- Saved the live owned source preimages in `research/desktop-preimages-bounded-live/` before editing.
- Added a window-wide retention budget (4 snapshots / 4 MiB serialized retained view+metadata) that refuses new live
  admission with explicit capacity state instead of evicting already displayed text. Selected-child scope still
  controls what is rendered; hidden children count against the same additional-live-memory budget.
- Added bounded recovery planning for terminal/obsolete canonical bodies: at most 4 entries / 256,000 characters per
  read-only pass. Hook/controller integration and repeated-run/failure/reconnect checks are in progress.
- No new acceptance is claimed at this intermediate point; prior native7 evidence predates this correction.

### Bounded private activity correction delivered

- Added `subagent-activity-retention.ts` for window-wide count/serialized-byte admission. Capacity exhaustion keeps
  all previously displayed retained snapshots and replaces the unadmitted current observation with explicit
  unavailability; the selected-child subscription is retired until read-only recovery or explicit retry.
- Added `subagent-activity-hydration.ts`; integrated terminal/obsolete Run recovery with the existing controller and
  canonical `SubagentConversationPages.expand` cache. Each automatic pass is serialized and bounded to 4 entries /
  256,000 characters, including a body accumulator guard. Input/draft/control authority is unchanged.
- Failed body identities remain blocked from automatic same-content retries. Connection replacement or explicit
  `Retry live recovery` starts a new read attempt. Oversized bodies keep the existing explicit full-body action.
- Retained positions are scoped to the actual snapshot items; the window budget includes snapshots from hidden
  children, so navigation cannot bypass the limit. The Core unavailable case also keeps previously observed text.
- New regression tests cover six 21.6-KB-shaped completed Runs without manual body reads (18 bounded body requests,
  zero additional retained snapshots after each complete batch), first-row incomplete handoff, eight Runs with failed
  hydration (original four snapshots retained without eviction), aggregate byte overflow, oversized automatic reads,
  reconnect/idle retention and retired body reads.
- Latest checks: Desktop typecheck passed; private/Chat/wire suite passed 125 tests in 22 files; Vite build passed with
  the existing large-chunk advisory. Scoped lint is rerun after a numeric hook-only size exception (85-line ceiling)
  under the owner's explicit temporary-overrun authorization. All non-size rules remain errors.
- Native7 remains pre-correction evidence. Coordinator must rerun native acceptance against this source. A terminal
  long reply within the recovery budget may already be fully expanded automatically, which is intentional; manual
  full-body UI checks should accept that state or use a body larger than the automatic pass budget.
- Final scoped lint and `git diff --check` passed after the numeric hook-only exception.
- Actual reproduction recheck (Node v24.18.0, real ChatAgent/installed SDK/SQLite fixture, scripted local model): six
  same-child ~21.6-KB Runs, six model requests and 24 canonical body pages. Each Run went from one additional retained
  snapshot before hydration to zero after hydration; canonical rows grew 3/6/9/12/15/18 with zero remaining previews,
  no capacity degradation in the successful path, and no fixture errors. This executed the exact retention planner and
  canonical page/body owner, not a rewritten reducer. Machine-readable evidence:
  `research/desktop-bounded-live-native-probe.json`. React/WebView lifecycle verification remains the coordinator's
  final native rerun; this fixture evidence is not relabelled as native UI acceptance.

## Ownership

- Desktop feature, shared Chat presentation/controller adapters, Desktop WS routes and focused tests/docs belong to this worker.
- Core/Shared changes belong to runtime/context owners. Coordinator owns native E2E integration and final acceptance evidence.
