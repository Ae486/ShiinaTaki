# Acceptance recovery checkpoint

Date: 2026-10-23. Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`. This is a partial integration checkpoint, not complete parent acceptance.

## Implemented fixture and deterministic evidence

- Explicit synthetic request capture is opt-in and separate from ordinary content-free observer diagnostics. A finite upstream request budget and failed evidence capture refuse forwarding. All 12 local HTTP observer regressions pass; the three new cases have preserved failing pre-change evidence in `observer-red.json`.
- `agent-context-scenario.ts` uses the existing isolated canonical Local seed, production Core entry, authenticated WS and provider relay. Exact outgoing synthetic bodies, phase snapshots, usage, concurrent Effect candidates and Core/Shared/E2E source hashes are retained. Candidate Effects do not imply exact request attribution.
- `scripted-rpc.json` passes two real-process/WS cases, with four and six local HTTP requests respectively: selected private child context, addressed input receipts, distinct terminal Runs, record-only versus deduplicated internal parent continuation and no implicit speech. Both cases retained stable source hashes. This provider was scripted, with zero external model calls.

## First bounded real-model batch

Evidence: `../live-r1-r3-20261023-100158/`. The coordinator obtained a temporary Core/Shared source freeze, then released it immediately after the batch.

- Requested model: `deepseek-v4-flash`. Usage rows reported `deepseek-flash`; no unverified alias equivalence is assumed.
- R1 passed with seven HTTP 200 requests, stable source hashes and 92,986 reported total tokens. The real model created the selected-summary child, handled an actual addressed correction, reused its retained working context for a new work item and produced no parent continuation for record-only work. The unrelated parent marker and private correction did not leak across their prohibited boundaries.
- R3 failed with two HTTP 200 requests, stable source hashes and 37,621 reported total tokens. Both requests belonged to the original primary Run. The child was durably accepted but failed before any child model Effect or input receipt; no Memory mutation occurred and the main-write portion was not reached.
- Cache-read/reasoning values are subsets of the reported token totals, not additional usage. These are observed usage values, not provider billing. The failed trial remains separate from any repaired trial.

## Confirmed R3 defect and next gate

The real parent requested an allow-list containing `recall`, `complete_subagent` and the four Memory mutations. Captured child Memory projection removed mutation tools correctly, but the later selection validation treated those fixed exclusions as unavailable requested tools and failed the whole execution. The required contract is to retain the permitted read while fixed mutation exclusions remain enforced.

`scripted-projection-red.json` independently reproduces the same failure through production Core and WS with a local provider. It retains the mutation names in the request rather than weakening the test, and records a failed child with no model request. Runtime owns the repair and integrated captured-snapshot/metadata-alias regression; arbitrary unknown-tool refusal, explicit empty selections and unchanged provider capability facts must remain intact.

Run only the repaired R3 live case after its deterministic gate and another brief source freeze. Do not repeat the passing R1 for unrelated changes. Runtime/Source completion, source A1-A3, remaining control/recovery integration, final independent review and full required checks remain outstanding. Desktop S7 has its own completed scripted-RPC native evidence and pending owner acceptance; it is not real Runtime/model evidence.

## Repaired R3 result

Runtime captured the fixed Memory exclusions from trusted tool metadata before the child projection. The final selector may remove those parent-authorized fixed exclusions without mistaking them for unknown tools; unknown names still refuse, and capability facts/digests remain unchanged. The real captured-snapshot/SDK regression covers mutation aliases as well as canonical names. The maintained production-WS regression passes in Runtime `research/s2-recovery/scripted-projection-green.json` with the original mutation-requesting test unchanged.

`../live-r3-repaired-20261023-101357/` passes R3 with six HTTP 200 requests, stable source hashes and 90,712 reported total tokens. The child actually invoked `recall`, obtained a marker present only in the seeded canonical record, had no executable mutation tools, made no mutation call and left the exact original row unchanged. The main Companion subsequently invoked `retain`, producing the requested new canonical record. Only the failed R3 was rerun; R1 was deselected.

The combined observed total across the passing R1, failed original R3 and passing repaired R3 is 15 HTTP requests and 221,319 reported tokens. Failed usage is retained rather than hidden. No native Hindsight extraction, source A1-A3, real-browser playback or owner acceptance is established by these two live scenarios.

## Owner-requested pause after current tests

Date: 2026-10-23. The owner requested completion of the current test task followed by a pause and report. Both rate-limited active workers were resumed, completed their existing scoped checks and released ownership. No new R2 or A1-A3 scenario, paid retry, whole-workspace test campaign or implementation was started during this closeout. Work is paused until the owner resumes it; this checkpoint does not complete or archive any task.

The coordinator rechecked cwd, branch, HEAD `06a8090`, worktree list and `task.py current --source`. The main session remains bound to the existing Runtime child; the stale global Avatar pointer is unchanged. Both workers reported no remaining test/provider process; the coordinator also found no matching T4 test/Core fixture processes in the final process check.

### Completed evidence

| Layer | Result and exact limit |
| --- | --- |
| Runtime S2/S3 | [Implementation report](../../../10-21-agent-delegation-runtime/research/s2-implementation.md): 74 scoped Core tests, 3 Shared schema tests and later selection/source/continuation regressions passed. The later sets overlap; these counts must not be added as unique coverage. |
| Source S4-S6 | [Final Source report](../../../10-21-agent-source-context/research/s5-s6-implementation.md): [six retained reports](../../../10-21-agent-source-context/research/s5-s6-recovery/final-test-summary.json) contain 290 distinct file/full-test-name pairs whose latest status is passed. The coordinator independently recomputed that total and confirmed zero unresolved failures. This is aggregated scoped evidence, not a single full-suite invocation. |
| Source static checks | [checks-final.json](../../../10-21-agent-source-context/research/s5-s6-recovery/checks-final.json): Core and Shared typecheck, manifest-scoped ESLint and manifest-scoped diff check all exited 0. Source's manifest contains 46 code/test/index paths. |
| Desktop S7 | [Implementation and native evidence](../../../10-21-agent-delegation-runtime/research/s7-implementation.md): prior full Desktop suite 1,231 passes; final follow-up 30 passes, typecheck/lint/build passes and six actual WebView2 scenarios. The native RPC state is scripted and Shared-validated. This is not real Runtime/model integration or human acceptance. |
| Production Main/WS | Existing isolated scripted-provider evidence passes record-only and request-parent cases, plus the unchanged mutation-selection regression after its repair. These execute production Core and authenticated WS with local HTTP responses, not a real model. |
| Real model | R1 passed; original R3 failed before the child model request; repaired R3 passed. The retained trials total 15 HTTP 200 requests and 221,319 reported tokens, including failed usage. No new external model request occurred during this pause closeout. |
| Bounded independent review | [Independent report](../../../10-21-agent-delegation-runtime/research/final-review/independent-review.md): 37/37 local regressions passed (Core 17, Desktop controller 8, observer 12), with no new confirmed defect and no production/test-source edit. The coordinator checked all three raw reports. This is not a full cross-layer review of the entire delivery. |

### Corrections retained with failing evidence

- Real R3 exposed a mismatch between fixed read-only Memory projection and explicit tool selection. The repair preserves trusted captured exclusions while keeping unknown-tool refusal and provider capability facts intact. The passing original scenario still requests the mutation names.
- A continuation check exposed acceptance clearing the user-stop latch before rejecting expired or retired-source work. The service/repository guards now reject before the mutation; the regression observes unchanged latch, control version, inputs and model-call count.
- Source's actual-SDK regression exposed loss of non-enumerable producer source metadata during response conversion. Exact completed-call metadata is now retained at the actual SDK seam. The prior compactor tool-label spelling was also preserved.
- The retained Source reports include 41 initial failures that have subsequent passing results: two source/reduction compatibility cases, 38 old explicit migration-list fixtures missing the new source column, and one deliberate curator prompt-version expectation. The fixture lists now include existing migration 057; production schema fallback and historical migration rewriting were not introduced. These earlier failures are not deleted or relabelled as passing runs.

### Parent acceptance coverage at pause

This table records evidence coverage, not new acceptance-checkbox approvals. Only the already accepted AC01 remains checked in the parent PRD.

| Parent criterion | Covered evidence | Open gate |
| --- | --- | --- |
| AC01 SDK compatibility | Existing final SDK independent review and required checks | No new gate introduced by this pause |
| AC02 selected context/reuse/input | Runtime deterministic tests and real R1 | Final integrated acceptance |
| AC03 retained completion/parent inference/publication | Runtime SDK/SQLite and production-WS scripted cases; real R1 record-only | Remaining real-model control/continuation coverage and final integration |
| AC04 independent controls | SDK/SQLite parallel-child/parent-stop/user-latch tests; independent rerun | R2 real-model scenario was not implemented or executed |
| AC05 private conversation UI | Controller tests, final S7 static/build checks and scripted-RPC WebView2 scenarios | Owner UI acceptance and complete Runtime/UI path |
| AC06 actual source carriage | Serialized-request, SDK, publication/replay/reduction and compaction-CAS deterministic evidence | Live A1-A3 and final source integration review |
| AC07 external/self-report/mixed attribution | Prompt/source implementation and deterministic request inspection | A1-A3 not started; no live attribution-quality conclusion |
| AC08 Memory source meaning | Local/Hindsight source readers, retained text/offsets, hashes and ingestion-wire tests | Native Hindsight extraction/reflection consumption and eligible real flush/semantic evidence |
| AC09 revision/recovery/playback | Runtime recovery and shared-child Co-Watching control/currentness tests | Complete real Skill/file/model Co-Watching path, remaining recovery integration and owner playback |
| AC10 evidence separation | Deterministic, live, native-scripted and owner results remain separately labelled | Final acceptance campaign and owner confirmation |
| AC11 child read-only Memory | Executable selection/indirect-dispatch checks and repaired real R3; permitted main retain observed | Final aggregate create/reuse/recovery coverage review |

### Resume boundary

- A1-A3 live fixture creation and calls never began: zero new generations, physical provider requests or token usage. Do not fabricate absent primary eligibility to avoid a real Memory flush in a future fixture; do not claim a baseline improvement without a comparable baseline.
- The pending whole-workspace gate is `pnpm -r typecheck`, root `pnpm lint`, and `pnpm -r test --maxWorkers=4`, with relevant E2E invoked explicitly. These were not run on this final integrated tree. Rust/native checks require comparing their recorded inputs before choosing whether existing evidence remains applicable.
- Current T4 and main migration histories still diverge from 049. T4-only feature evidence does not clear a main merge, release or real-user migration.
- No commit, push, finish/archive, release, real-user data change or human acceptance was performed. Resume the existing tasks and preserved evidence when requested; do not automatically start the open gates after this report.
