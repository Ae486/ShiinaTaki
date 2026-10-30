# Approved main snapshot integration

## Effective authorization and source

The owner authorized fixing the current B6 source snapshot in T4 and integrating it while preserving the main worktree. Development approval and the main-compatibility prerequisite remain effective. This supersedes the unresolved source-handoff choice in the September 16 gate.

On 2026-09-19, source verification found that B6 is now committed as `588e13e`, followed by its specifications/research and the completed durable Memory operations stage-1 commits. Current main is `516e151ad1cbd298d07b95e7b4460833e55442f6`; its production source is clean. Its only tracked dirty path is Hindsight parent task metadata, which is not an incoming source change and must remain untouched.

Use **`516e151ad1cbd298d07b95e7b4460833e55442f6` as the fixed incoming source snapshot**, including its existing Memory operations foundation and migration 048. This follows the owner's current-main prerequisite using immutable committed bytes. Do not import later uncommitted main work, move main, or implement its next closure stage.

The initial T4 HEAD is `06a8090118a45a8c4f06472be4917108f93aea44`; the common ancestor is `c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb`. Preserve T4's existing committed work and all uncommitted content, including the in-progress `09-19-avatar-command-outcome` task and its production changes.

## Ownership and execution order

The parent owns this bounded baseline integration before child-1 feature implementation. Activate the existing parent for this work, dispatch `trellis-implement` for source integration, run `trellis-check`, and synchronize affected specifications. After the combined baseline passes, activate child 1 and continue the approved four-child sequence. No new Trellis task or product-design approval is required for this source choice.

The integration implementer owns the incoming changes and their conflict resolution in T4. The root owns this task's authorization, plans and final integration evidence. They must not overwrite each other's artifacts or unrelated task changes.

## Required source protection

1. Capture a bounded manifest of the pinned incoming commit, merge base, T4 HEAD, incoming paths and original T4 content. Preserve byte-exact preimages of every file that may be changed, including dirty tracked files and colliding untracked files.
2. Keep snapshots in a task-owned local directory inside T4, with large generated payloads excluded from Git and small manifests/instructions retained. Do not copy ignored user data, credentials, models, third-party repositories or unrelated raw acceptance data.
3. Read incoming content from the pinned Git objects, not mutable main files. Verify main's HEAD and original dirty metadata/source state before and after integration. Main is read-only.
4. Merge from the common ancestor against T4's **current working bytes**, not just its HEAD. Before each write, confirm those bytes still match the captured preimage. If another session has changed a file, preserve that edit and re-evaluate the individual merge; never restore a whole worktree or use blanket ours/theirs.
5. Source integration may be applied as a reviewable working-tree patch with the Git index and HEAD preserved. Record that no merge commit/ancestry change is claimed. Do not stash, reset, rebase, force, commit, push or archive unrelated work. The owner's snapshot authorization is not authorization to submit another task's changes.

## Current merge surface

The committed-head simulation now has 26 conflicting paths, rather than the historical eight. Main changed 634 paths since the common ancestor (156 modifications, 478 additions, no deletions). The conflicts include ChatAgent/ConversationStore and snapshot capture, migration registration/tests, desktop RPC composition and the Operations page, source indexes and the developer journal index. The simulation excludes T4's additional dirty Avatar outcome changes, so they need separate preservation.

Resolve these concrete contracts together:

- T4 immutable tool display names, Timeline presentation metadata, live activity ordering and committed-turn recording.
- B6's captured provider/epoch/capability/tool/recall/assembly bundle, primary-only automatic recall and exact committed-entry ingestion callbacks.
- Main's durable Memory operations service, operator methods and Operations-page integration, while retaining T4's reactive UI continuity, current RPC behavior and Monitor.
- T4's new Avatar outcome protocol, coordinator/configuration and renderer changes; do not regress them to publication-only success or discard their registration during composition-root merges.
- One migration registry through 048, preserving historical T4/main 035 lineages via the existing 036 and 040 convergence. Preserve original migration files/receipts and meaningful Timeline/Memory assertions. Do not allocate initiative migration numbers yet.
- Both branches' named public exports, module indexes and journal entries. Deferred-decision IDs are source-qualified because their numbers collide by meaning.

No frozen main source deletion is required by this baseline. Do not delete T4-only features or retired-task evidence to simplify conflicts.

## Verification and handoff

Run the selected combined baseline in T4 only. Use installed dependencies or a frozen-lockfile install when needed; no new dependency proposal is part of this task.

- Resolve every source conflict and inspect automatically merged shared seams.
- Run workspace typechecks and root lint, focused Memory/runtime/Run/Timeline/migration/desktop RPC/Operations/Avatar regressions, and the proportional full test/build gate after fixes stabilize.
- Exercise populated fresh, T4-035 and main-035 migration histories through the combined registry. Preserve presentation data, Memory state and atomic unsupported-lineage refusal.
- Prove that the merged primary path retains T4 activity/presentation behavior and B6 immutable Memory binding/ingestion. Keep automatic recall primary-only.
- Verify the main worktree and unrelated T4 changes against the captured evidence. Record deliberately merged dirty paths separately from byte-identical untouched paths.
- Record actual commands/results, limitations, the source manifest and unresolved owner/native checks. Do not present earlier main tests as combined-branch results.

After the implementer, the root dispatches the formal Trellis check. Only the verified combined baseline opens child 1's autonomous context/admission/decision/delivery changes. Provider-level D81 remains an inherited limitation; current-main stage-2 switching requirements stay with their owner unless an existing shared consumer interface needs an explicit compatibility adaptation.

The [Memory baseline delta](memory-baseline-delta-2026-09-19.md) distinguishes installed Stage 1 from later planning, documents producer-before-operation-owner shutdown, and records D81/D84 evidence limits. Current executable source/specifications take precedence over stale archived shutdown prose.
