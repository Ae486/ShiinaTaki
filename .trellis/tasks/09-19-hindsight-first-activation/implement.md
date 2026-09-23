# Stage 2b Execution Plan

Date: 2026-09-23. Status: in progress. Follow [PRD](prd.md), [design](design.md), [grill](grill.md) and
[research/stage2b-seams.md](research/stage2b-seams.md). Owner direction: after research, proceed autonomously; wave C
starts automatically once wave B's gates pass; a wave-B defect is the only stop. Dispatch one `trellis-implement` per
wave (never finer) with an explicit context-budget brief. The leader owns task/spec/handoff documents. Preserve all
unrelated worktree edits; never commit inside an implementer.

## Planning and activation

- [x] Seam research persisted (`research/stage2b-seams.md`, `README.md`); gap list G1-G11.
- [x] Q1 chat-during-interval decided (grill); engineering rulings G6/G8/G9/G10 recorded.
- [x] PRD R1-R11 / AC1-AC10, design, this plan, context manifests. Task bound to the Claude leader session.

## A. Substrate: contracts, fence/drain, service, custody carry

- [x] Shared: `memory-hindsight-operation-schema.ts`, `memory-activation-schema.ts`, `memory-operation-schema.ts`
      (kind, `hindsight.` prefix in superRefine, error union), compact `index.ts` exports; schema tests.
- [x] Core: `canonical-local-write-fence.ts` threaded through every Local writer (design §3), `CanonicalLocalIngestion.settle()`,
      Block `replace` epoch guard.
- [x] Core: `memory/hindsight-activation/hindsight-activation-service.ts` (start/resume/status, checkpoints, lease policy,
      Bank-boundary stop) over the unchanged B4/D78 primitives; `testing/hindsight-activation-transport.ts`.
- [x] Core: `db/hindsight-activation-custody.ts` inside the promotion transaction; custody repo provider-routed finalize and
      Hindsight candidate; `previousCommit` same-epoch prior; migration 050 only if a column is truly missing.
- [x] Tests: service full chain + every pre-COMMIT matrix row with fault injection; fence/drain; custody carry; lease takeover.
      Headers + `index.md` for every touched folder.

## B. Rebind, operation kind, status read, wiring

- [x] `runtime-selector.ts` bind/recover/boot-unavailable for Hindsight; `runtime-composition.ts` `bindHindsight`,
      `recoverHindsightBinding`, `hindsightBindingSnapshot`, marker-routed `recordPrimaryCommitted`, `captureRun` refusal
      when committed-but-unbound; Local retirement on COMMIT.
- [x] `memory-operation-kind-hindsight.ts` + evidence helper + registry; family exclusions in setup kinds and
      `memory.hindsight.*` RPCs; `disable` authority check.
- [x] `hindsight-activation-status.ts`, `memory-activation-methods.ts`, `memory-authority-status.ts` binding feed,
      `main.ts` wiring and shutdown order.
- [x] Tests: kind handler (admission matrix, claim race/pre-claim cancel, `observeBoot`, immutability after recover), C03
      journey through registered operations (lost reply, restart both sides, bind failure + recover, no redispatch),
      authority/activation status fixtures; isolated boot smoke on a non-default port.

## C. Home

- [x] `ws-client-memory-operations.ts` status method; controller generic submit; `memory-authority-state.ts` labels.
- [x] `hindsight-activation-{card,state,actions}` + `use-hindsight-activation.ts`; Operations page mount; `index.md`.
- [x] Tests: every card state from fixtures, controller submit/race/timeout/hidden page; Desktop build.

## Validation and final review

- [x] One independent `trellis-check` over all S2b changes, PRD AC1-AC10 and the research failure matrix.
- [x] Leader re-runs: `pnpm typecheck`, `pnpm lint`, `pnpm --filter @taki/shared test`, `pnpm --filter @taki/core test`,
      `pnpm --filter @taki/desktop test`, `pnpm --filter @taki/desktop build`, `git diff --check`, isolated boot smoke.
- [ ] Specs: new `memory-hindsight-activation.md`; `memory-operations.md` (kind, families), `canonical-local-memory-runtime.md`
      (write fence, settle), `home-window.md` (card); deferred decisions for anything shipped later.
- [ ] Layered commits (shared/core/ui/docs/trellis), `task.py finish`, `archive --no-commit`, journal, HANDOFF §3.2.
      Manual acceptance is batched with the Stage 2 owner session; never marked here.

## Execution evidence

Append actual wave/check results here with dates and exact commands.

### Wave A — 2026-09-23 (trellis-implement)

- Shared: `memory-hindsight-operation-schema.ts` (request/producer/result/closed codes; `blocking[].localBankId` nullable so extra B3 rows are reportable), `memory-activation-schema.ts` (`superRefine` ties actions to run/authority/operation), `memory-operation-schema.ts` kind+prefix+error union, 7 compact `index.ts` lines (rule still under 500).
- Core fence: `canonical-local-write-fence.ts` (admit/quiesce/release/retire) + `canonical-local-writers.ts` (fenced engine tools/writeEntry/retention, maintenance, flush, tidy, captured Run tools; reads open) installed by `canonical-local-subsystem.ts`, which now exposes `fence` + `ingestion`; `CanonicalLocalIngestion.settle()`; Block `replace` gets `expectedEpochId` (tidy passes it). A fenced tool write answers `{ ok:false, code:"MEMORY_AUTHORITY_FENCED" }` (Legacy-fence shape; `MemoryErrorCode` left closed). Under the fence `captureRun` skips the baseline init instead of refusing (chat stays usable); a new Character's lazy Bank creation is still unfenced (D86) and surfaces as coverage staleness/prerequisite on resume.
- Service `memory/hindsight-activation/` (service/chain/drain/reads/errors + test fixture): drain -> create/lease (`takeOverFrom` added to `acquireLease`) -> capture/recapture -> per-Bank baseline/prepare/import/verify with persisted-evidence replay and supersede receipts after a recapture -> markReady (skipped when the run is already `ready` with the same digest) -> promotion with `beforeCommit` carry -> `fence.retire()`; failures map through `hindsightActivationErrorCode`, lease released, fence reopened only on a positive `canonical-local` + predecessor read; `stop()`/`stopRequested()` for shutdown.
- DB: `hindsight-activation-custody.ts` (refuse incomplete spans, copy unconsumed witnesses, seed cursors, reassign groups; no migration needed), `promoteHindsightAuthority.beforeCommit`, custody `begin`/`finalize` routed by the assigned epoch's provider, `previousCommit` same-epoch Hindsight prior first.
- Defects found in existing code: none blocking; note that only drift-proving refusal reasons persist an invalidation (Shared contract), so a `target_conflict` refusal leaves resume free to resubmit the same frozen request (tested both ways).
- Gates: `pnpm typecheck` -> 1 error, the expected Desktop `memory-authority-state.ts(51,7) TS2741 KIND_LABEL missing "hindsight.activate"`; `pnpm lint` clean; `pnpm --filter @taki/shared test` 58 files / 523 tests; `pnpm --filter @taki/core test` 395 files / 3176 tests with one known load flake (`hindsight-memory-write-repo.test.ts` 5000 ms timeout; passes in isolation 7/7); `git diff --check` clean.
- Deferred: `recover` (binding repair) and the Desktop label are wave B/C; `hindsight-ingestion-source-repo` `previousCommit` is covered in `hindsight-activation-custody.test.ts` rather than a new file.
- `localRuntime` seam wave B must implement: `HindsightActivationLocalRuntime = { fence: CanonicalLocalWriteFence; settle(): Promise<void>; ingestion: Pick<CanonicalLocalIngestion,"run"|"settle"> }` from `local.current()` + `autoMemory.settle`; service input also takes `client(): HindsightClient`, `setup: Pick<HindsightSetupService,"status">`, `custody: Pick<PrimaryMemoryCustody,"status">`; `plan()` feeds admission (mint uuids for `replicaEpochId`/`verificationId`, `hindsightEpochId`, `transactionId`), `control.checkpoint` receives the full producer ref, `control.takeOverFrom` is the observed lease owner when its operation is terminal/foreign-boot.

### Wave B — 2026-09-23 (trellis-implement)

- Rebind: `hindsight-runtime-binding.ts` (draft -> install -> publish, start() once the composition runs, unavailable state + disposal on failure, pure snapshot, `hindsightRuntimeAvailability`, marker-routed `witnessHindsightPrimaryCommit`); `local-runtime-binding.retire()`; `runtime-selector.ts` `bindHindsight` (Local withdrawn only on positive marker proof, never restored) / `recoverHindsight` / boot-unavailable for Hindsight; `runtime-composition.ts` `hindsightBindingSnapshot`, `activationLocalRuntime`, `bindHindsight`, `recoverHindsightBinding` (binding seams extracted), marker-routed `recordPrimaryCommitted`, `captureRun` -> `MEMORY_RUNTIME_UNAVAILABLE` while committed-but-unbound; a selected Hindsight runtime that fails to construct at boot now keeps Core serving (test updated from "throws" to "observable unavailable + recover").
- Service: input gains `fingerprint()` (live drift refuses `HINDSIGHT_CONNECTION_NOT_VERIFIED`) and `runtime` (binding seam); exposes `authority/binding/runtime/committedProducer/recover`; `run()` binds after COMMIT outside the failure path (chain now checkpoints `binding` after promotion, `completed` after the rebind); `readHindsightActivationRun` custody counters read the Hindsight ledger once selected.
- Kind `memory-operation-kind-hindsight.ts` + `memory-operation-hindsight-evidence.ts` + registry row; ctx gains `hindsight`, `activeInFamily`, `latestInFamily`, execution gains `operationId`; `refuseWhileExclusiveFamilyBusy` (setup / local-onboarding / hindsight-activation) applied at admission of every kind in those families; resume replays the prior row's minted ids (never a second verification candidate); recover takes the prior row's identity or rebuilds it from receipts; `disable` refuses under marker `hindsight`; `activationOpen` dep makes `memory.hindsight.validate/setup/disable` refuse `HINDSIGHT_STATE_CONFLICT` while a row is open.
- Reads/wiring: `hindsight-activation-status.ts` (`readHindsightActivationStatus`, family constant), `server/methods/memory-activation-methods.ts` (`memory.activation.status`), `memory-authority-status.ts` `hindsightBinding` feed, `boot/hindsight-activation-boot.ts` (production client factory + live fingerprint; injectable client for tests), `main.ts` +7 lines (569 -> 576: imports, service/kind/method wiring, shutdown `Promise.all([localOnboarding.stop(), hindsightActivation.stop()])` -> memory runtime -> operations).
- Tests: `memory-operation-kind-hindsight.test.ts` (10), `hindsight-activation-journey.test.ts` (6, real composition Legacy -> Local -> retain -> setup.validate/apply -> hindsight.activate; interval commit carried once + setup RPC conflict; lost reply/duplicate/shutdown at a Bank boundary + resume after restart; crash before COMMIT + restart after COMMIT; constructor-spy bind failure with unbound-window witness + recover; corrupt marker), `hindsight-activation-status.test.ts` (3), `memory-activation-methods.test.ts` (2), selector +2, authority status +1, `hindsight-runtime-composition` boot-unavailable rewrite; journey fixture reuses the transport double plus the exported D77 application overlay.
- Defects found in existing code: `canonical-local-write-fence.test.ts` tool options lacked `context` (typecheck error in the working tree, fixed); service `providerLineage` is nullable in Shared (now refused as not verified); `privacy-pause-writer` guard regex matches any `.resume(` call (kind detaches the method instead).
- Gates: `pnpm typecheck` -> 1 error (the expected Desktop `memory-authority-state.ts(51,7)` KIND_LABEL); `pnpm lint` clean; Shared 58 files / 523 tests; Core 399 files / 3200 tests with the known load flake (`hindsight-memory-write-repo.test.ts` 5000 ms timeout under full load; 7/7 in isolation); `git diff --check` clean.
- Boot smoke `research/isolated-process-check.mjs` (temp data dir `taki-s2b-process-*`, free port 2274, provider fetch blocked): migrations 1..49, operator connect, `memory.activation.status` + `memory.authority.status` answered and schema-valid, wrong-marker `hindsight.activate` refused `MEMORY_OPERATION_REFUSED/MEMORY_OPERATION_UNSUPPORTED` (kind registered), SIGINT exit code 0, no listener or child left.
- Deferred: carried witnesses are asserted at the ledger level (unprocessed count, cursor, idempotent re-witness) rather than through a scripted Hindsight ingestion run (needs the D77 write path with model scripting; wave A already proves exactly-once at the repo level); `memory.activation.status` has no dedicated deadline class (the registry has none); Desktop label is wave C.

### Wave C — 2026-09-23 (trellis-implement)

- Lib: `ws-client-memory-operations.ts` gains `memoryActivationStatus()` (`memory.activation.status`, strict `{}`, `MemoryActivationStatusSchema`); `rpc-deadline.ts` registers it as an interactive read (the `WsClient` interface already extends the method group, so no route/methods edit was needed).
- Controller: `memory-operations-controller.ts` is now generic — `createMemoryOperationsController<TStatus>(sink, read)` with one injected status read per instance, generic serialized `submit(request, key)` (`submitSync` delegates to it), reads wait for the memoized per-generation `memory.operations.subscribe` (subscribe-before-read; a failed subscription reports feedback, still reads, retries on the next read), and a timed-out mutation now answers the S2a "操作结果未知" warning before the rediscovery read. `use-memory-operations.ts` passes the authority reader; its test gained the reader and an `memoryActivationStatus` stub.
- View model: `memory-authority-state.ts` exports `MEMORY_OPERATION_KIND_LABEL` (+ `"hindsight.activate": "启用 Hindsight"`, clearing the wave A/B typecheck error), `MEMORY_OPERATION_STATE_LABEL`, `MEMORY_RUNTIME_UNAVAILABLE_LABEL` so the new card reuses them.
- Card: `hindsight-activation-{card,state,actions,fixtures}.ts(x)` + `use-hindsight-activation.ts` mounted after the Local card on `operations-page.tsx` (Stage 1 and Local card files untouched). Setup phase + guidance, Bank prerequisites with missing (`HINDSIGHT_TEMPLATE_NOT_VERIFIED`) / extra (`HINDSIGHT_BANKS_INCOMPLETE`) scopes, producer progress (已受理 vs 执行中 vs 已完成 distinct, counts verbatim), run record, custody counters only when non-zero, committed-but-unavailable with 恢复运行时, interrupted/unknown with 继续, ids/receipts/fingerprint/lease/native Bank ids only in 技术诊断. Actions: 校验连接 / 应用配置 are the only client-derived allow rules (Local authority, `setup.configured === false`, no open family operation, phase-gated: validate from `ready-to-validate|compatible|failed`, apply from `compatible|failed`); `setup.apply.characterId` = first unverified Character Bank in `prerequisites.banks`, else the first Character Bank, else `ACTIVE_CHARACTER_ID`; 启用/继续/恢复运行时/取消 come only from `status.actions`. Hook: hidden page or disconnect retires the generation (`replace(null)`), showing/reconnect re-reads once; refetch on every `memory.operations.changed` push (setup kinds also move the status), no polling, no replay.
- Tests: `hindsight-activation-state.test.ts` (7: every fixture parses, headline/guidance/facts/Bank rows/blocking/diagnostics), `hindsight-activation-actions.test.ts` (16: allow matrix, exact requests, subscribe-before-read + late client, serialized submit per action, cancel by server id, lost reply -> rediscovery without replay, refusal, reconnect race, hidden page, coalescing, failed revalidation lock, subscription retry), `hindsight-activation-card.test.tsx` (10: every state, buttons per actions/pending/disconnected, diagnostics-only ids), `memory-authority-state.test.ts` +1 (label, no Cancel for hindsight.activate).
- Gates: `pnpm typecheck` 5/5 Done, 0 errors; `pnpm lint` clean; `pnpm --filter @taki/desktop test` 111 files / 634 tests; `pnpm --filter @taki/desktop build` ok (pre-existing chunk-size warning); `git diff --check` clean (only the pre-existing `task.json` CRLF notice).
- Deferred: none new. Note for the check: Stage 1 inherits subscribe-before-read and the deadline feedback text through the shared controller (behavioral improvement, Stage 1 card code unchanged); `home-window.md` spec entry for the card is left to the update-spec step.

### Formal check — 2026-09-23/24 (trellis-check, opus)

- Verdict PASS-WITH-FIXES; report `research/check-2026-09-23.md`. Three MEDIUM defects fixed with regressions: F1 drain
  failed on witnesses committed during the forced drain (now only an incomplete span fails; witnesses are carried);
  F2 a Hindsight runtime that constructed but failed to start stayed "healthy" and aborted Core at boot (selector
  `hindsightLive`, boot keeps serving, `recover` republishes); F3 the card offered no 应用配置 remedy for a configured
  instance with an unverified Bank. Added the quiesce-timeout service test. G1-G11 and every failure-matrix row traced.
- New deferrals logged by the leader: D87 (lazy Bank creation outside the fence), D88 (`target_conflict` remedy).

### Leader verification — 2026-09-24

- `pnpm typecheck` 5/5; `pnpm lint` exit 0; Shared 58 files / 523 tests; Desktop 111 / 635; Desktop build ok
  (pre-existing chunk-size warning); `git diff --check` clean (task.json CRLF notice only).
- `pnpm --filter @taki/core test`: 3201/3203; the two failures were 5000/15000 ms load timeouts
  (`hindsight-memory-write-repo.test.ts`, `skill-package-source.test.ts`); both files alone 23/23 pass.
- `node research/isolated-process-check.mjs`: passed on port 14286, migrations 1..49, 0 fetches, exit 0; no listener left.

