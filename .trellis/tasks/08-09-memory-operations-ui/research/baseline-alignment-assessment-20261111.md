# Main checkpoint and T4 baseline alignment assessment

Latest leader test outcomes and the corrected fixture-scale interpretation are in
[the completed verification record](phase2-validation-20261111.md). The observations
below retain this advisor's dated snapshot; the new scale gap was found afterward.

## Decision

Checkpointing the completed main increment is the appropriate next boundary once
the current verification results and fixes have been recorded. It need not wait
for every unfinished parent acceptance criterion. The checkpoint must describe a
tested stage and its remaining limits, not complete product or owner acceptance.

T4 is already clean and frozen. After the main checkpoint, baseline alignment is
appropriate as a separate integration increment in an isolated worktree. It is
not ready for an immediate merge into either working branch or for opening real
data with a combined build. Both the textual overlap and independently divergent
persistence/governance contracts require reconciliation and new integration tests.

This assessment does not execute or authorize a commit, merge, branch update,
deployment or real-data migration. The owner requested testing and an assessment
first. The leader owns the running test gate and its final commit-readiness verdict.

## Scope and verified state

Read-only Git/source inspection on 2026-11-11, with `GIT_OPTIONAL_LOCKS=0`.
Only this report was written. No index/object/ref writes, dependency installation,
test/service/model run, credentials or original-data access occurred here.

The original Memory Operations PRD, current phase-2 wave-3 plan/review, and T4's
current [freeze handoff](../../../../../TakiAgent-worktrees/t4/docs/T4-FREEZE-HANDOFF.md)
were read. The latter supersedes older T4 continuation notes and agrees with the
frozen metadata in the installation/user-experience and memory-tidy tasks. The
old Skills/MCP parent still says `planning`; it does not imply T4 is unfinished
uncommitted work or override the November 10 freeze.

| Observation | Main | T4 |
| --- | --- | --- |
| Worktree | `H:/TakiAgent` | `H:/TakiAgent-worktrees/t4` |
| Branch | `main` | `task/t4-skills-mcp-productization` |
| HEAD | `ba5be726e8f03408d389e25962f511f0bc7982c4` | `63faf8119be1747b685aacf43529d754626ab35c` |
| Commits unique since merge base | 95 | 30 |
| Initial tracked working changes | 118 files, +1,679 / -522 lines | 0 |
| Initial untracked files | 41 files, 4,239 lines | 0 |
| Staged files | 0 | 0 |
| Final advisor HEAD check, 10:21:40 UTC | Unchanged; tests/records had increased tracked changes to 121 | Unchanged and clean |

Common ancestor: `c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb`, September 6, 2026
(`chore(trellis): record memory replica checkpoint session`). These are local
branch observations; no fetch or remote-state assessment was performed.
Main was being tested concurrently. The numbers above are dated snapshots, not
the final staging manifest; re-enumerate after the gate and report writes finish.

The initial 118 tracked changes comprised 60 source files, 32 tests, 24 Markdown
documents and two context manifests. The 41 untracked files comprised 13 source
files, 16 tests and 12 Markdown documents. In particular, migrations 061/062/063,
the policy-review schema/scheduler/repository, Pending aggregate and read-snapshot
helper are untracked. A tracked-files-only commit would omit required runtime
code. The archived settings-scoping document's diff is a current policy-review
metadata clarification; its archived path alone is not evidence of unrelated work.

## Committed divergence and textual preview

| Committed change since common ancestor | Main | T4 |
| --- | --- | --- |
| All changed paths | 5,095 | 4,917 |
| Paths under `apps`, `packages`, `integrations`, `e2e` | 1,270 | 2,090 |
| Paths under `.trellis` | 3,814 | 2,765 |
| Other paths | 11 | 62 |
| Added / deleted lines, all paths | +2,687,514 / -2,033 | +1,170,823 / -8,472 |

These totals include substantial historical evidence and task records. They are
not production-code size or an implementation-effort estimate. Both branches
changed 665 common paths. Ninety-two paths in main's initial dirty/untracked set
also occur in T4's committed changes from the common ancestor.

Git 2.49.0's read-only historical preview was run as:

```powershell
git merge-tree --trivial-merge c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb main task/t4-skills-mcp-productization
```

The output was inspected in memory, without retaining its large patch or writing
a merged Git tree. Counting only the generated `+<<<<<<< .our` markers identified
249 paths with textual conflicts, 222 of them under `apps`/`packages` (including
their directory documentation). Examples include:

- `packages/core/src/main.ts`, agent/chat/harness lifetime wiring and capability
  routing; main's memory composition meets T4's delegation/live-configuration work.
- `packages/core/src/db/migrations/index-list.ts`, `migration-runner.ts`,
  `sqlite.ts`, lineage tests and many ingestion/maintenance repositories.
- `packages/core/src/memory/runtime-composition.ts`, operations and Hindsight
  runtime/projection/scheduler/curator files.
- Home memory operations/controllers and Core/Shared operation/status schemas.
- Desktop WebSocket/Host session code, root/Core package manifests and lockfile.

This old trivial preview is a risk inventory, not the result of a modern `ort`
merge. It excludes main's current uncommitted work, and it does not establish
rename handling, compilation, semantic compatibility or the exact conflict count
of the eventual integration. Exit 0 from this command does not mean merge-ready.

## Persistence reconciliation is required even if a file merges cleanly

Both registries retain the same named Hindsight migration family through 048;
this does not prove that earlier SQL/constraints are identical. Their subsequent
numeric meanings diverge:

| Version example | Main current source | T4 frozen source |
| --- | --- | --- |
| 049 | Local onboarding | Initiative delivery |
| 051 | Hindsight replica requests | Initiative feedback |
| 058 | Hindsight template overlays | Agent inbox |
| 061 | Hindsight runtime identity | Subagent presentation |
| 062 | Hindsight policy-review schedule | Subagent inbox resume |
| 063 | Hindsight replica waiting | Subagent progress |
| Current tail | 063 | 072, search projection policy |

The actual exports assign these versions, and both registries include them.
Both `db/migration-runner.ts:45` implementations skip a migration whose version
is at or below the recorded maximum; line 53 reads `max(version)`. Merely adding
main's 049-063 definitions to a T4 database at 072 would therefore not create
the missing main schemas. Renaming a file cannot change an already written receipt.

The existing [migration-lineage contract](../../../spec/backend/sqlite-migration-lineage.md)
already requires preserving historical receipts, choosing one canonical forward
registry for fresh installs, and appending guarded schema convergence above both
final tails. Exact schema/constraint/identity preservation is required; generic
`IF NOT EXISTS` cannot reconcile different meanings. The integration must verify
fresh installation, main lineage, T4 lineage and the recognized combination of
actual historical schemas, including nonempty data, rollback and reopen. Do not
resolve the complete registry with ours/theirs or discard either feature set.

The T4 freeze handoff reports a real-profile maximum receipt of 72 and a verified
backup. That is dated handoff evidence, not a fresh live-data observation by this
advisor. This assessment read no profile or backup payload.

## Governance, dependencies and runtime seams

1. **Governance and Approval.** Live code declares registry revision 3 on main
   and 1 on T4 (`packages/shared/src/governance-registry.ts:13`). Main contains
   Hindsight custody/deployment capabilities missing from T4. Native Host entries
   differ too (`apps/desktop/src-tauri/src/gate/governance.rs`). Both policy repos
   reject a newer stored registry (`governance-policy-repo.ts:140`). Approval's
   default historical resolver knows only the current revision
   (`approval-decision-service.ts:51`), and an absent stored revision is rejected
   at lines 127-130. A TypeScript revision bump alone is not a migration design.
   Preserve compatible durable decisions and exact bindings while reconciling
   canonical definitions, native validation and historical registry resolution.
   The handoff's stored registry 3 / Approval registry 1 / seven decisions remain
   historical evidence; no current decision inventory was queried.
2. **SDK and lockfile.** The effective lockfile versions differ: `ai` 7.0.17
   versus 7.0.148, `@ai-sdk/mcp` 2.0.10 versus 2.0.81, and
   `@ai-sdk/openai-compatible` 3.0.5 versus 3.0.75. Main also adds the workspace
   `@taki/secret-catalog-codec` dependency. A combined source check must use a
   deliberately reconciled lockfile and local workspace links; today's main
   results do not validate T4's SDK behavior or the union.
3. **Native/build/startup.** T4 replaces ordinary entry scripts and simplifies
   startup; main's Desktop build script supplies installed-Host behavior. The
   Cargo manifests differ in Hindsight-needed Windows features, QQ management
   native integration and HMAC. Preserve both concrete feature requirements;
   selecting a whole manifest or build script from one side loses behavior.
4. **Local dependencies.** T4 Desktop uses the external QQMessageMonitor client
   tarball and Rust path dependency. The named client tarball currently exists
   on H:, but that does not prove a fresh isolated worktree's full build. Check
   path resolution and native dependency presence as part of integration setup.
5. **Concurrent owners.** T4's maintenance/Tidy, live configuration, delegation
   and Home observation work overlaps main's optimized Hindsight maintenance,
   policy review, D103 waiting and D104 admission. Keep lifetime, cancellation,
   durable progress and actual UI producer contracts from both branches. T4's
   freeze explicitly reserves Hindsight implementation for the main effort.

Textually clean governance/native files do not eliminate these semantic checks.
The preview flags mostly database/memory conflicts (45 paths under Core db and
105 under Core memory), so a whole-directory resolution would discard substantial
accepted behavior.

## Minimal next sequence and readiness limits

1. Finish main's current gate and full-stack observations; record new failures,
   baseline failures, metrics, cleanup and acceptance limits. Freeze final source
   identities after necessary fixes. Do not claim the parent task complete.
2. Prepare a concrete main checkpoint file set that includes the new runtime and
   test files plus the relevant records. Prefer a cohesive stage checkpoint with
   a separate documentation commit if useful; do not manufacture partial source
   commits across migration/schema/consumer dependencies. Obtain commit approval
   for the actual proposed result, then leave main and T4 at identifiable clean
   checkpoints. Existing frozen T4 need not be modified first.
3. When integration is authorized, use a separate worktree and preserve both
   histories. Decide the schema/governance convergence contracts before resolving
   the high-impact registries. Reuse the existing lineage machinery; no generic
   new migration framework is implied. Ordinary conflict resolution can then be
   organized around Shared/contracts, persistence, runtime, native Host and Home.
4. Validate the combined tree with its reconciled dependencies: fresh/main/T4
   migrations, governance and Approval history, native authorization/startup,
   current main memory journeys and T4 delegation/configuration/Tidy/QQ/Avatar
   paths affected by the merge. Main-only tests and dated T4 results cannot stand
   in for this combined-tree gate. Installed/owner/real-provider limits remain
   distinct.
5. Only after those results should the owner decide the final branch alignment
   and any rollout. The freeze handoff requires a fresh consistent backup before
   an eventual approved real-data upgrade and prevents old binaries from opening
   a newer shared profile. The dated backup is a recovery reference, not automatic
   permission to overwrite current data.

The benefit of checkpointing now is preserving two meaningful tested stages and
making integration changes independently reviewable. The cost is a separate
integration and migration-validation increment; postponing alignment until every
parent feature is finished would increase divergence without resolving that cost.
Conversely, merging immediately would hide stage defects among integration defects
and still leave the concrete persistence incompatibility unresolved.

## Reproduction

All commands below are read-only. Run status with optional locks disabled, and
recheck counts after the leader finishes tests because the working tree is active.

```powershell
$env:GIT_OPTIONAL_LOCKS = '0'
git worktree list
git merge-base main task/t4-skills-mcp-productization
git rev-list --left-right --count main...task/t4-skills-mcp-productization
git diff --numstat HEAD
git ls-files --others --exclude-standard
git diff --name-only c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb main
git diff --name-only c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb task/t4-skills-mcp-productization
git -C H:/TakiAgent-worktrees/t4 status --porcelain=v1
```

The assessment's only artifact is this report. It makes no green test, clean
release, integrated branch or current original-data compatibility claim.

At advisor close, the leader reported seven workspace typechecks and root lint
passing, with the full TS test pass and later C/L stack checks still running or
pending. Those are leader-reported progress, not checks executed by this advisor;
the final gate record must supply their completion and remaining limits.
