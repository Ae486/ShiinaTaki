# Child 1 formal review — 2026-09-26

## Scope, source and authority

Worktree: `H:/TakiAgent-worktrees/t4`; branch `task/t4-skills-mcp-productization`; unchanged HEAD
`06a8090118a45a8c4f06472be4917108f93aea44`. The root session explicitly binds this existing child; the stale
global Avatar Lab pointer was neither used as the task authority nor changed.

Reviewed the child PRD/design/implementation/check manifest, parent design/runtime contracts/decision register,
baseline snapshot contract and applicable backend/frontend/source-grounding/database/observability rules.
`trellis-check` and `trellis-before-dev` were applied. Child scope was determined against the parent's
`baseline-verified-source-2026-09-20.json` source hashes and the child implementation checkpoint, rather than
treating the several hundred incoming Memory files as new initiative work. The pinned-main `516e151` baseline
integration was already accepted on September 20; it was not repeated and mutable main was not integrated.

The review traced actual admission, SDK request preparation, tool construction/execution, decision acceptance,
Effect settlement, delivery transactions, restart recovery, legacy Monitor decoding and timezone authority.
Parallel ownership was coordinated with the root and `initiative_finish`. No commit, push, reset, rebase,
task creation/finish/archive, real-user database or external/paid model provider was used.

## Findings fixed

### 1. Held Memory currentness omitted the Hindsight connection and Bank binding

- Files: `packages/core/src/memory/hindsight/hindsight-memory-runtime.ts`,
  `packages/core/src/memory/runtime-composition.ts`, `packages/core/src/memory/hindsight-runtime-composition.test.ts`.
- Defect: the new held-Run `isCurrent()` stayed true after endpoint/credential rotation or replacement Character
  Bank routing. A later Memory tool would refuse, but text/presentation delivery could incorrectly trust the old
  decision without another Memory call. The added outer selection read also changed an existing epoch-drift
  admission refusal from `MEMORY_AUTHORITY_MISMATCH` to `MEMORY_INTEGRITY_ERROR`.
- Fix: compare captured Global/Character routes through the existing local runtime connection guard, including
  its original endpoint/secret fingerprint. Preserve the selected provider's admission validation before the
  additional selection/currentness fence. No live operation accessor, new Bank or new provider call is acquired.
- Evidence: added pre/post-currentness assertions reproduced endpoint/secret failures before the fix; endpoint,
  secret, epoch and Bank-route cases now pass with the original no-remote-call/no-Legacy-fallback assertions.

### 2. Recovery skipped pending text after its Run had already completed

- Files: `packages/core/src/harness/initiative-recovery.ts`, `recovery-coordinator.ts`,
  `initiative-recovery.test.ts`.
- Defect: pure speech completes execution before publication. Existing recovery enumerated nonterminal Runs only,
  leaving a completed Run's `staged` or `dispatch_committed` delivery unreconciled after a process crash.
- Fix: boot separately scans bounded batches of terminal-Run pending delivery records. Lost, known-undispatched
  output expires; committed publication becomes unknown. Original Run/Attempt/Receipt, Timeline identity and
  committed charge remain unchanged. Terminal no-target/sent/unknown results are not replayed.
- Evidence: SQLite tests cover both crash cuts, a second boot, no duplicate Timeline/charge, unchanged terminal
  Run identity and no publication replay. Additional tests prove a completed model Effect cannot turn a missing
  required decision into success; an unfinished Effect remains unknown without invoking any recovery adapter.
  The final process gate also caught an overbroad first recovery filter: a fully settled expression still has
  delivery state `staged`. The filter now selects pending speech or genuinely unfinished executable continuation
  only. Three added completed/failed/unknown expression regressions preserve exact replay; this suite passes 7 tests.

### 3. Scheduled delivery published intermediate tool-step prose

- Files: `packages/core/src/agents/chat-agent.ts`, `packages/core/src/scheduler/scheduled-run-adapter.ts`,
  `scheduled-delivery.test.ts`.
- Defect: the adapter concatenated every streamed text delta, including intermediate tool-step text, into its
  public result. This contradicted the explicit Scheduled result-selection contract.
- Fix: a narrow non-primary `onSettledText` callback supplies only final-step text after authoritative observer
  health and cancellation checks. Scheduled consumes that value while draining intermediate deltas privately.
  Primary streaming and initiative structural speech remain on their existing paths.
- Source grounding: installed `ai/src/generate-text/stream-text.ts:2380` resolves `text` from `finalStep.text`.
- Evidence: actual SDK `textTool -> text` regression publishes only `Complete public result`; an injected
  authoritative settlement failure produces a failed Run and no delivery/Timeline output. Four related files,
  including prior non-primary and observer regressions, passed 14 tests.

### 4. A timezone change could mint capacity during a 25-hour day

- Files: `packages/core/src/db/run-delivery-repo.ts`, `run-delivery-repo.test.ts`.
- Defect: the former-zone carry used only a fixed 24-hour lookback. During New York's fall-back day, a consumed
  charge older than 24 hours was still in the original civil day but disappeared after selecting UTC.
- Fix: preserve the existing conservative 24-hour carry and the original zone's actual civil-day boundary using
  the shared time helper. SQL counts stay inside the publication transaction; no migration or counter reset occurs.
- Evidence: a red/green test charges at `2026-11-01T04:15Z`, changes zone at `2026-11-02T04:30Z`, and proves a
  one-per-day limit still refuses publication. Independent hourly/daily caps across repository consumers, Class A
  independence, rollback and gap/idempotency tests pass (six repository tests).

### 5. Cancellation and storage errors were reported as quota refusal

- Files: `packages/core/src/delivery/delivery-coordinator.ts`, `delivery-coordinator.test.ts`.
- Defect: the broad publication catch mapped every exception except gap to `budget`, including canonical
  Run-only cancellation and failed Timeline/evidence persistence.
- Fix, coordinated with `initiative_finish`: map only known budget/gap/expiry/stale-Run domain errors; unexpected
  persistence failures propagate to the owner/recovery path. The known cancellation case remains uncharged and
  reports stale authority rather than invented budget exhaustion.
- Evidence: coordinator suite covers committed accepted/unknown/refused/throw/no-target transport, publication
  ordering, concurrent duplicate completion, cancellation before/after publication, terminal held Attempts,
  unexpected transaction failure and failed post-send fact persistence. It passed 19 tests before final gates.

### 6. Missing permission-cell presentation and stale inventory assertions

- Files: `packages/shared/src/governance-presentation.ts`, `governance-presentation.test.ts`,
  `governance-registry.test.ts`.
- Defect: `core.initiative.decide` had a capability/tool label but its `initiative-decide` cell displayed the unknown
  permission fallback. Initial tests stopped first at stale descriptor/cell inventory counts (19/31).
- Fix: add the Chinese cell label and truthful staging-only explanation; update expected inventory to 20/32 and
  explicitly assert immutable, once-only, auto posture at every permission level. Existing all-cell semantic
  assertions remain intact and exposed the missing label after the count correction.

### 7. Review quality failures and missing navigation/specification touch points

- Split delivery staging/publication into cohesive repository helpers and observed Timeline fan-out into its own
  helper. Snapshot capture now has three parameters, with optional admission/selection grouped in one options
  argument. Public `RunService.admit` is unchanged. No rule suppression or artificial module split was added.
- The test fixture now validates a deliberately stripped snapshot draft rather than destructuring unused fields.
  Shared exports remain named, source-bearing exports within the existing 500-line limit; duplicate module export
  declarations were consolidated.
- The Privacy Pause writer test's name-only `.resume()` sweep confused delivery continuation with consent mutation.
  It now resolves the called declaration to the PrivacyPause owner, preserving the whole-tree sole-writer assertion.
- Added `initiative/` and `delivery/` directory indexes, updated affected source indexes, added the executable
  `backend/initiative-runtime.md` contract, linked the existing User Timezone specification and documented mixed
  v1/v2 Monitor projection.

## Additional coverage and reviewed integration

- `heartbeat-respond-tool.test.ts`: nine cases cover all outcomes, exact duplicate acceptance, conflicting terminal
  calls, rejected payload/candidate/vocabulary, accepted-only stopping and retired/closed collectors.
- `initiative-observability.test.ts`: actual mixed v1/v2 SQLite readers retain every sequence through bounded
  forward/backward pages and reconstructed query services. Existing unchanged client schemas accept projected
  business rows/Inspector, unsupported optional closed eventKind is omitted, and added facts do not inflate tool/model counts.
- Root added the actual abrupt held-Run process crash/reopen case. Its fake operator Avatar result establishes the
  protocol/Effect path, not a native rendering or human-reading outcome.
- `initiative_finish` completed missing model-opportunity accounting with additive 050, immutable 049/reopen
  lineage tests, whole-policy config validation, original-timezone refusal and held busy-timer cleanup before
  executable dispatch. Its scoped tests and source were reviewed; this report does not relabel the previous
  baseline integration as new child implementation.

## C1 evidence matrix

All PRD checkboxes remain owner-controlled. "Covered" below means automated/code evidence for this bounded child,
not signed manual/native acceptance.

| Criterion | Automated/code evidence | Boundary |
| --- | --- | --- |
| C1-01 | Actual isolated SDK thin request and tool-list E2E; immutable snapshot/Memory fences; existing primary/non-primary tests; Scheduled final-step regression | No external-provider/native claim |
| C1-02 | TurnQueue primary reservation/cancellation/FIFO/cross-Character tests; process reserved-primary and no-Run refusal cases; model budget admission tests | No additional wake-source/Presence product is installed |
| C1-03 | Three outcome E2E; invalid/conflicting/missing decision cases; nine collector cases; actual SDK authoritative observer failure path | No fabricated silent success or public private stream |
| C1-04 | Same-Attempt held/resume/source/terminal tests; busy timer cleared before dispatch; actual held crash/reopen; terminal text/missing-decision SQLite crash cuts | Restart never reacquires lost executable bindings |
| C1-05 | Repository event/Timeline/charge rollback and exact identity; independent model/hour/day/gap limits; 25-hour timezone carry; coordinator transport/cancel/duplicate tests | Charge, transport acceptance and presentation are distinct |
| C1-06 | Existing Monitor real process reopen plus mixed v1/v2 forward/backward/Inspector client-schema tests; no synthetic refused Run | Policy diagnostics are a bounded Core read seam; later product UI remains outside this foundation |
| C1-07 | Current full migration registry, fresh/applied-049-to-050 and preserved populated T4/main-035 lineage tests; unsupported/unmappable refusal assertions retained | No real-user DB or migration-receipt rewrite |
| C1-08 | Shared IANA/mode/source schemas; real singleton reopen/CAS/lease/service tests; future-only schedule recomputation, claimed/pinned/absolute stability and DST day tests; runtime timezone invalidation | Actual Desktop reporter/settings and owner trials belong to later child/manual acceptance |

## Verification

Reviewer commands were run in T4 with installed locked dependencies:

```text
pnpm --filter @taki/core exec vitest run src/db/run-delivery-repo.test.ts
  PASS: 6 tests, including reproduced DST and atomic independent quota regressions.
pnpm --filter @taki/core exec vitest run src/harness/initiative-recovery.test.ts src/agents/heartbeat-respond-tool.test.ts src/observability/initiative-observability.test.ts src/db/run-delivery-repo.test.ts
  PASS: 4 files / 19 tests before the final additional DST case (then separately passed above).
pnpm --filter @taki/core exec vitest run src/scheduler/scheduled-delivery.test.ts src/scheduler/scheduled-run-adapter.test.ts src/agents/chat-agent-non-primary.test.ts src/agents/run-observability-telemetry.test.ts
  PASS: 4 files / 14 tests.
pnpm --filter @taki/core exec vitest run src/harness/initiative-recovery.test.ts src/agents/heartbeat-respond-tool.test.ts src/observability/initiative-observability.test.ts src/memory/hindsight-runtime-composition.test.ts src/harness/run-snapshot-capture-lifetime.test.ts
  Memory composition and capture lifetime passed. Initial new recovery fixture reused one process-generation
  instance; corrected it to instantiate the second boot, then the recovery suite passed as recorded above.
pnpm --filter @taki/core exec vitest run src/perception/privacy-pause-writer.test.ts src/memory/hindsight-runtime-composition.test.ts
  Privacy sole-writer passed. Added Memory currentness assertions initially reproduced the defect;
  the complete Memory composition suite subsequently passed in the command above.
pnpm --filter @taki/core typecheck
  PASS after final production edits.
pnpm --filter @taki/shared typecheck
  PASS.
pnpm exec eslint <all reviewer-touched production/test files in scoped batches>
  PASS; final whole-workspace lint is owned by the root gate below.
```

### Final gate evidence and source boundary

The full workspace run was launched against the source set recorded in `source-before-final-2026-09-26.json`
(fingerprint `9c598ca9a7f008fa76b8d3ec27fdc1373c07e9c2d952a099152b98da59c3f54c`). The first complete
15-case process run exposed the settled-expression recovery filter described in finding 2; its strict replay
assertion was preserved. After that bounded correction, recovery tests, all 15 process cases, Core typecheck and
whole-workspace lint were rerun successfully. The table distinguishes the full-suite run from those post-fix checks.

| Check | Result | Artifact (`.json` records command/exit and `.log` holds output) |
| --- | --- | --- |
| `pnpm -r --workspace-concurrency=1 test --maxWorkers=4` | PASS: Shared 597; CLI 50; Desktop 1067; Core 3401 passed / 1 existing skipped | `workspace-tests-final-2026-09-26` |
| All five TypeScript project checks | PASS | `typecheck-final-2026-09-26` |
| Core typecheck after recovery-filter correction | PASS | `core-typecheck-verified-2026-09-26` |
| Full initiative process suite after correction | PASS: 15 tests | `e2e-runtime-verified-2026-09-26` |
| Recovery after correction | PASS: 7 tests | `recovery-verified-2026-09-26` |
| Root `pnpm lint` after correction | PASS | `lint-verified-2026-09-26` |
| Desktop production build | PASS | `desktop-build-final-2026-09-26` |
| Reviewer scoped `git diff --check` | PASS; existing CRLF normalization notices only | Command output from this review |

The root separately corrected pre-existing QQMM native-smoke script quoting to complete lint, without executing
that native smoke. A concurrent unrelated update changed the existing `@qqmm/management-client` local-tarball
lock entry while these gates ran; the reviewer did not install or modify it. The root is preserving that work and
refreshing the affected Desktop tests/build/typecheck plus source hashes. That final dependency checkpoint is
recorded by the root and is not concealed as an unchanged starting source snapshot.

## Findings not fixed / limitations

No additional confirmed child-scope defect remains after the fixes and passing gates above. The actual
native Tauri/WebView/Avatar owner walkthrough and a real external-provider trial were deliberately not performed.
Inherited D81/D84 provider visibility/attribution limits remain with their existing owners. This review does not
claim that later Pattern/Intention/Presence children, Desktop timezone UI/reporting or the overall first delivery
are complete. C1-01 through C1-08 manual sign-off remains pending; no acceptance checkbox was checked here.

## Root dependency/source appendix

The affected Desktop refresh passed 1067 tests, typecheck and build (`desktop-current-lock-tests`,
`desktop-current-lock-typecheck`, `desktop-current-lock-build`, each suffixed `-2026-09-26`).
Independent QQMM page source/tests changed during that refresh and the mutable package continued
to change separately. The final read found the source lock and local tarball aligned, but the
installed lock still different. These are installed-environment results, not a frozen-lock or
latest-QQMM acceptance claim. The exact source/dependency checkpoint and child-boundary limits
are in `verified-source-2026-09-26.json` and `continuation-2026-09-26.md`. No dependency install
or QQMM reconciliation was performed by this initiative continuation.
