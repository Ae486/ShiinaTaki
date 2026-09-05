# windows/home/pages/settings/
The Settings page: Core-owned permission governance appears before generic config knobs. Permission state is fresh per
authenticated Home client generation and window-memory-only; config remains the guarded cached metadata surface.
- settings-page.tsx — page root: permission governance, durable Approval management, then the knob list regrouped client-side (U7) into fixed Chinese sections with a key/label/description search box; Core order inside a group is preserved and no knob is removed or hidden
- config-groups.ts — client-side presentation map only (U7): exact key → group + Chinese primary label, key-prefix → group fallback, the 高级 fallback for unknown keys, fixed-order grouping (empty groups skipped) and the search filter
- approval-decisions-section.tsx — fresh Core durable-allow list, current-client revoke readiness, retry, and no-cache presentation
- approval-decision-row.tsx — safe operation/target names with Shared fallbacks, creation time, Core-owned usability and exact decision-id revoke binding
- approval-decisions-controller.ts — current-Home-client-only Approval list/revoke guard with stale-result suppression
- permission-section.tsx — permission section composition: loading/reconnecting/failure/saved/conflict/refusal truth (Skeleton + FeedbackLine, failure keeps its retry)
- use-permissions.ts — the ONLY permission WS seam: fresh per-client reads, generation-safe mutation completion, conflict refetch, no replay/cache
- permission-controller.ts — framework-free async guard: one mutation at a time, replacement refetch, retired-client suppression, conflict reread
- permission-state.ts — pure permission transitions and structured POLICY_CONFLICT/GOVERNANCE_REFUSED classification
- permission-level-card.tsx — strict/standard/relaxed Core-authoritative selector with operator-facing safety limits; policy generation stays internal (tiles ride SelectionTile, aria-pressed)
- permission-cells-card.tsx — collapsed advanced view grouped by canonical capability id with Shared Chinese headings; registry revision stays internal and policy generation still guards row confirmation
- permission-cell-row.tsx — Shared category descriptions and Chinese posture/mode/control labels, reset, immutable disable, and generation-bound second confirmation; no inferred Host constraints; rows ride CARD_ROW
- knob-field.tsx — one knob row: Chinese primary label with the raw key as a secondary code line (unknown keys keep the key primary), badges (environment locked / restart required / secret / customized), the editor, save outcome (FeedbackLine + a transient 保存中 pending line, A6)
- knob-input.tsx — the editor itself: checkbox / select / text / number per input.kind, or a secret's set-not-set readout; controls carry the tokenized control class and the knob key as accessible name
- knob-editor.ts — pure metadata→editor mapping (kind, disabled + reason, bounds, secret set/not-set) + input parsing
- config-gate.ts — pure P1e hidden-gate decisions for the knob list: skip config.changed applies while hidden and record the gap; on reactivation issue exactly ONE deduped refetch (waits out an in-flight load instead of stacking)
- config-state.ts — pure knob-list transitions (config.changed / accepted set) + the five refusal messages + the apply verdict
- use-config.ts — the page's ONLY ws touchpoint: cached config.list (secret rows scrubbed before persistence), one fan-out config.changed consumer, and config.set per row; subscription is shared once per client generation; while the page is hidden the delta apply is skipped and reactivation refetches once (deduped, config-gate)
