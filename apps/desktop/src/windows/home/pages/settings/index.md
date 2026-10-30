# windows/home/pages/settings/
- user-timezone-section.tsx — fixed/follow-this-device User Timezone controls, retained draft and current confirmation/refusal truth
The Settings page: Core-owned permission governance appears before generic config knobs. Permission state is fresh per
authenticated Home client generation and window-memory-only; config remains the guarded cached metadata surface.
- settings-page.tsx — page root: permission governance, durable Approval management, then the knob list regrouped client-side (U7) into fixed Chinese sections with a key/label/description search box; Core order inside a group is preserved and no knob is removed or hidden
- config-groups.ts — client-side key/group/Chinese label presentation, including live viewing-invitation timing; unknown keys retain the 高级 fallback and existing search/order
- approval-decisions-section.tsx — fresh Core durable-allow list, current-client revoke readiness, retry, and no-cache presentation
- approval-decision-row.tsx — safe operation/target names with Shared fallbacks, creation time, Core-owned usability and exact decision-id revoke binding
- approval-decisions-controller.ts — current-Home-client list coordination and a visibility-independent revoke lock with post-outcome restoration; stale-generation feedback never assumes the covering read succeeded
- permission-section.tsx — retained permission cards with delayed header pending state and actionable reconnect/failure/conflict/refusal truth
- use-permissions.ts — the ONLY permission WS seam: fresh per-client reads, generation-safe mutation completion, conflict refetch, no replay/cache
- use-permission-feedback.ts — action-owned floating outcomes consumed once, with persistent refusal/conflict explanations retained locally
- permission-controller.ts — coherent paired reads, entry/advanced demand, retired-result suppression and mutation/conflict restoration; conflict feedback never promises an unverified successful read
- permission-state.ts — pure permission transitions and structured POLICY_CONFLICT/GOVERNANCE_REFUSED classification
- permission-level-card.tsx — strict/standard/relaxed Core-authoritative selector with operator-facing safety limits; policy generation stays internal (tiles ride SelectionTile, aria-pressed)
- permission-cells-card.tsx — collapsed advanced view grouped by canonical capability id with Shared Chinese headings; registry revision stays internal and policy generation still guards row confirmation
- permission-cell-row.tsx — Shared category descriptions and Chinese posture/mode/control labels, reset, immutable disable, and generation-bound second confirmation; no inferred Host constraints; rows ride CARD_ROW
- knob-field.tsx — stable knob row with a reserved pending slot, one retained field-error path and observed conflict/unsaved-draft controls
- knob-input.tsx — the editor itself: checkbox / select / text / number per input.kind, or a secret's set-not-set readout; controls carry the tokenized control class and the knob key as accessible name
- knob-editor.ts — pure metadata→editor mapping (kind, disabled + reason, bounds, secret set/not-set) + input parsing
- config-observer.ts — handler-before-subscription/read observation, hidden gap coverage and per-field observed change epochs
- config-save-controller.ts — per-key write serialization, explicit outcomes and suppression of retired or superseded echoes
- knob-draft-controller.ts — local draft/focus/composition ownership, deliberate conflict resolution and matching-save clean transitions
- use-knob-draft.ts — React adapter for field-local editing and explicit save actions
- use-config-read.ts — guarded cache/observation adapter with retryable same-client setup and observation-gap feedback
- use-config-save.ts — current-client save outcomes with per-attempt floating feedback; later editing/saves clear prior notices
- config-state.ts — pure knob-list transitions (config.changed / accepted set) + the five refusal messages + the apply verdict
- use-config.ts — Settings config composition over separate disposable read and write owners; no second config authority
