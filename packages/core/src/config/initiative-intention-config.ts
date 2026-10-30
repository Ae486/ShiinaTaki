/**
 * INPUT: existing ConfigSource and the Intention domain's finite-window default
 * OUTPUT: one validated live maximum for newly formed automatic follow-up windows
 * POS: core/config — registry-backed policy; existing plan deadlines never slide with this setting
 */
import { z } from "zod";
import type { ConfigSource } from "./config-source.ts";
import type { Knob } from "./knob-registry.ts";
import { DEFAULT_INTENTION_WINDOW_MS } from "../initiative/intentions/intention-service.ts";

export const INTENTION_MAX_WINDOW_KEY = "TAKI_INITIATIVE_INTENTION_MAX_WINDOW_MS";
const Window = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const INTENTION_WINDOW_KNOB: Knob = {
  key: INTENTION_MAX_WINDOW_KEY, schema: Window, default: DEFAULT_INTENTION_WINDOW_MS, apply: "live",
  input: { kind: "int", min: 1, max: Number.MAX_SAFE_INTEGER },
  description: "Maximum active duration of a newly formed automatic follow-up window; not a future-event horizon. Existing deadlines remain unchanged.",
};
export function readIntentionMaximumWindow(source: ConfigSource): number {
  return Window.parse(source.resolve(INTENTION_MAX_WINDOW_KEY)?.value ?? DEFAULT_INTENTION_WINDOW_MS);
}
