# Home Navigation State Preservation and Refresh UX Implementation Plan

## Batch 1: Navigation keep-alive and focused tests

1. Add a dependency-leaf helper for visited page ids with duplicate suppression.
2. Update `HomeShell` to lazily add the selected page and keep visited page hosts mounted.
3. Apply `hidden`/`aria-hidden` and stable flex sizing to inactive/active hosts.
4. Extend Home navigation tests for first-visit and repeat-visit behavior.
5. Update `apps/desktop/src/windows/home/index.md` and affected top-of-file comments.

## Quality gates

- `pnpm --filter @taki/desktop test`
- `pnpm --filter @taki/desktop typecheck`
- `pnpm lint`
- `git diff --check`
- Manual path: open Home, visit MCP, start an edit, switch to Skills, return to MCP, verify the draft/list/editor state remains and only the active page is interactive.

## Rollback point

If hidden page hosts cause layout or resource regressions, revert only the HomeShell/visited-page helper and its tests; page controllers and Core contracts remain untouched.
