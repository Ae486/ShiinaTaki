# Stage 5B automatic acceptance

Status: **PASS (2026-10-13)**. B3 and the Stage 5B isolated automatic gate are accepted on the reconciled source.
All eleven PRD automatic criteria pass. The original failed runs remain historical evidence, with complete
corrected-file results replacing their failed-file coverage as described below.
The owner authorized completion of this existing task through automatic acceptance, stopping before 5C.
Installed/manual acceptance, original services/data/credentials, real providers, new dependencies and Git
lifecycle actions remain outside this scope. The task stays `in_progress`, uncommitted and unarchived.

## Independent review and concrete corrections

- Core/Shared: `b3-independent-core-review-2026-10-12.md`. The capacity fixture now obtains canonical Bank
  IDs from `hindsightBankBindings`; its original 256/257 backup and 1024/1025 Healthy assertions pass.
  No additional production defect was found. Shared/Core typechecks and the nine actual consumers pass.
- Native: `b3-independent-native-review-2026-10-12.md`. Snapshot and committed-result reads check the existing tenant field permission against the
  configuration keys actually returned. Four real HTTP/PostgreSQL cases first returned denied values, then
  passed after the bounded `read_permissions` correction. Exact two-field/one-field allowed controls preserve
  the original snapshot/receipt. Fourteen affected cases, two-file Ruff/format and four-module Linux-target
  types pass. No new permission framework, schema, dependency or retry was introduced.
- Home: `b3-independent-home-review.md` and `b3-home-runner-resume-2026-10-11.md` retain the independently
  checked stale-consent/Escape fixes. The final Desktop suite passes all 127 files / 723 cases, including three
  real Headless Shell scenarios on the current Core/Shared graph. All three report `pageErrors: []`.
- Joint restore: the two fixture HTTPX clients use `trust_env=False` after a no-network probe identified
  Windows system-proxy inheritance. `b3-native-joint-06` passes both customized and removed physical restores,
  full row equality across 61 tables per scenario, nonempty refresh child/result history, actual managed CLI,
  mismatched/correct pairing, historical verification and fresh target refusal before writer start.

## Final whole-workspace gate

All heavy checks ran serially. Vitest used at most two workers; final Healthy and Desktop checks used one. Each whole
recorder result retains argv, input manifests, exit, duration and exact owned temporary-root cleanup.

| Gate | Evidence | Current result |
| --- | --- | --- |
| Shared/Core/CLI/Desktop/E2E types | `b3-whole-{shared,core,cli,desktop,e2e}-types-01-result.json`; `b3-whole-core-healthy-capture-typecheck-01-result.json` | PASS; the original five and the refreshed Core check each have 2417 unchanged inputs. The later Healthy spec-only sync is recorded separately. |
| Core complete coverage after reconciliation | `b3-whole-source-readback-01.json`; original full run and the two complete corrected-file runs below | PASS; 522 files, 4108 passed / one Windows-inapplicable skip. Reuses 516 unchanged passing files and replaces all six failed-file results. This is not a new all-green execution of all 522 files. |
| Original full Core execution (historical) | `b3-whole-core-tests-01-result.json` | Historical FAIL retained unchanged; 516/522 files pass, 4077 passed / 31 failed / 1 skipped. All 2417 inputs unchanged; wrapper 3761.610 s. |
| Four corrected legacy Core test files / scoped lint | `b3-whole-independent-core-expectations-{tests,lint}-01-result.json` | PASS; all 41 cases, lint, 2417 unchanged inputs and complete TEMP cleanup. These replace the corresponding five failed assertions in the first Core run; counts overlap. |
| Complete Healthy / capture-sync correction | `b3-whole-core-healthy-capture-tests-01-result.json` | PASS; 26 Healthy plus ten capture-sync cases, 1515.516 s, 2417 unchanged inputs and complete TEMP cleanup. Replaces the remaining two failed files. |
| Shared complete suite | `b3-whole-shared-tests-01-result.json` | PASS; 68 files / 611 cases, 2417 unchanged inputs, TEMP removed. |
| CLI complete suite | `b3-whole-cli-tests-01-result.json` | PASS; eight files / 47 cases, 2417 unchanged inputs, TEMP removed. |
| Desktop complete suite / three browsers | `b3-whole-desktop-tests-01-result.json`; `b3-whole-browser-readback-01.json` | PASS; 127 files / 723 cases, including three actual Headless Shell scenarios; 2417 unchanged inputs, TEMP removed. |
| Root ESLint | `b3-whole-root-lint-01-result.json` | PASS; 2417 unchanged inputs, TEMP removed. |
| Desktop Vite build | `b3-whole-desktop-build-01-result.json` | PASS; 2417 unchanged inputs, TEMP removed. The existing greater-than-500-kB chunk advisory remains; no performance work was added. |
| Applicable Rust checks | `b3-whole-rust-{clippy,tests}-01-result.json` | PASS; locked/offline Clippy with warnings denied and 175 tests. The three actual desktop tests listed below were excluded; source is unchanged. Both checks have 2417 unchanged inputs and removed TEMP. |
| Actual isolated Core main/WS boot | `b3-whole-core-boot-01-result.json`; `b2-core-boot-02-result.json`; `b2-core-boot-02-cleanup.json` | PASS; 5.047 s; authenticated status/preview/derived methods verified, migration head 59, zero prohibited calls. No dotenv/original deployment; owned process, port and data are cleaned. |
| Native affected field-read batch | `b3-native-independent-config-visibility-green-01-result.json` | PASS; 14 cases, exit 0; 952 unchanged inputs and owned PG/TEMP removed. |
| Native affected Ruff/format/Linux types | `b3-native-independent-config-visibility-{ruff,format,types}-01-result.json` | PASS; unchanged inputs and owned TEMP removed. |
| Customized/removed physical paired restore | `b3-native-joint-06-result.json`; `b3-whole-source-readback-01.json` | PASS; both physical restores preserve exact rows across 61 tables per scenario and nonempty refresh child/results. The later field-read permission correction is independently reviewed and its affected HTTP/PG backup/CLI cases pass; no unreviewed production delta remains. |
| Canonical generation / four SDKs | `b3-native-implementation-final-source-01.json`; `b3-root-native-final-readback-02.json`; `b3-whole-source-readback-01.json` | PASS by reuse of two canonical runs and the four passing SDK gates. All 958 generated, 12 maintained, four manifest and five original-generator entries match; no duplicate generation or SDK run was needed. |

The E2E package's typecheck is included. Its real-environment/model suite and installed WebView2/manual
acceptance are not part of this isolated automatic gate. Historical failed attempts remain unchanged;
overlapping targeted and whole-suite cases must not be added into a fabricated aggregate test count.

The Native reviewer inspected the default Tauri test targets before execution. Three tests use actual desktop
state and are excluded by exact `cargo test -- --skip` names: `capabilities_impl::clipboard::tests::set_then_get_round_trips`
(overwrites the system clipboard without restoring it), `capabilities_impl::foreground_window::tests::run_never_errors_and_shapes_a_valid_output`
(reads the active window and idle state), and `capabilities_impl::process_list::tests::snapshot_has_processes_with_expected_fields_and_no_cmd`
(reads the live process inventory). All remaining tests use local fixtures/fakes; the Windows sandbox tests run
only `hostname` and a bounded loopback `ping`. Clippy compiles without executing these tests. No source guard,
new fixture or additional authorization was introduced for the existing isolated acceptance scope.

### Corrections after the first full-Core run

- Healthy initially failed 25/26 cases: fifteen timeouts and ten incorrect RETURN terminal expectations. The
  retained phase diagnostic proves full rollback, a non-null `failed` result, source runtime, settled queue and
  complete `source-aborted` release. The permanent test now checks those facts; prepared REENTRY and exhausted
  leases still require `outcome_unknown`.
- The positive diagnostic exceeded its 60-second limit and continued into the next test's teardown. Its late
  lease error was not independent production-defect evidence. The isolated 180-second measurement completes
  RETURN and REENTRY in 59.776 seconds with both resolutions and no error log (`b3-core-healthy-positive-180s-measurement-01`).
  Existing full-run measurements also show removed RETURN at 164.274 seconds and a removed roundtrip at 279.016.
  Final local budgets follow the executed work: selected RETURN 60 s, selected two-direction cases 180 s,
  removed RETURN 240 s, and removed two-direction cases 360 s. Production clocks, leases and deadlines are unchanged.
- D2 also reproduced its original 5000-ms timeout in isolation. A 30-second measurement preserves every original
  fake-time admission/eight-binding assertion and passes in 3.493 seconds (`b3-core-d2-30s-measurement-01`). Only
  this real SQLite/hash-heavy case receives a 15-second test budget. All diagnostic inputs are stable and TEMP is removed.
- Four legacy files now pass all 41 tests and scoped lint: explicit migration tails include 58/59, the receipt map
  includes the two existing template proof kinds, and invalid client payloads expect `HINDSIGHT_RESPONSE_INVALID`.
  The capture boundary still maps that existing typed error to `HINDSIGHT_BACKUP_NATIVE_FAILED`; production is unchanged.

`b3-core-healthy-capture-final-applied-01.json` verifies the two-file permanent patch and complete probe removal.
The full 26-case Healthy matrix plus all ten capture-sync cases pass, followed by a passing Core typecheck.
The other four corrected files are independently complete. Root synchronized the existing Healthy spec's
historical budget paragraph; `b3-whole-healthy-spec-sync-01.json` proves that documentation-only delta. This sync
preceded final root lint, Shared/CLI/Desktop suites, build, Rust and boot. All remaining gates now pass.
`b3-whole-source-readback-01.json` proves that only the six corrected tests and this spec paragraph changed
since the original full Core run. The 41-case and 36-case runs replace the six complete file results, including
their earlier passing cases; they are not added to 4077. Final coverage is 4108 passed and one Windows-inapplicable
POSIX mode-bit skip across 522 files. No second complete Core suite is claimed or required for these test-only changes.

The initial full-Core run's four temporary entries are now removed. Root rechecked the exact owned path, no
associated process and no reparse points before deletion. `b3-whole-core-tests-01-cleanup-readback-01.json`
records removal and the unchanged original failure-result hash; the active Healthy fixture was untouched.

## PRD automatic criteria

All eleven automatic criteria are accepted after the final source/gate reconciliation. Accepted B1/B2 evidence
retains its documented scope; no installed, original-environment or manual criterion is marked passed.

| PRD criterion | Verdict | Supporting evidence and final gate |
| --- | --- | --- |
| 1. User precedence, reset and safe removal | PASS | B1 independent composition review; reconciled Core/Shared composition and lifecycle cases; Home full-resource removal/controller/DOM cases. |
| 2. Evidence-backed enrollment and collisions | PASS | B1 independent Core/Native review; current Core enrollment/identity/collision cases; Native snapshot/Apply/CAS coverage. |
| 3. Authentication, field/action refusal and atomic rollback | PASS | B1 Native 166-case matrix; current Native review and four red-to-green field-read regressions inside the 14-case affected batch. |
| 4. CAS, no-ops, immutable replay and job admission | PASS | B1/B2 independent Native claim/provider review; current actual Apply/CAS/concurrent replay cases; complete Core execution/recovery coverage. |
| 5. Actual per-fact extraction through canonical policy | PASS | B2 independent Native parser/provider/label evidence and real HTTP-to-Core/SQLite consumer checks; current Core policy and binding coverage. |
| 6. Interruption recovery and final lease/epoch guards | PASS | B2 independent detached-Apply lifetime correction; current Core partial/recovery/publication coverage and all 26 Healthy roundtrip/rollback cases. |
| 7. Durable unpublished-effect hold | PASS | B2 independent Core review; current Core hold/restart/runtime exclusion and original-plan recovery coverage. |
| 8. Exact server-owned label provenance | PASS | Unchanged B2 N1/N2 producer, sidecar, parser and exact-unit consumer evidence; current Native review and Core label consumer coverage. |
| 9. Migration/reopen and complete paired restore | PASS | Reconciled Core migration/reopen coverage; `joint-06` customized/removed physical restore with 61-table equality, nonempty refresh/provenance and mismatched-pair refusal; Native inventory/restore review. |
| 10. Old v1/5A/optional capability and Character defaults | PASS | Current Shared/Core/Desktop compatibility and lifecycle coverage; unchanged v1/migration/generator identities; accepted Native compatibility regressions. |
| 11. Operator/Home paths and relevant project checks | PASS | Current Desktop controller/DOM suite including three actual Headless Shell scenarios; isolated real Core main/WS boot; final types/lint/tests/build/applicable Rust checks. |

Each row's relevant final check passes. The two independent current reviewers used Astra `xhigh`;
their scope was limited to demonstrated defects and agreed acceptance gaps. Existing transactions, permission
hooks, fixture helpers and evidence were reused instead of introducing new abstractions or duplicate matrices.

## Final source and cleanup reconciliation

`b3-whole-source-readback-01.json` records `sourceChecksPassed: true`: all 2417 final whole-workspace inputs
match the post-boot manifest. Native's 952 reviewed inputs and every generated/maintained/manifest/generator
entry match. All 938 earlier Native inputs are covered by the current review. Relative to the 2594-input
joint-06 baseline, only eight test files and the independently reviewed field-read permission correction differ;
there is no unreviewed production change. These overlapping input sets must not be summed.

The same readback verifies all 17 successful whole-gate results and their absent owned TEMP roots. Supplemental
`b3-whole-core-tests-01-cleanup-readback-01.json` and `b2-core-boot-02-cleanup.json` confirm the old failed-run
leftovers and the successful boot's owned process/port/data are cleaned, without rewriting original results.
`b3-whole-browser-readback-01.json` retains the three passing browser results and 13 artifact hashes; root also
inspected the template customization and migration final screenshots. Screenshots and logs remain retained evidence.

`b3-whole-handoff-readback-01.json` records the final acceptance-document update separately. Of the 2417 tested
inputs, only `docs/HANDOFF.md` changes; task-local PRD, plan, notes and research Markdown/JSON are outside that
source snapshot. No executable, test, fixture, specification, dependency or generator input changes in this step,
so no further test, build or generation run is needed. Both reviewers and all checks have ended. Stop before 5C;
the existing task remains `in_progress`, uncommitted and unarchived.
