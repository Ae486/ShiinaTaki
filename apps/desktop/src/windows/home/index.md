# windows/home/
The home window: one instance, left menu / right page content. Pages are registry-driven — adding a page is one row
in pages.ts. Holds no state of record (invariant 4); every page talks to the Core over the window's own operator WS.
- main.tsx — React root mounting <HomeShell> into home.html #root, on the page named by the `?page=` boot param
- home-shell.tsx — two-pane shell + lazy visited-page keep-alive host, shared Home-client provider, and that socket's single Approval modal owner; Chat keeps a separate socket/modal
- pages.ts — THE page registry (id/label/icon/component rows) + the derived PageId union + isPageId
- default-page-id.ts — dependency-leaf default page id shared by navigation consumers without loading page components
- visited-page-ids.ts — dependency-leaf visited-page sequence used by the Home keep-alive host
- home-store.ts — zustand nav store: currentPage + navigate(id)
- boot-page.ts — pure `?page=` parse with a fallback to the default page
- use-home-navigate-event.ts — listens for the home:navigate Tauri event (openHome on an already-open window)
- use-home-connection.ts — the shared settings-family connection owner using fresh authenticated generations plus one stable last-good timing accessor; independent from Pet and Chat
- home-client-context.ts — React context exposing the client, status, and window-owned timing accessor to settings pages (chat keeps its own socket)
- page-chrome.tsx — shared page frame: <PageHeader> (title, hint, background-refresh marker) + <PageBody> (scrolling, width-capped column) + <PageAlert>
- page-card.tsx — shared page chrome: <PageCard> (title + optional header control) + <LabeledRows> (the label/value list the settings-family pages render)
- badge.tsx — the one status-chip look, in four tones (warn / ok / neutral / muted)
- action-button.tsx — the one button look, in four tones (primary / secondary / danger-soft / danger)
- extension-convergence-controller.ts / extension-convergence.tsx — current-client-only extension owner/generation read and compact shared status band
- pages/ — one directory per page (see each page's own index.md)
- Skills is registered in pages.ts and uses the same disposable Home-client state boundary as MCP.
