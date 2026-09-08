# windows/home/pages/mcp/

The operator-only Secure MCP Lifecycle page. Core remains authoritative for desired rows and process-local runtime
status; this disposable Home view stores neither config snapshots nor secret values.

- mcp-page.tsx — retained master/detail composition with a fixed editor parent through refresh and actual empty lists; expected revisions stay draft-owned
- mcp-labels.ts — U2 presentation vocabulary: phase badge, sanitized failure reasons, stdio/http transport lines (full + short) and the per-outcome diagnostics dismiss key; opaque ids/revisions never render as titles or badges
- mcp-server-list.tsx — the master list pane: one SelectionTile row per server (display name + phase badge + tool count · transport one-liner), aria-current selection
- mcp-server-card.tsx — detail-pane name, phase, transport, tool counts and measured outcomes; selected tools have a nonempty collapsible disclosure, connection failures claim continued service only for an active connection, and test/reconnect/toggle/edit/two-step-remove actions retain their original bindings; no internal bookkeeping or enumeration page counts render
- mcp-server-editor.tsx — stdio/http desired-config form with write-only env/header values and opaque-ref retention rules; every field rides the shared Field (explicit labels + visible focus ring), KindPicker rides SelectionTile, and saving shows a pending state
- use-mcp.ts — one authenticated-client-generation hook; late results are ignored and writes are never replayed
- use-mcp-feedback.ts — consumed action-owned Toasts with per-server replacement and retained test/error/partial-commit diagnostics
- use-mcp-editor.ts — React adapter for the page's independent editor session and save actions
- mcp-editor-controller.ts — matching-session/draft save completion; newer edits remain and only actual submitted commits advance their retry revision
- mcp-controller.ts — subscribe-before-baseline reads, covered hidden snapshots and notifications after guarded command/read-back settlement; preserves conflict/partial-commit/secret ordering and never treats a conflict as proof that read-back succeeded
- mcp-state.ts — pure view transitions, draft validation, detail-pane selection resolution (L2), marker-only desired config, and deterministic secret-ref derivation

Tests cover controller races and partial commits, state validation, component states/actions, and the no-cache invariant.
