# User Timezone Authority

## 1. Scope / Trigger

Use this contract for User Timezone settings, designated Desktop reports, user-relative calendar calculations and
Scheduled Task recalculation. The existing `user_timezone` singleton remains the only durable authority. Migration
049 adds mode, authority device and confirmation/source metadata; it does not create another configuration store.

## 2. Signatures

Shared `user-timezone-schema.ts` owns all strict request/state/result shapes:

```typescript
user-timezone.read({ claimReportSource?: true })
  -> { state, reportStatus, reportSourceId?, refusal? }
user-timezone.update({ expectedRevision, mode: "fixed", timezone })
user-timezone.update({ expectedRevision, mode: "follow-primary-device", authorityDeviceId })
user-timezone.report({ expectedRevision, timezone, reportSourceId })
  -> { status: "accepted" | "ignored-fixed", state }
   | { status: "refused", reason, state }
```

`createUserTimezoneRepo(db)` reads/replaces the existing singleton. `createUserTimezoneService(...)` exposes
`read()`, `timezone()`, `dayStart(at?)`, `update(params, authenticatedDeviceId)` and
`report(params, authenticatedDeviceId)`. `registerUserTimezoneMethods(registry, { service, connections })`
is the only device-report entry. Its source lease check precedes the domain service report mutation.

The existing renderers accept `renderDayDate(at, timezone?)`, `renderCurrentTime(at, timezone?)` and
`renderWallClock(at, timezone?)`. User-relative consumers pass the captured service zone explicitly.
`startOfUserDay(at, timezone)` returns the first actual instant of that civil day as UTC ISO text.

`ChatAgentDeps.userTimezone?: () => string` and `createCurrentTimeTool({ userTimezone?: () => string } = {})` are
narrow live read ports to this same authority. Production wires the service to both; omission preserves the existing
local-clock behavior for legacy callers. Tool construction reads no timezone, so an earlier composition point may
close over the service that is initialized before the first request.

## 3. Contracts

- Validate bounded IANA names with the installed `Intl` implementation; plain offsets, invalid names and extra
  request fields are refused. Device identifiers match the existing UUID connect identity. Revisions are positive
  safe integers. The Core supplies confirmation timestamps and source identity; clients cannot submit either.
- UTC bootstrap is unconfirmed: `source=bootstrap`, `confirmedAt=null`, `sourceDeviceId=null`. A fixed operator
  selection confirms the chosen zone. Entering follow mode retains the previous zone and its actual confirmation
  provenance until a valid designated-device report arrives. No disconnect, restart or new connection selects a
  replacement authority or substitutes the VPS process-local zone.
- Only an explicitly selected known operator device can report. Handler identity comes from a live authenticated
  `MethodContext.connection`; payload `deviceId` is forbidden. Node authentication and ordinary connectivity are
  neither report authority nor User Presence evidence.
- `read({})` is read-only. Only `read({claimReportSource:true})` claims an ephemeral reporting lease for the designated
  device. The server mints its UUID and binds it to that exact socket. Another window's ordinary read cannot steal
  it. A new explicit reporter retires its predecessor's reporting rights, without closing either socket. A retired
  reporter cannot reclaim on that socket; reconnect establishes a new lifecycle. A late old close cannot retire a
  newer source. No token survives restart.
- A successful settings update invalidates the current token and allows a fresh explicit claim on the still-current
  socket. Fixed mode ignores schema-valid device reports. Follow mode requires current source, designated device
  and expected revision; stale CAS/source reports do not update timestamps, confirmation or schedules.
- Every accepted confirmation/settings mutation increments the singleton revision once. Effective zone change and
  derived future cron slots commit in one short synchronous SQLite transaction. A schedule calculation/write failure
  rolls back both. `onEffectiveZoneChange(after, before)` runs after commit; observer failure is logged and cannot
  reverse or misreport the accepted durable change.
- `ScheduledTaskService.recomputeUserTimezone(zone, at)` is transaction-local and does not arm timers. It recalculates
  only active user-zone cron definitions strictly after `at`. Pinned-zone cron, absolute `at`, anchored `every`, paused
  definitions and already claimed occurrences retain their meaning. No timezone change creates historical catch-up.
  The composition root re-arms the existing engine only after the timezone transaction commits.
- A scheduler pass re-reads each due definition after an earlier asynchronous dispatch. A timezone/settings change
  in that gap must not dispatch a captured stale due slot. Existing normal restart/catch-up rules remain unchanged.
- Civil days may have 23 or 25 hours or a missing midnight. Day-start calculation searches actual instants in the
  supplied zone, never subtracts a presumed fixed UTC offset. Changing zone can move the day boundary: quota owners
  must preserve already consumed history and must not mint capacity by recounting only from a newer boundary.
- For the ordinary ChatAgent context, capture one clock instant and one User Timezone per attempt before awaited
  recall. Use that same zone for the stable day line and volatile current-time tail; include `User timezone: <zone>.`
  beside the stable day line when configured. A settings update during recall must not combine one zone's day with
  another zone's time. The next attempt reads the committed zone; no primary-chat cancellation is needed. Selected
  initiative context retains its existing immutable context path.
- `get_current_time` reads the current authority once per invocation, uses that zone for both `local` and `timezone`,
  and keeps `iso`, `epochMs` and `capturedAt` tied to the same instant. A supplied authority failure returns the existing
  structured tool error; never infer the host zone as a fallback. An invocation after a settings update may truthfully
  report the newer zone even while the earlier request context remains its captured snapshot.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Unauthenticated / Node / removed socket | Authentication or role refusal; no authority or lease change |
| Invalid zone, unknown field, invalid UUID/revision | Shared validation refusal before writes |
| Unknown authority device | `refused/unknown-authority`; prior singleton retained |
| Wrong reporting device | `refused/foreign-authority`; prior confirmation retained |
| Replaced token/socket or old connection after replacement | `refused/stale-source`; no report mutation |
| Current source but stale expected revision | `refused/revision-conflict` with current state |
| Fixed mode device report | `ignored-fixed`; no revision or timestamp change |
| Authority source closes / Core restarts | Read says reporting unavailable; persisted zone/confirmation retained |
| Future schedule recomputation fails | Atomic rollback and no post-commit callback |
| Zone change during an awaited scheduler dispatch | Re-read later due rows and skip their now-future slots |

## 5. Good / Base / Bad Cases

- Good: Home chooses a known Desktop device. Its single reporter explicitly claims a source and confirms the zone;
  a separate Chat window can read settings without taking the source. After reconnect, the old report token fails.
- Base: an unconfigured profile runs with persisted UTC and visibly absent confirmation until operator setup.
- Bad: trust a report's device ID, assign the newest connected Node, rewrite prior occurrences, use `process.env.TZ`
  as user authority, or treat a settings change as new daily quota capacity.

## 6. Tests Required

- Shared schema tests: IANA/offset rejection, positive safe revisions, strict identity exclusion and metadata coherence.
- Service tests: real file-backed SQLite reopen, fixed/follow provenance, stale CAS, foreign/unknown authority,
  fixed-report ignore, same-zone confirmation, atomic rollback and post-commit observer isolation.
- Method tests: real connection registry and method dispatcher, authentication/roles, same-device windows, explicit
  source replacement, stale close/reconnect, old token rejection and settings-change source invalidation.
- Time/scheduler tests: explicit cross-day rendering, DST 23/25-hour and midnight-gap day boundaries, anchored/pinned
  stability, future-only recomputation, unchanged claimed occurrences and the asynchronous due-row race.
- Agent/tool regression: real timezone service plus captured provider requests, exact UTC-versus-host mismatch,
  cross-day rendering, a zone change during awaited recall, next-turn/next-invocation fresh reads, no eager tool-construction
  read, unchanged unspecified callers, and structured failure rather than host fallback.
- Child integration owns actual Core boot, method registration, delivery budget preservation, full workspace checks
  and owner acceptance. Native Desktop reporting/settings are implemented by the Presence/Desktop child.

## 7. Wrong vs Correct

```typescript
// Wrong: a reported identity and the VPS clock overwrite the user's authoritative zone.
service.report(params, params.deviceId);
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Correct: authenticate and validate the current source lease at the operator boundary.
service.report(params, connection.state.deviceId);
const zone = userTimezone.timezone();
```
