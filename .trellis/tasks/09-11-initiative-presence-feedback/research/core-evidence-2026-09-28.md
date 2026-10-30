# C2 Core Presence Review Evidence — 2026-09-28

## Scope and source precedence

- Workspace: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`; HEAD: `06a8090`.
- Assigned child: `09-11-initiative-presence-feedback`. The stale global `.current-task` points to a missing Avatar Lab
  task; this review used the root agent's explicit C2 assignment and curated C2 PRD/design/check context. No global
  pointer, commit, push, reset, rebase or archive operation was performed.
- Owned scope: `packages/core/src/presence/*`, Shared presence/report schemas and schema tests, migration 051 module/test,
  and the new backend Presence spec. Root owns exports, registry, server/main/event integration and index registration.
- The user-supplied `H:/TakiAgent-worktrees/T4-heartbeat-child1-findings-2026-09-25.md` was read as nonauthoritative
  reference only. No implementation in the other worktree was inspected or copied. In particular, its alternate migration
  numbering is not the current registry: this workspace already uses 050 for initiative model opportunities, and C2 uses 051.

## Reviewed implementation

- Shared reports are strict, bounded and content-free. Source identity comes from the authenticated operator connection.
- Source leases, input-age tracking, monotonic sequences and the shared report token bucket are independent per connection.
  The existing bucket was verified as burst 128, refill 8/second, shared by Presence and presentation reports.
- Unknown remains unknown. Native/Host activity is not implicitly associated with an operator device; phone input does not
  create Host availability or prove that a Desktop message was visible to the user.
- Actual committed assistant text starts presentation; hidden-only reports cannot create a presentation fact. Exposure
  and same-device input intervals are intersected and unioned, without timer/offline/transport-gap backfill.
- Feedback is restricted to published Class B invitations. Ordinary Class A/non-invitation presentations omit unproduced
  `opportunityMs`. Interval unions and duration commit atomically; presentation/settlement facts are once-only and durable.
- Engagement requires a persisted later same-Character user Timeline row, including sequence ordering at the same millisecond.
  Sweeps recover missed callbacks. At the deadline, insufficient opportunity is unknown; history views cannot reopen it.
- Sources and exposures are ephemeral. File reopen retains observed history and does not restore leases or accrue outage time.

## Findings fixed

1. **Blank content accepted as presentation** — `presence-service.ts` used SQLite `trim(content)`, which strips ordinary
   spaces but leaves tabs/newlines. A whitespace-only assistant row passed the message check. The check now reads the
   exact Character/seq assistant row and requires nonempty JavaScript-trimmed content. The regression reproduced the
   failure before the fix and now passes.
2. **Old evidence survived re-authentication on the same connection** — `presence-sources.ts` checked role/device ID but
   did not bind the exact authentication generation. Sources now capture the authentication state object; changed
   authority refuses reports and retires/discards unconfirmed old evidence in snapshot/interval reads. Normal known-time
   connection removal still clips earlier valid history. A same-device re-authentication test verifies unknown presence
   and zero opportunity from the retired source.
3. **Engineering calibration described as ratified** — corrected the `presence-policy.ts` module header and documented
   source/rate/exposure/interval limits as engineering defaults, not owner-ratified feature-enablement or delivery budgets.
4. **Legitimate same-input renewal rejected under variable network delay** — a same-sequence age check required the
   client elapsed age to keep up with Core receipt-time deltas. A renewal delayed 10 ms more than the first report failed
   as `stale-input`. Same-input validation now requires nondecreasing age and unchanged kind, while the initially captured
   `inputAt` stays immutable. A frozen client age therefore still expires at the original Core 60-second bound. The
   injected-clock regression failed before the fix and passes afterward with varying delivery delays.
5. **Coalesced distinct inputs sharing a millisecond rejected** — the actual Desktop producer reports an eligible first
   trusted event immediately and coalesces a second event for up to one second. Their distinct input sequences can
   reconstruct equal millisecond timestamps. New-sequence validation now accepts equality without advancing freshness;
   older timestamps and older input sequences still refuse. The producer-shaped wire regression failed before the fix.
6. **Rate-limited hide/retirement left old exposure alive** — the integration reviewer reproduced a real RPC sequence
   that exhausted the 128-report bucket, hid a message, then showed it five seconds later. The refused hide left the old
   exposure alive and incorrectly accumulated those 5,000 hidden milliseconds. Strictly validated ends of existing
   exposures and source hide/retirement now close evidence despite exhausted quota. The Presence exception drops any
   attached input, so it cannot admit positive evidence without tokens. Malformed, replayed and foreign-source reports
   still refuse, repeated hidden reports have no active transition exemption, and other source lifecycles are unaffected.
   Both new service cases failed before the fix; those and the reviewer's RPC regression pass afterward.
7. **Other failures still vetoed negative lifecycle cleanup** — a stale attached input could reject an otherwise valid
   source hide/retirement, and `syncPublished`/settlement failure ran before exposure removal. The final path treats attached
   input independently: authenticated, current-sequence source hide/retirement drops it and closes evidence, while positive
   observations retain normal input validation. Validated source/message closures now remove live exposure and advance
   their source sequence before durable writes. SQLite errors still propagate, but cannot roll the ephemeral closure back.
   Real SQLite trigger tests reproduced another 5,000 ms hidden-gap accrual for message and surface hide before the fix;
   both pass afterward, including a fresh second source on the same device.

## Coverage added or strengthened

- Rate bucket saturation/refill across Presence and presentation; independent second source; immediate connection removal.
- 128-source retention/reclamation and 64-exposure saturation/release.
- Variable network delays on same-input renewal, frozen-age expiry, monotonic-age/kind validation, and same-millisecond
  distinct input sequences matching the Desktop coalescer's actual output.
- Quota-exhausted source hide/retirement with attached input, malformed/replayed/foreign-source fencing and independent
  phone presence; the integration reviewer's real RPC test verifies no hidden gap is included after a later show.
- Source hide/retirement with stale attached input and actual SQLite synchronization failure during message/surface hide:
  live cleanup survives the failure, and later show cannot join the hidden interval using another same-device source.
- Hidden-only reports and absent/blank/non-assistant message rejection.
- Same-device null-input, disconnect and reconnect gaps contribute no invented interval.
- Same-millisecond later user sequence, old row/callback-only refusal, and exact-deadline reply boundary.
- Interval/total rollback together, overlapping-union behavior, fragmentation cap and malformed persisted interval rejection.
- Real SQLite reopen with missed callback recovery, observed-duration preservation, zero restored live leases and unknown
  unanswered observation after the deadline.
- Recorded-049 and populated-050 file upgrades/reopens, unchanged old receipts/Timeline/timezone, and atomic migration
  rollback on both receipt failure and deferred foreign-key COMMIT failure followed by a clean retry.

The new source/rate tests initially exposed a test fixture crossing the exact lease boundary; the fixture was corrected
to renew before expiry, preserving the implementation's conservative no-backfill behavior. The file-reopen test was
also adjusted so no later service report settles the intentionally missed callback before the simulated crash.

## Verification

All final commands below ran in the assigned T4 workspace on 2026-09-28; these are scoped gates, not full C2 acceptance.

| Command/check | Result |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/presence/presence-service.test.ts src/db/migrations/051-initiative-feedback.test.ts` | Pass: 27 tests in 2 files before the final lifecycle-quota follow-up, 10:17 local |
| `pnpm --filter @taki/core exec vitest run src/presence/presence-service.test.ts src/server/methods/presence-methods.test.ts src/db/migrations/051-initiative-feedback.test.ts` | Pass: 38 tests in 3 files (28 service, 6 RPC, 4 migration), final run 10:29 local |
| `pnpm --filter @taki/shared exec vitest run src/presence-schema.test.ts` | Pass: 11 tests in 1 file |
| `pnpm --filter @taki/core typecheck` | Pass, final rerun after code/test changes |
| `pnpm --filter @taki/shared typecheck` | Pass |
| `pnpm exec eslint packages/core/src/presence packages/core/src/db/migrations/051-initiative-feedback.ts packages/core/src/db/migrations/051-initiative-feedback.test.ts packages/shared/src/presence-schema.ts packages/shared/src/presence-schema.test.ts packages/shared/src/timeline-presentation-report-schema.ts` | Pass, final rerun |
| `pnpm exec eslint packages/core/src/presence/presence-sources.ts packages/core/src/presence/presence-service.test.ts` | Pass after the variable-delay/coalesced-input follow-up |
| `pnpm exec eslint packages/core/src/presence` | Pass after the final lifecycle-quota/SQLite/stale-input follow-up |
| `git diff --check -- <owned paths>` | No errors; these new files are untracked and therefore are not actually inspected by Git's unstaged diff check |
| Direct BOM/trailing-whitespace read of the 13 owned code/schema/spec/index files | Pass; included the untracked files |

## Spec synchronization and remaining validation

- Added `.trellis/spec/backend/user-presence.md` with the seven required executable-contract sections, exact signatures,
  error behavior, engineering bounds, persistence semantics and required tests. Root registers its backend index link.
- No unresolved finding remains in this scoped review. No API signature or Shared refusal literal was changed in this
  continuation; `rate-limited` already existed and is now covered by the Shared schema test.
- Server/Monitor production wiring, cross-package integration, full-package gates, real Core startup and native Chat/Pet
  visibility/rendering/reading-position checks remain the root/integration owners' responsibility. This report does not
  mark C2 manual/owner acceptance, native occlusion validation, or the whole Heartbeat delivery complete.
- Rollback is disabling new reporting/consumption while retaining compatible readers and migration/history. Never downgrade
  the database or delete Timeline/delivery/feedback evidence to roll this feature back.
