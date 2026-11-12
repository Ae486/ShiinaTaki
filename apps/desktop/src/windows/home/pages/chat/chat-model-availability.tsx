/**
 * INPUT: presence-only Main availability and current observation freshness.
 * OUTPUT: a concise configuration/recovery entry while the chat timeline stays available.
 * POS: Chat presentation; model prerequisites gate new messages without gating Home navigation/history.
 */
import type { ModelProfilesView } from "../../model-profiles-controller.ts";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { useHomeStore } from "../../home-store.ts";

export function ChatModelAvailability({ view, refresh }: { view: ModelProfilesView; refresh(): Promise<void> }) {
  const navigate = useHomeStore((state) => state.navigate);
  const main = view.data?.profiles.find((profile) => profile.slot === "main");
  if (view.fresh && main?.state === "ready") return null;
  return <div className="px-6 py-2">
    {view.error ? <FeedbackLine tone="warn" action={{ label: "重新读取", onClick: () => void refresh() }}>{view.error}</FeedbackLine>
      : !view.fresh ? <FeedbackLine tone="info">正在确认模型配置，历史记录仍可浏览。</FeedbackLine>
        : <FeedbackLine tone="info" action={{ label: "配置模型", onClick: () => navigate("settings") }}>
          {main?.state === "disabled" ? "主模型已停用。" : "配置主模型后即可开始聊天。"}历史记录和其他页面仍可使用。
        </FeedbackLine>}
  </div>;
}
