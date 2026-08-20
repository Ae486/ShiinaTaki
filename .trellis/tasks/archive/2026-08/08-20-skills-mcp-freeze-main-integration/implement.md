# T4 Skills/MCP Freeze and Main Integration Plan

## Phase A: Freeze audit

- [ ] Confirm T4 worktree, branch, task pointer, and clean status.
- [ ] Run the final full-scope `trellis-check` gates for the already committed T4 diff.
- [ ] Reconcile Slice 6, Slice 7, and Slice 8 acceptance evidence with `docs/HANDOFF.md`.
- [ ] Keep packaged Home/file-picker, external credential round-trip, and compatible remote transfer Host as manual
      residuals unless directly observed by the owner.

## Phase B: Main synchronization

- [ ] Inspect live Main status and `main...HEAD` after the check.
- [ ] Merge latest `main` into T4 if Main advanced.
- [ ] Resolve migration registry and shared export conflicts while preserving both contracts.
- [ ] Re-run focused migration, Shared export, Core boot, and affected package tests.

## Phase C: Main integration

- [ ] From `H:\TakiAgent`, merge the verified T4 branch into `main`.
- [ ] Preserve all pre-existing dirty Memory/Hindsight files unstaged and untouched.
- [ ] Run post-merge `git diff --check`, typecheck, focused tests, and migration boot verification.
- [ ] Verify that the final Main commit contains T4 production files and no accidental Hindsight changes.

## Phase D: Trellis closeout

- [ ] Update closeout documentation and journal with verified final state.
- [ ] Archive the closeout child only after all required checks pass.
- [ ] Keep parent status truthful; do not claim unobserved manual acceptance.
- [ ] Record the exact Main merge commit and remaining owner-manual residuals.

## Rollback points

- Stop before committing if migration history cannot be reconciled safely.
- Stop before Main merge if T4 validation fails after synchronization.
- Do not reset, rebase, force-push, or clean unrelated worktrees.
