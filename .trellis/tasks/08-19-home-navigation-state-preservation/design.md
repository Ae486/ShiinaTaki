# Home Navigation State Preservation and Refresh UX Design

## Context

The Home shell currently swaps one page component for another. React unmounts the previous page, so page-local hooks and controllers are recreated on every return. This is especially visible on MCP, Skills, and Settings because their first effect performs a Core read.

## Decision

Add a small visited-page registry to `HomeShell`:

1. The boot page is visited immediately.
2. A newly selected page is added to the registry on the same render path as navigation, so the first visit is not blank.
3. Every visited page remains mounted under a page host.
4. The active host is rendered as a flex child; inactive hosts use the native `hidden` attribute and `aria-hidden` so they are removed from layout and the accessibility/focus tree.
5. Page controllers and local state therefore live for the Home window lifetime. Existing `client` dependency effects continue to handle a new authenticated WebSocket generation.

No new package or persistence layer is needed.

## Data Flow

```text
home-store.currentPage
        |
        v
HomeShell visitedPageIds ----> HomePageHost (one mounted instance per visited page)
        |                                  |
        +--> active id                     +--> existing page hooks/controllers
                                           +--> existing HomeClientContext
```

The Core remains authoritative. The keep-alive layer only preserves the page's in-memory view and pending UI state; it does not replay writes or persist sensitive data.

## Trade-offs

- First visit still loads that page once, which keeps startup cost bounded.
- Visited pages retain their React trees and any page-owned subscriptions for the Home window lifetime. This is intentional for continuity; existing page controllers already retire on client replacement.
- A future memory-budget policy can evict an inactive page explicitly, but that is not required for this task.

## Accessibility and Layout

- Inactive hosts receive `hidden`, which maps to `display: none` and prevents interaction.
- `aria-hidden` mirrors the visual state for assistive technology.
- The active host uses `min-h-0 flex-1 flex flex-col` so existing page headers/bodies keep their current sizing and scrolling behavior.

## Failure Handling

- If a page's background refresh fails, its existing page-specific error and last-good-state behavior remains unchanged.
- If the Home client changes generation, existing hooks rebind or reload according to their current contracts; hidden pages are not treated as a new navigation event.
- No mutation is replayed merely because a page becomes visible again.

## Verification Strategy

- Add a pure visited-page transition test to prove first-visit deduplication and order.
- Extend Home shell static rendering tests to verify the active host is visible and inactive hosts are hidden after they are visited.
- Run desktop tests, typecheck, lint, and `git diff --check`.
