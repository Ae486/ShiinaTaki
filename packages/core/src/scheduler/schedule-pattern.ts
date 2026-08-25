/**
 * INPUT: strict canonical at/every/cron patterns, an injected clock, and an IANA timezone
 * OUTPUT: deterministic next-slot calculation and catch-up metadata
 * POS: core/scheduler - the only Croner adapter; persistence and Run admission stay library-independent
 */
import { Cron } from "croner";
import { SchedulePatternSchema, type SchedulePattern } from "@taki/shared";

export interface SlotResult { scheduledFor: string; nextRunAt?: string }
export interface SchedulePatternAdapter {
  validate(pattern: SchedulePattern, timezone: string): void;
  next(pattern: SchedulePattern, timezone: string, from: Date): SlotResult | undefined;
  latestDue(pattern: SchedulePattern, timezone: string, at: Date): string | undefined;
  periodMs(pattern: SchedulePattern): number | undefined;
}

export function createSchedulePatternAdapter(): SchedulePatternAdapter {
  return { validate: (pattern, timezone) => { const parsed = SchedulePatternSchema.parse(pattern); if (!timezone) throw new Error("SCHEDULE_TIMEZONE_REQUIRED"); if (parsed.kind === "cron") new Cron(parsed.expression, { timezone, paused: true }).nextRun(); }, next, latestDue, periodMs };
}

function next(pattern: SchedulePattern, timezone: string, from: Date): SlotResult | undefined {
  const parsed = SchedulePatternSchema.parse(pattern);
  if (parsed.kind === "at") { const at = Date.parse(parsed.at); return at > from.getTime() ? { scheduledFor: new Date(at).toISOString() } : undefined; }
  if (parsed.kind === "every") {
    const anchor = Date.parse(parsed.anchorAt); if (!Number.isFinite(anchor)) throw new Error("SCHEDULE_INVALID_ANCHOR");
    const index = Math.floor((from.getTime() - anchor) / parsed.everyMs) + 1;
    return { scheduledFor: new Date(anchor + Math.max(0, index) * parsed.everyMs).toISOString() };
  }
  const cron = new Cron(parsed.expression, { timezone, paused: true });
  // Croner strips milliseconds and treats an exact match as current; schedule definitions always ask for the next
  // source slot, so advance one second before querying the adapter.
  const slot = cron.nextRun(new Date(from.getTime() + 1_000));
  return slot ? { scheduledFor: slot.toISOString() } : undefined;
}

function periodMs(pattern: SchedulePattern): number | undefined { return pattern.kind === "every" ? pattern.everyMs : undefined; }

function latestDue(pattern: SchedulePattern, timezone: string, at: Date): string | undefined {
  const parsed = SchedulePatternSchema.parse(pattern);
  if (parsed.kind === "at") return Date.parse(parsed.at) <= at.getTime() ? new Date(parsed.at).toISOString() : undefined;
  if (parsed.kind === "every") {
    const anchor = Date.parse(parsed.anchorAt);
    if (anchor > at.getTime()) return undefined;
    const index = Math.floor((at.getTime() - anchor) / parsed.everyMs);
    return new Date(anchor + index * parsed.everyMs).toISOString();
  }
  const slot = new Cron(parsed.expression, { timezone, paused: true }).previousRuns(1, at)[0];
  return slot?.toISOString();
}
