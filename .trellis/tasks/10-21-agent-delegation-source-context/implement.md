# Execution and coordination plan

Status: SDK, Runtime S1-S3, Source S4-S6 and Desktop S7 implementation, authorized live campaigns and final automatic checks are complete on 2026-10-23. The [current before-human acceptance matrix](../10-21-agent-context-acceptance/research/acceptance-before-human-20261023.md) owns the integrated evidence, failure disposition and remaining gates. Work has stopped before human acceptance. Formal native Hindsight behavior, T4/main migration convergence, release and commit/push/archive are not approved by these results. The dated entries below preserve historical execution states.

## Planning and research

- [x] Verify T4 worktree, branch and session-scoped task state.
- [x] Inspect existing active/archived task scopes and choose a new parent without changing old task ownership.
- [x] Preserve G1-G4, CS01-CS11 and the latest package-research leads.
- [x] Create four independently verifiable children, all in `planning` and without session activation.
- [x] Dispatch three bounded research assignments with exclusive output ownership.
- [x] Integrate research into the parent/child designs and resolve ordinary technical choices from evidence.
- [x] Curate and validate `implement.jsonl` / `check.jsonl`; check artifact links/encoding and task-tree consistency.
- [x] Prepare the Chinese review summary and record the explicit owner-start gate.

Current state: preparation is complete and the owner's subsequent conditional start instruction is satisfied for the SDK child. Respect the reviewed scope without requesting the same permission again. Remaining shared runtime/source contracts must be specified before their affected implementation, using the established research rather than a new product-preference interview.

## Authorized execution sequence

1. Activate the SDK child only, load `trellis-before-dev`, recheck the dirty-tree baseline and capture preimages. Run baseline checks including an isolated real Node Core boot; upgrade existing packages and fix only demonstrated compatibility breaks. Repeat comparable target checks without expanding to unused options.
2. Reconcile the child-result/source-preservation contract from both middle children against upgraded APIs. Record exact storage/protocol/queue boundaries, stale-result and restart behavior, and the render/evaluation candidates before the affected production edits.
3. Dispatch implementation with explicit file ownership. Runtime lifecycle/controls and source/prompt work may proceed independently only where their files and contracts do not overlap; sequence ChatAgent, RunService, publication, DB/protocol or shared prompt changes.
4. Run child-targeted checks, then the integrated SDK/Core/Shared/Desktop gates required by the actual changes. Do not rerun broad suites without a new change/failure or unresolved concern.
5. Execute the acceptance child's deterministic scenarios, authorized live-model trials and owner UI trials separately. Preserve pending manual playback checks and unknown memory-provider behavior as such.
6. Integrate evidence against parent AC01-AC11. Update affected architecture/spec documentation only for implemented verified behavior. No commit/push/archive is implied; wait for any separately required authorization.

## Dispatch protocol

Every dispatch starts with `Active task: <task.py current path>`, identifies the sole owned files/responsibility and tells workers that others share the workspace. Research stays within its assigned `research/` files. Implementers read the relevant child PRD/design/plan plus curated specs and report changed files, checks, unmet criteria and limitations. The parent reviews integration and never converts research completion into implementation approval.

Test reports and other retained evidence must use explicit absolute output paths under this T4 worktree's assigned `research/` directory. `pnpm --filter` changes the command working directory; do not derive artifact paths by counting `../` from the repository root. Verify each resolved destination before execution. Two test-only report-path mistakes were corrected by moving only the exact generated file after source/destination checks; no production or user data outside T4 was changed.

## Evidence and rollback checkpoints

| Checkpoint | Required record |
| --- | --- |
| Before upgrade | Exact installed/locked dependencies, touched-file hashes/preimages, current failure baseline, environment |
| After upgrade | Manifest/lock delta, actual resolutions, compatibility fixes and test results |
| Before shared contract edits | Package support/gap matrix, source lifecycle and consumer projections, additive migration/rollback plan |
| Before prompt selection | Official references, actual model requests, candidate comparison and semantic criteria |
| Before acceptance | Integrated version/config identifiers, deterministic results, pending live/owner gates |

Rollback uses the task boundary's saved state and respects newer concurrent changes; never use whole-tree reset/restore. Uncertain external effects are reconciled, not replayed. Failed checks must record the failing scenario, whether it predates the change and the next bounded action.

## Planning validation record (2026-10-21)

Historical pre-start record below; the later authorization and readiness disposition are recorded in the next section.

- All five `task.py validate` calls pass without warnings; all ten context manifests contain real entries.
- Full research reports exceed the 32 KiB injection cap. Manifests now load the 13,209-byte [reviewed brief](research/planning-brief.md), which links the complete reports for task-specific reading; the full evidence is preserved.
- A 35-file planning check passed UTF-8/no-BOM, whitespace, local-link and no-placeholder checks; all four child-parent links and all five `planning` / `await_owner_start` states were verified.
- Root/Core package manifests and the premodified lockfile retain their original SHA-256 hashes from this turn. Existing source/dependency work was not upgraded or reverted.
- `git diff --check` passed for the three updated documentation entry files. No repository runtime/test suite, package install, paid/live model call or owner acceptance was performed. The runtime research's source-based fake-adapter probes remain separately identified in its report.
- Session task lookup resolves this parent via `session:codex_01a15dc7-9db1-7e03-a520-9b09333423fb`; the legacy global pointer was not changed. The next intended execution target, once authorized, is `10-21-ai-sdk-upgrade-baseline`, not the parent.

## Start readiness record (2026-10-21)

- Owner instruction: optimize global rules first, then development is allowed when preparation is complete. This supersedes the earlier wait.
- Global `C:/Users/55473/.codex/AGENTS.md` was revised from 16,107 to 13,536 bytes and loaded into the current session. Its exact preimage is `C:/Users/55473/.codex/backups/global-instructions/20261021-205131-213831/AGENTS.md`; SHA-256 `71c85df8e07b19a12e0c1814d7a66f520b3916a59e7ca2839a51a077cb704732`.
- Global readback confirmed UTF-8 without BOM, no `AGENTS.override.md`, and byte-identical managed jbcontext content. Updated SHA-256 is `254af364172ae74f30d23ad0ea08fe74ea1199a58da8e591cebee83df35165d2`.
- [Independent readiness review](research/readiness-review.md) found no further framework/research/permission prerequisite for the bounded SDK upgrade. Its two refinements are adopted: isolated real Node Core boot before/after, and capped-concurrency/timeout testing only if actually used or affected by a demonstrated fix.
- Context manifests and reviewed child artifacts remain ready. Begin the SDK child; do not treat its completion as proof of delegation/source or owner acceptance.

## Session recovery and open gates (2026-10-22)

- Resumed the original user messages and execution record from session `01a15dc7-9db1-7e03-a520-9b09333423fb`. The later development authorization and `xhigh` sub-agent preference remain effective; no new task was created.
- Verified `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, and the existing dirty tree. Current session `codex_01a16275-c345-74e0-8706-d9ad95441552` is bound to the existing SDK child. The stale legacy avatar pointer was not changed.
- SDK recovery verified the saved source/configuration hashes, installed exact versions and scoped rollback. Workspace typecheck, root lint, bounded TS tests (5,959 passed, 2 existing skips), Clippy and 211 Rust tests pass. Real Node boot evidence is separate and includes zero model requests. These checks do not resolve the following compatibility finding.
- [Independent SDK review](../10-21-ai-sdk-upgrade-baseline/research/recovery/independent-review.md) reproduced a real Node-fetch partial-cancel regression against the exact old package graph and original ChatAgent: target starts post-turn maintenance once where baseline starts it zero times. The same committed partial conversation survives both. The [isolated cancellation proposal](../10-21-ai-sdk-upgrade-baseline/research/recovery/cancel-policy-proposal.md) now includes an applicable diff and fifteen passing old/target/candidate checks. It preserves primary source witnessing but intentionally changes post-turn callbacks and the actual-fetch cancellation ending. Owner confirmation has been requested; no candidate production change is applied. The SDK child remains pending until the decision, maintained regressions and independent repaired-source review.
- [Joint contract research](research/joint-runtime-source-contract.md) and its [independent review](research/joint-contract-review.md) are recorded. The researcher is reconciling the bounded review corrections before any shared schema/Runtime/source production edit. The middle-child dependency gates remain in force.
- No paid/live-model trial, live-data mutation, commit, push, finish or archive occurred during recovery. Existing manual/owner acceptance remains pending.

## Owner follow-up (2026-10-22)

- The owner approved the concrete unified cancellation proposal. The SDK implementer is applying the scoped change, updating its explicit contract/regressions and completing independent verification. The earlier pending decision is resolved; SDK compatibility remains pending until those checks pass.
- The owner permits using the coordinator's observed create, message, follow-up, independent interrupt and result-delivery interactions as a comparison for the product delegation flow. Compare explicit observable interaction contracts, not unknown implementation internals; retain Taki's G1-G4 requirements where the products differ.
- The owner clarified that Subagents must be read-only Memory consumers, with changes owned by the main Companion. R14/AC11 and the Runtime child now capture this requirement. Live inspection found reusable captured-tool projections and read/write classifications, but no generic child-only restriction; the joint contract must close that integration gap without creating another Memory service or broadening memory admission.

## SDK gate passed; Runtime S1 active (2026-10-22)

- [Final SDK review](../10-21-ai-sdk-upgrade-baseline/research/final/independent-review.md) passes with no remaining blocker. Final [required checks](../10-21-ai-sdk-upgrade-baseline/research/final-verified/results-typecheck-lint-tests-bounded.json) pass: 5,968 TS tests, two unchanged skips, typecheck and root lint. Real HTTP/WS cancellation and zero-model-request Node boot passed; native hashes justify the recorded 211 passing Rust tests. Parent AC01 is satisfied. The SDK task remains unarchived under the owner's lifecycle boundary.
- The coordinator accepted the corrected joint contract, including work-scoped supersession, canonical atomic terminal participation, inspectable synthesis/explicit report publication, acquired material sources, Co-Watching handoff, and simple instructions/effective-tool configuration with readonly child Memory. These are implementation requirements, not completed features.
- Current session is bound to `10-21-agent-delegation-runtime`, now `in_progress`. Dispatch `delegation_persistence` owns only S1 Shared schemas, additive database records/repositories, RunRepo/RunService participants and focused tests. No dispatcher/UI/source-publication implementation is included in S1. Review its actual output before transferring shared owners to S2/S3.

## Real-model E2E authorization (2026-10-22)

- The owner explicitly authorized real-model E2E tests to verify the implementation. This supersedes the earlier live-model restriction; do not request that permission again. Run bounded scenarios against isolated synthetic/test-owned data using the supported configured model route, and record model/settings, actual requests, results and failures without exposing credentials.
- `delegation_live_e2e_preparation` owns only acceptance research/evidence readiness while S1 review and S2/S3 preparation proceed. Full feature trials wait for the relevant implementation; a connectivity smoke is not delegation/source acceptance.
- Deterministic concurrency and authority checks, real-model observations, and owner UI/playback acceptance remain distinct evidence. Do not silently mark manual acceptance passed or modify real-user Memory for tests.

## Runtime S1 passed; S2/S3 active (2026-10-22)

- [S1 independent review](../10-21-agent-delegation-runtime/research/s1/independent-review.md) passes. The original implementation plus bounded reviewer fixes are verified; both owners released the files. The Runtime child's current handoff lists the actual API, verification and ownership details.
- `delegation_execution` now owns shared execution, role/tool selection, read-only child Memory, controls, completion/recovery/RPC and the direct-request report path. Shared barrel, ChatAgent, RunService and `main.ts` remain single-writer Runtime files.
- `source_context_execution` is implementing the independently released S4 publication-storage subset in the activated source child. Co-Watching producers and S5/S6 still await their Runtime port handoffs. `delegation_desktop` completed read-only preparation; UI production work follows stable protocol. Neither preparation nor S1 acceptance passes the parent feature criteria.

## Current migration integration boundary

[Independent migration scope review](research/current-main-migration-scope.md) confirms a pre-existing split beginning at 049: current `main` (`e260ff4`) reaches 059 with Memory deployment/transition/template tables, while this T4 lineage contains initiative/pattern tables through 055 and this task adds local 056/057. The current max-version runner cannot merge those meanings, and merely renumbering the new files would omit required old structures or duplicate already applied DDL.

Continue T4 feature implementation and isolated deterministic/real-model acceptance using the existing T4 lineage. **Current-main merge/release migration compatibility is not passed.** An actually requested integration requires one migration owner, a higher guarded convergence after both histories, dependency-ordered schema preservation, and fresh/both-lineage/receipt-preservation tests. Do not import unrelated main features, rewrite receipts, renumber S1 independently or run a real-user migration under this task's current scope. `base_branch: main` records the integration target; it does not authorize that integration now.

## Reboot recovery (2026-10-23)

- Read the original user instructions and latest execution record from session `01a16275-c345-74e0-8706-d9ad95441552`, including the explicit real-model E2E authorization. The earlier compacted summary predates that authorization and the completed S1/S4 storage work; it is not the current gate state.
- Verified this T4 worktree, branch and HEAD `06a8090`; preserved the existing dirty tree. Session `codex_01a16655-b1ca-78b0-816b-7b842fba516f` is bound to the existing Runtime child through `task.py start` / `current --source`. No new task was created. The legacy `.trellis/.current-task` avatar pointer remains untouched.
- The prior agent processes are absent after restart. Recovery owners are `delegation_execution_recovery` (S2/S3), `source_context_recovery` (S4-S6) and `delegation_desktop_recovery` (S7), all dispatched with `xhigh`. Their current-source assessment, rather than the interrupted process state, determines remaining work.
- SDK and S1 remain passed checkpoints. S2's saved controlled-provider/SQLite vertical evidence covers 24 tests, not the complete Runtime feature. The Source child's `research/s4-implementation.md` records the completed publication-storage subset, not source rendering, Memory interpretation, Co-Watching adaptation or live semantic acceptance. Desktop delivery and integrated acceptance remain pending.
- Shared Runtime/ChatAgent/RunService/main composition stay Runtime-owned; source schemas, publication storage, rendering/compaction/Memory consumers and Co-Watching stay Source-owned; Desktop owns its client/UI files. Stable protocol and adapter handoffs are required before cross-owner wiring. The coordinator owns integration evidence and final review.
- Continue authorized implementation and isolated bounded live-model testing. No commit, push, archive, release, cross-branch migration or real-user data mutation is implied; owner UI/playback acceptance remains pending.
- Later owner routing instruction: select `gpt-6.1-sol` for simple test execution/conventional verification and `gpt-6-astra` for coding or audits, according to task difficulty. Retain the established `xhigh` effort preference. Existing running agents continue; apply the model choice to subsequent dispatches.
- The owner then requested revival of the rate-limited Desktop recovery agent while the other existing workers continued, and limited subsequent parallel dispatch to two child agents. Stagger later dispatches/recovery to respect that concurrency limit; do not restart completed research after a transient service limit.

## Owner-requested pause after current tests (2026-10-23)

- The owner instructed the coordinator to finish the current test task, then pause and report. Source and the independent checker were resumed after rate limits, completed only their current scoped work, released ownership and stopped. No new R2/A1-A3 scenario or whole-workspace test campaign was started during closeout.
- [Acceptance checkpoint and AC01-AC11 coverage](../10-21-agent-context-acceptance/research/recovery-20261023/acceptance-checkpoint.md#owner-requested-pause-after-current-tests) is the current consolidated handoff. Runtime S2/S3, Source S4-S6 and Desktop S7 implementation reports are available. The bounded independent review passed 37 local regressions without a new confirmed defect or source edit; Source's six-report latest-result aggregation is 290 distinct passing cases, not a new full-suite run.
- Real R1 and repaired R3 passed; the original R3 failure and usage remain retained. A1-A3 never started, with zero additional provider requests. R2 real-model coverage, complete Co-Watching/native Memory semantics, final integrated review/whole-workspace gates and owner acceptance remain open. Existing historical SDK and Desktop full-suite evidence is not a final integrated-tree gate.
- The work remains paused at the owner's request. Do not advance the pending gates until the owner resumes. Session binding stays on the existing Runtime child; parent/child completion boxes and lifecycle statuses are unchanged. No commit, push, archive, release, cross-branch migration or real-user data mutation is implied.

## Owner resume: finish before human acceptance (2026-10-23)

- The owner resumed the existing task and requested completion of the remaining work up to, but not including, human acceptance. This supersedes the preceding pause. Continue bounded implementation repairs, deterministic/integrated checks and authorized real-model trials without requesting the same permissions again. Keep at most two child agents active concurrently.
- The owner clarified that `hindsight-taki version` is not complete and Hindsight may not yet be formally usable. Verify the Local Memory path and applicable existing Hindsight contract tests; report unavailable native Hindsight semantics as a dependency limitation. Do not extend this task into finishing/deploying Hindsight or pretend that mocked/native-wire tests prove its real prompt consumption.
- Complete source A1-A3, remaining delegation R2, the feasible real Co-Watching Skill/file/model path and Runtime/Desktop integration, then the final required checks and independent cross-layer review. Reuse passed evidence where code/input hashes and scope still apply; do not repeat passing paid trials without a relevant change or concern.
- Stop before requesting or performing owner UI/conversation/playback trials. Produce the acceptance matrix and concrete manual handoff, leaving human criteria unapproved. Commit/push/archive, main-branch schema convergence and real-user data changes remain outside scope.

## Automatic acceptance complete; stopped before human trials (2026-10-23)

- [Final acceptance report](../10-21-agent-context-acceptance/research/acceptance-before-human-20261023.md) records original AC01-AC11 coverage and separate model, deterministic, native UI and external-dependency boundaries. R1/repaired R3, real R2, final Source A1-A3, real Skill/file Co-Watching preparation and Local Gate/extraction/recall are complete. Failed/superseded trials remain included: 52 physical provider requests and 451,434 reported tokens for these functional campaigns.
- Final automatic checks passed: 6,097 TypeScript tests with five skips, explicit deterministic E2E 20 passed with three opt-in live skips, applicable typechecks, root lint and Desktop build. Actual native Home-to-Core scenarios passed 4/4. Earlier Clippy/211 Rust-test evidence was reused only after 54/54 native inputs matched. Runtime production kill/restart checks passed again after the last production change.
- The final Core failures required only three test corrections for historical schema/current repository separation and the verified curator prompt version; no production migration, Memory authority or test assertion was relaxed to hide them. The independent report retains the fixes and evidence.
- Two model-wording caveats, human conversation/UI/playback trials, native Hindsight semantics and T4/main migration convergence remain visible and unapproved. No human trial, further paid retry, commit, push, archive, deployment, main merge or real-user data change is performed. Parent/child metadata stays `in_progress`; the session pointer remains Runtime and the stale global pointer is untouched.
