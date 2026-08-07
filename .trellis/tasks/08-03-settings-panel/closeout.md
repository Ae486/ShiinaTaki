# Settings Panel Closeout

Status: owner-accepted implementation complete; archived 2026-08-07.

This is the task-level navigation document. Read the PRD and the named batch design before changing a shipped
contract; use the research files for root-cause evidence and `docs/deferred-decisions.md` for work deliberately left
open.

## Delivered Batches

| Batch | Delivery | Commits | Primary durable contract |
|-------|----------|---------|--------------------------|
| 1 | Sparse Core config store, migration 013, 34-knob registry, `config.*` operator surface | `f2de375`, `ab843ef` | `.trellis/spec/backend/config-store.md` |
| 2 | Runtime-created home window, chat-page migration, ws-client split, D29 close | `f7dbbfd`, `0404039` | `.trellis/spec/frontend/home-window.md` |
| 3 | Registry-driven operation wheel, model-area right-click, left-button-only reactions | `b08361d`, `9d5097d` | `batch-3-design.md` |
| 4 | Settings/operations/perception/costume pages, `memory.status`, cross-window costume command | `0b06eb3`, `50c8f1f` | `batch-4-design.md` |
| 5 | Clean-room BANDORI-referenced visual pass, self-owned icons, shared page primitives | `36e1711`, `599a9e7` | `.trellis/spec/frontend/home-window.md` |
| 6 | Result-bearing costume lifecycle, Cancel/45s deadline, last-good data, guarded SWR snapshots | `9953fe4`, `a6155d9` | `home-window.md`, `state-management.md` |

Closeout fix `6e6f263` persists a lowered declared context window into `window_state`. Runtime calibration and the
operator-facing `memory.status` view now agree after a restart, while a lower overflow shrink and the learned
correction factor remain intact.

## Final Product Shape

- `home` is the one settings-family window. Chat is a page, not a standalone window. Pages are registered once in
  `windows/home/pages.ts`; the pet wheel is an independent shortcut registry.
- Every window remains disposable and owns its own WS client. State of record stays in the Agent Core or follows a
  typed result-bearing Tauri event when only the pet can execute presentation work.
- The config table stores only operator-set primitive values. Effective precedence is explicit environment, then
  stored row, then default. Secrets never enter the table or `config.list` values.
- Persisted UI snapshots are read-only SWR accelerators behind a closed privacy allow-list. Perception content and
  pause state are not persisted by the UI.
- The legacy `main` pairing/status window remains separate. It is not a second settings surface; D62 owns its future.

## Acceptance and Verification

- Owner manual checks #74 and #75 passed after batch 6: selection follows the actual costume result; pending/cancel,
  error visibility, and retry remain reachable.
- Manual #79 is intentionally incomplete. Privacy Pause survived a real Core restart; real-live `until` expiry was
  not observed. The protocol accepts arbitrary epoch-ms deadlines and automated coverage remains green.
- D58 owner ruling B: skip-list/server support is deferred during owner-only development, but remains mandatory
  before any non-owner installation.
- Latest closeout evidence: focused window-calibrator tests 12/12, Core full tests 1168/1168, `pnpm -r typecheck`,
  `pnpm lint`, and `git diff --check` passed. The documentation closeout did not rerun a second full check.

## Open Boundaries (Do Not Rediscover)

| Decision | Boundary |
|----------|----------|
| D38 | Idle motion/expression pool editor still needs Core persistence and expression semantics. |
| D46 | The operations storage card covers attachments; on-demand screenshot usage, cleanup, TTL, and broken-ref UX remain open. |
| D54 | Knob convergence happens only when the owner explicitly calls for it. |
| D58 | Perception skip-list and adjacent missing server surfaces are deferred under the non-owner hard gate. |
| D59 | Pet/home WS clients have no reconnect, resubscribe, or window-level connection status. |
| D60 | Tavily Remote MCP remains a temporary search path; schema compatibility is a separate approved prerequisite. |
| D61 | Pet-side costume awaits can still hold the single-flight guard indefinitely; pair its deadline with D59 work. |
| D62 | Legacy `main` pairing/status consolidation requires its own startup/recovery/capability design. |

## Next Approved Task

`mcp-tool-schema-compatibility` must precede D60. The observed split is provider-side schema dialect compatibility:
DeepSeek accepts and invokes the same Tavily tool that Gemini rejects before generation because the nullable
`time_range` schema lacks a top-level FunctionDeclaration `type`. Image input only selected the vision/Gemini slot;
it did not route the turn to web search.

The approved boundary is discovery definitions -> normalization -> compatibility validation -> isolate one
incompatible tool with a warning -> official AI SDK tool construction. Preserve MCP transport and execution, and
preserve the original MCP tool name. This is groundwork for complete MCP integration, not the native search tool.
