/**
 * INPUT: continuous private entries, accepted echoes and real scoped child activity
 * OUTPUT: sender-aware Chat rows with native invocation identity and complete-batch handoff
 * POS: ui/subagents — pure presentation; no primary Timeline exposure or inferred execution progress
 */
import type { SubagentConversationEntry, SubagentInput } from "@taki/shared";
import type { ChatTranscriptItem } from "@/windows/home/pages/chat/chat-transcript.js";
import { addPrivateMessage } from "./subagent-message-projection.ts";
import { activityItemKey } from "@/lib/chat-activity-state.js";
import type { SubagentLiveView } from "./subagent-activity-retention.ts";
import { completePrivateItem, privateItemPreview } from "./subagent-live-coverage.ts";


const SENDER = { user: "你", parent: "主助手", core: "系统" };
const EVENT = { message: "发给主助手的消息", needs_input: "请求补充输入", final: "工作报告", interrupted: "执行中断" };
const DISPOSITION = { accepted: "主助手尚未接入", delivered: "主助手已接入，尚未处理", handled: "主助手已处理" };

export function projectSubagentConversation(input: {
  entries: SubagentConversationEntry[]; acceptedInputs: SubagentInput[]; live: SubagentLiveView | null; label: string;
  bodyState?(seq: number): ChatTranscriptItem["readMore"];
}): ChatTranscriptItem[] {
  const items = new Map<string, ChatTranscriptItem>();
  for (const entry of input.entries) {
    const base = { seq: entry.seq, order: 0, createdAt: entry.createdAt, workLabel: workLabel(input.entries, entry.workInputId),
      ...(entry.body ? { readMore: input.bodyState?.(entry.seq) } : {}) };
    if (entry.kind === "input") addInput(items, entry.input, base);
    else if (entry.kind === "message") {
      const previewsLive = [input.live, ...(input.live?.retained ?? [])].some((live) => live && "items" in live.view.snapshot
        && live.view.snapshot.items.some((item) => privateItemPreview([entry], live.metadata, item.itemId)));
      if (!previewsLive) addPrivateMessage(items, entry, { ...base, sender: input.label });
    }
    else if (entry.kind === "event") {
      const ref = entry.presentation?.references[0];
      const key = ref && entry.presentation ? activityItemKey(entry.presentation.messageId, ref.itemId) : `private-event:${entry.event.eventId}`;
      items.set(key, {
      ...base, key, kind: "text", role: "assistant", sender: entry.event.kind === "interrupted" ? "系统" : input.label,
      text: entry.event.body ?? "正文暂不可用。", detail: `${EVENT[entry.event.kind]} · ${DISPOSITION[entry.event.state]}`,
      });
    }
    else items.set(`private-control:${entry.seq}`, { ...base, key: `private-control:${entry.seq}`, kind: "notice",
      sender: SENDER[entry.control.origin], text: entry.control.origin === "user" ? "你已停止此子代理。" : "主助手已暂停此子代理。" });
  }
  const tail = input.entries.at(-1)?.seq ?? 0;
  for (const [index, accepted] of input.acceptedInputs.entries()) {
    if (input.entries.some((entry) => entry.kind === "input" && entry.input.inputId === accepted.inputId)) continue;
    addInput(items, accepted, { seq: tail + 0.25, order: index, createdAt: accepted.createdAt, workLabel: workLabel(input.entries, accepted.workInputId) });
  }
  for (const retained of input.live?.retained ?? []) addLive(items, { ...input, live: retained });
  addLive(items, input);
  return [...items.values()].sort((a, b) => a.seq - b.seq || a.order - b.order);
}

function workLabel(entries: SubagentConversationEntry[], id: string): string {
  const work = entries.find((entry) => entry.workInputId === id && entry.kind === "input" && entry.input.kind === "work");
  return work?.kind === "input" ? work.input.direction.slice(0, 48) || "未命名工作" : "工作记录";
}

function addInput(items: Map<string, ChatTranscriptItem>, input: SubagentInput,
  base: Pick<ChatTranscriptItem, "seq" | "order" | "createdAt" | "workLabel" | "readMore">): void {
  const key = `private-input:${input.inputId}`;
  const materials = input.materials.map((material) => `材料：${material.source?.label ?? material.key}${material.source?.speaker ? ` · ${material.source.speaker}` : ""}\n${material.text}`).join("\n\n");
  items.set(key, { ...base, key, kind: "text", role: input.sender.kind === "user" ? "user" : "assistant",
    sender: SENDER[input.sender.kind], text: [input.direction || (input.kind === "continue" ? "继续此工作" : ""), materials].filter(Boolean).join("\n\n"),
    detail: `${input.consumed ? "已纳入模型请求意图" : "已接收 · 等待纳入"}${input.kind === "work" && input.completionPolicy === "record_only" ? " · 完成后仅保留结果" : ""}` });
}

function addLive(items: Map<string, ChatTranscriptItem>, input: {
  entries: SubagentConversationEntry[]; live: SubagentLiveView | null; label: string;
  bodyState?(seq: number): ChatTranscriptItem["readMore"];
}): void {
  const live = input.live;
  if (!live) return;
  const { snapshot, stale } = live.view;
  if (snapshot.status === "idle") return;
  const base = { seq: (input.entries.at(-1)?.seq ?? 0) + 0.5, createdAt: input.entries.at(-1)?.createdAt ?? new Date().toISOString(), sender: input.label };
  if (snapshot.status === "unavailable") {
    items.set(`unavailable:${snapshot.messageId}`, { ...base, key: `unavailable:${snapshot.messageId}`, order: 0,
      kind: "notice", text: "实时内容超过恢复容量，已保留的会话仍可读取。" });
    return;
  }
  for (const item of snapshot.items) {
    const key = activityItemKey(snapshot.messageId, item.itemId);
    const complete = completePrivateItem(input.entries, { messageId: snapshot.messageId, itemId: item.itemId });
    if (complete && items.has(key)) continue;
    const canonical = items.get(key);
    const preview = privateItemPreview(input.entries, live.metadata, item.itemId);
    // An accepted report replaces its report-tool row once its complete step is present.
    const position = { ...base, seq: canonical?.seq ?? live.positions?.get(key) ?? base.seq,
      readMore: canonical?.readMore ?? (preview ? input.bodyState?.(preview.seq) : undefined) };
    if (item.kind === "text") items.set(key, { ...position, key, order: item.order, kind: "text", role: "assistant", text: item.text });
    else items.set(key, { ...position, key, order: item.order, kind: "tool", toolName: item.toolName, displayName: item.displayName,
      status: snapshot.status === "terminal" && item.status.phase !== "settled" ? { phase: "settled", outcome: "outcome_unknown" } : item.status, stale });
  }
  if (stale) items.set(`stale:${snapshot.messageId}`, { ...base, key: `stale:${snapshot.messageId}`, order: Number.MAX_SAFE_INTEGER,
    kind: "notice", text: "实时状态暂不可用，已接收内容已保留；恢复连接后核对。" });
}
