# T4 Skills/MCP Freeze and Main Integration Design

## Boundary

This task closes the implemented Skills/MCP initiative and integrates the dedicated T4 branch into `main`.
It does not add new product behavior, reopen frozen authority decisions, or implement Autonomous Runs, Run Receipts,
Scheduled Tasks, Heartbeat, or Memory provider runtime work.

## Closeout contract

- Treat Slice 1 through Slice 8 production behavior and automated evidence as frozen.
- Record owner-observed manual residuals truthfully; automated tests must not be relabeled as packaged UI, external
  credential, or remote Host acceptance.
- Preserve the single Core Governance/Approval authority, Host-local secrets, explicit Host routing, immutable Run
  snapshots, generation-safe MCP/Skill lifecycles, and no-replay settlement semantics.
- Update only closeout bookkeeping and documentation required by verified state. Do not rewrite historical task state
  merely to hide pointer drift.

## Integration strategy

1. Run the final full-scope quality check on the clean T4 branch.
2. Inspect both worktrees and compare `main...HEAD` before integration.
3. Merge the latest `main` into the T4 branch from the T4 worktree if it has advanced. Resolve shared exports,
   migration registry, Core composition, and documentation conflicts semantically.
4. Verify SQLite migration numbering and compatibility. Main's canonical-memory migration and T4's MCP/Skill
   migrations must coexist in one strictly increasing registry without reusing an applied version.
5. Run focused tests for every conflicted seam, then the relevant workspace gates.
6. From the main worktree, merge the verified T4 branch into `main` without staging or modifying user-owned dirty
   Memory/Hindsight files.
7. Run post-merge checks and record the resulting commit and residual risks.

## Conflict policy

- Preserve both Memory/Hindsight and Skills/MCP functionality.
- Never use whole-file ours/theirs resolution for shared exports, migration lists, `main.ts`, or task documentation.
- Never delete, reset, clean, or stage unrelated Main work.
- If a migration has already been applied in a real database, append compatible migration versions instead of renaming
  history. Verify the live migration runner and tests before choosing the final numbering.

## Rollback

- Abort an in-progress merge without committing if a conflict cannot be proven safe.
- If post-merge tests expose a regression, preserve the merge commit for diagnosis and report the exact failing seam;
  do not reset or force-rewrite either branch.
