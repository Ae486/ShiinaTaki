# core/time/
- time-context.ts — single prompt-facing date/time/age renderers with explicit User Timezone support and DST-aware startOfUserDay; existing callers retain their legacy local-time rendering
- user-timezone-service.ts — one persisted fixed/follow-primary-device authority, revision CAS, source confirmation and atomic future schedule recomputation
- current-time-tool.ts — pure get_current_time Core tool (no Gate/broker); reads optional live User Timezone once per execution, retains legacy local time when omitted, and returns { ok, iso, local, timezone, epochMs, capturedAt } (capturedAt ≡ iso)
