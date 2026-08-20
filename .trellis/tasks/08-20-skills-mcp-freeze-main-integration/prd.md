# T4 Skills/MCP Freeze and Main Integration

## Goal

Freeze the completed Skills/MCP productization work and integrate it into `main` without changing or losing parallel
Memory/Hindsight work.

## Scope

- Final evidence and acceptance reconciliation for Slices 1-8.
- Semantic synchronization with the latest Main branch.
- Safe resolution of shared export, SQLite migration, composition, and documentation conflicts.
- Post-merge verification and Trellis closeout records.

## Acceptance criteria

- [ ] T4 full-scope quality gates pass on the final branch state.
- [ ] All known manual residuals are explicitly classified as observed, unobserved, or unavailable.
- [ ] Main and T4 contracts coexist without migration-number reuse or lost Shared/Core behavior.
- [ ] Main's pre-existing Memory/Hindsight dirty files remain untouched and uncommitted by this task.
- [ ] Post-merge typecheck, focused tests, diff checks, and Core migration boot pass.
- [ ] The final report names the merge commit and remaining residual risk truthfully.

## Non-goals

- No new MCP/Skill feature work.
- No Autonomous Run, Run Receipt, Scheduled Task, Heartbeat, or Memory provider implementation.
- No push, reset, rebase, force operation, destructive cleanup, or worktree removal.
