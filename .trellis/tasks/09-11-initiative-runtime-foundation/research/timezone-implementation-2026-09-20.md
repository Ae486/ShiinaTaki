# C1-08 User Timezone foundation — implementation evidence

Date: 2026-09-20. Worktree: `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`. This is scoped implementation evidence, not whole-child or owner acceptance.

## Implemented boundary

- Extended the existing `user_timezone` singleton through a strict repository/service, using the integration owner's
  additive migration 049. Fixed/follow mode, explicit known operator device, revision CAS and actual source/confirmation
  provenance persist. UTC bootstrap remains unconfirmed; disconnect/restart retains the last persisted zone.
- Shared strict IANA/read/update/report schemas reject offsets, invalid names, client-supplied report identities,
  invalid revisions and incoherent source metadata. Reports derive identity from the authenticated live connection.
- `read({})` has no mutation. `read({claimReportSource:true})` explicitly claims a server-minted, connection-bound
  reporting lease, only for the already designated device. This does not promote authority, establish Presence,
  close sockets or invalidate ordinary same-device windows. A new reporter retires old reporting rights; stale
  reports and old close callbacks cannot overwrite the replacement. Settings changes invalidate old tokens.
- Effective-zone change and active user-zone cron recalculation commit in one SQLite transaction. Pinned cron,
  absolute `at`, anchored `every`, paused definitions and claimed occurrences remain unchanged. Future recalculation
  creates no historical catch-up; the scheduler re-reads due rows after an awaited dispatch.
- Explicit-zone time renderers and DST-aware day-start calculation share `core/time/time-context.ts`.

## Export and composition contract

Shared public exports from `user-timezone-schema.ts`:

- `USER_TIMEZONE_METHODS`.
- `UserTimezoneNameSchema`, `UserTimezoneStateSchema`, `UserTimezoneRefusalReasonSchema`,
  `UserTimezoneReadParamsSchema`, `UserTimezoneReadResultSchema`, `UserTimezoneUpdateParamsSchema`,
  `UserTimezoneReportParamsSchema`, `UserTimezoneMutationResultSchema`.
- Types `UserTimezoneState`, `UserTimezoneRefusalReason`, `UserTimezoneReadParams`, `UserTimezoneReadResult`,
  `UserTimezoneUpdateParams`, `UserTimezoneReportParams`, `UserTimezoneMutationResult`.

Core named exports:

- `db/user-timezone-repo.ts`: `createUserTimezoneRepo(db)`, `UserTimezoneRepo` (`read`, `replace`).
- `time/user-timezone-service.ts`: `createUserTimezoneService(...)`, `UserTimezoneService`
  (`read`, `timezone`, `dayStart(at?: Date)`, `update`, `report`). `read().revision` is the current snapshot fence.
- `server/methods/user-timezone-methods.ts`: `registerUserTimezoneMethods(registry, {service, connections})`.
- `time/time-context.ts`: existing renderers now accept optional second `timezone` argument;
  `startOfUserDay(at: number | Date, timezone: string): string` returns a UTC instant.
- `ScheduledTaskService.recomputeUserTimezone(zone, at)` is transaction-local, with no timer side effect.

Composition order, using the actual main variable names:

```typescript
const userTimezoneRepo = createUserTimezoneRepo(db);
const scheduleService = createScheduledTaskService({
  repo: scheduleRepo, patterns: schedulePatterns,
  userTimezone: () => userTimezoneRepo.read().timezone,
  rearm: () => scheduleLifecycle.engine?.rearm(),
});
const userTimezoneService = createUserTimezoneService({
  db, repo: userTimezoneRepo, schedules: scheduleService,
  isOperatorDevice: (id) => pairedDeviceStore.find(id)?.role === "operator",
  logger, onEffectiveZoneChange: () => scheduleLifecycle.engine?.rearm(),
});
registerUserTimezoneMethods(registry, {service: userTimezoneService, connections: connectionRegistry});
// Supply userTimezoneService.timezone to ScheduleEngine and the service itself to initiative composition.
```

The integration owner now has this wiring in `main.ts` and the Shared exports in `index.ts` (source observed).
Whole-child compile/process/E2E validation of that evolving composition is still pending. Future clock candidates
and held contextual output must use the captured timezone revision; quota consumers must retain consumed history
when a new zone moves the day boundary. The timezone service does not own delivery capacity accounting.

## Files owned by this subtask

- New Shared schema/test; Core `db/user-timezone-repo.ts`; `time/user-timezone-service.ts` and its test;
  `time/user-timezone-schedules.test.ts`; operator `user-timezone-methods.ts` and its test.
- Updated `time/time-context.ts` and its test; `scheduler/scheduled-task-service.ts`; `scheduler/schedule-engine.ts`.
- Updated directory indexes for Shared, Core db/time/scheduler/server methods and added
  `.trellis/spec/backend/user-timezone.md`.
- This evidence file. Migration 049, Shared public exports, main wiring and global spec indexes remain integration-owner edits.

## Commands and results

Executed in the T4 worktree with installed dependencies:

```text
pnpm --filter @taki/shared exec vitest run src/user-timezone-schema.test.ts
PASS: 1 file, 4 tests.

pnpm --filter @taki/core exec vitest run src/time/user-timezone-service.test.ts src/time/user-timezone-schedules.test.ts src/time/time-context.test.ts src/server/methods/user-timezone-methods.test.ts src/scheduler/schedule-engine.test.ts src/scheduler/scheduled-task-service.test.ts
PASS: 6 files, 36 tests (rerun after the scheduler helper extraction).

pnpm --filter @taki/shared typecheck
PASS.

pnpm exec eslint packages/shared/src/user-timezone-schema.ts packages/shared/src/user-timezone-schema.test.ts packages/core/src/db/user-timezone-repo.ts packages/core/src/time/user-timezone-service.ts packages/core/src/time/user-timezone-service.test.ts packages/core/src/time/user-timezone-schedules.test.ts packages/core/src/time/time-context.ts packages/core/src/time/time-context.test.ts packages/core/src/server/methods/user-timezone-methods.ts packages/core/src/server/methods/user-timezone-methods.test.ts packages/core/src/scheduler/scheduled-task-service.ts packages/core/src/scheduler/schedule-engine.ts
PASS. The first run identified ScheduleEngine's function-size limit; extracting the cohesive due-dispatch helper fixed it.

git diff --check
PASS (existing CRLF normalization warnings only).

pnpm --filter @taki/core typecheck
FAIL at the observed concurrent integration checkpoint; no timezone-domain diagnostic.
```

The Core checkpoint diagnostics were `avatar-tools.test.ts:21` (missing `generation`),
`run-delivery-transition.ts:28` (`SqlValue | undefined`), `initiative-presentation.ts:34` (tool execution context/types),
and `testing/run-service-stub.ts:20` (missing delivery hold/resume). They were sent to their runtime implementation
owner; this report does not claim their later resolution.

## Remaining acceptance

Root/runtime owner: whole-child checks, real isolated Core operator/process E2E, captured timezone validity and
delivery-budget integration. Presence/Desktop child: the actual single designated reporter, settings and stale/offline
feedback. No real data, external service, dependency, commit, push or archive operation was performed here.
