/**
 * INPUT: private Run messages, preserving Run/Attempt/call identity and partial outcomes
 * OUTPUT: reusable Chat presentation items without creating canonical Timeline or presence records
 * POS: ui/subagents — private transcript rendering projection only
 */
import type { RunMessage } from "@taki/shared";
import type { ChatTranscriptItem } from "@/windows/home/pages/chat/chat-transcript.js";
import { historicalToolStatus } from "@/windows/home/pages/chat/tool-result-display.js";

export function projectSubagentTranscript(messages: RunMessage[]): ChatTranscriptItem[] {
  const items = new Map<string, ChatTranscriptItem>();
  for (const row of messages) {
    if (row.entryKind === "input") continue;
    const parts = row.parts?.length ? row.parts : [{ type: "text" as const, text: row.content }];
    for (const [order, part] of parts.entries()) {
      const base = { seq: row.seq, order, createdAt: row.createdAt };
      const key = `private:${row.runId}:${row.seq}:${order}`;
      if (part.type === "text" && part.text) items.set(key, { ...base, key, kind: "text", role: row.role === "user" ? "user" : "assistant", text: part.text });
      else if (part.type === "image") items.set(key, { ...base, key, kind: "image", role: row.role === "user" ? "user" : "assistant", imageRef: part.ref });
      else if (part.type === "tool-call" || part.type === "tool-result") {
        const callKey = `private-tool:${row.runId}:${row.attemptId}:${part.toolCallId}:${part.toolName}`;
        const previous = items.get(callKey);
        const output = part.type === "tool-result" ? part.output : previous?.kind === "tool" ? previous.output : undefined;
        items.set(callKey, { ...base, ...(previous ? { seq: previous.seq, order: previous.order } : {}),
          key: callKey, kind: "tool", toolName: part.toolName, output, status: historicalToolStatus(output) });
      }
    }
    if (row.entryKind === "partial") {
      const key = `private-partial:${row.runId}:${row.seq}`;
      items.set(key, { key, seq: row.seq, order: parts.length, createdAt: row.createdAt, kind: "notice", text: "部分输出；执行结果请以下方工作结果为准。" });
    }
  }
  return [...items.values()].sort((a, b) => a.seq - b.seq || a.order - b.order);
}
