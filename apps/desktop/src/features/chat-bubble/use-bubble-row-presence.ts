/**
 * INPUT:  one semantic row's presence token and exact CSS completion callback
 * OUTPUT: stable DOM ref and last natural offset for an outgoing absolute row
 * POS:    ui/chat-bubble — keeps exit nodes in the same React parent while measuring only committed natural layout
 */
import { useLayoutEffect, useRef } from "react";
import type { BubblePresenceRow } from "./bubble-presence.ts";
import { observeBubbleCssCompletion } from "./bubble-css-completion.ts";

interface RowPresenceInput {
  row: BubblePresenceRow;
  settled(itemKey: string, token: number): void;
}

export function useBubbleRowPresence(input: RowPresenceInput) {
  const ref = useRef<HTMLDivElement | null>(null);
  const top = useRef(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (input.row.phase !== "exiting") top.current = element.offsetTop;
    if (input.row.phase === "present") return;
    return observeBubbleCssCompletion(element, () => input.settled(input.row.item.key, input.row.token));
  }, [input.row.item, input.row.phase, input.row.token, input.settled]);
  return { ref, exitTop: top.current };
}
