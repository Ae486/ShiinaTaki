# UI motion continuity and layout stability — 2026-09-05

Status: design within the ongoing UI/UX grill. The owner confirmed the Pet tool-exit boundary and
required smooth appearance, disappearance, and layout changes across UI surfaces. The owner delegated
the detailed motion design. The choices below are the design baseline for implementation review;
they are not claims about shipped behavior or new visual acceptance.

Parent decisions: [G2/G3/G5 and the scope boundaries](uiux-grill-2026-09-05.md). Retain the accepted
non-Monitor visual foundations. G5 requires Monitor to follow DSH's presentation and behavior; this
motion contract applies to that port as well. Task ownership remains unchanged. This document does
not activate an implementation task or add a UI library.

## 1. Outcomes and terminology

- **Layout stability:** inserting/removing content does not abruptly move an existing reading target.
- **Enter/exit and layout transitions:** appearance, disappearance, occupied space, and necessary
  movement form one continuous change; opacity alone cannot prevent a layout jump.
- **Object continuity:** an existing text segment remains the same visible object, with its content,
  selection, and identity preserved while adjacent elements change.
- **Scroll anchoring:** reading older content remains under user control when live content changes.

These are acceptance requirements for changing states, not an instruction to animate every element.
Correct state, prompt feedback, stable controls, and comfortable reading take priority over decoration.

## 2. Pet bubble lifecycle and placement

G3 retains separate text bubbles across tool invocations. A tool bubble appears below earlier content,
shows the readable tool name, and remains until the next language segment begins or the turn ends.
Actual tool completion immediately stops any execution indicator. Its remaining visual presence must
not claim that the tool is still running. Full Chat retains the canonical tool history under G2.

Use a top-anchored transcript region: additions and removal of the trailing tool bubble change the
tail, leaving earlier text bubbles in place while content fits. Keep the outer interaction frame and
composer controls stable while the bubble is open. Constrain transcript growth to the space available
inside the existing Pet window; scroll inside that region instead of resizing the native window per
delta. Reserved transparent space must remain click-through; only visible bubble/control surfaces
participate in the existing interaction hit-test contract.

### Transition recipes

| Transition | Visual and layout behavior |
|---|---|
| A language segment starts | Create one text bubble; fade in with at most 4px of vertical travel. Subsequent deltas update this bubble without replaying its entrance. |
| A tool starts below text A | Add a separate tool bubble at the tail. Allocate its bounded row space and reveal it; A's top anchor remains unchanged. |
| A tool completes, before the next text | Keep the name bubble in place under G3a. End the busy indication from the real outcome, independently of animation. |
| Next text B starts | Crossfade the outgoing tool bubble and incoming B inside one temporary layout envelope. Transition from the old occupied height to B's measured height without collapsing through zero. A remains separate and anchored. |
| The last tool exits at turn end | Fade its content and smoothly release its occupied height and spacing. With no successor, leave no lasting blank placeholder. Earlier text bubbles remain separate. |
| An error ends the turn with no following language reply | Show one G3c error bubble containing the error message, keeping earlier text bubbles. Use the coordinated entry/space transition; add no action inside the error bubble. |
| Text wraps while streaming | Grow the current bubble from real content. Coalesce size updates; do not animate individual characters or restart the bubble entrance on each delta. |

The layout envelope is only a visual coordinator. Tool and text nodes keep distinct semantic
identities; a tool record must never be repurposed as an assistant message. Incoming text is applied
as soon as it arrives, including while a prior fade is running. Execution, ingestion, persistence,
and text delivery never wait for an animation to finish.

### Coordinating occupied space

An outgoing row remains measurable during its exit. Its content may fade before its outer box is
released. Include padding, borders, and inter-row spacing in that release: shrinking a row to zero
while leaving a parent `gap` until unmount would still cause a final position jump.

When content exists below a departing tool row, move that content continuously as the occupied space
contracts. Do not remount or fade the whole stack. When the next text replaces a trailing tool row,
use one combined transition rather than a remove-to-zero followed by a second insertion.

Choose restrained motion defaults, centralized with the existing duration tokens:

| Motion | Initial design value |
|---|---|
| New bubble content | 150ms, opacity plus 0–4px translation |
| Departing content | 120ms opacity fade, no text scaling |
| Occupied-space/position change | About 200ms, ease-out, no bounce or overshoot |
| Tool-to-text handoff | Overlapping fades within the same layout transition, not two queued full animations |

These are tuning defaults, not artificial loading delays or performance guarantees. Reuse existing
`--duration-fast`/`--duration-base`; introduce a common layout duration only in an approved implementation
if needed. Tune in the actual WebView2 window without asking the owner to select easing curves.

## 3. Scroll, rapid updates, and cancellation

- When content fits, the earlier language bubbles do not move during trailing tool insertion/removal.
- While the user follows the tail, keep new content readable and coordinate scrolling with the same
  geometry change. Do not start a new smooth-scroll command for every token.
- Once the user scrolls up or reads/selects older content, retain the reading anchor and stop tail
  following. New data must not pull the view down. If scroll-range or window bounds make an exact
  anchor impossible, reconcile continuously rather than snapping at the end of a fade.
- Key text segments and tool invocations by stable identities. A new event retargets an in-progress
  transition from its current geometry; it does not append a backlog of animations or restart A/B.
- Rapid consecutive or concurrent tool events must keep their actual identities and outcomes. Never
  hold the turn open just to make every short invocation spend a minimum time on screen. Detailed
  multi-tool combinations must follow the G3 identities and lifecycle; terminal errors use G3c.
- Closing the bubble, switching character, replacing the client/turn, or hiding the document retires
  obsolete visual work. A late animation callback cannot reopen a bubble or erase a newer segment.
  Reappearance shows the current view without replaying a queue of missed entrance animations.
- Cancelled, failed, or disconnected execution settles from real lifecycle facts. G3c uses one
  message-only error bubble for a terminal error without a following language reply; do not retire it
  as an ordinary transient tool bubble. Approval behavior remains under its existing contract. D77
  separately tracks cause/code/message quality; animation cannot classify an unknown error.

## 4. Shared rules for the other UI surfaces

Apply the same outcome to relevant changes in G1 and to later frontend work. G5 explicitly requires
the DSH-led Monitor rebuild; it does not authorize an unrelated visual rewrite of the other pages.

| Surface/change | Required continuity |
|---|---|
| Monitor Inspector and detail disclosures | Opening/closing keeps the selected record and reading anchor. Pane-space changes and disclosure height settle together; no intermediate empty full-page state. Explicit dragging follows the pointer directly, without easing lag. |
| Monitor live rows and counters | Update stable rows in place. Reserve sensible numeric/status widths; a counter update does not remount the ledger, reorder the selected Run, or move the viewport. Real state/selection correctness is a prerequisite, not something motion can repair. |
| Chat live-to-persisted handoff | Retain the same visible content and position, deduplicate tool identity, and avoid a second entrance or duplicate flash when durable records arrive. |
| MCP/Skills cards and expandable details | Animate the local occupied space and affected neighbors, preserving selection and the operator's place. Avoid whole-list entrance replay after a local refresh. |
| Loading, error, and refresh | Use placeholders with the expected content shape for cold loads; keep last-good content during refresh when its contract allows it. A refresh does not clear and rebuild the entire page. No invented loading duration. |
| Pending buttons and form feedback | Reserve label/icon space so status changes do not move neighboring controls. Keep focus and pointer targets stable; success/error feedback reflects the actual operation. |
| Toasts and connection banners | Release toast space with its exit; an invisible exiting layer cannot intercept clicks. Preserve the existing overlay/reserved-space connection banner behavior. |
| Dialogs | Keep focus containment and restoration, close policy, and approval authority intact. Animation does not create an automatic approval response or an extra dismissal path. |

## 5. Implementation constraints to carry into batch design

- The [Home window contract](../../../spec/frontend/home-window.md) requires CSS-driven Pet overlay
  animation. Use CSS transitions/keyframes with finite, event-driven presence bookkeeping and bounded
  measurements; no new JavaScript animation timers, continuous measurement loop, or animation package.
- Prefer opacity/transform for visual movement. Limit actual height transitions to the small changing
  occupancy wrappers; do not animate the geometry of an entire long ledger or scale readable text.
- Observe natural content size only where needed; do not create a feedback loop by measuring the same
  animated outer box every frame. The measurement/presence code stays local until actual reuse warrants
  an extraction under the existing size/responsibility rules.
- Separate semantic state from `entering/present/exiting` presentation state. Completion/cancellation
  cleanup is identity-guarded, idempotent, and correct even when the usual end event does not arrive.
- Honor the existing CSS `prefers-reduced-motion` rule. Reduced motion skips travel and extended size
  interpolation while preserving identity and reading anchors. Reduced/zero-duration animation,
  visibility changes, and cancellation must settle without a timer or mandatory `transitionend`.
- Retired visual nodes are excluded from focus, actions, and repeated accessibility announcements.
  Reserved or invisible Pet geometry must not become a new desktop input-blocking rectangle.
- Follow [read-model scroll/visibility rules](../../../spec/frontend/reactive-read-models.md),
  [state ownership](../../../spec/frontend/state-management.md), and
  [quality constraints](../../../spec/frontend/quality-guidelines.md). Motion creates no event,
  persistence, approval, or execution authority.

Current implementation anchors: `apps/desktop/src/features/chat-bubble/chat-bubble.tsx` has one reply
area; `chat-bubble-store.ts` stores a single reply text; `apps/desktop/src/styles.css` has 120/150ms
tokens and reduced-motion handling. The new segmented lifecycle and coordinated layout are design
work still to implement, not behavior proven by those existing files.

## 6. Verification to include in executable batches

| Case | Evidence required |
|---|---|
| Text A -> tool -> text B -> tool -> end | A/B remain separate; tools leave at G3a boundaries; no collapse-then-expand flash or leftover row gap. |
| Content fits, tail tool enters/exits | In-browser geometry shows earlier text anchors remain stable, allowing only pixel rounding; check intermediate frames and the unmount frame. |
| Long/multiline reply, tail-follow and scroll-up | Test both modes, including height changes, next-segment arrival, and scroll-range clamping. Reading/selecting older text is not interrupted. |
| Tool result/new text/turn end arrive during a fade | Latest semantic state wins; no lost text, duplicate tool, restarted old bubble, or serialized animation backlog. |
| A terminal error has no following language reply | One message-only error bubble remains readable; earlier language survives and tool exit does not remove the error explanation. |
| Close, hidden window, character/client/turn replacement | No stale callback, ghost input region, delayed reopening, or background motion loop. |
| Reduced motion or no animation end event | The final view still settles and remains operable. |
| Inspector, disclosure, refresh, pending control | Verify actual container sizes, selected-row/scroll/focus continuity, and direct resize response. |

Use meaningful reducer/presence lifecycle tests for races and cleanup. Browser geometry and real
packaged-WebView recording are needed to assess motion: jsdom, a screenshot, or checking CSS class
names alone cannot prove continuity. Owner visual acceptance remains distinct from automated checks.
No new animation, browser, performance, or production tests were run while writing this design.
