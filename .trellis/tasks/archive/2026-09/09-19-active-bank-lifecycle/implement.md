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

- [x] Shared kinds/unions/producer table; Core lifecycle service, occupancy, two kinds, registry/family/context, binding
      `replace`, G13 callback, boot composition, main wiring, Core-derived actions; automatic triggers per Q1/Q2.
- [x] Tests: kind admission matrix, four-family busy, pre-claim cancel, `observeBoot`; lifecycle journey (provision +
      fresh-Bank bind + recall; drift + revalidate + rebind; lineage refusal; outage -> reconnect); D87 journey (AC6);
      isolated boot.
- [x] Gates + commit if clean.

## C. Home

- [x] Authority card readiness rows, labels, two actions; fixtures; tests; Desktop build. Gates.
- [x] Commit if clean.

## Validation and final review

- [x] One independent `trellis-check` over all S2c changes, AC1-AC9 and the failure matrix.
- [x] Leader re-runs all gates + isolated boot.
- [x] Specs: new `memory-hindsight-lifecycle.md`; `memory-operations.md`, `memory-hindsight-activation.md` (D87),
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

### Wave B — 2026-09-25 (trellis-implement)

- Shared: `bank.provision` / `connection.revalidate` requests, producer refs, `bank` / `connection` results and the closed
  lifecycle error codes in `memory-hindsight-lifecycle-schema.ts`; unions + producer table in `memory-operation-schema.ts`
  (+ test); `index.ts` 488/500 effective lines (unchanged count, names folded into existing statements).
- Core producers (`memory/hindsight-lifecycle/`): context, reads, `hindsight-bank-occupancy.ts` (client `bankStats`),
  provision (template/fingerprint/runtime guards, occupancy, dry-run, unchanged `applyHindsightBank`, one full replica run),
  revalidate (Stage 4/5 blocker, lineage admission, export-verify without row writes, evidence record, `verifiedReconnect`
  or binding `replace`), service (setup deadline, stop interruption), trigger (R8, once per key from persisted rows).
- Core kinds: `operations/memory-operation-kind-bank.ts`, `-kind-connection.ts`, `-lifecycle-settlement.ts`; family
  `hindsight-lifecycle` in `EXCLUSIVE_MEMORY_FAMILIES`; `db/hindsight-lifecycle-attempt-reads.ts`.
- Binding `replace` + selector/composition seam; G13 `verifiedReconnect` on the subsystem; `boot/hindsight-lifecycle-boot.ts`;
  `main.ts` wiring (trigger late-bound; lifecycle stops with local/activation before the runtime — order kept); status
  actions derived from open `bank.provision` rows and exclusive-family business.
- Carried: re-enabled flag before recover degrades as `config_changed` (`hindsight-unbound-run.ts`) and reports to
  `onUnavailable`; status read guards `liveConnection()` (unreadable -> `unconfigured`).
- Desktop minimal: two `MEMORY_OPERATION_KIND_LABEL` entries in `memory-authority-state.ts`.
- Tests: `memory-operation-kind-lifecycle.test.ts` 5 (admission matrix, four-family busy, pre-claim cancel, two
  `observeBoot`); `hindsight-lifecycle-journey.test.ts` 13 (AC1 provision + bind + recall + degraded turn ingested once;
  occupied refusal; template conflict zero native calls; drift -> rebound, old scheduler stopped once; `replace` under an
  in-flight Run; disabled / deploymentMode / template / lineage refusals keep the binding; outage -> exactly one
  `verifiedReconnect`; automatic provision once across restart; automatic revalidate; automatic busy refusal; D87).
- D87 (AC6): first report stopped after half 2; closed in full by the S2b verification-id fix below.
- Gates (2026-09-25): `pnpm typecheck` 5/5; `pnpm lint` clean; `pnpm --filter @taki/shared test` 59 / 532;
  `pnpm --filter @taki/core test` 405 / 3242 (no flake this run); `pnpm --filter @taki/desktop test` 111 / 635;
  `pnpm --filter @taki/desktop build` ok; `git diff --check` clean.
- Isolated boot: `node .trellis/tasks/09-19-active-bank-lifecycle/research/isolated-process-check.mjs` passed — port 8718,
  migrations 1..49, `memory.authority.status` schema-valid (`hindsight: null`) on Legacy and after RPC Local onboarding,
  both kinds refused `MEMORY_OPERATION_REFUSED` / `MEMORY_OPERATION_UNSUPPORTED` on the Local marker with no row,
  0 fetches, exit 0; `netstat -ano` afterwards: only a PID 0 `TIME_WAIT`, no listener, child pid gone.

### Wave B follow-up — 2026-09-25 (trellis-implement)

Leader ruling on D87 plus two review items.

- S2b verification-id fix (separate `fix(core)` commit): `hindsight-activation-chain.ts` presents
  `preparationVerificationId(base, preparationId)` (the existing `hindsightOperationUuid` over both) instead of the per-Bank
  base, so a recapture's preparation gets its own native id and a replay of the same preparation the same one; derivation
  over re-minting in `mintRef` because admission cannot know whether execution will recapture, and derivation needs no
  new persisted state. Readers audited: orchestrator/candidate/invalidation repos key by the presented id (unchanged);
  `hindsight.activate` `observeBoot` never reads it; `readCommittedHindsightProducer` now returns the native
  per-preparation id (documented; a committed run is never replayed through the chain). Test double: `currentImportFixture`
  answers `superseded_count: request.supersede.length` (batch id when superseding); the transport refuses a changed
  verification request under a used id with 409 `request_conflict`, like native. Tests: service (recapture after a posted
  verification -> interrupted verify -> resume, ids derived per preparation and unique, conflict refusal by the double),
  kind (same across a `boot-b` restart, base ids replayed by `mintRef`), kind rebuild assertion re-aimed. Mutation checks:
  presenting the base id fails both with `HINDSIGHT_CURRENT_NATIVE_REFUSED` (request_conflict); `superseded_count: 0`
  fails the service test at the import proof.
- D87 journey now completes: resume after 应用配置 -> `activated`, marker Hindsight, a mika Run served with recall.
- deploymentMode: a restart with a changed mode binds the runtime on the live settings (status drift `unreviewed`), so the
  blocker's runtime reference carried the new mode and revalidate passed `unchanged`, recording the new fingerprint.
  Fixed in `hindsight-lifecycle-reads.ts`: the runtime is the mode reference only when built on the reviewed fingerprint,
  otherwise only an unchanged reviewed fingerprint proves it; test: refused `HINDSIGHT_STATE_CONFLICT` at `reserved`, no
  export, reviewed fingerprint kept. Remaining (proposed deferral): boot itself still binds unreviewed settings, and a legit
  Stage 4 change made across a restart cannot be revalidated until the reviewed deployment mode is persisted.
- Automatic revalidate with a changed lineage: one failed automatic attempt (`HINDSIGHT_REPLICA_LINEAGE_MISMATCH`,
  phase `validating`), binding kept, no retry on the next degraded Run (new journey test).
- Gates (2026-09-25): `pnpm typecheck` 5/5; `pnpm lint` clean; Shared 59 / 532; Core 405 / 3246 (no flake);
  Desktop 111 / 635; Desktop build ok; `git diff --check` clean; isolated boot passed again (port 7751, 1..49, 0 fetches,
  exit 0; only a PID 0 `TIME_WAIT` left, no listener).

### Wave B follow-up 2 — 2026-09-25 (trellis-implement)

Leader ruling: persist the reviewed deployment mode instead of deferring the cross-restart gap.

- Migration 050 `db/migrations/050-hindsight-reviewed-deployment-mode.ts`: nullable `reviewed_deployment_mode` on
  `hindsight_connection_state` (CHECK against the Shared mode values; NULL = pre-050 row). Registered in `index-list.ts`;
  head pins in the migration/lineage/pending-memory/scheduled-task tests moved to 50.
- `db/hindsight-connection-repo.ts`: `save(snapshot, expectedRevision, reviewedDeploymentMode?)` writes the mode in the same
  UPDATE (given -> set; omitted -> kept only while the fingerprint is unchanged, else NULL); `reviewed()` reads fingerprint +
  mode. Core-internal, not in the Shared snapshot. Writers: setup validate (`compatible`) and apply (`configured`) pass the
  connection's mode; revalidate `record()` passes the live mode.
- `hindsightRevalidateBlocker` (no `reviewedFingerprint` parameter any more): the persisted mode is the reference (mismatch
  -> `HINDSIGHT_STATE_CONFLICT`); NULL keeps the earlier fail-closed rule. Status `actions.revalidate` is false whenever the
  same lifecycle `revalidateBlocker` refuses (`memory-authority-status.ts` optional `lifecycle` input, wired in `main.ts`
  and the journey fixture; an unreadable blocker read counts as blocked); drift still shows.
- Tests: migration 050 (applies on a 049 DB, legacy row unchanged with NULL mode; CHECK); repo (mode kept/cleared with
  its fingerprint, stale revision refused); status unit (blocked hides revalidate, drift kept); journey: in-process and
  cross-restart mode change offer no revalidate, cross-restart refusal keeps fingerprint + mode; cross-restart timeout
  change -> revalidate `unchanged`, reviewed fingerprint + mode advance, then an in-process key rotation -> `rebound`,
  recall served; a pre-050 NULL row stays fail-closed across a restart (status offers none, refused at `reserved`).
  Mutation checks: ignoring the persisted mode fails the benign cross-restart test; dropping the status gate fails three
  journey tests.
- PRD R9 migration line: already reads "One migration (050)" (leader edit). Isolated boot script expects head 50.
- Gates (2026-09-25): `pnpm typecheck` 5/5; `pnpm lint` clean; Shared 59 / 532; Core 406 / 3251 (no flake); Desktop
  111 / 635; Desktop build ok; `git diff --check` clean; isolated boot passed (port 4854, 1..50, 0 fetches, exit 0);
  `netstat -ano` afterwards: only a PID 0 `TIME_WAIT`, child pid gone.

### Leader verification, wave B — 2026-09-25

- Rulings: fold the S2b verification-id defect and the D87 double gap into wave B (committed separately as `fix(core)`);
  persist the reviewed deployment mode (migration 050, PRD R9 amended) instead of deferring the cross-restart revalidate gap.
- `pnpm typecheck` 5/5; `pnpm lint` 0; Shared 59/532; Core 406/3251 (no flake); Desktop 111/635; Desktop build ok;
  `git diff --check` clean; isolated boot passed (port 5281, migrations 1..50, 0 fetches, exit 0, no listener left).
- Commits: e5f172d (fix core, S2b verification id), f831880 (shared), 2bf5cb7 (core), 2c07d6a (ui).
- For the formal check: `main.ts` is 585 lines (578 at HEAD before the wave, pre-existing overage); `readCommittedHindsightProducer`
  now returns the native per-preparation id (safe only while committed runs are never replayed through the chain).

### Wave C — 2026-09-25 (trellis-implement)

- `memory-hindsight-lifecycle-state.ts` (new, 64 lines): `hindsightLifecycleView(status)` -> null unless `status.hindsight`;
  connection rows (config 已配置 / reused `connection_disabled` label / 未填写连接参数; drift and 上次校验通过 only for a ready
  config — reused `config_changed` label, 与已校验的配置一致, 当前配置尚未校验; null admittedAt -> 无记录), per-scope readiness
  rows (可用 / 同步中 / 创建中 / 失败 / 未创建), diagnostics (`nativeBankId` + `errorCode` only there), action descriptors from
  `hindsight.actions` only: 重新校验连接 `{ kind: "connection.revalidate", expectedEpochId: authority.epochId }` key `revalidate`
  (omitted when the epoch id is null), 创建 Bank（id）`{ kind: "bank.provision", characterId }` key `provision:<id>`.
- `memory-hindsight-lifecycle-block.tsx` (new, 34 lines): child block of the authority card; buttons call `ops.submit(request,
  key)`, disabled by the card's existing lock (`!connectionReady || busyKey !== null`), busy on the matching key; collapsed
  技术诊断.
- `memory-authority-card.tsx`: renders the block when the section is non-null (also while the runtime is unavailable);
  `memory-authority-state.ts`: `bankScopeLabel()` shared by replica and readiness rows; `use-memory-operations.ts`: exposes the
  controller's generic `submit`; `memory-authority-fixtures.ts`: `lifecycleBank` / `lifecycleSection` (every readiness state,
  `config_changed`, revalidate on, provision `[nana, yui]`) / `degradedStatus`; `index.md` updated.
- Tests: `memory-hindsight-lifecycle-state.test.ts` 6 (fixtures schema-valid incl. disabled / unconfigured / unreviewed / settled;
  null under Local and Legacy; every readiness label with codes/native ids only in diagnostics; both reasons reuse the runtime
  labels; actions exactly from Core incl. an unlisted `not_provisioned` Bank with no button and null epoch; exact payloads and
  keys through a real controller); `memory-hindsight-lifecycle-block.test.tsx` 2 (onClick props drive `submit` with exact
  request + key; lock and busy per button); `memory-authority-card.test.tsx` +3 (no block under Local; degraded block with
  labels, buttons exactly from actions, code only after 技术诊断; disabled while pending / disconnected). Mutation checks:
  offering revalidate without `actions.revalidate` fails 3 tests; putting `errorCode` in a readiness row fails 2.
- Gates (2026-09-25): `pnpm typecheck` 5/5; `pnpm lint` clean; `pnpm --filter @taki/desktop test` 113 / 646; `pnpm --filter
  @taki/desktop build` ok (existing chunk-size warning only); `git diff --check` clean. No Core/Shared change; Tauri and Core
  not launched.
- Deviations: the block lives in its own child component file instead of inline in the card (distinct concern); the
  active-operation row for the two new kinds keeps the kind label without a target suffix (unchanged from wave B).

### Formal check — 2026-09-25

- Verdict PASS-WITH-FIXES; full report `research/check-2026-09-25.md`.
- Fixed: F1 (MEDIUM, R1) `hindsightUnboundReason` degraded any unbound code once the connection was disabled — now only the
  connection guard's own codes; F2 Shared refine: Hindsight authority names epoch + lineage; F3 `actions.provision` bounded
  like the request (160); F4 production non-null assertions in `memory-operation-kind-bank.ts` / `hindsight-lifecycle-provision.ts`;
  F5 formatting; F6 tests for revalidate replace failure (+ recoverBinding), reverse four-family busy, provision with no runtime.
- Not fixed: F7 Desktop fixture offers provision under an unavailable runtime (test-only realism). Uncovered: dedicated
  revalidate health/version failure test.
- Gates: typecheck 5/5; lint clean; Shared 59/532; Core 406/3252 (no flake); Desktop 113/646; Desktop build ok;
  `git diff --check` clean; isolated boot passed (port 8341, 1..50, 0 fetches, exit 0), no listener left.
- Leader follow-up (same day): F1 accepted (`MEMORY_AUTHORITY_MISMATCH` degrades only under a non-ready config; reasoning
  in the report O6). F7 fixed: lifecycle fixtures reshaped to Core's derivation (serving / provisioning / changed /
  unreviewed / disabled sections, `HINDSIGHT_TEMPLATE_INVALID` failed row, native ids on mappable Banks, the Core-produced
  unmappable Timeline Character kept, null-epoch case dropped). Revalidate health (503 -> `HINDSIGHT_UNREACHABLE`) and version
  (`HINDSIGHT_VERSION_UNSUPPORTED`) failures tested: failed / producer_failed at `validating`, reviewed fingerprint + mode,
  B3 fingerprint and Bank rows unchanged, old binding kept; automatic variant settles once with one probe and never retries.
  Gates: typecheck 5/5; lint clean; Core 406/3254; Desktop 113/646; Desktop build ok; `git diff --check` clean.

### Spec update — 2026-09-25

- New `.trellis/spec/backend/memory-hindsight-lifecycle.md`: degrade-vs-refuse table (incl. `DISABLED_CODES`), witnesses and
  exactly-once ingestion, `bank.provision` / `connection.revalidate` (admission, occupancy, blocker, reviewed fingerprint +
  mode and NULL fail-closed, `replace` ordering), settlement/boot table, four exclusive families, automatic triggers,
  `verifiedReconnect` callers, status section + actions, common mistakes, known limits.
- Updated: `backend/memory-operations.md` (kinds, explicit producer table, four families, origin, `MemoryOperationsRuntime`
  fields, status inputs), `backend/memory-hindsight-activation.md` (per-preparation verification id, D87 closed, D88
  retargeted, `readCommittedHindsightProducer` note), `backend/memory-replica-sync.md` (reconnect callers, `armTimer`
  `lastError`), `backend/hindsight-application-runtime.md` (capture without evidence degrades on availability failure),
  `backend/index.md` (new row), `frontend/home-window.md` (readiness block, actions only from `hindsight.actions`,
  collapsed diagnostics). `database-guidelines.md` lists no migration heads; unchanged.
- `docs/deferred-decisions.md`: D87 DONE (AC6 journey tests, e5f172d / 2bf5cb7); D86 retargeted (Stage 4 reverse transition /
  Stage 3 backup identity); D88 retargeted (Stage 3/5; transient `target_conflict` keeps re-POST, reset = whole-Bank DELETE).
  No new entry: the check lists no deferred item without a home (boot binding on unreviewed settings is the AC5 contract).

### Leader verification, final — 2026-09-25

- Check verdict PASS-WITH-FIXES (`research/check-2026-09-25.md`); leader accepted F1 (MEMORY_AUTHORITY_MISMATCH degrades
  only under a non-ready config) and had F7 plus the revalidate health/version tests closed instead of deferred.
- Spec-agent ambiguities accepted as stated in `memory-hindsight-lifecycle.md`: a busy/changed-state automatic refusal
  leaves no row (the once-guard counts admitted automatic rows only); a Bank left `syncing` offers no provision action and
  recovers through ordinary B5 scheduling (re-submit stays admitted and idempotent).
- Gates after all fixes: `pnpm typecheck` 5/5; `pnpm lint` 0; Shared 59/532; Core 406/3254 (no flake); Desktop 113/646;
  Desktop build ok; `git diff --check` clean; isolated boot passed (port 1249, migrations 1..50, 0 fetches, exit 0).
- Commits: wave C 37b0703; check fixes 3929490 (shared), 1b4ccdb (core), fc6964f (ui).
- Owner manual acceptance: batched with Stage 2a/2b; not marked here.
