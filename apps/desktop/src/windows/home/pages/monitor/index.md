# windows/home/pages/monitor/
Read-only DSH presentation over Core Run/Event projections: compact Run browser, 32px Toolbar, fixed
three-lane Overview, compact measured ledger, and temporary resizable Inspector/narrow drawer.
System and accessible copy is Chinese. Correlation stays internal; unsupported payload panels are absent.
- monitor-page.tsx — full-height Monitor-only page composition and explicit connection/read/mode feedback
- use-monitor-controller.ts — native Home client/visibility binding with disposable controller cleanup
- monitor-controller.ts — generation-guarded Run browsing and selected-Run coordinator ownership
- monitor-selection.ts — selected-Run restoration independent of list membership, bounded forward catch-up, distinct older/live cursors, and synchronized selected browser summaries
- monitor-detail-requests.ts — independent Inspector epochs and one-in-flight/one-trailing summary revalidation that rejects older snapshots without replacing rows
- monitor-request-state.ts — request scope, semantic error translation, and monotonic summary/cursor/row merges
- monitor-run-browser.tsx — compact authorized summaries, retained older selection, and bounded Run browsing
- monitor-run-filters.tsx — summary/initiator/state/time query controls and invalid-range feedback
- monitor-labels.ts — Chinese wire/mode/connection labels and recorded time formatting; actual names bypass the mapper
- trajectory-workspace.tsx — DSH Toolbar/Overview/ledger/Inspector composition for one selected Run
- use-trajectory-workspace.ts — disposable local filters, independent folds, timing/record selection, width, and reading commands
- trajectory-workspace-actions.ts — explicit navigation, ancestor reveal, close/resume, and range/fold actions
- trajectory-records.ts — immutable semantic records paired by exact model/invocation identity; ambiguous or absent associations remain independent
- trajectory-layout.ts — chronological measurable items, Attempt/request folds, safe literal search, and real-field filter options
- trajectory-timing.ts — measured three-lane spans, inclusive range focus, anchored zoom, and clamped pan; no wall-clock durations
- trajectory-toolbar.tsx — compact Chinese timing/folding/search/filter controls and durable request/tool totals
- trajectory-filters.tsx — closable loaded-window filter popover with captured tool names and real provider/model/status options
- trajectory-overview.tsx — fixed three-lane timing Overview, historical-prefix control, exact recorded tooltips, and selection state
- use-overview-gestures.ts — pointer capture, cancellation, wheel zoom, right-drag pan, and keyboard navigation lifecycle
- trajectory-ledger.tsx — compact selectable grouped records with stable measurement keys and explicit history/follow controls
- use-trajectory-follow.ts — installed measured virtualizer integration above 100 items, 12-row overscan, retained offset across threshold changes, and selection suspension
- trajectory-scroll.ts — deterministic initial-tail, prepend-anchor, focus, and follow placement; content-only updates do not scroll
- monitor-layout.tsx — temporary wide Inspector/narrow closable drawer with focus restoration and resize binding
- use-inspector-resize.ts — clamped direct pointer/keyboard resize and lost-capture/blur/hidden/narrow cleanup
- monitor-view.tsx — conditional semantic tabs, keyboard navigation, and independently closable detail sections
- trajectory-inspector-model.ts — authorized section projection following the same exact record's later settlement and usage
- monitor-workspace.module.css — Monitor-only full-height layout, compact Run browser, and responsive stacking
- trajectory-toolbar.module.css — DSH Toolbar density and accessible narrow wrapping
- trajectory-overview.module.css — fixed lanes, truthful markers/spans, range overlays, and reduced-motion tooltips
- trajectory-table.module.css — 30px rows, group separators, selection/error states, and measured-row geometry
- monitor-inspector.module.css — resizable Inspector/narrow drawer, occupied-space disclosures, and reduced-motion cleanup
- third-party-notices.md — retained full DeepSeek MIT notice and presentation source attribution
