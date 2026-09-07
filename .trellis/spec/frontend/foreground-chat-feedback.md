# Foreground Chat and Pet feedback

## 1. Scope / Trigger

Applies to the confirmed live-feedback Chat/Pet surface and its disposable presentation/motion state.
The [Core activity and batch contract](../backend/foreground-chat-activity.md) defines authoritative
identity, order, recovery and canonical persistence. Read it before changing consumers.

## 2. Signatures

- Consume Shared `ChatActivity`, `ChatActivityReadResult`, `TimelineEntry` and `TimelineCommitted`.
- One generation/Character activity adapter installs typed notifications, subscribes, reads a bounded
  snapshot and merges intervening pushes. It can refresh, flush coalesced text and dispose; it cannot
  execute a tool, resend `chat.send` or cancel an observing turn.
- Keep the initiating `chat.send` acknowledgement and error/draft restoration separate from activity.
  Stable presentation keys come from Core `itemId`, not array index, current text, or generated titles.
- Use existing CSS duration tokens and reduced-motion media rules. Presence/layout state is local
  and disposable; it is never persisted in localStorage or used as execution state.

## 3. Contracts

### Chat

- Interleave language and one compact entry per invocation in actual order. Retain terminal calls,
  captured names and truthful outcomes. Useful reversible details are collapsed initially; no second
  call/result card, raw runtime identifier panel or fabricated execution timing.
- The selected tool heading keeps its DOM parent when details first become available. Reserve its
  disclosure control space and attach useful details without remounting the heading or exposing an
  empty actionable disclosure.
- Canonical result details may include meaningful business versions, counts, paths or output text.
  Hide internal bookkeeping without dropping those useful results. Existing safe Markdown/rendering
  rules remain in force; never introduce raw HTML to display output.
- Buffer partial batch appends. Complete commits or fully recovered history replace live material in
  one store update with the same semantic keys. Text may span multiple references in one canonical
  part; an SDK row boundary is not a language-bubble identity.
- Legacy `chat.delta` remains compatibility input only when authoritative activity is absent. Receiving
  both channels must not duplicate text. Legacy completion never clears newer or uncovered activity.
- Preserve scroll/focus/selection through appends, details, batch handoff and reconnect. Following the
  tail and reading older content are separate modes; do not repeatedly smooth-scroll each token.

### Pet

- Keep language A and later language B as separate bubbles around tool boundaries. Each tool has its
  own transient row and captured name. Actual completion stops the busy indicator immediately; the
  settled row remains until the next language starts or the turn ends.
- Next-language and end boundaries retire only their intended tool rows. Concurrent/late results do
  not reinsert an already retired row or remove a newer segment. A turn ending in error without later
  language leaves one message-only error bubble alongside any earlier language, with no embedded action.
- Observing a turn never automatically opens Pet. Preserve existing opening, input, visibility and
  presentation gates; reconnect or a late animation event cannot reopen a user-closed bubble.
- Top-anchor the transcript. Earlier fitting text and the composer/frame remain stable as the tail
  changes. Long content scrolls inside the existing window rather than resizing the native window.

### Continuous geometry and cleanup

- Coordinate tool-to-text crossfade inside one temporary occupied-space envelope. Apply incoming text
  immediately and transition from current height to the new natural height; do not collapse to zero
  and then expand. Text and tool DOM nodes keep distinct semantic identities.
- A disappearing tail releases its height and spacing together. No leftover parent gap, zero-height
  placeholder, whole-stack remount, scaled text or end-of-transition position jump.
- Observe natural content size only where needed. Do not measure the animated box every frame or use
  JavaScript animation timers. Finite CSS presence bookkeeping may respond to actual end/cancel events.
- A natural height target can precede actual scrollable occupancy. When following the tail, reconcile
  again at finite CSS height settlement so initial overflow cannot remain at scrollTop zero. Recheck
  current reading/selection ownership at that callback; an old measurement cannot override a user scroll.
- Interruption retargets from current geometry. Hide, close, Character/client/turn change, reduced or
  zero motion and missing end events all settle without stale callbacks or a pending animation queue.
- Invisible/exiting surfaces do not intercept input or repeat accessibility announcements. Only
  visible bubble/control geometry participates in the existing click-through hit-test contract;
  reserved transparent space stays pass-through.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| A -> tool -> B -> tool -> end | A/B stay separate; tools retire at the specified boundary. |
| Tool completes before B | Busy ends immediately while the settled name can remain visible. |
| B arrives during tool fade | Show all B text immediately; continuous height with stable A. |
| Tail tool exits without a successor | Release its complete height/gap continuously; no final placeholder. |
| User is reading/selecting older text | Preserve the node/selection and reading anchor; do not pull to the tail. |
| An already-rendered waiting turn becomes a long reply | Initial animated overflow reaches the actual tail; user scrolling can stop following before settlement. |
| Read is stale, fails or returns unavailable | Keep truthful visible state; no false running/success or resend. |
| Reduced/zero motion or no end event | Correct settled DOM, operable controls and no invisible hit target. |
| View/client/Character retires | Dispose obsolete work; late events cannot reopen or erase newer content. |

## 5. Good / Base / Bad Cases

- Good: Core updates one invocation; Chat keeps it as history and Pet later crossfades its transient row
  into a separately keyed language bubble while earlier text remains selected and anchored.
- Base: legacy history is still readable; cold empty/failed recovery is explicit and does not fabricate data.
- Bad: one ever-growing Pet string, duplicate call/result cards, spinner after confirmed completion,
  remove-to-zero then reinsert, full-stack entrance replay, or localStorage transcript persistence.

## 6. Tests Required

Meaningful reducer/adapter/store tests cover identity, exact acknowledgements, old generations,
history/read/push/commit races, partial pages, unavailable state, terminal errors and interrupted
presence cleanup. Real WebView2 checks must additionally record intermediate geometry and verify
fitting/overflow content, tail-follow versus scroll-up, selection/focus, handoff DOM identity,
concurrent tools, rapid interruption, reduced motion and transparent input geometry.

Use immutable production assets and the production CSP for final engineering acceptance. Label
scripted transport/provider data, actual native behavior and personal owner inspection separately.

## 7. Wrong vs Correct

```ts
// Wrong: the first durable row can represent only a fraction of an ordered live turn.
onTimelineAppended(() => clearEveryLiveItem());

// Correct: a validated complete batch atomically covers its exact accepted message.
onTimelineCommitted((batch) => commitCoveredMessage(batch));
```

The source-backed motion rationale is in the task's
[motion design](../../tasks/08-22-t4-agent-architecture-observability/research/uiux-motion-continuity-2026-09-05.md).
