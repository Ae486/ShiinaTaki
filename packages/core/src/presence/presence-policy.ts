/**
 * INPUT: provisional C2 engineering calibration and bounded source ownership
 * OUTPUT: shared Core timing and memory bounds for source and response evidence
 * POS: core/presence — no model scheduling or hard delivery budget authority
 */
export const PRESENCE_LEASE_MS = 30_000;
export const PRESENCE_RENEW_MS = 15_000;
export const PRESENCE_INPUT_FRESH_MS = 60_000;
export const PRESENCE_NATIVE_IDLE_SECONDS = 180;
export const FEEDBACK_OPPORTUNITY_MS = 120_000;
export const FEEDBACK_DEADLINE_MS = 3_600_000;
// Engineering defaults, not owner-ratified feature-enablement or delivery-budget policy.
// Explicit resource bounds fail closed rather than creating unbounded per-window telemetry.
export const PRESENCE_MAX_SOURCES = 128;
export const PRESENCE_MAX_EXPOSURES = 64;
export const PRESENCE_MAX_INTERVALS = 128;
export const PRESENCE_REPORT_BURST = 128;
export const PRESENCE_REPORTS_PER_SECOND = 8;
