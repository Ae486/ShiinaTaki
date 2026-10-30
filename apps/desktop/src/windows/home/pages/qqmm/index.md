# windows/home/pages/qqmm/

Local QQ message/history presentation, independent of Taki Core. The shared QQMM
package owns queries, policy, polling, recovery and bounded content. No local persistence.

The native bridge uses official IPC Channels bound to the invoking WebView.
General Tauri event targets are not a privacy boundary: Any listeners bypass
target filters. QQMM does not publish history notifications on that event bus.

- qqmm-page.tsx — Records/Settings composition, current-draft credential retirement and truthful connection/account/history states.
- qqmm-session.ts — serialized native attachment lifecycle and effective visibility binding.
- use-qqmm.ts — React and official Tauri API adapter; synchronous visibility clears plus render masking.
- qqmm-labels.ts — semantic Chinese labels, dates and QQ-number disambiguation for duplicate or unnamed conversations.
- qqmm-filters.tsx — kind/severity/conversation/time/text filters.
- qqmm-timeline.tsx — compact chronology, pause/clear/follow controls, filter-aware empty states and older-page scroll anchoring.
- qqmm-detail.tsx — saved summary/tool parts, initial read feedback and summary-only source navigation in the existing accessible dialog; section changes reset the reading position.
- qqmm-detail-text.tsx — literal bounded text chunks and Unicode character positions.
- qqmm-sources.tsx — one bounded recorded-source page or body with local unavailability.
- qqmm-summary-labels.ts — captured summary stages, coverage and recorded-source provenance labels.
- qqmm-tool-labels.ts — actual tool operation, effective caller-selected scope, outcome and returned occurrence counts; no inferred prior position, delivery or source reconstruction.
- qqmm-settings.tsx — one complete shared draft in PageCards, actual impact preview and click-time preview-bound apply confirmation.
- qqmm-setting-field.tsx — stable semantic fields preserving raw numbers, focus and composition input.
- qqmm-dimensions.tsx — ordered editable descriptions without silent input truncation; stable keys never become DOM metadata.
- qqmm-controls.tsx — supported backend actions, actual PMHQ discovery, ephemeral QR and account-bound confirmation with stable modal focus.
- qqmm-secrets.tsx — shared write-only credential input and truthful protected candidate state.
- qqmm-retry.tsx — selected-summary eligibility and durable retry attempt/outcome projection.
- qqmm-management-labels.ts — finite Chinese management labels without revisions, keys, hashes or raw JSON; past requests are not reinterpreted after backend changes.

Development prerequisite: build and pack `H:/QQMessageMonitor/packages/management-client`
before installing the relative tarball dependency. Build the QQMM Host/helper and
provide a native management installation to run it; M1 does not distribute these artifacts.
