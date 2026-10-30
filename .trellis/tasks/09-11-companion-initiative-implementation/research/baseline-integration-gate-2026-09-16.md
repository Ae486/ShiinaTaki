# Main and Hindsight baseline integration gate

Date: 2026-09-16. Scope: the owner's approved entry into initiative development, with an explicit prerequisite to follow main and report conflicts with its Hindsight task before affected implementation.

## Authorization and execution boundary

The owner approved development under Trellis. That authorization remains effective; it does not need to be repeated after this gate is resolved. The new prerequisite is to select and verify the incoming main/Hindsight source baseline before shared production edits.

This preflight reads both worktrees and uses Git's merge-tree simulation. It does not modify main, migrate real data, import uncommitted Hindsight code, start an initiative implementation agent, or perform an actual checkout/index merge. Task preparation and conflict evidence are written only inside the T4 task directories.

## Observed baselines

| Item | Observed value |
| --- | --- |
| T4 branch and HEAD | `task/t4-skills-mcp-productization`, `3fce61022e22c62f42a2c2f8bbaa270186b8fd43` |
| Local main HEAD | `3c63a8080c92ffbb3ee8257dc2d979c2ba4ed711` |
| Common ancestor | `c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb` |
| Divergence | 13 T4-only commits and 2 main-only commits |
| Main committed changes from ancestor | 228 paths; principally the existing Memory recovery/cutover work |
| Main live working state | 99 tracked changes; 280 changed paths under `packages/`, `apps/` or `e2e/`, including source, tests and indexes |
| T4 initial working state | 63 dirty file paths, including the initiative plans and unrelated Avatar Lab work |
| Dirty T4 paths also changed by incoming main commits | `CONTEXT.md`, `docs/deferred-decisions.md` |

The large untracked main validation/evidence trees are not a production source bundle. Do not copy the whole main working directory to obtain B6. The [machine-readable preflight](baseline-git-preflight-2026-09-16.json) records exact paths, statuses and SHA-256 values for the relevant sources and the initial T4 dirty files. It distinguishes observed local refs from any claim about fetched upstream state.

The native session resolves this initiative parent. The legacy global Avatar Lab pointer is unrelated to this request and remains unchanged.

## Confirmed committed-merge conflicts

`git merge-tree --write-tree --name-only HEAD main` exited 1 and produced conflict-bearing tree `65e12024a1720414b990d4a08ee453bb69eb9e4b`. This writes Git objects only; it does not start a merge in the worktree or index.

| Conflicting paths | Cause | Required resolution |
| --- | --- | --- |
| `packages/core/src/db/migrations/index-list.ts` | T4 registers Timeline presentation as 035; main registers Pending Memory as 035 and has 036-040. | Preserve applied histories and their original files. Reuse main's canonical forward registry and existing 036/040 convergence; never register two migrations with version 35 or rewrite old receipts. |
| `packages/core/src/db/migrations/index-list.test.ts` | Expected registry ends at 35 versus 40. | Derive expectations from the selected final baseline; preserve uniqueness/ordering checks. Live uncommitted B6 includes 041-047, so 40 is not the final B6 ceiling. |
| `packages/core/src/db/migrations/lineage-reopen-matrix.test.ts` | Different imported tails, expected counts and T4 presentation assertions. | Preserve both lineages, Timeline presentation assertions and populated Memory preservation; test the selected combined registry. |
| `packages/core/src/db/scheduled-task-repo.test.ts` | Historical migration-tail expectations differ. | Retain the existing ownership-backfill regression and update the expected complete tail. |
| `packages/core/src/db/index.md`, `packages/core/src/db/migrations/index.md` | Both branches extend the module inventory. | Retain both responsibilities and explain historical 035 versus active registry ownership. |
| `packages/shared/src/index.ts`, `packages/shared/src/index.md` | Public API header/inventory changes overlap. | Preserve both public export sets and accurate inventory; do not resolve by wholesale replacement. |

These eight text conflicts have a bounded resolution strategy. They do not justify rebuilding Memory or a new migration bridge. Source inspection confirms committed 036 adds both Pending Memory and the nullable Timeline presentation column while preserving historical receipts. Committed 040 accepts only recognized cutover lineages and refuses unmappable historical imports atomically. These statements describe source contracts; the combined runtime has not been tested in this preflight.

## Live Hindsight overlap and source drift

The committed main HEAD does not contain the live B6 runtime implementation. Main's uncommitted changes overlap 17 paths already changed by T4 since the common ancestor, including ChatAgent, ConversationStore, RunService, Run snapshot capture, the composition root, migration registration and Shared exports. The exact list is in the machine-readable evidence.

Main's B6 task is `in_progress`. Its records report bounded implementation/validation closeout on 2026-09-13 while preserving known failures and pending owner acceptance. B7 (`08-09-memory-operations-ui`) remains `planning`; the owner inserted `09-14-hindsight-integration-completeness-audit`, also planning/research-only, before further B7 grill. Their declared validation is not a test result reproduced by this initiative preflight.

The September 11 initiative plan's statement that Memory runtime integration is only planning is therefore stale for the live main worktree. Its core ownership decisions remain useful, but source/version-specific assumptions must be refreshed against a reproducible B6 checkpoint. Merging `3c63a80` alone would not satisfy that refresh.

## Cross-task ownership and acceptance considerations

- B6 owns provider composition, immutable Memory identity, bound recall/tools/assembly and Memory maintenance. Initiative should extend and consume those interfaces; it must not recreate them.
- T4's immutable `toolDisplayNames` and Timeline presentation/turn-recording behavior must survive alongside B6's Memory bundle and exact committed-entry ingestion callbacks. Neither version of ChatAgent, Run snapshot capture or ConversationStore can replace the other wholesale. The [semantic audit](hindsight-baseline-audit-2026-09-16.md) records the exact source lines.
- B6 automatic foreground recall is guarded by `attempt.primary`. Initiative still needs explicit autonomous thin context and bounded selected-topic recall. Sharing the implementation does not mean enabling foreground automatic recall for Heartbeats.
- B7 owns future operator switching/re-entry/takeover and runtime handoff. It is not an initiative deliverable or an already installed capability. Agree the consumer/snapshot lifetime seam without implementing B7 inside child 1.
- Main's known D81 hidden-derived-content failure is an inherited provider limitation. Parent AC08/AC09/AC18 do not independently require complete derived-policy propagation, but their acceptance must not be expanded into a guarantee that hidden/expired content can never reappear through derived records. Do not claim that adding a caller fixes visibility or restore the owner-rejected blanket observation filter as an implicit workaround.
- Deferred-decision numbers collide across worktrees: T4 D79 is Character-specific non-response behavior and D80 is avatar command outcome; main D79 is daily Memory review and D80 is Hindsight retention. Preserve full titles and provenance during integration; matching numbers do not denote the same work.

## Recommended entry sequence

1. Obtain a named, reproducible B6 source checkpoint from the Hindsight task. Prefer its reviewed source commit; an explicitly approved scoped export would need an exact file/validation manifest. Do not silently adopt all of main's working state.
2. Preserve T4's existing dirty content, then integrate the committed main changes and that checkpoint in T4. Resolve the eight known text conflicts and any additional B6 conflicts deliberately, preserving both tasks' contracts.
3. Recheck the final migration registry, including the newly introduced B6 tail, and update the initiative design/context references. Do not allocate initiative versions before this registry is fixed.
4. Verify fresh, T4-applied and main-applied lineages plus primary chat, Scheduled execution, Memory binding and Monitor replay in isolated T4 data. Recorded B6 tests do not replace this combined-branch gate.
5. Activate child 1 and dispatch `trellis-implement` against the verified baseline, followed by `trellis-check` and spec updates. Continue the approved task sequence; keep B7 and the provider's known acceptance limitations explicit.

A stable B6 checkpoint is needed to select the source being integrated. Waiting for all B7 implementation is not automatically required; shared lifetime contracts and final acceptance restrictions must be resolved explicitly. Development authorization is already recorded, while production dispatch remains behind this baseline gate.

## Evidence limits

- The main/Hindsight tree was read only. No external Hindsight server, original database or paid model was used.
- The merge simulation covers committed HEADs. It cannot prove compatibility with uncommitted B6 or future B7 changes.
- No production tests, migration execution or native/owner acceptance were run for this preflight.
- The [independent semantic audit](hindsight-baseline-audit-2026-09-16.md) confirms the source overlap, B7 ownership and precise D81 limitation. It found no need to replace the product design.
- Preservation verification compared the captured hashes with the current files: all 280 main source/test/index paths and all initially dirty T4 files outside the five intentionally updated task artifacts remained unchanged. Both Git HEADs also remained unchanged. Task JSON, UTF-8/no-BOM, whitespace and local-link checks passed for the owned metadata and baseline artifacts.
