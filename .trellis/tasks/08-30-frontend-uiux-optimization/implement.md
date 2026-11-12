# Frontend implementation plan — G4 information cleanup

## Current slice and authorization

Implementation, independent automated review and isolated WebView2 engineering QA (12/12 groups)
have passed; see [the current evidence](implementation-evidence-g4-2026-09-05.md). G4 and A1/A2 were
committed together as `a771496`. Owner visual inspection is not claimed. The ordered steps below
document the executed scope; the latest execution delegation authorizes autonomous engineering
acceptance and coherent local commits while the remaining UI/UX slices continue.

The owner approved the six-batch UI/UX sequence and implementation on 2026-09-05. This is its first
batch, using the existing pure-frontend task. Earlier frontend batches remain historical deliveries;
this plan does not reopen them or certify their pending manual acceptance.

Sources: this task's PRD, design section 10, the parent
[G1–G5 decisions](../08-22-t4-agent-architecture-observability/research/uiux-grill-2026-09-05.md), and the
[G4 field inventory](../08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md).
The inventory identifies the actual render sites and retained data contracts; read those current
files before editing. No new dependency or protocol change is required.

## Scope and ownership

| Owner | Production scope | Outcome |
|---|---|---|
| Implement A | `apps/desktop/src/windows/home/pages/mcp/`, `pages/skills/` | Remove internal metadata and enumeration counts; curate useful package details; retain selected tools and all correctly bound actions |
| Implement B | `apps/desktop/src/windows/home/extension-convergence.tsx`, `pages/settings/permission-level-card.tsx`, `pages/settings/permission-cells-card.tsx`, `pages/costume/costume-page.tsx` | Remove Host identity copies and policy/registry counters; show readable availability/conflict/import feedback |
| Main session | Task/spec/report artifacts and integration | Protect unrelated work, verify full scope, prepare later child tasks |
| Check | Union of the two implementation scopes and corresponding tests/indexes | Independent spec/behavior review and direct corrections |

Implementers own colocated existing tests and the touched folder indexes; Implement B owns the Home
index for its shared status component. They are not alone in the worktree and must not revert other
edits. No recursive delegation. Implement agents use `gpt-6-astra`/`high`; check uses
`gpt-6-astra`/`xhigh`. Every prompt starts with the exact active task and requires child-side pointer
verification. Semantic discovery uses `jbcontext` only; YCE is forbidden. Known files are read directly.

Excluded: Monitor (D68/G5), shared readable capability maps and approval content (the new naming
child), Core/Shared/Rust production code, Chat/Pet streaming, dependency/configuration changes, and
the parallel avatar lab/OpenBiliClaw/memory work. Removing a displayed revision never removes its
snapshot, CAS, key, selection, binding or generation-guard use.

## Ordered execution

1. Review the current artifacts; preserve a hash snapshot of unrelated dirty files. Validate context
   manifests, activate this task, and verify the session-scoped pointer before implementation dispatch.
2. Implement A removes MCP revision/generation/Owner rows and published enumeration page count.
   Retain selected tools, meaningful outcomes/duration, settings and actions. Replace last-good jargon
   with truthful service wording, including initial failure where no prior runtime is serving.
3. Implement A removes Skills' now-empty technical disclosure and arbitrary custom-metadata dump.
   Keep name/description/source/trust/state, useful declared standard fields and relative file inventory.
   Use Chinese UI-owned labels and retain real content. Inspection remains collapsible.
4. Implement B removes the shared Core Host ID and its copy control, localizes the remaining status
   labels, removes policy/registry counters, and omits raw character IDs from successful import feedback.
   Keep real availability/conflict warnings, imported count and permission constraints. Raw capability
   and permission-cell naming is the next child; do not invent a local semantic map here.
5. Update stale assertions in existing component tests and run the affected controller tests that
   already cover action identity, conflict/refetch and reconnect behavior. Do not add snapshot noise or
   tests that merely mirror deleted JSX. Update module headers and folder indexes with the real contract.
6. Dispatch independent check after both implementations finish. The check agent reviews all this
   slice's changes, fixes findings, and runs the required gates below. Main reviews the resulting diff.
7. Record changed surfaces, automated and real-window engineering evidence, and later batch ownership.
   The 2026-09-06 delegation authorizes checked local commits. Keep the whole frontend task open while
   its required integration work remains; no push or unobserved owner acceptance is implied.

## Validation and acceptance

- Targeted renderer/component and existing MCP/Skills/permission controller suites during implementation.
- `pnpm typecheck` (workspace); `pnpm lint`; `pnpm --filter @taki/desktop test`.
- `pnpm --filter @taki/desktop build` for this UI change; changed-file ESLint if a local correction follows.
- `python .trellis/scripts/task.py validate 08-30-frontend-uiux-optimization` and scoped `git diff --check`.
- No removed bookkeeping in primary/expanded markup, tooltips, accessibility names or copy controls.
  Useful configuration/results and selection/mutation binding must remain. Keep empty/loading/failure
  states honest and preserve existing confirm/cancel behavior.
- Real-window review opens MCP selected-tool details and Skills inspection, observes extension status,
  expands permission settings, and checks import feedback. Automated markup is not owner visual approval.
  Report any unavailable real-window check explicitly; never promote it to passed from static tests.
- Verify unrelated-file hashes and the preexisting deferred-registry prefix after the slice.

## Rollback and follow-up

This is presentation-only, with no migration or deployment setting change. Roll back only this slice's
render/test/index changes if needed; preserve other work and all protocol identity/concurrency state.
The next child is `09-05-uiux-readable-operations`; D68 Monitor and
`09-05-uiux-live-tool-feedback` follow the approved sequence. D77 error taxonomy/copy governance remains
deferred. New D75 compaction benefit measurements are not silently included.
