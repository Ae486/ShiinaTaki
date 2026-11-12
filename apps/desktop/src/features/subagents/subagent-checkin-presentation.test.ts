import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { SubagentConversationEntry } from "@taki/shared";
import { projectSubagentConversation } from "./subagent-conversation-transcript.ts";
import { TimelineMessage } from "@/windows/home/pages/chat/timeline-message.js";
import { CHILD_A, WORK_A } from "../../../test/s7-subagent-data.ts";

// Field names/values follow Core progressSnapshot; producer identity comes from the event, never its body.
const snapshot = {
  reportKind: "Core progress snapshot", label: "Researcher", completedModelSteps: 50,
  latestWorkerText: { text: "已核对第一份材料。\n仍需核对第二份。", reference: "run:private-run:message:42" },
  olderTaskSummary: { text: "较早资料只支持初步结论。", throughSeq: 31 },
  recentToolEvidence: [{ name: "read_file", preview: '{"ok":true}',
    reference: { runId: "private-run", attemptId: "private-attempt", stepNumber: 49, toolCallId: "private-call" } }],
  pendingInputs: 2, remainingWork: "Not independently established by this factual snapshot; inspect worker evidence.",
  requiredActor: "user", nextAction: "Explicitly continue or redirect this exact check-in event and work.",
};
function entry(body: string | null = JSON.stringify(snapshot), producerKey = "checkin:0"): Extract<SubagentConversationEntry, { kind: "event" }> {
  const at = "2026-10-30T08:00:00Z";
  return { seq: 7, subagentId: CHILD_A, workInputId: WORK_A, historicalOrder: false, createdAt: at, kind: "event",
    event: { eventId: "checkpoint-event", seq: 1, characterId: "taki", subagentId: CHILD_A, workInputId: WORK_A,
      kind: "needs_input", producerRunId: "private-run", producerAttemptId: "private-attempt", producerKey,
      body, bodyDigest: "a".repeat(64), sourceContext: {}, throughWorkSeq: 1, acceptedAt: at,
      eligible: true, suppressionReason: null, state: "accepted", reconciliationNeeded: false } };
}
function project(value: SubagentConversationEntry, readMore?: { run(): void; pending: boolean; error: string | null }) {
  return projectSubagentConversation({ entries: [value], acceptedInputs: [], live: null, label: "Researcher", bodyState: () => readMore })[0]!;
}

describe("trusted Core checkpoint presentation", () => {
  it("formats the actual snapshot shape as system evidence without internal references or completion claims", () => {
    const source = entry(); const original = structuredClone(source);
    const row = project(source);
    expect(row.sender).toBe("系统"); expect(row.detail).toContain("系统事实快照");
    if (row.kind !== "text") throw new Error("Expected text row");
    expect(row.text).toContain("已完成 50 个模型步骤"); expect(row.text).toContain("2 条输入尚未纳入模型请求");
    expect(row.text).toContain("已核对第一份材料"); expect(row.text).toContain("较早资料只支持初步结论");
    expect(row.text).toContain("剩余工作尚未由此快照确认"); expect(row.text).toContain("需要你明确决定");
    for (const internal of ["reportKind", "private-run", "private-attempt", "private-call", "throughSeq"]) expect(row.text).not.toContain(internal);
    expect(row.text).not.toContain("工作已完成"); expect(source).toEqual(original);
  });

  it("does not give worker-written lookalike JSON system attribution", () => {
    const source = entry(JSON.stringify(snapshot), "interaction:49:worker-call");
    expect(project(source)).toMatchObject({ sender: "Researcher", text: source.event.body, detail: "请求补充输入 · 主助手尚未接入" });
    source.event.kind = "message"; source.event.producerKey = "checkin:0";
    expect(project(source)).toMatchObject({ sender: "Researcher", text: source.event.body });
  });

  it("renders the system sender and readable evidence through the actual shared Chat row and Markdown", async () => {
    const stream = await renderToReadableStream(createElement(TimelineMessage, { item: project(entry()) }));
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).toContain(">系统</span>"); expect(html).toContain("系统事实快照");
    expect(html).toContain("已完成 50 个模型步骤"); expect(html).toContain("已核对第一份材料");
    expect(html).toContain("<blockquote>"); expect(html).not.toContain("private-run"); expect(html).not.toContain("reportKind");
  });

  it.each([null, "{unfinished", JSON.stringify({ ...snapshot, reportKind: "future format" }),
    JSON.stringify({ ...snapshot, completedModelSteps: -1 }), JSON.stringify({ ...snapshot, pendingInputs: null }),
    JSON.stringify({ ...snapshot, requiredActor: ["user"] }),
    JSON.stringify({ ...snapshot, latestWorkerText: { text: "large".repeat(15_000) } })].map((body, index) => ({ body, index })))(
    "keeps unavailable or unsupported checkpoint body visible without inventing parsed facts: $index", ({ body }) => {
      const row = project(entry(body));
      expect(row.sender).toBe("系统");
      if (row.kind !== "text") throw new Error("Expected text row");
      expect(row.text).toContain("无法完整解读"); expect(row.text).not.toContain("已完成 50 个模型步骤");
      if (body !== null) expect(row.text).toContain(body);
    });

  it("keeps incomplete previews and their exact read-more action, then formats the completed body with the same identity", () => {
    const full = entry(); const preview = entry(full.event.body!.slice(0, 100));
    preview.body = { digest: "b".repeat(64), totalChars: full.event.body!.length, nextOffset: 0 };
    const readMore = { run: vi.fn(), pending: false, error: "Read failed; retry" };
    const before = project(preview, readMore); const after = project(full);
    expect(before.readMore).toBe(readMore); expect(before.key).toBe(after.key);
    if (before.kind !== "text" || after.kind !== "text") throw new Error("Expected text rows");
    expect(before.text).toContain("尚未完整读取"); expect(before.text).toContain(preview.event.body!);
    expect(before.text).not.toContain("已完成 50 个模型步骤");
    expect(after.text).toContain("已完成 50 个模型步骤"); expect(after.readMore).toBeUndefined();
  });

  it("distinguishes no recent text from unknown work and uses the captured parent-or-user actor", () => {
    const row = project(entry(JSON.stringify({ ...snapshot, latestWorkerText: null, olderTaskSummary: null,
      recentToolEvidence: [], pendingInputs: 0, requiredActor: "parent_or_user" })));
    if (row.kind !== "text") throw new Error("Expected text row");
    expect(row.text).toContain("0 条输入尚未纳入模型请求"); expect(row.text).toContain("没有可用的近期子代理文字");
    expect(row.text).toContain("主助手或你"); expect(row.text).toContain("剩余工作尚未由此快照确认");
  });
});
