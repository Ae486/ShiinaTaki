/**
 * INPUT:  trusted ToolSet groups assembled for one agent turn
 * OUTPUT: mergeToolSets(...groups) — one ToolSet with duplicate model-facing keys rejected
 * POS:    core/agents — composition guard; presentation keys never choose which authority binding wins
 */
import type { ToolSet } from "ai";

export function mergeToolSets(...groups: ToolSet[]): ToolSet {
  const merged: ToolSet = {};
  for (const group of groups) {
    for (const [key, value] of Object.entries(group)) {
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        throw new Error(`duplicate model-facing tool key '${key}'`);
      }
      merged[key] = value;
    }
  }
  return merged;
}
