/**
 * INPUT:  a normalized point (nx, ny) in [0,1] over the model's on-screen bounds (top-left origin).
 * OUTPUT: regionForPoint(nx, ny) -> one of 7 click regions (head + upper/lower body × left/center/right).
 * POS:    ui/renderer/live2d — framework-free (ZERO React imports). Pure, unit-tested; the personality preset maps
 *         each region to an emotion tag (click-presets.ts). Region ratios ported from the BANDORI reference (§4).
 */

export type ClickRegion =
  | "head"
  | "upper_body_left"
  | "upper_body_center"
  | "upper_body_right"
  | "lower_body_left"
  | "lower_body_center"
  | "lower_body_right";

// Ported ratios: head above 0.38; the body splits upper/lower at 0.64; columns split at 0.38 / 0.62. taki's arbeit
// framing may want a taste retune (a manual-check item), but the buckets are deterministic and testable as-is.
const HEAD_MAX_Y = 0.38;
const BODY_SPLIT_Y = 0.64;
const LEFT_MAX_X = 0.38;
const RIGHT_MIN_X = 0.62;

export function regionForPoint(nx: number, ny: number): ClickRegion {
  if (ny < HEAD_MAX_Y) return "head";
  if (ny < BODY_SPLIT_Y) {
    if (nx < LEFT_MAX_X) return "upper_body_left";
    if (nx < RIGHT_MIN_X) return "upper_body_center";
    return "upper_body_right";
  }
  if (nx < LEFT_MAX_X) return "lower_body_left";
  if (nx < RIGHT_MIN_X) return "lower_body_center";
  return "lower_body_right";
}
