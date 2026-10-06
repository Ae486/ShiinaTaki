# W7 minimal usable Home handoff

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Exact cwd: `H:/TakiAgent`; branch: `main`. Resume complete W7 from `research/w7-checkpoint.md` once dispatched.

Preparation only. Dispatch after W6 functional readiness and the leader's risk-based predecessor gate. Final checked W4-W6 status/action/
preview APIs take precedence over provisional names. This brief does not claim a usable transition UI yet.

## Scope and ownership

Implement W7 from `implement.md`: Shared/operator preview/status wiring, Desktop client/controller/state/components,
single healthy confirmation, separate emergency confirmation, durable operation observation and necessary regressions.
Reuse existing Operations layout and controls; no unrelated visual redesign or new dependency. W8 owns final review.

You are not alone in the codebase. Preserve all existing changes, do not revert others and do not spawn agents.
One whole-wave implementer owns W7; the leader may consolidate its independent review into W8 where the actual
changes and risk permit. Keep focused checks on admission, observation and recovery boundaries. Prioritize
functional completion and correctness; defer non-blocking performance work. Parent owns requirements/cross-wave decisions. Verify only
`H:/TakiAgent` (branch `main`), initial HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`, worktrees and actual session task pointer
`codex_01a10bce-c98d-7930-a034-2842a2739758` for `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Verify the live binding rather than relying on a historical session ID.
Never use T4. Native is a checked dependency; report a concrete API/producer gap rather than editing it silently.

Read root instructions, trellis-before-dev, relevant frontend/Shared/server specs, PRD/design/implement and final
W0-W6 reports. Use applicable frontend skill guidance while preserving this existing product's components, theme,
information structure and interaction conventions. Shared changes precede consumers; update touched indexes/specs.

## Existing source seams

- `packages/core/src/server/methods/memory-operation-methods.ts`: operator-only submit/status/list/cancel/subscribe;
  connection-scoped changed pushes and sanitized closed refusals. Reuse this authority rather than a UI-only ledger.
- `apps/desktop/src/windows/home/pages/operations/memory-operations-controller.ts`: subscribes before reads,
  serializes mutation admission, refetches after every accepted/refused/lost outcome, coalesces pushes and ignores
  retired client generations. It currently has no preview method; extend/adapt without weakening those properties.
- `memory-authority-state.ts`: pure node-testable projection and closed labels; current cancellation offers only
  admitted replica.sync. Use actual new Core action availability/stage instead of making every transition cancellable.
- `operations-page.tsx`: shared PageHeader/PageBody/PageCard/Skeleton and separate Local/activation/authority cards.
  Hooks own WebSocket calls; keep presentational components free of transport and authority derivation.

Inspect actual final W6 source before edits. Transition state/actions must be available while Local is selected or
the committed target runtime is unavailable; do not hide them behind a live-Hindsight-only guard.

Parent source check during W6 continuation: the exact methods are `memory.transitions.preview` and
`memory.transitions.status` in `memory-transition-methods.ts`, with Shared preview/read schemas. Add their typed
Desktop client wrappers and explicit deadline classifications: current `rpc-deadline.ts` falls back to an
interactive mutation for unknown methods, which would misclassify preview/status timeouts. Current generic submit
also uses the interactive mutation default; retain unknown-outcome/no-replay semantics. Measure the final repaired
real-data behavior before choosing a bounded existing timing class. The pre-context-repair actual driver spent
roughly84s in emergency preview and178s in synchronous recovery admission; direct Node calls do not establish a
usable browser RPC path. Verify timeout/lost-response/reattachment on the actual client path and do not invent a
successful UI result or extend production authority leases. No general performance project is requested here.

## Interaction contract

Core supplies current source/target, complete preview identity, readiness/refusal and allowed actions. A user opens
the normal switch preview and confirms ONCE; Core performs all required phases. Do not add confirmation for each Bank,
maintenance phase or queue item. Initial Local onboarding and first Hindsight activation keep their distinct flows.

Emergency is a separately selected action with its own preview/confirmation. Show last verified backup age, known
local evidence and unknown missing interval in plain language. No verified backup does not imply no surviving data;
equal local cursor numbers do not prove zero unseen loss. Never auto-select emergency after a failed healthy attempt.
The W6 version2 emergency preview distinguishes `takeover: eligible` with an exact non-null `expected` identity
from a safely refused preview with `expected: null`, per-Bank evidence and explicit blockers. Display the latter's
disclosure without enabling submission or fabricating an identity. Verify the final Shared schema before coding;
healthy previews retain their existing mandatory identity and capability proof.

Render source authority, actual phase/Bank progress, committed runtime availability and admitted-intent outcomes as
separate facts. Switch completion does not label every queued mutation successful. Unknown totals stay unknown;
show a determinate progress value only when a real producer supplies its denominator. Keep hashes, leases and native
request internals in diagnostics. Give actionable copy for conflict, capability/config absence, stale preview,
pre-COMMIT failure, committed-but-unavailable target, unresolved result and permitted recovery/cancellation.

Handle loading/empty/error/accepted/success states, keyboard focus and accessible confirmation controls using current
components. Disable unavailable or pending controls from actual state. Avoid UI inference that a click/HTTP success
changed authority or that disconnect cancelled Core work. Local status refresh must not issue a mutation.

Keep request/preview identity stable for its one explicit submission. A timeout/lost reply, reconnect, remount,
observer replacement or closed initiating Home must never automatically replay it or mint another operation.
Reattach observation to Core history. A second authenticated Home sees the same operation and can use only the
current allowed recovery action. Late responses/pushes from old socket generations cannot overwrite the new view.

## Validation and delivery

Test pure state/controller and real operator method integration: unsupported/unauthorized/stale request, one normal
confirmation, separately selected emergency confirmation, initial/loading/error/unavailable/unknown states,
cancelability at actual boundaries, lost submit response, initiating Home close, second observer and late retired
client replies. Assert submit counts and immutable operation identity, not only rendered text. Cover transition
history under Local and unavailable target. Do not mock a successful producer in place of the composed W5/W6 path.

Run targeted Shared/Core/Desktop tests with at most two Vitest workers, root lint/typecheck and Desktop build.
Exercise the actual available UI/runtime test tooling for key flows; report any environment limit rather than claim
manual/visual acceptance. No new dependency or original-user authority switch. Existing onboarding/activation,
replica and backup controls remain covered where touched.

Parent preflight on2026-10-06 verified an already installed browser runner: `G:/anaconda3/python.exe` imports
`playwright.sync_api`, and its Chromium executable exists at
`G:/AppDataMove/ms-playwright/chromium-1181/chrome-win/chrome.exe`. A subsequent owned headless smoke launched
Chromium139.0.7258.5, exercised a local button focus/Tab operation and closed the context/browser successfully.
No dependency was installed. This verifies runner availability only, not application behavior or network isolation.
Use an owned temporary browser context against the isolated final UI/runtime for actual confirmation, focus,
lost-response and second-observer interaction checks. Existing React static-markup tests cannot prove those DOM
behaviors. Browser/Vite evidence does not alone certify packaged WebView2/CSP behavior; keep that distinction explicit.

Deliver `research/w7-implementation.md` with actual files/APIs, behavior, commands/results and limits; keep
`research/w7-checkpoint.md` before compaction. No commit/push/reset/rebase, finish/archive or inferred owner/manual
acceptance. Owner-facing communication is Chinese; engineering docs/comments are English.
