/**
 * INPUT:  semantic bubble items, motion preference and presentation lifecycle identity
 * OUTPUT: finite occupied-space groups and guarded completion callbacks
 * POS:    ui/chat-bubble — local visual state; latest text enters the same commit without a timer-backed queue
 */
import { useCallback, useState } from "react";
import { initialBubblePresence, reconcileBubblePresence, settleBubbleRow, settleEmptyBubbleGroup,
  type BubblePresenceInput } from "./bubble-presence.ts";

export function useBubblePresence(input: BubblePresenceInput) {
  const [state, setState] = useState(() => initialBubblePresence(input));
  let view = state;
  if (state.transcript !== input.transcript || state.presentationVersion !== input.presentationVersion || state.motion !== input.motion) {
    view = reconcileBubblePresence(state, input);
    setState(view);
  }
  const settleRow = useCallback((groupKey: string, itemKey: string, token: number) =>
    setState((current) => settleBubbleRow(current, { groupKey, itemKey, token })), []);
  const settleGroup = useCallback((groupKey: string, revision: number) =>
    setState((current) => settleEmptyBubbleGroup(current, { groupKey, revision })), []);
  return { groups: view.groups, settleRow, settleGroup };
}
