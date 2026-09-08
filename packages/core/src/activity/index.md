# core/activity/
- activity-layer.ts — composition of deterministic cadence/dwell/bounds and privacy predicates from Perception; forwards data-free accepted-state and scheduling callbacks without changing defaults
- activity-state.ts — bounded coalesced activity, dwell-filtered entries and latest current; notifies after admitted push/prune or an effective data-free seal, isolating observers from the committed state
- activity-sampler.ts — governed 30s foreground sampling with pause/offline skip, sensitive seal and PII scrub before admission; denial stops the session; data-free callbacks follow actual scheduled-running changes
- render-activity.ts — read-side renderer: reportable entries → compact English activity block, wrapped whole in the A1 untrusted fence; "" when nothing reportable
