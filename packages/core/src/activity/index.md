# core/activity/
- activity-layer.ts — composition point + home of the deterministic defaults (poll/pulsetime/dwell/idle/span/cap/backoff); createActivityLayer(deps) → { state, sampler }
- activity-state.ts — OS-neutral bounded rolling window of foreground samples; heartbeat-merge coalescing + dwell + idle marking + span/entry-cap bounds; pure/deterministic (injected clock, no OS deps); T4 reads entries()/current()
- activity-sampler.ts — SYSTEM-initiated 30s poll loop (setInterval.unref()): skips routing entirely while no node connects (hasNode dep, quiet once-per-streak), else route foreground-window → safeParse → state.push; NO_NODE quiet-skip, DENIED stops the session, other errors exponential-backoff; never throws
- render-activity.ts — read-side renderer: reportable entries → compact English activity block, wrapped whole in the A1 untrusted fence; "" when nothing reportable
