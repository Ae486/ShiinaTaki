/**
 * INPUT:  one ordered set of active/exiting semantic rows and finite completion callbacks
 * OUTPUT: one measured occupied-space envelope that crossfades tools into successor text without collapsing first
 * POS:    ui/chat-bubble — visual group only; no stream/turn/execution authority or per-frame geometry loop
 */
import { useCallback } from "react";
import type { BubblePresenceGroup as PresenceGroup } from "./bubble-presence.ts";
import { useBubbleOccupiedHeight } from "./use-bubble-occupied-height.ts";
import { BubbleTranscriptRow } from "./bubble-transcript-row.tsx";

interface GroupProps {
  group: PresenceGroup;
  onMeasured(): void;
  settleRow(groupKey: string, itemKey: string, token: number): void;
  settleGroup(groupKey: string, revision: number): void;
}

export function BubblePresenceGroup({ group, onMeasured, settleRow, settleGroup }: GroupProps) {
  const geometry = useBubbleOccupiedHeight({ group, onMeasured, onEmpty: settleGroup });
  const settled = useCallback((itemKey: string, token: number) => settleRow(group.key, itemKey, token), [group.key, settleRow]);
  return (
    <div ref={geometry.outerRef} className="pet-bubble-group" data-bubble-group={group.key}
      data-instant={group.instant || undefined} style={{ height: geometry.height ?? "auto" }}>
      <div ref={geometry.naturalRef} className="pet-bubble-natural">
        {group.rows.map((row) => <BubbleTranscriptRow key={row.item.key} row={row} settled={settled} />)}
      </div>
    </div>
  );
}
