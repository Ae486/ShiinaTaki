# Desktop User Presence and Presentation Feedback

## 1. Scope / Trigger

Applies to Desktop Home/Chat/Pet input evidence, self-window visibility, ordinary committed Timeline text exposure,
and the designated Home User Timezone reporter. Core owns source validation, receipt time, leases, interval unions and
feedback disposition. Neither this UI nor transport receipt proves human reading, Host availability or permission.

## 2. Signatures

- Shared `PresenceReportParams`, `PresenceReportResult`, `TimelinePresentationReportParams` and User Timezone schemas
  are parsed by the existing `WsClient` facade. Never declare a parallel wire format or supply operator/Node identity.
- `retainSurfacePresence(client, surface)` retains the one physical-client source and returns `source` / `release`.
- `useSurfacePresence(client, surface, active)` binds real trusted input and native/document lifecycle to that source.
- `useCommittedExposure(targets, text, active)` observes actual rendered text using existing Character/Timeline seq
  coordinates. The source unions independent rendered regions that refer to the same committed row.
- `createUserTimezoneController({ client, deviceId, timezone })` owns read-only views, explicit CAS saves and one
  designated reporting source. Home owns it; Chat/Pet do not compete for that source.

## 3. Contracts

### Source and input lifecycle

- A physical operator socket has one immutable source ID/surface and a monotonically increasing sequence shared by
  presence and exposure reports. Core derives identity from authentication; same-origin operator credentials remain
  distinct from the Rust Node. Home, Chat and Pet use their independent existing clients.
- React StrictMode and actual render detach/remount on a live socket must retain that source. Detach immediately ends
  visibility/exposure and removes native/input listeners and renewal timers; it does not send a permanent source
  retirement. Socket close and page retirement end the source. A retired source never revives.
- Accept only trusted pointer-down, wheel, touch and non-repeat keyboard input on an active visible surface. Send
  only kind, sequence and elapsed age. Never send keys, content, coordinates or a payload-supplied device identity.
- Source renewal continues the original input age; it never turns focus, programmatic opening, synthetic DOM events,
  reconnect or a render update into input. A replacement connection starts without historical input.
- C3 may retain the same bounded input sequence/kind/age for up to the existing 24-hour Shared bound. This is explicit
  source-local inactivity evidence, not extended presence; Core's presence freshness remains 60 seconds. The optional
  `inputContinuity` field is `tracked` only while the actual trusted-input listeners are attached, the surface is
  active, and its last confirmed own-window state is visible/focused. Old clients omit the field and remain unable
  to establish C3 return continuity. No new sensor or global absence assertion is introduced.
- Use event-driven updates, at most one coalesced input report per second, and one source-owned renewal after 15 seconds.
  The Core lease is 30 seconds and current direct input freshness is 60 seconds. These are C2 engineering calibration,
  separate from model opportunity and utterance budgets; they are not generic page polling.

### Native visibility and actual text

- Query only the app's own window visibility/minimized/focused state. Every asynchronous refresh first withdraws the
  previous evidence, including renewal reads. Fence native completions and late listener registrations by lifetime.
  Missing native query/listener support stays unknown. Focus is reported separately and is not required for exposure.
- Routine query withdrawal uses `beginWindowRefresh`: text/display evidence is closed while continuously attached
  trusted-input listeners remain capable of recording actual input during the pending query. Native/document events,
  a confirmed hidden/minimized/unfocused result, query failure, route detach and listener teardown suspend that input
  continuity. `setInputTracking` follows the real listener attachment, not a timer or guessed focus. A routine query
  that finds `document.hidden` must also suspend; it cannot preserve continuity by returning early.
- Combine native visibility, document visibility, route/bubble state and actual DOM viewport intersection. Chat's lazy
  Skeleton and private/live text have no committed target. Pet's exiting rows, closed bubble, offscreen content and
  inactive retained Chat route are ineligible. No producer changes opening, scrolling, selection or focus to obtain evidence.
- The current visual threshold is at least half of the rendered nonempty text region for two continuous seconds.
  A hide, removal, source retirement or interruption ends the observation; renewed eligibility starts a new interval.
  This is opportunity evidence, not proof of complete reading or full native occlusion detection.
- Pet consumes ordinary `timeline.appended`, complete `timeline.committed`, bounded history and removal tombstones.
  Reuse Chat's canonical semantic keys and the existing PresentationGate. Do not manufacture ChatActivity for
  autonomous speech, reveal partial multi-row commits, auto-open the bubble or let late old batches cover a newer turn.

### User Timezone

- Use the existing Core singleton and designation/source/CAS contract in [User Timezone Authority](../backend/user-timezone.md).
  Only Home explicitly claims a source. Fixed/foreign-authority reads remain read-only.
- Revalidate device timezone on Home visibility/focus and explicit refresh; there is no recurring settings poll.
  Preserve edited input through reads. Show confirmed zone/mode and actual unavailability/refusal, not opaque source IDs.
- A settings mutation sends the reviewed revision once. Old read/claim/report/save results cannot replace a newer
  generation or explicit setting. A lost report acknowledgement is not replayed as a second confirmation of the same
  observation; a genuinely changed device zone or new explicit source lifecycle can produce a new report.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| StrictMode cleanup/setup or same-client remount | Same source/sequence; no permanent retirement or refreshed input age |
| One of Home/Chat/Pet disconnects | Only its source retires; replacement starts with no input |
| Native query is pending or fails | Previous exposure withdrawn; no late resurrection |
| Synthetic input, focus, opening or renewal | No new input fact |
| Skeleton, hidden route, minimized window, closed/exiting Pet | No exposure |
| Two DOM regions reference one row | One exposure remains until both regions leave |
| Multi-row commit or deferred presentation callback | Complete canonical group only; current generation/turn/visibility rechecked |
| Timezone CAS/source refusal or unknown write outcome | Honest retained confirmation/refusal; no automatic mutation retry |

## 5. Good / Base / Bad Cases

- Good: a Chat Markdown chunk resolves, visible text qualifies, and Core receives a bounded exposure report while
  independently aging actual same-device input.
- Base: the native API or device association is unavailable; presence/presentation remains unknown.
- Bad: socket receipt becomes an ACK, hidden Pet content opens itself, render replay rotates a Core-bound source,
  or a timezone refusal is displayed as a current confirmation.

## 6. Tests Required

Use owning source/visibility/timezone classes and real facade boundaries to cover input age, replay/remount, independent
sources, asynchronous retirement, negative rendering cases, same-row region union, commit/history/removal races and CAS.
Run Desktop typecheck, tests, scoped lint and production build. Native WebView2 checks additionally exercise actual
document/window transitions, trusted browser events, lazy rendering, reader position and Pet display. Record fixture
servers/openers separately from actual Core policy tests, model/renderer coverage and human owner acceptance.

## 7. Wrong vs Correct

```typescript
// Wrong: StrictMode cleanup tombstones a still-live connection's only source.
return () => source.dispose();

// Correct: render cleanup suspends evidence; the physical client owns terminal retirement.
return () => lifetime.release();
```
