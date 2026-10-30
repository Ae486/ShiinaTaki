# Qualified Feedback Backoff

## 1. Scope / Trigger

Use this contract when changing the Class B backoff consumer, operator reset, canonical admission accounting,
or its semantic Monitor projection. C2 [User Presence](user-presence.md) remains the sole producer of qualified
feedback; [Initiative Runtime](initiative-runtime.md) retains admission, execution, delivery and hard quotas.
This service neither settles feedback nor creates a second Run, delivery, opportunity or feedback ledger.

Sources: [C4 design](../../tasks/09-11-initiative-intentions-acceptance/design.md), parent design sections 8.3/12,
and the effective [decision register](../../tasks/09-11-companion-initiative-implementation/research/decision-register.md).

## 2. Signatures

`createInitiativeBackoff({ db, now?, timezone, modelIntervalMs, onChanged? })` exposes:

- `read(characterId)`: validated `InitiativeBackoffStatus`; recovers missed durable primary engagement first.
- `refusal(characterId)`: `backoff-spacing | backoff-daily | undefined`, for new admission only.
- `reset(characterId)`: explicit operator reset and the resulting status.
- `observeUserTurn(characterId)`: query persisted same-Character primary Timeline input; a callback alone is insufficient.
- `recordAdmission(runId, capturedTimezone?)`: synchronous immutable timezone metadata on an existing newly admitted Run.

Shared `initiative-backoff-schema.ts` owns the strict semantic status and reset parameters. Migration 055 adds
`runs.initiative_timezone` as nullable TEXT, `initiative_backoff_resets`, and read indexes. Old Runs retain NULL;
an upgrade or read cannot infer their original User Timezone from the current setting.

The existing C3 `observability.initiative-policy` result keeps its original closed reason vocabulary: detailed
backoff spacing/daily diagnostics project as `model-cadence`/`model-budget`, preserving every recent row and cursor
and merging mapped counters. Durable detailed reasons remain unchanged. The separate backoff read/reset/changed
methods carry the exact current policy; extending a Shared enum alone does not upgrade an older client decoder.
Committed canonical Heartbeat/Class B admissions invalidate that separate view because daily usage and spacing
change before any feedback exists. Admission notifications do not themselves request another wake.

## 3. Contracts

### Qualified evidence and full reset

- Count only C2's persisted `weak_non_engagement` dispositions for the actual Character. The rolling seven-day
  window includes both endpoints through the current observation instant and uses the producer's settlement time.
  Unknown feedback, elapsed offline time, silence, expressions, held speech, Class A and non-invitations cannot
  produce a weak instance here. Re-reading or re-settling a producer row never duplicates the count.
- Three/six/nine qualified instances select `double`/`quadruple`/`daily`; fewer than three select `normal`.
  These remain engineering calibration. The effective configured model interval supplies the base cadence.
  Normal stage leaves the existing jittered cadence authoritative; later stages enforce at least 2x/4x spacing
  from actual Class B Heartbeat admission. Daily stage also allows at most one admission in a User Timezone day.
- A real subsequent persisted `role=user` Timeline row resets only its Character. Timeline sequence, rather than
  a timestamp alone, handles equal-millisecond ordering. Read/observe recover a missed callback after restart.
- Explicit operator reset fences through the Character's latest Timeline sequence. Both reset forms retire every
  earlier invitation, including feedback settling after reset. Later invitations remain eligible to accumulate
  new qualified evidence. Durable fences survive deletion of the user row and process restart.
- Reset updates use one synchronous transaction; failed writes cannot emit `onChanged`. Successful commits survive
  observer exceptions. Reset never mutates C2 dispositions, admission/delivery counters, Intentions or Memory;
  engagement is not evidence that a real-world matter was answered or resolved.

### Admission and timezone boundaries

- Canonical `runs` where `initiator=heartbeat` and `delivery_class=class_b` own judgment counting. Silent, express,
  failed and unfinished admitted Runs still count. Individual model Effects are not judgment admissions.
  Class A and another Character are excluded from this Character's backoff; independent global hard limits remain.
- Apply `refusal` immediately before NEW admission. Do not include it in an already admitted Run's `isCurrent` or
  delivery gate: recording the Run would make its own spacing/daily refusal true and cancel accepted work.
- Immediately after `admit` returns `reused=false`, call `recordAdmission` without another await and pass the
  admission's captured zone. A same-zone duplicate is idempotent; a changed known zone refuses. A reused old Run
  with NULL metadata must stay NULL; do not backfill it with today's zone. The canonical admission already counts
  if a crash occurs before the optional metadata write, so the crash cannot mint daily capacity.
- Use the actual User Timezone civil-day boundary, including 23-/25-hour days and missing midnight. Known changed
  zones preserve both current/original day carry plus a conservative rolling 24-hour bound. Unknown original zones
  preserve a conservative 48-hour civil-day bound. Never use the process-local zone as an inferred authority.
- Timezone changes and clock rewind retain already consumed history. Queries never rewrite captured metadata or
  reset quota state. `nextEligibleAt` reflects the stricter remaining spacing/day bound; nullable fields mean that
  no future backoff refusal exists, not that independent policy has approved admission.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Missing/wrong-class/non-Heartbeat Run passed to capture | `BACKOFF_ADMISSION_REQUIRED`; no write |
| Capture contradicts an existing known zone | `BACKOFF_ADMISSION_CONFLICT`; preserve original metadata |
| Invalid User Timezone or missing/invalid configured cadence | Validation error / `BACKOFF_CADENCE_REQUIRED`; no inferred fallback |
| Callback without a user row / different Character | No reset of the requested Character's feedback history |
| Old invitation settles weak after operator reset | C2 fact survives; it contributes zero to the reset policy |
| Core restart / missed callback | Durable evidence and fence recover; no live Presence interval is manufactured |
| Metadata absent after admission crash | Admission still counts with conservative unknown-zone carry |
| Reset or migration transaction fails | Roll back state/schema/receipt and preserve prior evidence |

## 5. Good / Base / Bad Cases

- Good: one admitted silent judgment consumes the daily allowance, with no charged utterance and no weak feedback.
- Base: one qualified weak invitation leaves normal cadence unchanged; global quotas remain authoritative.
- Bad: reset hard quotas with backoff, fabricate weak evidence from no reply alone, or cancel a Run because it
  appears in the admission count that was just recorded for that same Run.

## 6. Tests Required

- Actual C2 repository dispositions, deduplication, 3/6/9 thresholds, seven-day boundaries and independent counters.
- Persisted primary input through ConversationStore, same-millisecond ordering, other Character isolation, callback
  without evidence, reset rollback and observer failure.
- Operator reset followed by delayed qualified settlement across file reopen; new invitations can back off again.
- Actual Run admissions for silent/express/failure, immutable metadata, invalid/wrong-class capture, normal jitter,
  DST spring/fall/missing-midnight, date-line switches, clock rewind and exact unknown-zone carry expiry.
- Populated 054-to-055 file upgrade/reopen preserving Runs, Timeline, snapshots/events, timezone and hard opportunity
  history; migration receipt/COMMIT rollback. Integration owner verifies new-admission-only wiring and same Monitor.

## 7. Wrong vs Correct

```typescript
// Wrong: its own committed admission causes an accepted Run to revoke itself.
const isCurrent = () => !backoff.refusal(characterId);

// Correct: count the new admission once, then use the independent source/target fences for its lifetime.
if (backoff.refusal(characterId)) return;
const admitted = await runs.admit(request);
if (!admitted.reused) backoff.recordAdmission(admitted.run.runId, capturedTimezone);
```
