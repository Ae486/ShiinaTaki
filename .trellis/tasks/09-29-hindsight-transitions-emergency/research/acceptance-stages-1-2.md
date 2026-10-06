# Independent acceptance review: Hindsight Stages 1, 2a, 2b and 2c

Date: 2026-09-29. Reviewed HEAD: `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.

## Verdict

**REQUIRES REMEDIATION for Stage 1 outcome truthfulness.** A fresh counterexample with the real B5 scheduler and SQLite proves that a failed manual replica sync can be persisted as `completed`, with its error and next action cleared. The existing focused suites all pass, so the earlier acceptance evidence does not cover this case.

The current focused automated coverage for Stages 2a, 2b and 2c passes. A second probe exposes a documentation inconsistency about new-Character Bank creation during the Local write fence; the later D87 journey explicitly handles this interval safely, so this is not reported as an unsafe authority promotion.

Stage 4 research and design may continue. Correct finding F1 before treating manual operation completion as a trustworthy transition prerequisite or closing Stage 4 acceptance. Owner/manual acceptance remains **pending for Stage 6 under D89** (`docs/HANDOFF.md:209`); no historical or current automated result below substitutes for it.

## Scope, environment and evidence discipline

- Verified `H:/TakiAgent`, branch `main`, and the worktree list before review. No task work was performed in the T4 or Claude worktrees.
- The session pointer `.trellis/.runtime/sessions/codex_01a0eaf4-aea6-7e51-9353-71ca36d634bf.json:4` names `09-29-hindsight-transitions-emergency`; its `task.json` remains `planning`.
- Toolchain used: Node `v24.18.0`, pnpm `10.22.0`, Vitest `4.1.10`. Package scripts were inspected before test execution. Every Vitest invocation used `--maxWorkers=2`.
- Read root `AGENTS.md`, `CLAUDE.md`, relevant `CONTEXT.md` vocabulary, backend/frontend spec indexes, the requested memory contracts, Home/reactive read-model/WS guidance and `trellis-check/SKILL.md`. The user-authorized review scope overrides the skill's auto-fix instruction.
- Reviewed the Stage 1/2 archived PRDs, relevant design/implementation/check sections, and the native-smoke/capture-sync-resilience regression evidence. `docs/HANDOFF.md:181` supplies the superseding Stage 1-3/D89 allocation.
- Test fixtures use in-memory SQLite or established `mkdtemp` journey directories with isolated config (`env: {}`), scripted models and injected transport doubles. No native Hindsight service, original database, real model, paid resource or external request was started by this review.
- Production files, existing tests, specs, archives, runtime config and Git history were not changed. Review artifacts are confined to this report and `research/evidence-stages-1-2/`. `git diff --name-only -- packages apps` was empty at final source verification; HEAD remained unchanged.

## Findings

### F1 — Medium: a preceding run's success masks the requested manual sync's failure

**Locations:** [classifier](../../../../packages/core/src/memory/operations/memory-operation-kind-replica.ts) (`H:/TakiAgent/packages/core/src/memory/operations/memory-operation-kind-replica.ts:90`), especially the success branch at line 91; failure persistence at `packages/core/src/db/hindsight-replica-schedule-state.ts:68`; claim/success timestamps at `packages/core/src/db/hindsight-replica-scheduler-repo.ts:97` and `:134`.

**Trigger:** a catch-up/automatic run is already active when the operator submits `replica.sync`. That earlier run succeeds after admission; the subsequently claimed manual run fails. The scheduler retains the earlier `lastSuccessAt`, as it should for historical status. Once `pendingManualKind` and `run` become null, the operation classifier checks only `lastSuccessAt >= admittedAt` before considering the current failure.

**Fresh reproduction:** [acceptance-reproductions.test.ts](evidence-stages-1-2/acceptance-reproductions.test.ts:19), first test, uses the real scheduler, its repos/leases and the real durable operation service. Only the data-plane runner is substituted. The final recorded sequence is:

| Time | Event / persisted evidence |
| --- | --- |
| `00:00:00` | Earlier `catch_up` starts and is held. |
| `00:00:01` | `replica.sync` is admitted and its manual request queues. |
| `00:00:02` | The earlier run succeeds; the manual run is claimed. |
| `00:00:03` | The manual runner throws `HINDSIGHT_UNREACHABLE`. |
| Terminal Bank state | `mode=failed`, `errorCode=HINDSIGHT_UNREACHABLE`, `nextAction=automatic_retry_scheduled`, `lastSuccessAt=00:00:02`. |
| Terminal operation | **`state=completed`, `errorCode=null`, result `errorCode=null`, `nextAction=null`.** |

The expected `failed` assertion is red on HEAD; the repro was confirmed twice, with the final run retained in [reproduction-console.log](evidence-stages-1-2/reproduction-console.log) and [reproduction-results.json](evidence-stages-1-2/reproduction-results.json). This is not an attribution difference of a few milliseconds: the earlier success genuinely occurred after this operation's admission. A current failure is positively persisted.

**Consequence:** all observers consistently read the same incorrect durable success; the operation loses the actionable error/retry outcome. An operator or later coordinator that trusts `completed` can proceed despite the requested synchronization having failed. The Bank's own status remains truthful, and this reproduction does not demonstrate data loss or an unsafe authority COMMIT.

**Coverage gap:** `memory-operation-kind-replica.test.ts:87` covers a previous in-flight run, but both that run and the manual run succeed. The normal failure test has no intervening successful run. D84 records supervisor attribution and cancellation precision limits; neither makes this false terminal success acceptable.

**Stage 4 impact:** blocks using this operation result as successful synchronization evidence, and blocks unconditional acceptance of the operation foundation. It does not block Stage 4 preparation. Minimum remediation is in `replicaSyncKind.classify`: retain the actual failure of the claimed manual work and require positive evidence of that work's success. Add the preceding-success/manual-failure regression with real scheduler state. Merely tightening timestamp comparison is insufficient when completion and the next claim share a timestamp; preserve/run-correlate producer outcome where necessary.

### F2 — Low: the Local fence contract overstates what new-Character capture skips

**Locations:** `.trellis/spec/backend/canonical-local-memory-runtime.md:117` says capture skips the Bank/baseline write while fenced. `packages/core/src/memory/canonical-local-writers.ts:63` skips its explicit call, but line 64 still calls `engine.captureRun`. That reaches `router(characterId)` at `packages/core/src/memory/canonical-local-runtime.ts:55`, and `captureAssembly` at line 75, both of which call `ensureCanonicalLocalBanks`; the missing Character Bank is inserted at `packages/core/src/memory/canonical-local-banks.ts:29`.

**Fresh reproduction:** the second test in [acceptance-reproductions.test.ts](evidence-stages-1-2/acceptance-reproductions.test.ts:71) onboards through the real Local operation path, quiesces its published fence, then captures a previously unseen Character. `fence.writable()` stays false but the actual Local Bank count grows from **2 to 3**. The no-write assertion derived from that spec sentence is red.

**Interpretation:** the later accepted D87 behavior is explicit in `.trellis/spec/backend/memory-hindsight-activation.md:183` and `packages/core/src/memory/hindsight-lifecycle/hindsight-lifecycle-journey.test.ts:480`: the interval Character makes activation stale/blocking until setup verifies its Bank, then resume succeeds. That existing journey passed freshly. Therefore this is a verified **contract/documentation inconsistency**, not a claim that the implementation silently promotes incomplete coverage.

**Stage 4 impact and minimum remedy:** not a Stage 4 preparation blocker. Correct/narrow the Local fence wording and carry the tested D87 exception into Stage 4's freeze/capture assumptions. Do not assume `quiesce()` alone freezes the Bank inventory; keep an explicit inventory/coverage recheck or provide a stronger capture fence if the new transition requires one. No source/spec change was made in this review.

## Criteria coverage

For Stage 1, AC numbers below follow the order of its unnumbered PRD acceptance bullets. **Fresh automated** means a current focused test executed in this review; **source** means wiring was inspected; **historical** is explicitly not re-executed evidence.

| Stage / criteria | Current evidence | Result / limitation |
| --- | --- | --- |
| S1 AC1-2, AC9: discovery, duplicate refusal, two observers, subscription cleanup | `memory-operation-service.test.ts`, `memory-operation-kind-replica.test.ts`, `memory-operation-methods.test.ts`; service and connection-scoped fan-out source | Fresh automated pass for discovery/identity/cleanup. Same service result is returned to every observer. No live two-WebSocket process test was run now. |
| S1 AC3: manual success/failure and retry outcomes | Normal tests pass; independent real-scheduler counterexample F1 fails | **Fail: false `completed` under overlapping previous success.** |
| S1 AC4-7: cancellation, setup delegation, restart unknown, interrupted setup recovery and failed-validation evidence | Operation service, real replica-kind, setup-service/recovery and setup-method tests | Fresh automated pass for covered branches; D84's disclosed imprecision remains. |
| S1 AC8: authority/runtime/setup/replica/Pending separation | Core authority/lifecycle status and Shared authority-schema tests | Fresh automated pass; unknown remains unknown. |
| S1 AC10: Home loading/healthy/error/unavailable, serialized actions, stale client rejection | Authority card/state and operations-controller tests | Fresh fixture/controller pass; live Home manual acceptance pending. |
| S1 AC11-12: migrations and common gates | Current temporary fixtures open through `MIGRATIONS`; root owns whole-workspace gates | Fresh in-process migration application covered. Dedicated full lineage suite/build/typecheck/lint/process boot not rerun here. |
| S2a AC1-3, AC5: empty/Legacy onboarding, inventory, replacement, interruption/resume, exclusion and evidence verification | Local onboarding tests; all selected legacy-migration suites; Local runtime-activation-failure test | Fresh automated pass, including scoped Local retain/recall after reopen with scripted/unused models. |
| S2a AC4, AC6-7: one owner, pre/post-COMMIT, binding-only repair, cancellation, restart | Local-kind, onboarding-service, Local-binding and runtime-activation-failure tests | Fresh automated pass. Receipt-based recovery and immutable terminal history retained. |
| S2a AC8: complete Home onboarding states and no replay | Local onboarding controller (23 tests) and card (10 tests) | Fresh automated pass; actual Home user journey not claimed. |
| S2a AC9, AC11: exact primary custody, late/failing terminal turns, retirement refusal | Chat primary custody (7), custody repo (8), runtime activation and candidate/source tests | Fresh automated pass; production `main.ts:404` injects primary persistence and Chat finalizes it in `chat-agent.ts:237` (source). |
| S2a AC10 | Current focused suites; archived check/boot evidence; root common gates | Automated subset covered; owner manual acceptance pending under D89. |
| S2b AC1-2, AC4: full C03 chain, admission, per-Bank failures, replay identities | Activation journey (6), activation service (20), activation kind (11), status/schema/method tests | Fresh automated pass. Lost responses replay evidence; native POST identity and per-preparation verification-id cases covered. |
| S2b AC3: all writer surfaces/drain, incomplete span and quiescence timeout | Canonical Local fence, activation-service and runtime tests | Fresh automated pass for memory-write fencing/drain. **F2 narrows the claimed Bank-inventory freeze.** |
| S2b AC5-7: PR03 custody carry, COMMIT/bind interval, failed binding/recover, restart/corrupt marker | Activation custody, journey, kind, Hindsight composition tests; carry source within promotion transaction | Fresh automated pass. No Local/Legacy fallback after Hindsight COMMIT. |
| S2b AC8-9: strict status and Home actions | Core status/method tests, Shared activation schemas, Home actions/state/card tests | Fresh automated pass; no mutation replay on lost reply/remount. |
| S2b AC10 | Current focused suites; archived isolated process check | Root common gates and Stage 6 manual/native acceptance remain separate. |
| S2c AC1-3: degraded turn custody, provision occupancy, first-sync/retry, drift and replacement | Lifecycle journey (20), lifecycle-kind (5), Hindsight composition and unbound-run tests | Fresh automated pass for covered failure matrix. Reviewed deployment mode survives restart and lineage changes refuse. |
| S2c AC4: outage, foreground recovery, no scheduler/WS reconnect trigger | Lifecycle journey, capture-sync (10), foreground recall lifetime (9), sync-runner (7) | Fresh automated pass, including post-smoke bounded admission and native-conflict retry behavior. |
| S2c AC5-6: restart, template/config refusal, D87 interval/new Character | Lifecycle-kind/journey and unbound-run tests | Fresh automated pass, no redispatch and no implicit authority switch. |
| S2c AC7-8: readiness/actions schemas and Home | Core/Shared lifecycle status tests; Home lifecycle state/block and authority card | Fresh automated pass for readiness, pending/disconnected guards and exact submit shapes. |
| S2c AC9 | Focused current suites; historical head-050 boot evidence | Whole-workspace and owner acceptance not attributed to this subreview. |

## Production wiring checked

1. **Core -> operation owner -> producer:** `packages/core/src/main.ts:251` composes Local onboarding; lines 259-269 compose activation/lifecycle and bind the automatic trigger only after the sole operation owner exists. `memory-operation-service.ts:96` seals the request/producer row before execution; its boot observation at line 84 runs before foreign-row fallback. Shared kind/producer/result unions and the explicit producer table constrain the wire.
2. **Exclusive operations and cancellation:** `memory-operation-contract.ts` contains the five-family exclusive guard (including Stage 3 backup). Stage 2 handlers use deferred claim and pre-claim cancel. Per-Bank replica synchronization remains a separate scheduler-backed family. Current lifecycle/activation/Local tests exercise mutual guards and no native work after a cancelled claim. Stage 3 backup-specific mutual-exclusion coverage belongs to the sibling Stage 3 reviewer.
3. **Primary custody:** `primary-memory-custody-repo.ts:59` registers append plus exact member atomically; line 145 finalizes witnessed membership in a transaction; line 182 only recovers a dead/settled producer. `hindsight-activation-custody.ts:12` carries unconsumed witnesses and open/finalized groups inside promotion. `runtime-composition.ts:91` routes primary commits through the selected subsystem or durable Hindsight marker during the bind interval.
4. **Single binding and lifetime:** `runtime-composition.ts` selects Local/Hindsight capture and resolves flush from the current publication. `hindsight-runtime-binding.ts` drafts, installs, publishes and starts; failures withdraw publication. `runtime-selector.ts` verifies committed identity before repair/replace. The current journey tests cover held old Run failure, new Run availability, failed replacement and binding-only recovery.
5. **Core -> Shared -> Home:** operator-only registrations in `server/methods/memory-operation-methods.ts` parse Shared results and subscribe by physical connection; `server/memory-operation-subscriptions.ts` isolates dead sinks. `ws-client-memory-operations.ts` parses Shared schemas and memoizes subscribe per client. `ws-client-routes.ts:177` validates/fans changes; the Home controller installs listeners/subscribes before reads, coalesces invalidations and checks client plus generation before applying outcomes. `operations-page.tsx:38` mounts authority, onboarding and activation cards.

These are source checks plus the named in-process tests, not a new native end-to-end smoke.

## Executed checks and exact test arguments

All output lives in [evidence-stages-1-2](evidence-stages-1-2/). Define `$evidence` as `H:/TakiAgent/.trellis/tasks/09-29-hindsight-transitions-emergency/research/evidence-stages-1-2`. Core's exact filter array is preserved in [core-filters.txt](evidence-stages-1-2/core-filters.txt); `@filters` below expands those lines, in order. The package commands used were:

```powershell
# cwd H:/TakiAgent/packages/core; @filters is exactly core-filters.txt
pnpm exec vitest run --maxWorkers=2 --reporter=default --reporter=json --outputFile.json="$evidence/core-results.json" @filters 2>&1 | Tee-Object -FilePath "$evidence/core-console.log"

# cwd H:/TakiAgent/packages/shared
pnpm exec vitest run src/memory-operation-schema.test.ts src/memory-authority-status-schema.test.ts src/memory-local-onboarding-schema.test.ts src/memory-hindsight-operation-schema.test.ts src/memory-activation-schema.test.ts src/memory-hindsight-lifecycle-schema.test.ts src/hindsight-setup-schema.test.ts src/hindsight-connection-schema.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile.json="$evidence/shared-results.json" 2>&1 | Tee-Object -FilePath "$evidence/shared-console.log"

# cwd H:/TakiAgent/apps/desktop
pnpm exec vitest run src/windows/home/pages/operations/memory-operations-controller.test.ts src/windows/home/pages/operations/memory-authority-card.test.tsx src/windows/home/pages/operations/memory-authority-state.test.ts src/windows/home/pages/operations/local-onboarding-controller.test.ts src/windows/home/pages/operations/local-onboarding-card.test.tsx src/windows/home/pages/operations/hindsight-activation-state.test.ts src/windows/home/pages/operations/hindsight-activation-card.test.tsx src/windows/home/pages/operations/hindsight-activation-actions.test.ts src/windows/home/pages/operations/memory-hindsight-lifecycle-block.test.tsx src/windows/home/pages/operations/memory-hindsight-lifecycle-state.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile.json="$evidence/desktop-results.json" 2>&1 | Tee-Object -FilePath "$evidence/desktop-console.log"

# cwd H:/TakiAgent; intentionally red contract counterexamples, final retained run
pnpm exec vitest run .trellis/tasks/09-29-hindsight-transitions-emergency/research/evidence-stages-1-2/acceptance-reproductions.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile.json=.trellis/tasks/09-29-hindsight-transitions-emergency/research/evidence-stages-1-2/reproduction-results.json 2>&1 | Tee-Object -FilePath .trellis/tasks/09-29-hindsight-transitions-emergency/research/evidence-stages-1-2/reproduction-console.log
```

Each command propagated `$LASTEXITCODE` to the tool result.

| Check | Exit | Files | Tests | Duration |
| --- | --- | --- | --- | --- |
| Existing focused Core | 0 | 43 passed | 277 passed | 71.19 s |
| Existing focused Shared | 0 | 8 passed | 32 passed | 3.18 s |
| Existing focused Desktop | 0 | 10 passed | 97 passed | 5.53 s |
| Review-only counterexamples, final run | 1, expected | 1 failed | 2 failed assertions documenting F1/F2 | 7.43 s |

**Existing-suite total: 61 files / 406 passing tests.** There were no unexplained existing-suite failures or skips. Chat custody tests deliberately emit fixture `stream failed` errors while asserting retained-source behavior. The two red review probes are additional acceptance evidence, not edits to or failures of the existing package suites. The probes were repeated once after correcting their type annotation/log timestamp field; both runs reproduced the same behaviors. Final logs supersede the first probe run.

## Historical native evidence and residual limits

- The archived 2026-09-25 native smoke proves steps 1-8 on an isolated real native instance, including second-connection operation reads and one-time ingestion, but its extra post-ingestion step 6b found D1/D2/D3. It is not an unconditional pass for the old implementation.
- `09-26-hindsight-capture-sync-resilience/implement.md:91` records the later native rerun passing steps 1-8 and 6b. That run predates the final admission-budget clamp: its first 6b acknowledgement was 10,140 ms under the then-10,000 ms sync budget. The current default 7,500 ms budget and bounded retry are proven here by transport-double tests, **not a newly measured native latency**. That historical rerun did not hit the timing-dependent native conflict race; the regression test proves that retry branch.
- This review did not run full workspace tests, lint, typecheck, Desktop build, standalone Core process boot, native Hindsight/PostgreSQL, credential custody, or a live Home session. Root/common-gate evidence must be reported separately. Native maintenance quality, environment compatibility and the owner's interaction acceptance remain Stage 6 work under D89.
- D84's known supervisor/cancel precision limits, D88's target-conflict administrative remedy, and the Stage 4/5 transitions/template/model/deployment-mode scope remain distinct. F1 requires an explicit corrective acceptance test and must not disappear into those historical caveats.
- No permanent data change or remediation was attempted. The report gives minimum source seams; root owns Stage 4 planning and any subsequent authorized implementation.
