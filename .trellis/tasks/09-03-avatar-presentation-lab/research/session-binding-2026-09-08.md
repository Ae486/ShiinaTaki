# Lab session binding recovery

The owner explicitly requested continuing all Lab investigation in the existing task and recording the work.
The active topic is the mouth rig's actual pose capability after audible Fish playback was reported by the owner.

- Worktree: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.
- Existing task: `.trellis/tasks/09-03-avatar-presentation-lab`, status `in_progress`.
- Native Codex session/thread: `01a07bf0-012f-7142-863e-c24d735e6a5a`.
- `task.py current --source` already resolved the correct session-scoped Lab pointer. Running `task.py start`
  refreshed that binding; no new task was created and no planning-to-implementation promotion occurred.
- The repeated `no_task` breadcrumb had a different reader: the installed
  `.codex/hooks/inject-workflow-state.py:get_active_task` still reads `.trellis/.current-task`, while task.py uses
  `.trellis/.runtime/sessions/`. The legacy pointer named the missing `08-29-compaction-harness` task.
- Synchronized the compatibility pointer to `.trellis/tasks/09-03-avatar-presentation-lab`. A direct invocation
  of the actual UserPromptSubmit hook now emits `Task: avatar-presentation-lab (in_progress)`; task.py independently
  reports `Source: session:codex_01a07bf0-012f-7142-863e-c24d735e6a5a`.
- The compatibility pointer is worktree-wide because the installed hook is an older reader. Other native session
  files were not changed. Updating the hook to the shared session resolver is a separate tooling improvement,
  not part of mouth-rendering research.

Current work records: `reference-mouth-control-2026-09-08.md` for reference processing/mapping,
`mouth-pose-probe.mjs` for reproducible browser parameter posing, and the ensuing mouth capability findings.
No commit, push, task finish or archive was performed.

## 2026-09-09 resumed session

The prior process was interrupted while the owner was asking for a real-time mouth design and existing framework
survey. Recovery re-ran `task.py current --source` in `H:/TakiAgent-worktrees/t4` and confirmed the same
session-scoped task: `.trellis/tasks/09-03-avatar-presentation-lab`, source
`session:codex_01a07bf0-012f-7142-863e-c24d735e6a5a`, status `in_progress`. No new task was created and no
pointer was changed. The provider timing research was already present; the resumed work added
`realtime-mouth-design-2026-09-09.md`, updated the implementation checklist/context manifests, and preserved the
unselected automatic-driver decision. Task context validation passed after the additions.
