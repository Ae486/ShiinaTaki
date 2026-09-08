# Visual continuity design

Approved direction: the owner's 2026-09-08 "允许推进" accepts the preceding class-wide behavior proposal and asks to use React's own capabilities. The implementation below refines that same scope; it does not require a new product decision.

## State and rendering ownership

Use the existing React hooks/controllers and Zustand domains. React batching and reconciliation preserve a stable committed tree when the application supplies a coherent snapshot and stable identities. Keep request metadata separate from displayed data; no mirrored rendering cache, duplicate hidden tree, new query library, or forced response delay.

`startTransition` is not a data-retention mechanism. In this application, a controller updates its imperative state before notifying React. Deferring every notification could leave old DOM dispatching actions against a newer controller target. Prefer ordinary complete `useState` snapshot commits. Use concurrent scheduling only for an independently safe, measured expensive derived view; do not add it merely to claim framework usage. The external API rationale is recorded in `research/react-continuity.md`.

## Monitor target transitions

Separate the requested target from the displayed/committed Run and Inspector. A same-authority selection starts a bounded candidate read without destroying the currently committed snapshot. A successful current candidate publishes its matching identity, initial trajectory and associated detail reset in one notification. The existing warm restore path is only for the same committed Run: it must never merge A's rows/cursor into B.

- Latest requested target wins across A/B/C; request epochs, client identity, Character, visibility and explicit close invalidate candidates.
- Repeat-click deselection and explicit close remain deliberate immediate actions.
- Keep titles, row highlights, Inspector fields and action targets coherent. An action originating from a displayed old record must not be redirected to a pending new record.
- Background restoration, ordered live rows, older-page cursors, summary refresh and reading anchors retain their existing owner/guards.
- Authority loss, disabled monitoring and actual unavailable/deleted data clear the relevant content immediately. A generic failed target change must not leave an eternal loading indicator.
- Key the per-Run workspace by the committed Run identity, not the request identity. A different Run may intentionally reset Run-local filters/anchors when it commits; ordinary refresh must not.
- Inspector fields and their record metadata commit together. A refresh of the same detail retains its mounted content.

## Small shared pending indication

Add `components/ui/pending-indicator.tsx` with `PendingIndicator({ active, label, className? })`.

- `active` is the real pending signal. A presentation-only 250 ms one-shot suppresses fast flash; completion is never delayed.
- The component always reserves the same small inline slot. After the threshold it exposes an accessible, subdued indicator; idle/fast completion paints nothing.
- Timers clean up on active changes/unmount. No data read, retry, cache lifetime or truth state is driven by this timer.
- Respect reduced motion. An immediate `aria-busy` remains available on the controlled region/control.
- PageHeader and the shared ActionButton busy affordance reuse it. Button labels remain stable while busy; disabling remains immediate.

Adopt the same primitive in the extension strip, permission/saving surfaces, Skill inspection and Monitor's relevant controls. First-load placeholders and genuinely long-running operation results remain semantically distinct.

## Perception layout

The controller already retains a populated card during ordinary invalidation. Preserve that behavior and its privacy authority checks.

- Remove the normal-flow refreshing paragraph from Privacy Pause; use the card header's existing action slot for pending indication.
- Replace the transient sampling warning block with a compact header status. Its tooltip/accessibility text retains the meaning of an unconfirmed previous snapshot. Ordinary pending work uses the delayed indicator; a settled failure/gap keeps a visible persistent qualification.
- Keep an invariant content structure and stable activity identities. Do not add `memo` everywhere or manual DOM updates: React can patch the existing rows.
- Verify actual before/during/after row nodes, card rectangles, scroll and empty-state transitions in a rendered environment. A legitimate successful empty response must be displayed, not hidden behind old data.

## Transient notification ownership

Extend the existing `components/toast` implementation, preserving its fixed overlay placement, four-item cap, text selection and dismissal behavior.

- Add success/warning tones using existing tokens and an optional opaque notification/attempt key for active-queue deduplication. Keep existing `pushToast(message, tone?)` callers working.
- Default unpinned notifications retain the existing 6-second lifetime. Existing deliberate click-to-hold behavior is an A4 reading affordance, not the cause of the user's permanent inline success banner; preserve it unless a concrete accessibility correction is required. Hover/focus must not let a notice disappear while being read or operated.
- Deliver outcomes once from the owning action/completion seam. Where a hook consumes an outcome, guard StrictMode/effect re-execution and remove/consume its transient state; repeated list reads must not replay success.
- A later distinct attempt may notify even with identical text. Do not globally suppress a message string forever. Retired-client results remain suppressed by existing owners.
- Keep field validation, unsaved draft/conflict affordances, partial-commit diagnostics, unavailable capabilities and useful operation result details at their owning views. A transient notification must not hide the only available retry or lasting error explanation.

Scope: permission actions and generic config save feedback; MCP mutation outcomes; character import; media clearing; already-existing Chat consumption/dismissal parity. Skills validation output and memory tidy results remain actual content, not expiring toasts.

## Shared interfaces and ownership

- Root owns `pending-indicator`, shared PageHeader/ActionButton, Perception, extension strip, Skills loading affordances, cross-page rendered regression fixtures, task/spec documentation and final native verification.
- Monitor implementer owns `pages/monitor/` and its colocated tests/index.
- Feedback implementer owns `components/toast/`, Settings feedback/busy call sites, MCP feedback/busy call sites, Costume/import and Operations feedback/busy call sites with their tests/indexes.
- Existing dirty `apps/desktop/tsconfig.json`, `vite.config.ts`, Lab/OpenBili, parent task metadata and unrelated docs are outside ownership.

## Verification and operational impact

Start with failing controller/UI regressions for clearing and duplicate/sticky feedback, then retain them through fixes. Test candidate races, close/deselect, failed reads, retired clients, current empty results, notification consumption and real pending signals. Static renders prove content/attributes, not timers or browser geometry.

Use a disposable synthetic RPC fixture and frozen production Home assets for browser/WebView verification, with separate ports/profile from the owner's live Core (8974) and Desktop dev server (1420). Do not stop or repoint the owner's processes. Record actual source/build versions so renderer evidence matches the reviewed source. No environment/config/schema migration or deployment is required; reverting this task's frontend files restores the prior presentation.
