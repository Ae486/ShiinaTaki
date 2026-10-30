# windows/home/
The home window: one instance, left menu / right page content. Pages are registry-driven — adding a page is one row
in pages.ts. Holds no state of record (invariant 4); Core pages use the window's operator WS, while QQ history uses its own local native QQMM attachment.
- main.tsx — React root mounting <HomeShell> into home.html #root, on the page named by the `?page=` boot param
- home-shell.tsx — two-pane shell, retained pages with pre-paint route publication, shared client/Approval owner, and connection feedback; Monitor survives transient client retirement, initial unresolved routes stay pending, and confirmed disable removes its surface
- pages.ts — THE page registry, including initiative management and private child conversations (id/label/icon/component rows), derived PageId and runtime gate
- pages/qqmm/ — local QQ history, native-only transport and effective visibility disposal; exempt from the Core connection banner
- pages/monitor/ — full-height DSH Run browser/Toolbar/Overview/measured-ledger/temporary-Inspector port with semantic filters, independent history/live recovery, and no user-facing internal metadata
- default-page-id.ts — dependency-leaf default page id shared by navigation consumers without loading page components
- visited-page-ids.ts — dependency-leaf visited-page sequence used by the Home keep-alive host
- page-visibility-store.ts — shell-owned route and document visibility; effective disposable-read gates preserve existing Chat/Monitor contracts
- home-document-visibility.ts — owned visibilitychange observation; focus/blur never masquerades as hidden
- home-store.ts — zustand nav store: currentPage + navigate(id)
- boot-page.ts — pure `?page=` parse with a fallback to the default page
- use-home-navigate-event.ts — listens for the home:navigate Tauri event (openHome on an already-open window)
- use-home-connection.ts — independent settings-family connection, source-bound Home presence and designated User Timezone reporter, plus the last-good timing accessor
- use-monitor-availability.ts — generation-safe typed Monitor availability, retained across transient null clients; config changes supersede stale reads and only confirmed disable redirects a requested Monitor route
- home-client-context.ts — React context exposing the client, status, and window-owned timing accessor to settings pages (chat keeps its own socket)
- page-chrome.tsx — shared page frame: stable title/hint with delayed non-displacing pending indication, keyboard-scrollable content and persistent actionable errors
- page-card.tsx — shared card/label-value chrome with optional internal row identity independent of changing display labels
- badge.tsx — the one status-chip look, in four tones (warn / ok / neutral / muted)
- action-button.tsx — the shared button tones/shape and 32px hit target; busy controls keep a fixed label/indicator slot with immediate aria-busy and delayed visual feedback; disclosure controls preserve aria-expanded
- extension-convergence-controller.ts — subscribed, targeted extension-status reads with covered-snapshot reuse and separate binding, visibility and invalidation
- extension-convergence-resource.ts — one ephemeral extension-status owner per physical client, effect-bound only while consumers exist and shared by visible copies
- extension-convergence.tsx — visibility-aware resource adapter, retained availability/count band and stable pending slot; list-key invalidation is restricted to recognized older-Core support
- read-observation-notice.tsx — explicit older-Core manual-refresh feedback over existing domain refresh actions
- pages/ — one directory per page (see each page's own index.md)
- Skills is registered in pages.ts and uses the same disposable Home-client state boundary as MCP.
