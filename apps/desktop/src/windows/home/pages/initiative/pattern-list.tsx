/**
 * INPUT: current Pattern list, selected binding and explicit navigation/pagination actions.
 * OUTPUT: compact semantic list with lifecycle and pending-proposal markers.
 * POS: Home initiative presentation; IDs exist only as React keys and callbacks.
 */
import type { InteractionPatternListResult } from "@taki/shared";
import { SelectionTile } from "@/components/ui/selection-tile.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { ActionButton } from "../../action-button.tsx";
import { PATTERN_STATES } from "@/features/initiative-patterns/pattern-labels.js";

export function PatternList(props: {
  list: InteractionPatternListResult | null;
  selectedId: string | null;
  busy: boolean;
  select(patternId: string): void;
  loadMore(): void;
}) {
  if (!props.list) return <p className="text-xs text-text-secondary">{props.busy ? "正在读取互动规则…" : "等待读取互动规则。"}</p>;
  return <div className="space-y-2">
    {props.list.patterns.length === 0 && <EmptyState title="还没有互动规则" hint="可以在聊天中描述你的想法，或新建一条规则。" />}
    {props.list.patterns.map((pattern) => <SelectionTile key={pattern.patternId} selected={props.selectedId === pattern.patternId} onSelect={() => props.select(pattern.patternId)}>
      <div className="min-w-0 text-left"><p className="break-words text-sm">{(pattern.candidateRevision ?? pattern.effectiveRevision)?.definition.title ?? "互动规则"}</p>
        <p className="mt-1 text-xs text-text-secondary">{PATTERN_STATES[pattern.state]}{pattern.candidateRevision && pattern.state !== "proposed" ? " · 有待确认修改" : ""}</p>
      </div>
    </SelectionTile>)}
    {props.list.nextAfter !== null && <ActionButton disabled={props.busy} onClick={props.loadMore}>加载更多规则</ActionButton>}
  </div>;
}
