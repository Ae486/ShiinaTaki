# windows/home/
The home window: one instance, left menu / right page content. Pages are registry-driven — adding a page is one row
in pages.ts. Holds no state of record (invariant 4); every page talks to the Core over the window's own operator WS.
- main.tsx — React root mounting <HomeShell> into home.html #root, on the page named by the `?page=` boot param
- home-shell.tsx — the two-pane shell: left menu (icon+label rows from the registry, accent-highlighted current row) + the current page's body + the shared client provider + the ToastHost
- pages.ts — THE page registry (id/label/icon/component rows) + the derived PageId union + isPageId
- home-store.ts — zustand nav store: currentPage + navigate(id)
- boot-page.ts — pure `?page=` parse with a fallback to the default page
- use-home-navigate-event.ts — listens for the home:navigate Tauri event (openHome on an already-open window)
- use-home-connection.ts — the window's own operator WS (shared device identity; concurrent with the pet's socket)
- home-client-context.ts — React context exposing that client + status to the settings pages (chat keeps its own socket)
- page-chrome.tsx — shared page frame: <PageHeader> (title, hint, background-refresh marker) + <PageBody> (scrolling, width-capped column) + <PageAlert>
- page-card.tsx — shared page chrome: <PageCard> (title + optional header control) + <LabeledRows> (the label/value list the settings-family pages render)
- badge.tsx — the one status-chip look, in four tones (warn / ok / neutral / muted)
- action-button.tsx — the one button look, in four tones (primary / secondary / danger-soft / danger)
- pages/ — one directory per page (see each page's own index.md)
