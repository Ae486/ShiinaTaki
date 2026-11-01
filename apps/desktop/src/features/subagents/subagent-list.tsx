/**
 * INPUT: bounded child summaries with committed selection and loading/connection facts
 * OUTPUT: navigable task labels and honest empty or unavailable views
 * POS: ui/subagents — disposable MasterDetail list, no inferred child outcomes
 */
import { SelectionTile } from "@/components/ui/selection-tile.js";
import { ActionButton } from "@/windows/home/action-button.js";
import { CHILD_STATE } from "./subagent-labels.ts";
import { subagentUsageLabel } from "./subagent-progress.tsx";
import type { useSubagents } from "./use-subagents.ts";

export function SubagentList({ model }: { model: ReturnType<typeof useSubagents> }) {
  const { state, controller, connected } = model;
  return <section aria-label="子代理列表" className="space-y-2">
    {!state.list && <p className="px-3 py-2 text-xs text-text-secondary">{!connected ? "连接恢复后可读取子代理。" : state.readError ? "列表暂不可用。" : "正在读取子代理…"}</p>}
    {state.list?.entries.length === 0 && <p className="px-3 py-2 text-xs leading-relaxed text-text-secondary">还没有子代理。主助手委派工作后，会在这里显示。</p>}
    {state.list?.entries.map((child) => <SelectionTile key={child.subagentId} selected={state.selectedId === child.subagentId}
      stateAttr="aria-current" disabled={!connected || !!state.pending} onSelect={() => controller.select(child.subagentId)}>
      <span className="block break-words text-sm font-medium">{child.label}</span>
      <span className="mt-1 block text-xs text-text-secondary">{CHILD_STATE[child.state]}</span>
      <span className="mt-1 block text-xs text-text-secondary">{subagentUsageLabel(child)}</span>
    </SelectionTile>)}
    {state.list?.nextCursor && <ActionButton disabled={!connected || state.loading} onClick={() => controller.loadMore()}>读取更多子代理</ActionButton>}
  </section>;
}
