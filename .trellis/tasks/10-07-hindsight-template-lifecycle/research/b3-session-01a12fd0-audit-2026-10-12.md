# B3 interrupted-session recovery audit (2026-10-12)

## Scope and evidence coverage

Read-only recovery of session `01a12fd0-4fa0-7952-8bb2-0f7d52cf11c6`. This report is the only file written by
this auditor. No test, build, service, source edit or task/Git lifecycle action was performed.

Source log: `C:/Users/55473/.codex/sessions/2026/10/12/rollout-2026-10-12T19-12-23-01a12fd0-4fa0-7952-8bb2-0f7d52cf11c6.jsonl`.
It contains 620 records and 3,554,109 bytes; SHA256
`1bfb73b754c79704e06da0523b317c2c75653918a0064fea2c38ece6fd36d953`.
All 620 records were parsed and categorized, including metadata and duplicated event/response representations.
The readable user request, all 11 assistant progress messages and both plaintext child final reports were read.
Commands, changes, retained outcomes and their operational context were recovered from the raw event stream;
large repeated inventory/hash lists were handled as structured evidence, not independent work or extra tests.

- 260 event records: 160 completed items, 97 token-count events, and one each task-start/task-complete/settings.
- 255 response items: 18 messages, 69 reasoning, 30 child messages, 35 function calls and 35 results,
  34 orchestration calls and 34 results.
- 69 token-usage records, 30 inter-agent metadata records, four world-state records, one session meta and one turn context.
- The completed-item stream contains 39 CommandExecution and four FileChange events. Other completed items
  duplicate message/reasoning/agent-activity representations; they are not extra commands or edits.
- 26 command outputs exactly match their decoded orchestration result. Five inner-truncated wrappers
  (L37/68/157/213/318) and three outer-truncated wrappers (L20/54/125) account for the other 13 raw commands.
  Their complete command-event outputs remain accessible. A literal mention of truncation in a document is not
  evidence that the raw command output itself is truncated.
- 126 records contain inaccessible encrypted segments: 69 reasoning, 28 incoming child messages,
  25 send-message bodies, three dispatch bodies and one follow-up body. These segments were not decoded.
  L413 and L613 are the two readable child final reports; they were read in full.
- The earlier 826+15-record session audit is preserved in L413 and `b3-recovery-2026-10-12.md:35`.
  It was not represented as new work performed by this auditor.

The task PRD/design/implement/review contract and complete requested handoff/recovery/diagnosis/leader documents
were read. Superseded pause/slot instructions in append-only history do not revoke the current continuation.

## Authorization and actual stopping point

L9 asks to recover the earlier session and continue. Earlier owner approval remains in original-session
L9 (Astra, existing task), L178 (proposed whole-5B scope), L185 (approval), and L822 (restore continuation).
`b3-resume-plan-2026-10-11.md:5-8` records the binding scope: complete remaining B3 and whole Stage 5B automated
acceptance; stop before 5C. No original services/data/credentials, real/paid model calls, new dependency,
commit/push/reset/rebase/finish/archive or installed/manual acceptance is included.

L87-90 bind the historical session to the existing task and validate 43 implement / 47 check entries.
The frontend Home spec exceeds injection limits and must be read directly by a Home reviewer.
The current parent session has a different binding; do not restore the old session identifier as current.

The last root command is L614; L616/L617 report its successful completion. It creates
`b3-root-joint-05-freeze-20261012.json` at 2026-10-12T11:45:16.887434+00:00, with 1599 Core inputs, 2594 union
inputs, no Core release mismatch and the two supplemental Core recorders. L619 terminates on HTTP 402
budget-pool exhaustion with no final assistant message. L620 changes thread settings; it is not work completion.
There is no recorded root grant/run/result after that freeze.

Current readback independently rehashed all 2594 frozen paths with zero mismatches. `b3-native-joint-05-result.json`
is absent. This proves source continuity, not a successful joint check. Resume with fresh root slot allocation.

## Child endings and easily missed completed work

Relevant child logs share `C:/Users/55473/.codex/sessions/2026/10/12/`:

- Core: `rollout-2026-10-12T19-16-44-01a12fd4-4ba2-77b0-a921-56258ac9c31b.jsonl` (589 records).
  Late L551 restores the pre-diagnostic source and changes only measured local test envelopes; L560 tidies
  registration and updates the Healthy driver spec; L575 records the completed correction. L589 ends with 402,
  no final self-check release. These late changes are present in the final root freeze.
- Native: `rollout-2026-10-12T19-17-01-01a12fd4-8dd8-7e12-8fcf-8e9f95e6515c.jsonl` (677 records).
  L667 and L672 run scoped Ruff and format; both result files pass. L677 ends with 402, before joint-05/types
  or final self-check release. The last actual checks are `b3-native-resume-ruff-05-result.json` (0.299 s)
  and `b3-native-resume-format-check-04-result.json` (0.291 s), both exit 0 with unchanged inputs and clean TEMP.
- History/fixture reviewer: `rollout-2026-10-12T19-17-17-01a12fd4-cadd-75f0-b904-f7076161911f.jsonl` (454 records).
  Its final L451 is parent L613; no new deterministic fixture error found. It checked all 353 Native test,
  409 helper, 115 Core entry and 142 Core fixture lines against actual producers. This is a static preflight,
  explicitly not joint acceptance or the future independent full B1-B3 review.

The latest root progress at L579 says both roundtrips passed. Its valid interpretation is the Core Healthy
selected positive plus the instrumented removed positive; it must not be quoted as two successful joint restores.

## Actual Core and Native results

| Evidence | Result and limit |
| --- | --- |
| `b3-core-resume-smoke-02-result.json` | Exit 1, 110.858 s; three actual consumer positives pass, both Healthy positives fail, 30 skipped. |
| `b3-core-resume-healthy-diagnostic-01-result.json` | Exit 1, 51.238 s; selected REENTRY loses template auxiliary receipt membership in the specialized fixture. |
| `b3-core-resume-healthy-positive-02-result.json` | Exit 1, 119.912 s; selected complete RETURN/REENTRY passes (46.576 s), removed hits old 60 s test budget. |
| `b3-core-removed-phase-diagnostic-01-result.json` | Exit 0, 133.700 s; one removed positive passes all original assertions, 25 skipped. Instrumented source, not final-source full matrix. |
| `b3-native-joint-03-result.json` | Exit 1, 140.646 s; both fail copied terminal refresh membership before archive/restore. |
| `b3-native-joint-diagnostic-04-result.json` | Exit 1, 131.682 s; fake provider rejects legitimate final-text synthesis, producing actual failed/null marker. |
| `b3-native-joint-04-result.json` | Exit 1, 86.797 s; refresh/Core prepare/capture/copy pass, history JSONB assertion fails. Both scenarios fail; actual paired restore unaccepted. |
| joint-05 | Frozen only; no result. |

Every historical failure remains evidence. The fixture-only repairs preserve production validation:

1. `memory-transition-template-healthy-fixture.ts:33-46` carries independently held template auxiliary rows into
   the post-delta evidence before observation, reseals it and updates the observer cursor; persisted Core evidence
   and production hash/membership guards remain unchanged.
2. `transition-template-healthy.test.ts:23-41,70,104` has no diagnostic probes. Only the removed positive and
   removed REENTRY cases that first run RETURN use 180 seconds. Selected and standalone removed RETURN remain
   60 seconds. All 26 test cases/assertions remain. Measured phases: setup 3.373, RETURN 52.662, REENTRY 66.376,
   close 0.012 seconds (122.423 total). Runtime leases, production deadlines and global defaults are unchanged.
3. Native pair fixture supplies deterministic final synthesis through the existing fake provider, retaining real
   claim/execution/publication and restored fail-on-call traps. History assertion now checks the previous
   `{previous_content, previous_reflect_response}` JSONB object rather than generated text. Nonempty children,
   semantic markers, current content, history, user resources, B2 sidecar and complete table equality remain.

`b3-recovery-2026-10-12.md:70-71` still says Core "will remove" the probe; actual source, child edits and
`b3-core-resume-diagnosis-2026-10-12.md:72-75` establish cleanup already completed. Do not repeat it blindly.

Current read-only reconciliation also verifies all 57 unique Home release paths (SHA256 and lengths), and all
979 Native artifact records: 958 generated, 12 maintained, four generation manifests, five generator sources.
All match. These overlapping inventories are not summed as unique work or tests. Home retains only
`scoped_browser_runner_pass`, `wholeStage5BAccepted: false`. Native historical SDK/generation evidence may be
reused only for unchanged covered behavior; neither reconciliation accepts current joint or independent review.

## Minimal complete remaining whole-5B gate

Source requirements: `implement.md:82-118`, `research/review-plan.md:12-21,96-108`,
`research/b3-resume-plan-2026-10-11.md:24-59`, backend quality guidelines' checks-before-handoff and boot sections.

1. Finish Core final-source 26-case selected/removed Healthy positives, W9 lease rollback, final
   selection/default/hold/incarnation/scope drift; actual copied SQLite/request/ZIP consumer refusal and D91
   stopped-writer traps; separate backup 256/257 and Healthy 1024/1025 capacity gates. Preserve adjacent offline
   W6, legacy v1/5A, B2 detached-Apply shutdown and N1/N2 trusted-label boundaries.
2. Execute actual customized and removed joint pair/CLI/physical restore/current preflight on one common source
   freeze. Historical validity must survive current configuration/receipt drift while fresh preflight refuses
   before writer start. Nonempty children/semantic history/sidecar/full user resources must survive actual COPY.
3. Obtain complete self-check source releases, transfer Core/Shared and Native ownership to independent reviewers,
   and review current whole B1-B3 code against original W9/5A boundaries. Reconcile Home PASS with current
   dependencies. Fixture preflight and old B1/B2 PASS are not this final independent gate.
4. Run serial Shared/Core/CLI/Desktop/e2e typechecks; serial Shared/Core/CLI/Desktop TS tests with at most two
   Vitest workers (one for any browser run requiring it); root `pnpm.cmd lint`; Desktop Vite build via
   `pnpm.cmd --filter @taki/desktop build`. Root parallel workspace scripts do not satisfy the serial rule.
5. Include Desktop Rust clippy/test as specified, or document complete unchanged Rust/source/config/lock evidence
   justifying reuse. Include actual Core main/WS boot with a new supported `b2-core-boot-NN` label, clean
   environment, isolated dataDir and final PID/port/owned-directory cleanup. The existing smoke script's label
   validation requires that exact naming pattern even when the run belongs to B3.
6. Run affected isolated Native B1-B3 regressions, applicable types/lint and canonical/SDK gates; unchanged
   canonical/generator/maintained/generated evidence may be explicitly reused. Historical SDK scope is Python
   109 excluding service main operations, TS 46/13 suites excluding main_operations plus build, Rust six
   specified offline release/locked contract binaries (14 tests), Go ten selected top-level contracts.
   Do not expand automatically into real-provider upstream or `.env.local`-loading e2e suites.
7. Root reconciles final manifests, exact commands/exits/counts, unchanged execution inputs, owned cleanup and
   each PRD criterion before marking automated 5B acceptance. Original/installed/manual/Stage 6 remains separate.

The e2e package has `test:e2e`, not `test`; it is not implicitly covered by a recursive `test` claim. Typecheck
and appropriate isolated entry integration are required, not an unapproved full real-capability e2e run.
No final source, whole-suite or independent acceptance is claimed by this audit.
