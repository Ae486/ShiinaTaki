# Integration verification progress

Updated 2026-11-12. Latest engineering gate: complete connected journey 24/24 and current process E2E 26/26 pass.
The final independent review passed and both original branches fast-forwarded to application merge `95ce75e`;
[delivery evidence](baseline-delivery-20261112.md) and [alignment receipt](baseline-alignment-receipt-20261112.json)
record engineering completion and remaining product limits;
the older checkpoint paragraphs below retain their original scope and failed-attempt history.

## Latest continuation gate (2026-11-12)

Session `01a1cf67-4df4-7c42-af1c-51885631386c` recovered the complete source-session context and bound
this existing task through `task.py start` (`Source: session:codex_01a1cf67-4df4-7c42-af1c-51885631386c`).
The original owner approved the G engineering integration, testing, commit and gated alignment of both branches;
the original real-profile upgrade, push and release remain separate.

The previously running Native/PostgreSQL/Home journey completed after the API turn failed. Its raw final result
records all 24 stages passed, four natural nonforced Core exits, a natural Native exit and no surviving owned
processes/listeners. A current read-back matches Taki and Native source manifests, including intentional deletions.
[Connected acceptance and resources](connected-journey-acceptance-20261112.md) and
[compact provenance receipt](connected-journey-receipt-20261112.json) record the complete scope.

A new isolated process E2E run now records **26/26 passed, zero failures/skips, ten actual files, 184.358 s** in
`test-e2e-final-20261112.json`. It exercises the same actual Core/SDK/SQLite and native Host paths with loopback
controlled providers: child restart recovery, 36/50/56-step continuation, schema upgrade and Stop/Continue,
flat inbox/ask-user/native interface, Approval challenge/resume, truthful Avatar failure, canonical Local,
governance authority and stale/tampered projections. The old split failing governance report is preserved.
Launch/isolation metadata is in `test-e2e-final-launch-20261112.json`; no paid provider was configured.

HS-START-01/02 remain open in the canonical Hindsight startup ledger. Both offline model caches were prepared
before the successful connected run; startup-first embedding/reranking configuration remains for the later task.
Actual QQ observations, WebGL/Pet rendering, live-model inference, installed distribution, owner-manual and
large-library acceptance remain outside this engineering evidence.

## Identity and isolation

- Repository: `G:/TakiAgent-integration`, branch `integration/main-t4-20261111`.
- Merge inputs remain main `9b98794a673efb561682b9fd451fe1da2db95086` and T4 `63faf8119be1747b685aacf43529d754626ab35c`.
- Original worktrees/branches/profiles have not been aligned or upgraded. Integration is not committed or pushed.
- Initial conflict inventory: 267 paths (160 add/add, 107 content). Current source/spec/task/document marker scan is empty;
  remaining Git AA/UU entries still need coordinator staging. They do not count remaining product conflicts.
- Node `24.18.0`, pnpm `10.22.0`, Cargo `1.97.0`, Vitest `4.1.10`.
- Observed available memory during this checkpoint: approximately 3.19–5.74 GiB. This is a set of observations,
  not a continuously sampled minimum or an application peak-memory benchmark.

## Completed checks

| Check | Actual result | Duration / evidence |
| --- | --- | --- |
| 073–077 convergence contract | 43/43 passed | 19.00s; `073-convergence-gate.test.ts` |
| Historical lineage/reopen matrix after exact Timeline fixes | 10/10 passed | 12.43s |
| SQLite/reopen/convergence combined before final 074 Timeline branch | SQLite + gate passed; 2 lineage failures retained and then fixed | SQL/receipt/COMMIT rollback preserved |
| Scheduler recovery and Approval | 24/24 passed, 2 files | 11.94s |
| Operations UI selection | 247/247 passed, 27 files | 67.65s |
| WS/RPC after separating connection lifecycle | 54/54 passed, 2 files | 3.60s |
| Run service and turn registration | 23/23 passed, 2 matched files | 8.14s |
| Shared first full suite | 907 passed / 1 failed, 101 files | `test-shared.json`; exposed missing Hindsight display vocabulary |
| Shared display/history repair | 11/11 passed, 2 files | 669ms; three capabilities/five cells now have actual labels |
| Desktop first full suite | 1630 passed / 3 failed, 255 files | `test-desktop.json`; disconnected skeletons and old source-label expectation |
| Desktop affected repair suites | 37/37 passed, 5 files | 5.44s; actual disconnected-state regressions retained |
| Core test type seams | All 13 reported errors fixed; focused functional failures explicitly retained | `core-test-type-seams.md` |
| Hindsight unavailable-source fixture | 12/12 passed | 19.34s; unavailable capabilities/tools/disposition and unchanged witnesses |
| Direct Node strip-only boot, no model | Pass; listening 4.254s; typed model-unavailable refusal; zero Runs | `smoke-core-result.json` |
| Direct Node boot, invalid unrelated Memory/Tidy config | Pass; listening 4.010s; typed model-unavailable refusal; zero Runs | `smoke-core-result.json` |
| Normal G Rust binary build | Pass, both `taki-node` and `taki-secret-key` | 9.60s; isolated G Cargo target |
| Generated exact schema reproducibility | Byte-identical regeneration | SHA256 `4BF5D387DC9723A6459C7F54BE627A8CF28303B8CD30C30D952E59BDFD88CF92` |
| Documentation integration | 47 conflict blocks resolved; 46 duplicate source rows consolidated; links/rows/operation kinds checked | `document-conflicts.md` |
| First integrated Core full suite | 6,185 passed / 90 failed / 7 pending, 768 files | `test-core.json`; individual failures remain under investigation |
| Governance/extension effect and base-prompt repair | 31/31 passed, 3 files | `test-governance-prompt-repair-20261112.json`; captured current policy generation after registry reconciliation |
| Rust all-target clippy | Passed with warnings denied | `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --all-targets -- -D warnings`; 4.46s reported |
| Controlled delegation/interface E2E repair | 10/10 passed, 3 files | `test-e2e-repaired.json`; actual Core/SDK/RPC with controlled loopback provider |
| Tidy affected repair | 69/69 passed, 5 files | `test-tidy-repair.json`; cancellation, durable edit progress and recovery |

These rows overlap and must not be added into a single unique-test total. Full-suite failed counts describe the
first runs; affected repairs do not retroactively turn the original raw JSON receipts into successful runs.

## Proven migration details

- Frozen copy SHA256 remains `973f100874a9f80716d71be96e2b8064e0aa7bf6c40d2e60ec02ff5a6304c023`.
- The full gate upgrades/reopens an isolated stopped-copy freeze and checks the original hash, meaningful rows,
  old receipt timestamps, FK/integrity and failure rollback. No original frozen data is changed.
- Main upgrade adds only three new zero-valued delegation `sqlite_sequence` entries. All existing sequence rows,
  rowids and deleted high-water marks remain exact; the test explicitly permits only these new empty counters.
- Historical unquoted `presentation TEXT` accepted by migration 036 also needs exact main073/initiative074
  variants. These are explicit branches; global SQL normalization and unknown-schema refusal remain strict.
- Failed `openDatabase` boot now releases its owned connection before rethrowing; file retry/cleanup no longer
  retains the failed handle. Atomicity remains per migration, not across the whole multi-group upgrade.

## Earlier remaining-work checkpoint

The initial Core failures have been repaired: `test-core-final-20261112.json` records 6,282 passing tests,
zero failures and seven conditional skips. Historical fixtures preserve their real lineage; current composition
uses complete convergence. The pre-baseline custody/coverage-gap repair is included, not waived as a fixture change.
The updated receipts below supersede the earlier remaining-work snapshot without rewriting its raw failed reports.
The complete Native/PostgreSQL/Home journey and final baseline ancestry/alignment gates remain open.

## Recovered receipts and continuation (2026-11-12)

Current session `01a1cf03-3415-7d93-9028-6a82ce7dfee1` recovered `01a1ce3d-2104-7d50-b8ab-a549357c9619`
and bound this existing G: task via `task.py start`; no new task was created. Source session's implementation,
isolated verification and gated alignment authority is retained. H: originals remain unchanged by this continuation.

Raw JSON reports were read back; these are prior-run receipts, not newly rerun suites:

| Receipt | Latest recorded result |
| --- | --- |
| `test-core-final-20261112.json` | 6,282 pass; 0 fail; 7 conditional skips |
| `test-shared-final-20261112.json` | 908 pass; 0 fail |
| `test-desktop-final-20261112.json` | 1,633 pass; 0 fail |
| `test-cli-final-20261112.json` | 50 pass; 0 fail |
| `test-codec-final-20261112.json` | Successful command with zero tests; not a functional-test count |
| `test-host-preparation-final-20261112.json` | 87 pass; 0 fail; 1 installed-fixture opt-in skip; supersedes the older failed Host report |
| `test-memory-repair-final.json` | 165/165 pass; overlaps full Core |
| `test-e2e-delegation-20261112.json` | 4/4 pass |
| `test-e2e-gates-20261112.json` plus `test-e2e-governance-repair-20261112.json` | Initial 11 pass / 1 fail, then the failing governance case passes; not a fresh aggregate 12/12 report |
| `governance-replay-result-20261112.json` | Frozen copy reaches migration077/governance4; seven usable Approvals retained; original hash unchanged |

The prior independent review records final workspace typecheck/lint, Rust tests and build coordination; its exact
scope and limits remain in `final-independent-check-20261112.md`. Do not relabel those as new executions here.
The connected journey first failed Native startup with missing embedding/reranking caches; after isolated cache
preparation it passed Native/Core boot but failed Home onboarding on a missing Playwright import. Full journey
acceptance remains pending. Initial available-memory observation for this continuation is approximately 3.7 GiB,
below the launcher's existing 6 GiB gate, with no leftover owned stack found.

Hindsight changes and the owner's follow-up requirement now have canonical records in the parent task:
[integration handoff](../../08-09-hindsight-memory-provider/research/main-t4-integration-20261112.md) and
[startup configuration blockers](../../08-09-hindsight-memory-provider/research/startup-configuration-blockers.md).
Keep those records updated as the remaining E2E uncovers new changes or prerequisites.

The continuation repaired isolated Playwright import resolution and added real browser preflight plus unique
per-run logs. The next full run, `2026-11-12T09-21-17.541Z/result.json` under the operations first-use results,
passed Native/Core boot, Home Local onboarding, Hindsight setup and first activation. Step 5 failed because the
old harness parses a compact model-facing retain result as the complete internal envelope. The failed receipt and
SQLite remain available at `G:/taki-first-use-Btl1vA`; exact call/Effect and durable write assertions are being
reconciled with the accepted output projection before rerunning. Source hashes remained unchanged, and cleanup
left no owned processes/listeners. This is a failed E2E attempt with four passing stages, not complete acceptance.

The projection repair passed 19 stopped-database replay checks and independent source review; it preserves
separate captured Run/Source/Effect evidence plus original parent/Native-child checks. The following run,
`2026-11-12T09-42-31.030Z/result.json` (`G:/taki-first-use-zkwd8V`), passed eleven stages through step 7 and
failed the clean-shutdown assertion at step 8 after the unchanged 60-second budget. Source hashes remained unchanged
and cleanup left no owned processes/listeners. The harness IPC stays referenced while production Core now exits
naturally; an isolated actual-Core comparison is checking this cause before a minimal harness fix. The clean-exit
assertion remains required. Complete Native/PG/Home/restart/transition acceptance is still open.

The isolated shutdown comparison has now confirmed and repaired the harness IPC cause without production edits:
`core-shutdown-harness-repair-20261112.md` records the old 60,051-ms forced result and the new 83-ms natural
`code=0`/nonforced exit. A full-journey launch at 10:05 UTC passed browser preflight but was refused at the original
memory admission gate (5.85 GiB available versus 6 GiB required); it started no Native/PG stack.
Independent resource review accepted a test-only threshold of 5.5 GiB: the measured maximum decline in available
physical RAM was about 3.446 GiB, leaving an estimated 2.05 GiB reserve. Later-stage peak use remains unmeasured;
one heavyweight stack, resource sampling, all business assertions and all timeouts remain unchanged.

The recovered final desktop build receipt is persisted in `recovered-build-receipt-20261112.json` and its log:
the prior source-session command `node apps/desktop/scripts/build-installed-host.ts --debug --no-bundle` exited 0,
including production Vite assets and the debug Windows application. The current executable's SHA-256 is recorded.
This is recovered build evidence, not a new execution or installer acceptance. CLI and Shared declare no `build`
script; their existing typechecks/tests are the applicable package checks.

The remaining positive configuration-to-chat acceptance now passes. `configuration-recovery-chat-20261112.md`
and its timestamped JSON record actual same-process/socket no-model refusal (zero Runs), Main apply/test, then one
completed streaming Chat Run/Attempt with exact persisted text and successful reopen. Only two keyless loopback
requests occurred; Native/PG and real providers were absent. The older zero-Run smoke receipt remains unchanged.

## Continuation identity (2026-11-12)

Recovered source session `01a1ca07-857f-7ec2-9adb-11c14229c334`; the active integration task is now explicitly
bound in this repository to `session:codex_01a1ce3d-2104-7d50-b8ab-a549357c9619`. Historical integration/testing/
alignment authorization persists: main owns Hindsight, T4 owns other accepted mechanisms, original real profiles
and external push remain outside the engineering verification scope. Main and T4 input tips remain frozen.
After the owner closed browser/Steam, available physical memory was 6.42 GiB; no additional applications were
terminated. This is a point observation, not a performance or peak-memory result.

The integrated base-prompt ceiling is explicitly 56 lines: T4's accepted 54 lines plus main's two source-grounding
lines. Both accepted truthfulness/Memory contracts remain in place; the exact ceiling and its reason are recorded
in `agent-runtime.md`. It is not a general increase for additional prompt behavior.

Direct boot used allowlisted OS environment variables plus explicit fresh G data/ports. It loaded no env file,
provider, model or credential helper at startup. The latest `smoke-core-result.json` additionally records applying
a keyless loopback Main profile, a successful explicit model connection test, invalid-apply preservation and
reopening the last-good profile. That older receipt records zero admitted Runs; the later timestamped positive
chat gate above now supplies the missing evidence. Windows termination in this direct smoke is forced and
does not establish graceful shutdown. No paid/live model or owner UI acceptance is claimed. Prior main-only tests
and filesystem hash counts do not substitute for integration/library-scale proof.
