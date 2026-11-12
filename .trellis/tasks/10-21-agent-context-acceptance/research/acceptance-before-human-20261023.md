# Agent delegation and source-aware context: before-human acceptance

Date: 2026-10-23. Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, base HEAD `06a8090118a45a8c4f06472be4917108f93aea44`. Evidence applies to the recorded dirty working tree, not HEAD alone. The active session remains bound to `10-21-agent-delegation-runtime`; the legacy Avatar pointer was not changed.

Status: implementation, the authorized live campaigns and final automatic checks are complete and passed within the evidence boundaries below. **Stopped before human acceptance; no human trial has started or passed.** This is the current handoff and supersedes earlier paused/unstarted/final-gate-pending summaries. Tasks remain in progress and unarchived; no commit, push, main integration, release or real-user data mutation is included. Native Hindsight and main migration compatibility remain separate unverified gates.

## Delivered behavior

- Parent and child execution use the same Core Runtime, governance, Run/Attempt/Effect and recovery owners. A child keeps its own inspectable conversation and results; create/reuse, selected context and addressed follow-up do not create a second relationship Timeline or continuously copy the parent's conversation.
- Recording a result, requesting a new parent execution and publishing speech are separate operations. Parent cancellation leaves children running. A user-stopped child retains its context and queued input, requires explicit user Continue, and resumes in a new Run without reopening old terminal Runs.
- Home exposes the private conversation, input, Stop and Continue. Actual native Home, authenticated WS, production Core and SQLite were exercised together. The UI no longer invents chronological execution ordinals from an API list sorted by random Run ID.
- Available source/person/material information survives relevant tool, delegation, publication, replay, compaction and Local Memory consumers. Native message roles and tool results remain intact; missing attribution is not manufactured. A compaction-only prompt clarification addresses the observed loss of a separate person's reported event.
- Child Memory is read-only at executable selection and dispatch boundaries. The main Companion retains its existing write authority. Private child work and publication do not acquire automatic primary Memory eligibility.

Implementation details and file ownership remain in the existing [SDK](../../10-21-ai-sdk-upgrade-baseline/research/final/independent-review.md), [Runtime](../../10-21-agent-delegation-runtime/research/s2-implementation.md), [Desktop](../../10-21-agent-delegation-runtime/research/s7-implementation.md), and [Source](../../10-21-agent-source-context/research/source-acceptance-results.md) reports.

## Original acceptance matrix

The dispositions below describe the evidence boundary for each original parent criterion. They do not approve human trials or main-branch migration compatibility. Final repository checks are listed separately and must not be inferred from feature-scenario success.

| Parent criterion | Disposition and evidence |
| --- | --- |
| AC01: supported SDK baseline | Passed by the accepted SDK child, including reproducible exact package graph, real-fetch cancellation comparison, owner-approved callback policy, rollback and independent review. |
| AC02: create/reuse/context/input | Deterministic Runtime tests, real R1 and actual Home-to-Core input pass. Unrelated parent content is not mirrored and private correction does not enter relationship history. |
| AC03: result/inference/publication | Real R1 record-only and real R2 reply/internal-result paths pass, with one eligible new parent per completed work item and separate no-model publication. |
| AC04: independent stop and user latch | Real R2 cancels the actual parent, stops A precisely, leaves B running, observes the model's refused Continue and then explicit user Continue. Native Home and production restart supplement this evidence. |
| AC05: child conversation UI | Controller/render-state checks and four actual native Home-to-production-Core scenarios pass. Human usability, wording and perceived output remain unapproved. |
| AC06: actual source-aware model input | Actual requests, tool/source projections, original-root publication and post-compaction requests inspected. Retired subject-bearing content is absent outside the saved summary; unknown material remains unknown. |
| AC07: external versus user experience | Final real A1/A2 and repaired mixed/unknown A3 preserve the relevant subjects, events and explicit denial. Bounded semantic observations pass; the unsupported A3 correction narrative remains a wording caveat below. No universal grounding or reliability claim. |
| AC08: Memory meaning and eligibility | Real primary witnesses/sanitization, real Local Write Gate/extraction and actual Local sparse recall pass. Primary/private reply generation in that fixture is scripted. Native Hindsight extraction/reflection is an external, unverified dependency. |
| AC09: revision/stop/recovery/playback | Existing deterministic validity cases, real R2, two actual Core kills/three starts and real Skill/file/shared-child publication cover their stated paths. Native media acquisition/playback were synthetic in the new Co-Watching fixture; existing human playback checks remain open. |
| AC10: separate evidence levels | Deterministic, real-model, native scripted-model, external-dependency and human results are explicitly separated. No owner acceptance is claimed. |
| AC11: child read-only Memory | Actual tool-snapshot/SDK/alias enforcement, repaired real R3 recall and main retain pass; private work is excluded from automatic primary ingestion. Existing authority/capability facts remain unchanged. |

## Verification evidence

[Machine-readable final gate summary](final-automatic/repaired-final/final-gate-summary.json) aggregates the successful check exit codes and exact package counts without discarding failed earlier attempts.

| Check | Result |
| --- | --- |
| Whole-workspace typecheck | Passed: [original final-gate JSON](final-automatic/results-typecheck-lint-tests-bounded.json). Core/Shared were checked again after the TurnRegistry/inventory repairs, and [Core passed again after the final test fixes](final-automatic/repaired-final/core-typecheck.json); unchanged package results are reused. |
| Root lint | Final repaired run passed; see [gate results](final-automatic/repaired-final/results-lint-tests-bounded.json). The earlier 65-line TurnRegistry factory failure remains in the original log. |
| Whole-workspace TypeScript tests | **6,097 passed, 5 skipped, zero failed** in the [final run](final-automatic/repaired-final/tests-bounded.log): Shared 680, CLI 50, Desktop 1,231, Core 4,136. All 18 failures in the preceding run are resolved. Earlier failed logs remain intact. |
| Explicit deterministic E2E | [20 passed, 3 opt-in paid cases skipped](final-automatic/repaired-final/deterministic-e2e.json), including actual R2 control and production restart. Root recursive tests do not run this separate E2E command. |
| Desktop production build | Passed. [Commands/timings/exit codes](final-automatic/repaired-final/results-e2e-build.json) record both E2E and build. Existing large-chunk warnings are informational and retained in the build log. |
| Native Rust checks | Previously passed Clippy and 211 tests reused after [54/54 input hashes](final-automatic/native-input-parity.json) matched. The existing native example was rebuilt in this continuation. |
| Actual native Home/WS/Core/SQLite | [4/4 passed](native-runtime/report.md), including Stop, pending private input, Continue/new Run and retained private result. Model HTTP responses scripted; zero external calls. Rendered screenshots inspected by the coordinator, not owner acceptance. |
| Actual production restart | [First run passed](restart-20261023/report.md): two process-tree kills, three production starts over the same isolated database, durable latch/input, interrupted model Effect to `outcome_unknown`, exactly one retained result and no automatic replay. Eight local scripted requests; zero external calls. |
| Independent review | [Integrated review](../../10-21-agent-delegation-runtime/research/final-review/integrated-review.md) passed with no remaining in-scope technical blocker after the final gates. It covers production wiring, tests, actual live output and the retained narrative/external/human limitations. |

All commands run from T4 with exact invocation/environment/output paths retained in the linked reports. The [final environment record](final-automatic/repaired-final/execution-environment.json) records Node `v24.18.0`, pnpm `10.22.0`, four whole-suite workers and two E2E workers. General test invocations strip inherited live/provider flags and do not load the real provider file. Test databases, screenshots and synthetic model requests are retained under task-owned evidence directories. All five task/context validations passed in [task-validation.json](final-automatic/repaired-final/task-validation.json).

## Real-model observations and usage

| Campaign | Physical external requests | Reported total tokens | Outcome |
| --- | ---: | ---: | --- |
| R1 selected context, follow-up and reuse | 7 | 92,986 | Passed. |
| Original R3 Memory trial | 2 | 37,621 | Failed before the child's first model Effect; no Memory mutation. Preserved. |
| Repaired R3 | 6 | 90,712 | Passed with original mutation names still requested; actual child recall/main retain. |
| [R2 control and completion](r2-20261023/implementation.md) | 11 | 160,740 | One real attempt passed. Two additional Core requests cancelled while held had no external forward. |
| [Source campaigns](../../10-21-agent-source-context/research/source-acceptance-results.md) | 26 | 69,375 | Final A1/A2/A3, Co-Watching Skill/file and Local Gate/extraction completed; includes earlier rejected/semantically deficient trials. |
| **Total** | **52** | **451,434** | Failed and superseded usage included. |

R1/R3's retained evidence is indexed by the historical [checkpoint](recovery-20261023/acceptance-checkpoint.md). Requested model was `deepseek-v4-flash`; reported usage model was `deepseek-flash`. No alias equivalence is inferred. These are reported token counts, not billing; cache/reasoning subsets are not added again. This functional-campaign total excludes earlier separate SDK/connectivity baselines. No new paid call is needed to close the current automatic gate.

Each live batch retained exact synthetic outgoing requests and completed output, source hashes, request/deadline bounds, failures and cleanup. Candidate Effect observations beside concurrent requests are not exact request-to-Effect attribution. HTTP 200 alone is not semantic acceptance.

## Failures, corrections and material limits

- Real R3 exposed a mismatch between fixed read-only Memory projection and the parent's explicit tool selection. Trusted fixed exclusions now remain filtered without being misclassified as unknown requested tools; unknown names still refuse. The original mutation-requesting scenario was retained and passed after repair.
- The first Source A2 compaction was correctly rejected as `non_shrinking` (116 estimated source tokens versus 245 summary tokens). Only the unrealistic short fixture interlude changed; the production quality gate remained enabled. No failed output was committed.
- A3's actual compactor input contained both people's events, but its summary lost the external person's stopped project and invented prior confusion. The bounded compaction-only wording repair restored subject/event/negation retention in the final summary and answer. **The summary still says the user corrected a mix-up without sufficient evidence.** The response body's explicit facts pass the original source-attribution objective; not every narrative sentence is grounded, and the short closing recap is less complete than the body.
- The real Co-Watching preparation used the shipped Skill plus governed file reads/writes and shared child completion. Its phrase “语气还平得过分” has a weak stated basis and remains a human wording/grounding item. Review did not establish whether it asserted unseen audio or interpreted the text. Native acquisition and browser playback were synthetic; no extra Skill rewrite or paid answer-selection loop was performed.
- Source/R2 evidence helpers now fail on lost evidence or exceeded final cleanup deadline. Local failure-injection/lifecycle tests verify the safeguards; previously successful live trials recorded no such failures and were not repeated for helper-only corrections.
- The first final gate exposed a function-length violation and stale Shared inventories. The shutdown waiter owner was separated without changing Run/scope cancellation semantics; inventory tests now assert the three actual immutable Core delegation descriptors in addition to correct totals. Existing assertions were not dropped.
- The next whole-suite run reached Core and exposed 18 test failures: 17 used historical schema with today's Source-aware Timeline repository, and one expected curator prompt v1 after the intentional Source prompt v2 change. Backoff now exercises current schema; migration 035 still tests the actual 034-to-035 history using historical SQL, preserves canonical fields and migration receipts on reopen, and always closes registered database handles. The curator cancellation test still checks every late-callback/Memory boundary with the verified v2 identifier. These are test-only corrections, separate from the unresolved T4/main lineage split. Failed full-run logs are retained under `final-automatic/repaired/`.

## Hindsight and T4/main integration boundaries

The owner states that the compatible `hindsight-taki` version is unfinished and may not be formally usable. This continuation did **not** probe current native service availability, deploy it or run its native extraction/reflection. Local Memory and interface-contract evidence do not prove its provider-owned prompt behavior. Preserve formal native acceptance as an external dependency; do not report the service as empirically unavailable.

“T4/main migration compatibility not passed” concerns **SQLite upgrade history**, not moving the worktree. [The migration review](../../10-21-agent-delegation-source-context/research/current-main-migration-scope.md) records the divergence: T4 uses 049–055 for initiative structures, then 056 for Subagents and 057 for source context; main `e260ff4` uses the overlapping numbers for Memory and reaches 059. The current runner skips all scripts at or below `max(version)`.

A main-059 database handed to T4 would therefore skip required T4 tables. Renumbering just 056/057 to 060/061 cannot supply missing 049–055 dependencies and can repeat DDL on existing T4 databases. T4's isolated lineage is tested; merge/release compatibility requires a separately scoped, guarded convergence preserving both histories, followed by fresh/T4/main upgrade and receipt/data-preservation tests. No real-user database was opened for migration and no main merge was attempted.

## Stop point and future owner trials

Automatic checks are resolved; work stops here at the owner's requested boundary. Do not start or mark human trials without the owner's next instruction. Suggested later trials are readable child progress/input/Stop/Continue, the perceived separation of private work and Companion speech, natural mixed-source conversation after compaction, and real Co-Watching playback/revision/Stop plus the two wording caveats. These are future acceptance items, not new passed tests.

The worktree contains extensive pre-existing changes. Preserve original and repaired evidence, scoped working-state preimages and manifests; any rollback must reconcile later shared-file edits rather than resetting to HEAD or reversing another owner's changes. Human approval, native Hindsight, main migration convergence and release remain outside this completed-automation stop point.
