# Current continuity and feedback audit

Baseline: `82e0a4a` (2026-09-08), T4 worktree. This extends the completed event-triggered refresh work; its request authority, subscriptions and cache/privacy contracts remain in force.

## Verified symptoms

- `monitor/monitor-selection.ts` calls `clear()` before selecting a different Run. A deferred real `MonitorSelection` harness reproduced three empty state publications and an absent trajectory before the replacement completed, twice.
- `monitor/monitor-detail-requests.ts` clears `inspector` on ordinary detail selection. The same harness reproduced absent Inspector content while the next detail request remained pending, twice.
- `monitor/monitor-page.tsx` keys `TrajectoryWorkspace` by the immediately requested Run. `monitor-layout.tsx` inserts a loading paragraph before detail content.
- A real `createPerceptionController` harness retained the identical populated card during a deferred producer invalidation, twice. Normal controller refresh does not explain a blank activity card by itself. `perception-page.tsx` inserts a stale warning above the activity card and `pause-controls.tsx` inserts a refreshing paragraph; both change normal-flow geometry.
- `permission-section.tsx` inserts a refresh banner and a permanent outcome line. `use-permissions.ts` has no outcome expiry. Two identical rendered saved notices have not been reproduced; duplicated internal state alone is not proof.

## Shared and cross-page inventory

| Surface | Existing behavior / seam |
| --- | --- |
| `components/toast/toast-host.tsx`, `toast-store.ts` | Existing fixed host, mounted once per Home. Queue capped at four. No dedupe key; clicking a card pauses expiry permanently. |
| `home/page-chrome.tsx` | `busy` immediately inserts a refreshing label. |
| `components/ui/feedback-line.tsx` | Ordinary flow content; also used for actionable persistent errors. It must not globally become a Toast. |
| Settings config | `knob-field.tsx` shows persistent save outcomes and an inserted saving row. A failure can appear both through `config-save-controller.ts` notice and `knob-draft-controller.ts` error. |
| MCP | `mcp-page.tsx` inserts mutation feedback above the list. Controller exposes an action outcome callback; `use-mcp.ts` clears feedback only on the next mutation. |
| Skills | Header busy plus an inserted checking line on cards. Validation output itself is meaningful content and must remain. |
| Costume | Import success persists; early input/connection refusals can leave an earlier successful result visible. |
| Operations | `use-media-clear.ts` never clears its successful notice; a newer error can coexist. Compaction details are durable results, not transient success copy. |
| Chat | Composer already consumes a notice after pushing Toast. History errors need persistent retry semantics. |
| Extension convergence | A shared strip immediately inserts refreshing text; counts and coverage failures remain meaningful status. |

The existing cached-fetch/MCP/Skills owners already retain warm data. Use their existing ownership rather than introducing a second cache. Activity row identities are already stable (`startedAt`, process, title, idle); verify actual DOM/geometry before adding optimization.

## Reproduction boundary

The initial loops execute production TypeScript controllers with synthetic deferred responses. They do not establish WebView frame behavior, the exact permission double-notice sequence, or performance measurements. Final verification must reach the rendered call sites.
