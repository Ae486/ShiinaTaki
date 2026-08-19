# Home Navigation State Preservation and Refresh UX

## Goal

Make navigation inside the Home window feel instantaneous after a page has been visited. Switching pages must not discard page-local state or show a blank loading phase when the operator returns to a page, while Core remains the sole authority for current data.

## Requirements

- Keep the existing in-window Zustand navigation and the single Home WebSocket lifecycle unchanged.
- Mount the initially selected page and lazily mount other pages on first visit.
- Keep visited page instances mounted but hidden when inactive so local form drafts, controller state, scroll position, and last-good snapshots survive navigation.
- Show the retained page state immediately on return; background refreshes may still display a lightweight refresh indicator.
- Do not add persistent disk snapshots for MCP or Skills and do not cache secret values.
- A replacement Home WebSocket generation must still invalidate/rebind page controllers through the existing client context contracts.
- Navigation must not trigger a full window reload, a new WebSocket connection, or duplicate page-level initial loads.
- Preserve accessibility: inactive page content must be hidden from the active document/focus order.

## Acceptance Criteria

- [ ] Visiting MCP, switching to another page, and returning to MCP preserves the loaded server list and any unsaved editor draft without a blank loading state.
- [ ] Visiting Skills, switching away, and returning preserves the loaded package view and inspection state without another initial `skillList` request.
- [ ] Settings retains its loaded rows and notices while navigating away and back; a connection-generation change still causes the normal re-read.
- [ ] Only the active page is visible and focusable; inactive page instances do not overlap or intercept pointer/keyboard input.
- [ ] Existing navigation, MCP, Skills, and Settings behavior remains functionally unchanged.
- [ ] Desktop tests, typecheck, lint, and `git diff --check` pass.

## Definition of Done

- Implementation and focused regression tests are complete.
- Relevant Home-window documentation and top-of-file comments describe the lazy keep-alive behavior.
- Full affected-package quality checks pass.
- No changes are made to Core MCP/Skill contracts or to persistent secret handling.

## Out of Scope

- Replacing the Home navigation model or adding a routing dependency.
- Eagerly mounting every page at startup.
- Persisting page UI state or MCP/Skill snapshots to disk.
- Changing Core refresh, MCP generation, Skill catalog, or WebSocket protocol behavior.
- Broad visual redesign unrelated to navigation latency.

## Technical Notes

- `apps/desktop/src/windows/home/home-shell.tsx` currently renders only `const CurrentPage = page.component`, so navigation unmounts the previous page.
- `useMcpServers()` creates/disposes its controller in a page effect and calls `mcpList()` on every mount.
- `createSkillsController().bind()` resets state and calls `skillList()` on every mount.
- `useCachedFetch()` refreshes on every page mount even when a persisted settings cache exists.
- The implementation should use React's existing `hidden` semantics plus an explicit visited-page registry rather than a new dependency.
