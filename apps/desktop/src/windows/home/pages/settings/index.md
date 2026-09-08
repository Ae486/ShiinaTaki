# windows/home/pages/settings/
The Settings page: Core-owned permission governance appears before generic config knobs. Permission state is fresh per
authenticated Home client generation and window-memory-only; config remains the guarded cached metadata surface.
- settings-page.tsx — page root: permission governance, durable Approval management, then the knob list regrouped client-side (U7) into fixed Chinese sections with a key/label/description search box; Core order inside a group is preserved and no knob is removed or hidden
- config-groups.ts — client-side presentation map only (U7): exact key → group + Chinese primary label, key-prefix → group fallback, the 高级 fallback for unknown keys, fixed-order grouping (empty groups skipped) and the search filter
- approval-decisions-section.tsx — fresh Core durable-allow list, current-client revoke readiness, retry, and no-cache presentation
- approval-decision-row.tsx — safe operation/target names with Shared fallbacks, creation time, Core-owned usability and exact decision-id revoke binding
- approval-decisions-controller.ts — current-Home-client list coordination and a visibility-independent revoke lock with post-outcome restoration
- permission-section.tsx — permission section composition: loading/reconnecting/failure/saved/conflict/refusal truth (Skeleton + FeedbackLine, failure keeps its retry)
- use-permissions.ts — the ONLY permission WS seam: fresh per-client reads, generation-safe mutation completion, conflict refetch, no replay/cache
- permission-controller.ts — coherent paired reads, entry/advanced demand, retired-result suppression and mutation/conflict restoration
- permission-state.ts — pure permission transitions and structured POLICY_CONFLICT/GOVERNANCE_REFUSED classification
- permission-level-card.tsx — strict/standard/relaxed Core-authoritative selector with operator-facing safety limits; policy generation stays internal (tiles ride SelectionTile, aria-pressed)
- permission-cells-card.tsx — collapsed advanced view grouped by canonical capability id with Shared Chinese headings; registry revision stays internal and policy generation still guards row confirmation
- permission-cell-row.tsx — Shared category descriptions and Chinese posture/mode/control labels, reset, immutable disable, and generation-bound second confirmation; no inferred Host constraints; rows ride CARD_ROW
- knob-field.tsx — stable knob row with metadata labels, observed conflict actions and explicit current-draft versus prior-save feedback
- knob-input.tsx — the editor itself: checkbox / select / text / number per input.kind, or a secret's set-not-set readout; controls carry the tokenized control class and the knob key as accessible name
- knob-editor.ts — pure metadata→editor mapping (kind, disabled + reason, bounds, secret set/not-set) + input parsing
- config-observer.ts — handler-before-subscription/read observation, hidden gap coverage and per-field observed change epochs
- config-save-controller.ts — per-key write serialization, explicit outcomes and suppression of retired or superseded echoes
- knob-draft-controller.ts — local draft/focus/composition ownership, deliberate conflict resolution and matching-save clean transitions
- use-knob-draft.ts — React adapter for field-local editing and explicit save actions
- use-config-read.ts — guarded cache/observation adapter with retryable same-client setup and observation-gap feedback
- use-config-save.ts — React adapter for current-client save outcomes and notices
- config-state.ts — pure knob-list transitions (config.changed / accepted set) + the five refusal messages + the apply verdict
- use-config.ts — Settings config composition over separate disposable read and write owners; no second config authority
