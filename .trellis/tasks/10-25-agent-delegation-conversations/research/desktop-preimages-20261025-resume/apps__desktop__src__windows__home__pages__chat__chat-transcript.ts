/**
 * INPUT:  canonical Timeline rows and disposable live-turn handoffs
 * OUTPUT: one flat ordered transcript with stable text/invocation keys across persistence
 * POS:    ui/chat — render projection only; original Timeline rows remain the history/replay authority
 */
import type { ChatActivityToolStatus, TimelineEntry, TimelineToolOutput } from "@taki/shared";
import type { TimelineLiveTurn } from "./chat-timeline-activity.ts";
import { activityItemKey } from "@/lib/chat-activity-state.js";
import { projectCanonicalTimeline } from "./timeline-projection.ts";
import type { CommittedTextTarget } from "@/features/presence/surface-presence.js";

interface TranscriptPosition {
  key: string;
  seq: number;
  order: number;
  createdAt: string;
}
export type ChatTranscriptItem = TranscriptPosition & (
  | { kind: "user"; entry: TimelineEntry }
  | { kind: "text"; role: "user" | "assistant"; text: string; committed?: CommittedTextTarget[] }
  | { kind: "image"; role: "user" | "assistant"; imageRef: string }
  | { kind: "tool"; toolName: string; displayName?: string; status: ChatActivityToolStatus; output?: TimelineToolOutput; stale?: boolean }
  | { kind: "notice"; text: string }
);

export function projectChatTranscript(entries: TimelineEntry[], turns: TimelineLiveTurn[]): ChatTranscriptItem[] {
  const activeMessages = new Set(turns.flatMap((turn) => turn.view.snapshot.status === "idle" ? [] : [turn.view.snapshot.messageId]));
  const canonical = projectCanonicalTimeline(entries.filter((entry) => !entry.presentation || !activeMessages.has(entry.presentation.messageId)));
  const live = turns.flatMap(projectLiveTurn);
  return [...canonical, ...live].sort((left, right) => left.seq - right.seq || left.order - right.order);
}

function projectLiveTurn(turn: TimelineLiveTurn): ChatTranscriptItem[] {
  const { snapshot, stale } = turn.view;
  if (snapshot.status === "idle") return [];
  const position = { seq: turn.anchorSeq + 0.5, createdAt: turn.createdAt };
  if (snapshot.status === "unavailable") return [{ ...position, key: `unavailable:${snapshot.messageId}`, order: 0,
    kind: "notice", text: "这段回复较长，实时视图无法完整恢复。完成后将显示完整聊天记录。" }];
  const items: ChatTranscriptItem[] = snapshot.items.map((item) => {
    const base = { ...position, key: activityItemKey(snapshot.messageId, item.itemId), order: item.order };
    if (item.kind === "text") return { ...base, kind: "text", role: "assistant", text: item.text };
    const status: ChatActivityToolStatus = snapshot.status === "terminal" && item.status.phase !== "settled"
      ? { phase: "settled", outcome: "outcome_unknown" } : item.status;
    return { ...base, kind: "tool", toolName: item.toolName, displayName: item.displayName, status, stale };
  });
  if (stale && items.length > 0) items.push({ ...position, key: `recovering:${snapshot.messageId}`, order: Number.MAX_SAFE_INTEGER,
    kind: "notice", text: "正在恢复回复状态，已接收的内容保留在此。" });
  return items;
}
