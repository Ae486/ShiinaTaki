# windows/home/pages/settings/
The Settings page: Core-owned permission governance appears before generic config knobs. Permission state is fresh per
authenticated Home client generation and window-memory-only; config remains the guarded cached metadata surface.
- settings-page.tsx — page root: permission governance, durable Approval management, then the knob list in server order
- approval-decisions-section.tsx — fresh Core durable-allow list, optimistic revoke feedback, retry, and no-cache presentation
- approval-decisions-controller.ts — current-Home-client-only Approval list/revoke guard with stale-result suppression
- permission-section.tsx — permission section composition: loading/reconnecting/failure/saved/conflict/refusal truth
- use-permissions.ts — the ONLY permission WS seam: fresh per-client reads, generation-safe mutation completion, conflict refetch, no replay/cache
- permission-controller.ts — framework-free async guard: one mutation at a time, replacement refetch, retired-client suppression, conflict reread
- permission-state.ts — pure permission transitions and structured POLICY_CONFLICT/GOVERNANCE_REFUSED classification
- permission-level-card.tsx — strict/standard/relaxed Core-authoritative selector with policy generation and Host-floor notice
- permission-cells-card.tsx — collapsed-by-default advanced view grouped by Core-returned capability id
- permission-cell-row.tsx — factory/override/effective/mode facts, reset, immutable disable, and second-confirm flow; no inferred Host constraint state
- knob-field.tsx — one knob row: description, badges (environment locked / restart required / secret / customized), the editor, save outcome
- knob-input.tsx — the editor itself: checkbox / select / text / number per input.kind, or a secret's set-not-set readout
- knob-editor.ts — pure metadata→editor mapping (kind, disabled + reason, bounds, secret set/not-set) + input parsing
- config-state.ts — pure knob-list transitions (config.changed / accepted set) + the five refusal messages + the apply verdict
- use-config.ts — the page's ONLY ws touchpoint: cached config.list (secret rows scrubbed before persistence), one fan-out config.changed consumer, and config.set per row; subscription is shared once per client generation
