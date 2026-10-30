/**
 * INPUT: coherent child conversation pages, retained target/draft and real selected-child activity
 * OUTPUT: one shared Chat transcript frame plus authoritative private work controls
 * POS: ui/subagents — separate private controller, shared presentation; no primary Chat hooks or presence
 */
import { useMemo } from "react";
import { ChatClientContext } from "@/windows/home/pages/chat/chat-client-context.js";
import { TimelineView } from "@/windows/home/pages/chat/timeline-view.js";
import { groupByLocalDate } from "@/windows/home/pages/chat/date-group.js";
import { SubagentComposer } from "./subagent-composer.tsx";
import { SubagentConversationHeader } from "./subagent-conversation-header.tsx";
import { projectSubagentConversation } from "./subagent-conversation-transcript.ts";
import { displayedTarget } from "./subagent-state.ts";
import type { useSubagents } from "./use-subagents.ts";

export function SubagentDetail({ model }: { model: ReturnType<typeof useSubagents> }) {
  const { state, controller, available, activity } = model;
  const detail = state.detail;
  const target = displayedTarget(state);
  const items = useMemo(() => projectSubagentConversation({ entries: detail?.entries ?? [],
    acceptedInputs: state.acceptedInputs.filter((input) => input.subagentId === state.selectedId),
    live: activity?.metadata?.subagentId === state.selectedId ? activity : null, label: detail?.conversation.label ?? "子代理",
    bodyState: (seq) => ({ run: () => void controller.loadBody(seq), pending: state.bodyReads[seq]?.pending ?? false, error: state.bodyReads[seq]?.error ?? null }),
  }), [detail, state.acceptedInputs, state.selectedId, state.bodyReads, activity, controller]);
  if (!detail || !target) return <p className="p-4 text-sm text-text-secondary">{state.detailLoading ? "正在读取私有会话…" : "选择一个子代理查看工作与会话。"}</p>;
  return <ChatClientContext.Provider value={model.mediaClient}>
    <div className="flex min-h-0 flex-1 flex-col" data-subagent-id={detail.conversation.subagentId}>
      <SubagentConversationHeader detail={detail} workId={target.workInputId} loading={state.detailLoading}
        pending={!!state.pending} selectWork={(id) => controller.selectWork(id)} />
      <TimelineView timeline={{ items, groups: groupByLocalDate(items), loaded: true, hasMore: detail.hasMore,
        restoring: state.detailLoading, loadOlder: () => state.detailError ? void controller.refresh() : controller.loadMoreHistory(), historyError: state.detailError,
        reading: { key: `${state.characterId}:${state.selectedId}`, positions: controller.readingPositions } }} />
      <SubagentComposer target={target} child={detail.conversation} controller={controller} available={available} pending={state.pending} />
    </div>
  </ChatClientContext.Provider>;
}
