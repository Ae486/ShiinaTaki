# core/activity/
- activity-layer.ts — composition of deterministic cadence/dwell/bounds and privacy predicates from Perception; forwards data-free accepted-state and scheduling callbacks without changing defaults
- activity-state.ts — bounded coalesced activity and legacy idle projection; dwell-filtered entries, data-free seal and consent/source cache retirement, with post-change notification
- activity-sampler.ts — governed 30s foreground sampling with pre/post-await consent and real dispatch-source fences; retains nullable idle in accepted evidence after sensitive screening and scrub; denial stops the session
- render-activity.ts — read-side renderer: reportable entries → compact English activity block, wrapped whole in the A1 untrusted fence; "" when nothing reportable
