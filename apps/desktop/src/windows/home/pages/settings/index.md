# windows/home/pages/settings/
- model-profiles-section.tsx — grouped Main/Utility profiles at the Settings entry, using actual Home connection and demand reads
- model-profile-card.tsx — coherent saved/active model status, retained inputs, one Save action and explicit cost-labelled test/reset actions
- model-profile-fields.tsx — labelled endpoint/model/authentication fields and distinct Utility inherit/configured/disabled choices
- model-profile-form.ts — draft projection, completeness/endpoint-bound secret presence and concise application feedback
- model-profile-editor-controller.ts — local draft/focus/composition ownership, CAS save/test and read-first unknown acknowledgement recovery without replay
- use-model-profile-editor.ts — React editor lifetime binding; secret input stays ephemeral and successful current submissions clean only matching edits
- config-application-view.ts — Core-reported scalar source/application badges, boundary copy and retained active values on failures
- model-capabilities-section.tsx — accessible configured MAIN model information, declared source/activation guidance and distinct connection-native versus application-tool search availability
- model-catalog-summary.tsx — catalog display/provider names with the original configured model ID, brand icon and concise tool/image/reasoning/modality declarations
- model-catalog-details.tsx — collapsed provider/canonical identity and token limits, explicitly separate from effective runtime settings
- model-provider-logo.tsx — fixed-origin provider image with a local generic fallback for absent or failed artwork; no inline remote SVG
- use-model-capabilities.ts — visible demand reads using existing retirement coordinator and safe SHA-256 model/base URL identity; refreshes on actual configured identity changes without polling or persistence
- user-timezone-section.tsx — fixed/follow-this-device User Timezone controls, retained draft and current confirmation/refusal truth

The Settings page composes Main/Utility profiles, User Timezone, permission governance, durable Approval and the
dedicated Hindsight key before searchable scalar knobs. Permission state stays fresh per authenticated Home client
generation and window-memory-only; scalar config remains the guarded cached metadata surface.

- settings-page.tsx — grouped model profiles, permission governance, durable Approval, dedicated Hindsight key entry and searchable scalar groups; profile editors replace six legacy model-connection controls
- config-groups.ts — presentation-only grouping and Chinese labels, four Hindsight policy-review knobs, primary/Utility/perception/runtime fields, prefix/advanced fallbacks and stable search order; no separate vision model controls
- approval-decisions-section.tsx — fresh Core durable-allow list, current-client exact-decision revoke readiness, retry and no-cache presentation
- approval-decisions-controller.ts — current-client durable-allow coordination and visibility-independent revoke lock, post-outcome restoration and stale-generation feedback without fabricated covering-read success
- hindsight-key-section.tsx — dedicated write-only Hindsight API Key form; distinguishes storage presence from connection validation
- use-hindsight-key.ts — fresh Home client key seam; transient password cleared on submission and retirement, never cached
- hindsight-key-controller.ts — encrypted secret presence/set/clear with generation guards and no mutation replay
- permission-section.tsx — retained permission cards, delayed header pending state and actionable loading/reconnecting/failure/saved/conflict/refusal feedback
- approval-decision-row.tsx — safe operation/target names with Shared fallbacks, creation time, Core-owned usability and exact decision-id revoke binding
- use-permissions.ts — the ONLY permission WS seam: fresh per-client reads, generation-safe mutation completion, conflict refetch, no replay/cache
- use-permission-feedback.ts — action-owned floating outcomes consumed once, with persistent refusal/conflict explanations retained locally
- permission-controller.ts — coherent paired reads, entry/advanced demand, retired-result suppression and mutation/conflict restoration; conflict feedback never promises an unverified successful read
- permission-state.ts — pure permission transitions and structured POLICY_CONFLICT/GOVERNANCE_REFUSED classification
- permission-level-card.tsx — strict/standard/relaxed Core-authoritative selector with operator-facing safety limits; policy generation stays internal (tiles ride SelectionTile, aria-pressed)
- permission-cells-card.tsx — collapsed advanced view grouped by canonical capability id with Shared Chinese headings; registry revision stays internal and policy generation still guards row confirmation
- permission-cell-row.tsx — Shared category descriptions and Chinese posture/mode/control labels, reset, immutable disable, and generation-bound second confirmation; no inferred Host constraints; rows ride CARD_ROW
- knob-field.tsx — stable knob row with reserved pending, check-in application guidance, one retained field-error path and observed conflict/unsaved-draft controls
- knob-input.tsx — the editor itself: checkbox / select / text / number per input.kind, or a secret's set-not-set readout; controls carry the tokenized control class and the knob key as accessible name
- knob-editor.ts — pure metadata→editor mapping (kind, disabled + reason, bounds, secret set/not-set) + input parsing
- config-observer.ts — handler-before-subscription/read observation, hidden gap coverage and bounded covering reads for source/application changes
- config-save-controller.ts — per-key write serialization, explicit outcomes and suppression of retired or superseded echoes
- knob-draft-controller.ts — local draft/focus/composition ownership, deliberate conflict resolution and matching-save clean transitions
- use-knob-draft.ts — React adapter for field-local editing and explicit save actions
- use-config-read.ts — guarded cache/observation adapter with retryable same-client setup and observation-gap feedback
- use-config-save.ts — current-client save outcomes with per-attempt floating feedback; later editing/saves clear prior notices
- config-state.ts — pure knob-list transitions (config.changed / accepted set) + the five refusal messages + the apply verdict
- use-config.ts — Settings config composition over separate disposable read and write owners; no second config authority
