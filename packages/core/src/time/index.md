# core/time/
- time-context.ts — the single home for prompt-facing time rendering: renderDayDate (stable-prefix day line) + renderCurrentTime (volatile-tail minute line) + formatRelativeAge (memory-age label) + renderWallClock (RESERVED for T4); pure, injected-clock, OS-neutral local-tz, zero provider awareness
- current-time-tool.ts — the pure get_current_time Core tool (no Gate/broker; reads new Date()); informational, never-throw, returns { ok, iso, local, timezone, epochMs }
