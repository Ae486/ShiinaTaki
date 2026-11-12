/**
 * INPUT:  AI SDK turn messages and the Run's captured own-key tool display-name table
 * OUTPUT: privacy-safe timeline inputs enriched only with trusted display names; canonical content is unchanged
 * POS:    core/agents — persistence presentation seam; never consults live catalogs or provider-supplied labels
 */
import { getKnownToolDisplayName, getValidToolDisplayName } from "@taki/shared";
import { toEntryInput, type TurnEntryInput, type TurnMessage } from "./turn-mapping.ts";

export function toPresentedTurnEntry(
  message: TurnMessage,
  names?: Readonly<Record<string, string>>,
): TurnEntryInput | null {
  // The canonical mapper discards provider metadata and raw tool input before any presentation is added.
  const input = toEntryInput(message);
  if (!input?.parts) return input;
  return {
    ...input,
    parts: input.parts.map((part) => {
      if (part.type !== "tool-call" && part.type !== "tool-result") return part;
      const captured = names && Object.hasOwn(names, part.toolName)
        ? getValidToolDisplayName(names[part.toolName]) : undefined;
      const displayName = captured ?? getKnownToolDisplayName(part.toolName);
      return displayName === undefined ? part : { ...part, displayName };
    }),
  };
}
