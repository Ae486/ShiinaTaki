# C3 integrated implementation and verification

Date: 2026-09-28. Workspace: `H:/TakiAgent-worktrees/t4`. Branch: `task/t4-skills-mcp-productization`.
HEAD remains `06a8090118a45a8c4f06472be4917108f93aea44`.

The later owner-approved [real-model extension](real-llm-acceptance-2026-09-28.md) records actual DeepSeek trials,
timezone/schema/authoring fixes and final request-context probes. Its root lint passes after the owner's test-size
policy clarification. The earlier gate below is preserved as historical evidence; its real-provider and root-lint
limitations are superseded only where the extension supplies newer results. Manual acceptance and the independent
repository/installed lock discrepancy remain pending.

## Authorization and scope

The owner requested continuation, then explicitly approved C3 after reviewing the Hermes/OpenClaw reference
design and the C1/C2 prerequisite evidence. The later instruction was to continue after rate limiting.
Native session binding is `codex_01a0e700-4c6f-7831-a73a-8c9fe0d33167`; the legacy global Avatar Lab pointer was
intentionally preserved. No new task replaced this child and no C4 implementation was started.

This report covers C3 Pattern authority, finite source/policy integration, conversational and panel review,
standard Skill setup and the existing Monitor. C4 Intention execution/backoff, owner experience and real-provider
acceptance remain separate. PRD manual acceptance checkboxes remain unchecked.

## Implemented behavior

- Strict Pattern definitions, immutable revisions and exact CAS review are Core-owned. Seeds, primary Agent
  proposals and panel management use the same authority. Active rules survive candidate editing; rollback is
  another reviewable candidate. Confirmation never writes permission/Approval grants.
- The primary `manage_interaction_pattern` tool uses the actual appended user row and live Run/Attempt. It
  supports bounded list/history pagination and lifecycle changes, but cannot confirm an unseen revision.
- Actual accepted Perception, explicit-input Presence return, User Timezone and terminal background Runs feed
  finite matching. Unknown idle/absence stays unknown. Foreground/screen privacy retirement and source generations
  fence old work. Existing published Class A results and heartbeat completions cannot create cascades.
- One explicit target, deterministic source occurrence/chance, bounded candidate coalescing, Pattern judgment gap,
  shared model cadence and canonical Class B quotas precede the existing C1 Run/Effect/ChatAgent execution.
  Both wake-source switches closed means no new admission even on policy changes or queue release.
- Thin context uses the real provider-neutral Memory capture: full Persona, only selected bounded global/Character
  Blocks/index and actual optional source manifests. It does not copy primary history or invoke automatic recall.
  Preparation has original-authority fencing, deadline/cancel/shutdown handling and outcome-policy enforcement.
- Main registers migrations 052/053, the primary tool, operator methods and local post-commit/source invalidations.
  Startup follows recovery and WS readiness. Shutdown closes preparation/wake before storage; cancellation targets
  heartbeat Run IDs and cannot cancel another primary/scheduled lane occupant.
- Home and Chat share readable candidate/history/lifecycle views. Settings expose actual config/time/source
  readiness; policy views explain periodic/event scope and shared budgets. Client recovery re-reads current state
  without replaying mutations or losing retained drafts/focus/selection.
- Bundled authoring guidance is actual byte content imported through the existing immutable Skill lifecycle.
  Named directory wrapping, same-name user packages, disablement, unavailable content and explicit seeds are tested.
- Same-Monitor diagnostics record bounded pre-admission policy transitions without fabricated Runs/model usage.
  Tool inputs/results remain available to canonical replay while readable/expanded/accessibility/copy views omit
  internal IDs, cursor and source bindings.

## Review and fixes

The delegated [formal review](formal-review-2026-09-28.md) found and fixed three defects: unreachable records beyond
the first conversational page; both disabled wake controls bypassed by policy/release notifications; and missing
periodic/event scope disclosure. All scoped review regressions pass and no reviewed production finding remains.

Integration additionally exposed and fixed standard Skill directory wrapping, operation-specific tool fields,
unknown-seed/pre-write validation, observer failure isolation, preparation cancellation and actual source manifests.
The initial full checks exposed outdated exact governance/knob/migration inventories; those now include C3.
Historical migration-051 tests remain explicitly pinned to that history instead of accidentally running the current tail.

## Engineering coverage

| Criterion | Exercised evidence | Acceptance boundary |
| --- | --- | --- |
| C3-01 | Actual primary tool proposal -> exact operator confirmation -> automatic clock/presence-conditioned wake -> C1 model/Timeline/Monitor. Native review/edit/history/pause/resume/rollback/create/retire and reconnect cases. | Unsupported-condition clarification is specified/tested structurally; subjective real-model authoring remains owner acceptance. |
| C3-02 | Real immutable Skill service tests plus fresh install over actual Core RPC. Seed identity preserves edited/paused rules; collisions/disabled/unavailable packages are distinct. | No user installation or real data was changed. |
| C3-03 | Real SQLite source/CAS/idempotency/history/reopen tests, exact candidate UI confirmation and source-retirement refusals. | No permission inheritance or automatic candidate approval. |
| C3-04 | Source, policy, queue, Memory and real-process zero-request cases for missing sources/invalid target/quiet hours/both source controls disabled; focused stale/privacy/busy/budget tests. | No claim of a newly acquired sensor or inferred human reading. |
| C3-05 | Two data-only definitions (clock window, clock plus accepted direct-input presence) use the same unmodified Core/C1 adapter. Activity/dwell/idle/return/completion matching has owning-source regressions. | C4 due-Intention source remains inert. |
| C3-06 | Actual Run trajectory and persisted policy reads before/after restart, same-Monitor inspector privacy tests, frontend rendered policy disclosure. | Diagnostic transition counters deliberately coalesce identical sampling ticks. |
| C3-07 | Package regression gates, actual WebView2 scroll/focus/selection/reconnect cases, C1/C2 protocol compatibility and additive historical migrations. | Whole-workspace QQMM limitations and owner experience remain explicit. |

## Verification ledger

| Check | Result / evidence |
| --- | --- |
| Shared full suite | 65 files / 632 tests passed; `validation/shared-full.log`. |
| CLI full suite | 8 files / 50 tests passed; `validation/cli-final.log`. |
| Combined typecheck | Shared, Core, Desktop, CLI and E2E passed; `validation/typecheck-final.log`. |
| C3 unmodified Core process | 3 tests passed in `validation/pattern-process.log`: actual primary authoring, automatic wake, Timeline/Monitor/restart, plus real Skill install and forbidden-state zero requests. |
| Combined C1/C2/C3 process regression | 20 tests in 2 files passed in 113.92 seconds; `validation/e2e-final.log`. |
| Core full final | 444 files / 3620 passed and one existing skip, exit 0 in 717.47 seconds; `validation/core-serial-final.log`. |
| Desktop | Final full gate: 194 files / 1165 tests passed in 71.69 seconds; `validation/desktop-final.log`. Production build passed; `validation/desktop-build-final.log` (existing large-chunk advisory remains). |
| Formal review | Core 92, Shared 21, Desktop 50 plus final UI 6 tests; focused lint and package typechecks passed. See reviewer report. |
| Native WebView2 | 8 groups passed. JSON and 3 PNG files copied and SHA-256 verified under `validation/ui-native-2026-09-28T093219Z/`. See [UI evidence](pattern-ui-implementation.md). |
| Rust | C3 changes no Rust/Cargo source relative to C2's verified inventory. C2's same-source tests passed 198 library + 7 helper cases. Final locked Clippy with `-D warnings` passed again in 1.26 seconds; `validation/clippy-final.log`. |
| Root lint | Final root run fails only on independent `apps/desktop/test/qqmm-home-native-smoke.mjs`: 361 nonblank lines against its 360-line limit. C3 files pass root lint; `validation/root-lint-final.log`. No size guard or unrelated script was changed. |
| Task validation | Curated context validation passes; tracked `git diff --check` passes with line-ending notices. New source/task text files are checked for UTF-8/no BOM and trailing whitespace. |

The initial unrestricted-parallel Core run had 25 failures: stale inventory assertions plus 5000 ms timeouts.
Inventory failures were corrected; timeout limits and assertions were not relaxed. The complete final Core gate
used one worker and passed all 3620 active tests, matching the successful C2 verification strategy. This resolves the gate without asserting the exact cause of the earlier timing failures. Initial log is retained as `validation/core-full.log`.

## Reproducibility and remaining boundaries

`source-at-final-gates.json` records 2202 source/config files, current HEAD/index, repository and installed lock
hashes. The index remains identical to C2. `verified-source-2026-09-28.json` records final reconciliation. Core/Shared/Desktop/E2E production and test code did not change during the final gates; only documentation indexes changed. HEAD and Git index remain unchanged.
Independent QQMM source/lock work remains outside this child's ownership; no whole-workspace frozen-lock rebuild
or globally green lint claim is made. No dependencies were added or reinstalled for C3.

All process/model tests used isolated fixture databases, loopback ports and a local scripted provider. Actual native
WebView2 tests use a scripted backend with real Pattern/SQLite domain ownership; they do not replace end-user or
real-provider trials. No commit, push, reset, rebase, production deployment or finish/archive was performed.

## Rollout and rollback

- Startup applies additive migrations 052/053. Back up a real data directory before a later owner-controlled upgrade.
- Initiative remains explicitly configured: select target, review desired rules, confirm them and enable the relevant
  source controls under shared budgets. Installing guidance or adding a seed alone never enables a rule.
- To stop new admission, turn off the initiative master switch or both source switches. Existing dependent work is
  invalidated. Retain compatible readers and durable Pattern/Run/Timeline/Memory history; never downgrade through
  written schema/event versions, rewind reviews or undo already executed effects.
- Child task remains `in_progress` while owner acceptance is pending. C4 is the next separately scoped child;
  this report does not claim completion of the parent Companion initiative delivery.

## Final gate disposition

C3 implementation, integration, formal review and the scoped automated/native-fixture gate are complete. The task
remains `in_progress` with `meta.stage=automated_verified`; owner acceptance remains pending. C4 is the next child
and has not been activated. Root lint and external QQMM lock reproducibility remain explicit independent limits.
