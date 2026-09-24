# Stage 2c Execution Plan

Date: 2026-09-24. Follow [PRD](prd.md), [design](design.md), [grill](grill.md) and
[research/stage2c-seams.md](research/stage2c-seams.md). Owner direction: proceed autonomously; a wave whose gates pass
cleanly may be committed and the next wave started. All sub-agents run on opus. One `trellis-implement` per wave (never
finer) with an explicit context-budget brief. The leader owns task/spec/handoff documents; implementers never commit.

## Planning

- [x] Seam research (`research/stage2c-seams.md`), G1-G14, failure matrix.
- [x] Engineering rulings (degraded snapshot, occupancy probe, naming, status placement, D86/D87/D88).
- [x] Owner Q1/Q2: both A (2026-09-24) — automatic provision and automatic revalidate, one attempt per key.

## A. Degrade path, witnesses, truthful status

- [x] Shared: lifecycle status section + readiness, authority status `hindsight` + two reasons, two connection codes,
      relaxed setup refine; tests; `index.ts` recount.
- [x] Core: `hindsight-unavailable-run.ts`, runtime/subsystem degrade + G11 witness, connection drift/readiness helpers +
      template-revision refusal, scheduler `armTimer` catch, lifecycle status read + authority status mapping.
- [x] Tests: new-Character capture degrades and `chat.send` replies; drift/disabled/provider-down captures; witness kept and
      ingested once after the connection is restored in-test; status matrix; template-revision boot unavailable; scheduler.
- [x] Gates + commit (shared/core) if clean.

## B. Producers, rebind, reconnect, automatic triggers

- [ ] Shared kinds/unions/producer table; Core lifecycle service, occupancy, two kinds, registry/family/context, binding
      `replace`, G13 callback, boot composition, main wiring, Core-derived actions; automatic triggers per Q1/Q2.
- [ ] Tests: kind admission matrix, four-family busy, pre-claim cancel, `observeBoot`; lifecycle journey (provision +
      fresh-Bank bind + recall; drift + revalidate + rebind; lineage refusal; outage -> reconnect); D87 journey (AC6);
      isolated boot.
- [ ] Gates + commit if clean.

## C. Home

- [ ] Authority card readiness rows, labels, two actions; fixtures; tests; Desktop build. Gates + commit if clean.

## Validation and final review

- [ ] One independent `trellis-check` over all S2c changes, AC1-AC9 and the failure matrix.
- [ ] Leader re-runs all gates + isolated boot.
- [ ] Specs: new `memory-hindsight-lifecycle.md`; `memory-operations.md`, `memory-hindsight-activation.md` (D87),
      `memory-replica-sync.md` (reconnect callers), `home-window.md`; D86/D88 retarget, D87 close.
- [ ] Finish/archive, journal, HANDOFF §3.2; then queue the batched Stage 2 owner manual acceptance.

## Execution evidence

Append wave/check results here with dates and exact commands.

### Wave A — 2026-09-24 (trellis-implement)

Progress log (updated per part; final gate results at the end of this section).

- Shared done: `memory-hindsight-lifecycle-schema.ts` (+ test), `memory-authority-status-schema.ts` (`hindsight` section,
  `connection_disabled` / `config_changed`), `hindsight-connection-schema.ts` (`HINDSIGHT_BANK_OCCUPIED`,
  `HINDSIGHT_CONNECTION_DISABLED`; Core `hindsight-errors.ts` next-action map extended), `hindsight-setup-schema.ts`
  relaxed `configured` refine (+ test); `index.ts` +2 lines, 488/500 effective lines.
- Core done: `hindsight-unavailable-run.ts` (persona-only assembly, base prompt minus the memory floor, all-false
  capabilities); runtime degrades on `routedBanks()` undefined (`bank_not_ready`) and on an availability failure with no
  capability evidence (`admission_unavailable`); subsystem degrades on `driftReason()` `config_changed` /
  `connection_disabled` after `initializeBaseline`, epoch/lineage still throws; G11 witness via
  `witnessHindsightPrimaryCommit`; connection `driftReason` / `routedBanks` / `readHindsightLiveConnection` +
  `HINDSIGHT_TEMPLATE_CONFLICT` at construction; scheduler `armTimer` catch -> `lastError`;
  `operations/memory-hindsight-lifecycle-status.ts` + `memory-authority-status.ts` mapping (`liveConnection` input wired in
  `main.ts` and the journey fixture; `MemoryOperationsRuntime.driftReason`); `db/timeline-repo.ts`
  `listTimelineCharacterIds`.
- Desktop minimal compile fix: two reason labels in `memory-authority-state.ts` and `local-onboarding-card.tsx`;
  `hindsight` field in `memory-authority-fixtures.ts`.
- Existing tests re-aimed at the new contract: composition drift test (endpoint/secret now degrade, epoch still refuses);
  `run-snapshot-capture-lifetime.test.ts` pre-sync-failure case now expects a memory-unavailable Run (still no admission
  evidence, no extra transport call, no Run row).
- Gates (2026-09-24): `pnpm typecheck` 5/5; `pnpm lint` clean; `pnpm --filter @taki/shared test` 59 files / 531 tests;
  `pnpm --filter @taki/core test` 402 / 3218 (first full run: `db/hindsight-memory-write-repo.test.ts` timed out at 5000 ms
  under load and passed alone — known flake; second full run clean); `pnpm --filter @taki/desktop test` 111 / 635;
  `git diff --check` clean. Core was not booted.

### Wave A follow-up — 2026-09-24 (trellis-implement)

Leader review items (a) and (b).

- (a) Setting-caused unbound runtime degrades: new `memory/hindsight-unbound-run.ts` — `hindsightUnboundReason()` (selected
  epoch, running lifetime, binding `unavailable`: live config disabled/unconfigured -> `connection_disabled`; binding code
  `HINDSIGHT_TEMPLATE_CONFLICT` -> `config_changed`; else null) and `createUnboundHindsightCapture()` (re-reads the marker
  through `readMemoryAuthoritySelection`, admits `createHindsightUnavailableRun` with the committed epoch/lineage and a
  persona assemble, warns `Hindsight Run admitted without memory`; any other cause or an unreadable live config refuses
  `MEMORY_RUNTIME_UNAVAILABLE`). `runtime-composition.ts` `captureRun` routes marker `hindsight` + unbound through it;
  `recordPrimaryCommitted` unchanged (marker-routed witness verified by test). `memory-authority-status.ts` uses the same
  classifier, so status reports `connection_disabled` / `config_changed` and every other unbound state stays
  `not_installed`; `recoverBinding` unchanged.
- (b) `hindsight-runtime-connection.ts` `characterRouted()`; `hindsight-memory-subsystem.ts` `maintenance.run` returns
  before ingestion/curation for an unrouted Character (no Utility model call, no failure log) and its flush returns
  `retryable_failure` `MEMORY_FLUSH_INCOMPLETE` (never `not_required`, so uncovered Timeline rows are kept).
- Tests: `hindsight-unbound-run.test.ts` (new, 4: flag disabled and template conflict each admit a chat.send-level turn
  via `testing/memory-chat-turn-fixture.ts` with witness rows; a corrupt `template_digest` construct failure still
  refuses with its witness kept; setting repaired -> same-epoch recover -> full tools); `hindsight-memory-subsystem.test.ts`
  7 (new unrouted-Character case: 0 model calls over 3 maintenance passes, 20 witnesses kept, no failure logs; mutation
  check without the skip fails); `memory-authority-status.test.ts` 6 (classifier cases); `hindsight-runtime-composition.test.ts`
  23 (two boot-unbound cases re-aimed from refusal to degraded Run).
- Gates (2026-09-24): `pnpm typecheck` 5/5; `pnpm lint` clean; `pnpm --filter @taki/shared test` 59 / 531;
  `pnpm --filter @taki/core test` 403 / 3222 with 1 timeout in `db/hindsight-memory-write-repo.test.ts` (known flake,
  7/7 alone); `pnpm --filter @taki/desktop test` 111 / 635; `git diff --check` clean. Core was not booted.

### Leader verification, wave A — 2026-09-24

- Ruling (a): known configuration states (disabled/unconfigured, template conflict) degrade; unknown unbound refuses.
- `pnpm typecheck` 5/5; `pnpm lint` 0; Shared 59/531; Desktop 111/635; Desktop build ok; `git diff --check` clean.
- Core 3220/3222; the two load timeouts (`hindsight-memory-write-repo`, `skill-package-source`) pass alone 23/23.
- Carried into wave B: re-enabled flag before recover still refuses (`HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE` +
  live `ready`) — must degrade as `config_changed` and trigger automatic revalidate; guard the status read's
  `liveConnection()` so a config/secret read failure cannot throw the whole status.

