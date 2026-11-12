# C3 accepted source producers

Date: 2026-09-28. Worktree: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.

## Delivered ports

`PerceptionEvidence.foreground(now): InitiativeForegroundFact | undefined` reads the sanctioned accepted sampler.
It contains the exact bounded application name, accepted nullable idle, actual Host/connection/catalog and consent
epoch, observation/start instants, one stable occurrence key and a meaningful flag. No window title is copied.
The first sample after startup, app/idle-class change, privacy/source retirement, duplicate/backward time or a
60-second gap is not meaningful. The second strictly later compatible sample establishes dwell. Further compatible
samples retain the occurrence, so renewal cannot reroll chance. The existing native-only `latest(now)` projection
and privacy invalidation counts remain unchanged.

`PresenceService.recentReturn(): InitiativePresenceReturn | undefined` exposes a distinct source-local fact.
`createPresenceService` accepts optional data-free `onSourceChanged`; it is observer-isolated and does not dispatch
work. The wake owner remains responsible for selection, privacy/availability, quotas, lifetime and model admission.

The return tracker requires:

1. The same registered authenticated operator source and uninterrupted source lease.
2. An actual initial trusted input and explicit later reports retaining its sequence, kind and nondecreasing age.
3. A receipt-forward known-inactivity start after that input is at least 60 seconds old.
4. At least ten minutes of that source-local interval, followed by a genuinely newer fresh input.

Bootstrap, null input, legacy clients without continuity evidence, focus, visibility, renewal, reconnect and gaps
alone never produce a return. A suspended or expired chain cannot be re-anchored by replaying cached old input.
Freshness is 60 seconds from the original return input; repeated reports and further input do not reroll or extend
the old occurrence. Authentication/source replacement and actual retirement remove it. This never asserts global
absence, Host/operator co-location, hardware-only input, reading or rejection.

## Necessary compatible producer extension

The existing Desktop producer discarded input after 60 seconds and every routine native visibility query briefly
reported false visibility. Those facts could not establish ten minutes of known inactivity. The integration owner
approved the optional Shared `inputContinuity: tracked | suspended` field, with omission treated as suspended.
This is a bounded protocol compatibility exemption: updated Core accepts old C2 clients, while old clients cannot
produce the new return evidence. The pre-existing C2 presence/exposure fields retain their meanings.

`SurfacePresenceOwner` now retains the original input sequence/kind/age up to the existing 24-hour Shared bound.
Core presence still expires at 60 seconds. `setInputTracking` follows actual trusted listener attachment/teardown;
tracked continuity additionally requires an active surface and its last confirmed visible/focused state.

`observeOwnWindow` still withdraws display evidence before every asynchronous query. Routine renewal uses the
separate `beginWindowRefresh` path, preserving the independently attached input listeners and capturing genuine
input during the pending query. Actual native/document events, confirmed hidden/minimized/unfocused state, query
failure, `document.hidden`, route detach and listener teardown suspend input continuity. No old display interval
survives a pending query, and no unknown gap is filled. The negative-lifecycle rate-limit exception closes C2
evidence but explicitly suspends return tracking, preventing new-input piggyback through that exception.

## Changed responsibilities

- Core Perception: `perception-evidence.ts`, new `foreground-continuity.ts`, focused direct/layer regression tests.
- Core Presence: `presence-service.ts`, `presence-sources.ts`, new `presence-return.ts` and owning-service tests.
- Shared: compatible optional field in `presence-schema.ts` and strict compatibility/bounds tests.
- Desktop: `surface-presence.ts`, `own-window-visibility.ts`, `use-surface-presence.ts`, and producer/Core integration tests.
- Core/Desktop directory indexes and backend/frontend executable presence/Perception specifications updated.

## Validation

- `pnpm --filter @taki/core test presence-return presence-service perception-evidence foreground-continuity perception-changes`: **81 tests passed**, including existing C2 exposure/feedback and privacy batching cases.
- `pnpm --filter @taki/desktop test surface-presence own-window-visibility`: **18 tests passed**. Seven exercise the actual Desktop source and actual native-visibility owner through Core `PresenceSources`, covering routine withdrawals, a trusted input during a pending query, and real hidden/document-hidden/blur/detach/lease-gap rejection.
- `pnpm --filter @taki/shared test presence-schema interaction-pattern-schema`: **30 tests passed**.
- Shared typecheck: passed.
- Scoped ESLint covering all touched source-producer files and tests: passed.
- `pnpm --filter @taki/core typecheck` and `pnpm --filter @taki/desktop typecheck`: both passed after independently owned integration fixes and the corrected test fixture callback.

These deterministic tests use isolated SQLite and scripted native query/input facts. They prove the owning protocol,
continuity and control-flow paths, not physical native input, real WebView2 behavior, rendering/occlusion, external
model behavior or owner acceptance. Those gates remain explicitly pending. No new sampler, sensor, dependency,
permission, user database, commit, push or archive action was introduced.
