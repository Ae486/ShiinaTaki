# W7 implementation checkpoint

## Current — W7 source handoff ready

- Complete W7 implementation is delivered in `w7-implementation.md`; consolidated W8 is the next owner step.
- Final source manifest: `w7-source-ownership.json`, 42 paths, SHA
  `3ec6c7c675ca41bc4c26883affc430282772dfa5800cdb3ee54e2a4aad05ce4f`.
- Core scoped group: 6 files/41 tests PASS; final projection/method rerun: 2 files/7 tests PASS.
  Desktop scoped group: 10 files/60 tests PASS; final real WS/DOM rerun: 2 files/2 tests PASS.
  Final root lint/types and Desktop Vite build PASS. UTF-8 without BOM and diff checks PASS.
- Final browser artifacts: `.trellis/.runtime/w7-browser-artifacts/eef3ca2f-9ca9-4c77-af80-fc244d7ea7e2/`.
  Exactly 3 explicit submissions; first page closed while original operation was running; second authenticated
  observer retained operation `07d9d8a9-5afb-4018-bb63-028df144255e`; no automatic replay or extra emergency Native call.
- No running tool sessions or owned test servers remain. No parent corpus/runtime evidence or Native changes.
- Latest source includes the current-authority historical label, safe emergency disclosure, real preclaim cancel,
  closed preview errors, pending-obligation fresh-submit block and configuration-sensitive original recovery.
- Read `.trellis/spec/frontend/memory-transitions.md` for the delivered contract. The preparation notes below are
  historical and superseded by this section and the implementation report. Do not restart their discovery or wait for W6.
- Remaining: leader's consolidated W8 and separately recorded owner/manual/original-environment acceptance.

## Authorization context

- Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
- Owner: `/root/w5_head_prefetch_implement`; parent: `/root`. One child only; no delegation.
- IMPLEMENTATION AUTHORIZED. Parent handed off complete W7 after W6 PASS on 2026-10-06.
  Shared/Core operator actions/status/reasons and Desktop client/controller/components/tests are owned here.
  W7 independent checking is consolidated into W8. Preserved corpus/runtime inputs and Native remain parent-owned.
- Verified worktree `H:/TakiAgent`, branch `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
  `.trellis/.runtime/sessions/codex_01a10bce-c98d-7930-a034-2842a2739758.json` currently names this task.
  Empty legacy `.current-task` is not authority. T4 and other worktrees were not used.
- Parent owns W6 rehearsal/runtime/corpus work and source freeze. Latest supplied bind-harness ownership manifest:
  `w6-bind-harness-source-ownership.json`, SHA `92b2bebb0f849b3e2c439977ca7f563f4fe932e72217fcb62c060a6ad29e4f71`.
  Do not edit that manifest or preserved runtime artifacts. W6 final JSON SHA:
  `96e9bac3dbd38ce31bccda83f6fbe7332c452983b13847eb2fdfa0894a28ddb7`.
- Read PRD/current curated context, `w7-implementation-brief.md`, `w7-check-brief.md`, relevant frontend specs and
  actual Shared/server/client/controller/card code. Trellis before-dev/continue context is already loaded.

## Historical preparation findings

| Current file/API | Findings and reuse |
| --- | --- |
| `packages/core/src/server/methods/memory-transition-methods.ts:13` | Authenticated operator `memory.transitions.preview` and `memory.transitions.status`; submit stays on `memory.operations.submit`. Both parse Shared results. Preview/status exceptions currently lose their specific closed reason. |
| `packages/shared/src/memory-transition-driver-schema.ts` | Preview params cover return/reenter/emergency and optional recovery transition ID. Healthy v1 requires identity/capability; emergency v2 has explicit eligible/refused, nullable expected, per-Bank evidence, backup age and unknown remote head/loss. Status is original transition + actual phase/banks/queue/runtime + recoverable. |
| `packages/core/src/memory/transitions/transition-healthy-status.ts:16` | Reads original intent/attempt/receipt/resolution and actual readiness across selected providers. `recoverable` currently checks terminal operation, nonterminal attempt and expired lease only. `nativeReleasePending` currently equals nonterminal attempt even for emergency. |
| `packages/core/src/memory/operations/memory-operation-kind-transition.ts:37` and `memory-operation-transition-storage.ts:46` | Actual cancellation permits only unclaimed original transition or unclaimed recovery; receipt/attempt ownership gates remain Core-owned. Recovered original obligations are not cancelled with a new unclaimed recovery row. |
| `packages/core/src/memory/operations/memory-authority-status.ts:69` | Composite status already exposes `operations.active` and `recent(20)` under Local or unavailable target. Hindsight-only evidence is separate. The UI currently renders only active rows; no transition action overview exists yet. Generic list supports bounded50 rows, with no pagination. |
| `transition-healthy-execution.ts:57`, `transition-emergency-service.ts:127` | Real phase/cutoff/proof/publication checkpoints already call `input.checkpoint(input.producer)`; the operation owner persists and emits `memory.operations.changed`. Reuse this channel; no polling or separate transition ledger is needed. |
| `apps/desktop/src/lib/ws-client-memory-operations.ts` | Typed generic operation methods parse every Shared response and memoize subscription per client. Missing transition preview/status wrappers. Extend this sibling or a small focused sibling, then wire through `ws-client-methods.ts`. |
| `apps/desktop/src/lib/rpc-deadline.ts` | Native json-rpc-2.0 timeout cleanup is the sole deadline mechanism. Unlisted methods default to interactive mutation. Preview/status are currently unlisted; generic submit/cancel also use the default. Development budgets:15s interactive,120s long. |
| `memory-operations-controller.ts` | Subscribe-before-read, current client+generation guard, serialized mutation, coalesced changed-push reads, and refetch on accepted/refused/lost outcome. Reuse these properties; no automatic replay or optimistic authority. Preview needs its own stale-response/confirmation identity guard. |
| `use-memory-operations.ts`, `memory-authority-state.ts`, `memory-authority-card.tsx` | Hooks own transport, pure view models own labels, components render shared primitives. Current cancel view supports admitted replica only; unknown label incorrectly assumes every unknown came from Core restart. Opaque IDs currently leak into some ordinary labels—new transition UI must use diagnostics. |
| `operations-page.tsx`, `hindsight-activation-card.tsx`, `storage-card.tsx` | Existing PageHeader/PageBody/PageCard/Skeleton/ActionButton/FeedbackLine and inline two-step confirm pattern. Keep initial onboarding/activation separate. Add a distinct transition card usable under Local/unavailable state; no unrelated redesign. |
| `windows/home/home-client-context.ts` | A page can be mounted with an actual authenticated WsClient and per-window timing accessor without starting the Tauri shell. Suitable owned browser harness seam for real DOM interaction; packaged WebView2/CSP remains separate. |

## Confirmed W7 backend integration work

Parent explicitly classified these as functional W7 work, not a performance project. No repair has been applied yet.

1. **Core-derived actions.** Add a small closed action projection for initial directions and historical recovery/cancel,
   using the same selected epoch, receipt, quarantine/foreign branch, configuration/baseline and unclaimed-operation
   predicates as admission. Candidate location: transition section in existing authority/status read, or a focused
   transition overview. Decide the smallest existing-read extension after W6 handoff. Do not guess availability in
   React from `mode === hindsight` or `operation.state === admitted` alone. Emergency must remain selectable despite
   an eligible hung old Hindsight operation, while unrelated Local exclusive work stays busy.
2. **Truthful status.** Emergency cannot claim a pending Native release. Keep healthy Native progress separate from
   emergency surviving evidence. Tighten historical recoverability so a quarantined/foreign/stale source cannot
   advertise recovery that its preview immediately refuses. Preserve actual COMMIT/runtime/queued-outcome separation;
   unknown totals stay null, and queue settlement is not blanket mutation success.
3. **Closed reason propagation.** Preview/status handlers currently catch everything as a generic refusal without
   reason. Preserve only approved closed configuration/capability/stale/foreign/unavailable categories through Shared
   and operator errors; no raw error/secret/hash/lease message. UI maps those to an actionable next step.
4. **Deadline classification and reattachment.** Explicitly mark transition preview/status reads as read-only timeout
   outcomes and transition submission as unknown on timeout. Prefer existing bounded timing classes, potentially
   parameter-aware classification for generic `memory.operations.submit`, preserving nontransition policy. Never
   add a second Promise.race over bare RPC or extend authority leases to satisfy a UI deadline.

## Actual timing evidence supplied by parent

- Current-source reused-corpus committed recovery preview ran `04:24:05.822Z -> 04:25:36.690Z`: **90.868s**,
  eligible, complete2Banks, remoteHead/remoteLoss unknown. This was direct Node, not an RPC/browser timing result.
- Recovery admission began `04:25:36.690Z`. At the parent's read-only `04:30:30Z` observation, original transition
  was generation4/revision11/binding; new operation `e030a150-0bad-4995-8924-446fdfb19ec5`, leaseUntil `04:34:05.325Z`.
  Exact submit duration was not separately instrumented. Do not report an invented208s admission measurement.
- This corpus's end-to-end recovery clearly exceeds120s. A long120s request class does not by itself prove timely
  submission ACK. W7 must exercise real client timeout/late response/reattachment and count actual submitted requests.
  Preserve one explicit request identity; after an unknown response, refresh Core history/observation rather than
  minting or replaying a request. The parent owns the final W6 measurements; consult them before deadline selection.
- Latest parent update: both audit boundaries passed with real heartbeat renewals; production bind passed in
  **178.354s** and the same transition reached settling with a renewed lease. This is bind timing, not submission
  ACK timing. Final W6 result/restart is still pending; it does not authorize W7 source edits.
- Avoid broad performance work. A specific unusable admission/read boundary can be addressed only with evidence and
  parent coordination; an unbounded UI timeout or fake success is not a fix.

## Planned implementation sequence after source handoff

1. Finalize additive Shared/Core action/status/reason contracts above and focused method tests using current W5/W6
   composed producers. Keep operation/candidate/authority engines and checked Native protocol unchanged.
2. Add typed Desktop preview/status wrappers and tested deadline policy. Extend/reuse the existing generic controller
   for read/submit/subscription ownership; keep transition preview identity and confirmation state in a focused
   controller/state module. Preserve last good status and reject stale preview responses on action/client changes.
3. Add `use-memory-transitions` and focused presentational transition card/confirmation/progress components under
   Operations. Normal switch preview has one confirm; emergency is a separate selected action and confirm. Refused
   emergency preview remains readable with disabled submit and no invented expected identity. Disclose backup age,
   surviving coverage and unknown remote loss plainly. Reuse existing theme/primitives and keyboard focus pattern.
4. Show current authority and historical transitions regardless of Local/unavailable runtime; retain original
   operation/transition mapping from Core active/recent/list. Explicit recovery uses a fresh server preview of the
   original transition, not the old request closure. Do not auto-trigger emergency or resubmit on reconnect/remount.
5. Add focused controller, pure state, component and actual WS producer integration tests. Use parent-verified
   `G:/anaconda3/python.exe` Playwright + installed Chromium in an owned temporary context for confirmation focus,
   double activation, loss/close/reconnect and two observers against an isolated Core/UI harness. No new dependency.
   Browser/Vite evidence is not packaged WebView2/CSP or owner/manual acceptance.
6. Run relevant Shared/Core/Desktop tests with at most2Vitest workers, root lint/typecheck, Desktop `pnpm --filter
   @taki/desktop build`, source indexes/specs and diff/encoding. Save `w7-implementation.md`; parent may consolidate
   independent review into W8. No commit/push/archive or source/runtime work until handoff.

## Focused regression obligations

- Unauthorized/unsupported/stale preview and confirmation; exact one healthy submit; separate emergency confirmation.
- Eligible/refused emergency v2 (expected:null) and missing/incomparable backup/head; no false zero-loss or zero-data copy.
- Core cancellation/recovery permissions, quarantine/foreign history, committed-but-unavailable target and queue conflict.
- Subscribe-before-read; coalesced real phase pushes; loading/read failure/last-good rendering; old generation responses
  and callbacks cannot overwrite new selection or preview.
- Lost submit response plus close/remount/second observer retains original durable operation and zero automatic replay.
- Preview/status read timeouts versus submission unknown, late RPC cleanup and actual measured client behavior.
- Real DOM keyboard confirm/cancel/focus and disabled controls; retain touched onboarding/activation/replica/backup tests.

## Historical resume instruction (superseded by the completed handoff above)

Wait for parent's explicit W6 readiness and source handoff. Then reread this Current section, the latest W6 result and
any final action/deadline decision. Do not repeat the completed discovery or touch preserved runtime/corpus inputs.
