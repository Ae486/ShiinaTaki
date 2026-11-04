/**
 * INPUT:  process env (TAKI_AMBIENT_SCREENSHOT, TAKI_AMBIENT_SCREENSHOT_RETENTION)
 * OUTPUT: loadAmbientScreenshotConfig(env) -> { enabled, retention }; factory default = OFF + drop-after-consumption
 * POS:    core/config — the ambient screen-sampling switch + raw-frame retention policy (D11 env style; #26 turns both
 *         into panel controls). DEFAULT OFF is load-bearing: with no explicit enable the sampler is never scheduled —
 *         no capture, no dialog, no log. A garbage value is fatal at boot, never a silent fallback.
 */
import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The default retains pixels only until consumption, expiry, replacement or withdrawal.
 * Retained policies preserve completed captures; consent/source withdrawal overrides retention while live.
 */
export type AmbientRetention =
  | { mode: "drop-after-consumption" }
  | { mode: "keep" }
  | { mode: "delete-after-days"; days: number; ttlMs: number };

// The enable flag is a privacy kill switch: recognize only true/1/false/0 (case-insensitive; empty = unset) and fail
// the boot on anything else — a typo'd "on"/"yes" silently meaning OFF is confusing, meaning ON would be fail-open.
function parseEnableFlag(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return undefined;
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return value; // z.boolean() rejects it -> the boot throws, naming the var
}

// One var, three shapes: "drop" (default) | "keep" | a positive integer of DAYS. Day granularity is the prd's ruling;
// a non-integer / zero / negative / unknown word is fatal, so a typo can never silently disable expiry.
function parseRetention(value: unknown): AmbientRetention {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "" || raw === "drop") return { mode: "drop-after-consumption" };
  if (raw === "keep") return { mode: "keep" };
  const days = Number(raw);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`TAKI_AMBIENT_SCREENSHOT_RETENTION must be "drop", "keep" or a positive number of days (got "${raw}")`);
  }
  return { mode: "delete-after-days", days, ttlMs: days * DAY_MS };
}

export const AmbientScreenshotConfigSchema = z.object({
  // Env-var name IS the schema key so a fatal boot error names it (attachment-config precedent).
  TAKI_AMBIENT_SCREENSHOT: z.preprocess(parseEnableFlag, z.boolean().default(false)),
  TAKI_AMBIENT_SCREENSHOT_RETENTION: z.unknown().transform(parseRetention),
});

export interface AmbientScreenshotConfig {
  enabled: boolean;
  retention: AmbientRetention;
}

export function loadAmbientScreenshotConfig(env: Record<string, string | undefined>): AmbientScreenshotConfig {
  const parsed = AmbientScreenshotConfigSchema.parse({
    TAKI_AMBIENT_SCREENSHOT: env.TAKI_AMBIENT_SCREENSHOT,
    TAKI_AMBIENT_SCREENSHOT_RETENTION: env.TAKI_AMBIENT_SCREENSHOT_RETENTION,
  });
  return { enabled: parsed.TAKI_AMBIENT_SCREENSHOT, retention: parsed.TAKI_AMBIENT_SCREENSHOT_RETENTION };
}
