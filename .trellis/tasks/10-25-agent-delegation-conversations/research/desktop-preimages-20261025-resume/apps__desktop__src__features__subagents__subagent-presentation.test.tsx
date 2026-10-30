import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SubagentInputs } from "./subagent-inputs.tsx";
import { SubagentResults } from "./subagent-results.tsx";
import { SubagentComposer } from "./subagent-composer.tsx";
import { SubagentController } from "./subagent-controller.ts";
import { projectSubagentTranscript } from "./subagent-transcript.ts";
import { history, summary, resultView, CHILD_A, WORK_A } from "../../../test/s7-subagent-data.ts";

describe("private child presentation", () => {
  it("keeps accepted inputs distinct from actual model-intent receipts", () => {
    const html = renderToStaticMarkup(<SubagentInputs inputs={history().inputs} />);
    expect(html).toContain("已纳入模型请求意图"); expect(html).toContain("已接收 · 等待纳入");
    expect(html).toContain("不代表模型已理解");
  });
  it("internal parent synthesis and a stored publication never claim delivered speech", () => {
    const view = resultView(); view.result.publication = { state: "recorded", runId: "delivery-run" };
    const html = renderToStaticMarkup(<SubagentResults results={[view]} />);
    expect(html).toContain("主助手 · "); expect(html).toContain("内部结论");
    expect(html).toContain("尚无送达确认"); expect(html).not.toContain("已送达");
  });
  it("only a canonical sent delivery renders sent, and unknown remains unknown", () => {
    const view = resultView(); view.deliveryState = "unknown";
    expect(renderToStaticMarkup(<SubagentResults results={[view]} />)).toContain("送达结果未知");
    view.deliveryState = "sent"; expect(renderToStaticMarkup(<SubagentResults results={[view]} />)).toContain("已送达");
  });
  it("user stop keeps a visible explicit continue and explains that sending cannot resume", () => {
    const child = summary(); child.stopOrigin = "user"; child.state = "blocked_user"; child.activeRunId = null;
    const html = renderToStaticMarkup(<SubagentComposer child={child} target={{ subagentId: CHILD_A, workInputId: WORK_A, expectedRunId: null, expectedControlVersion: 2 }}
      controller={new SubagentController(vi.fn())} available pending={null} />);
    expect(html).toContain("需要点击继续才能恢复"); expect(html).toContain("继续此工作");
  });
  it("projects private text without relationship presence and scopes tool pairs by Run and Attempt", () => {
    const rows = history().messages.slice(0, 2);
    rows[0]!.parts = [{ type: "tool-call", toolCallId: "call", toolName: "memory_recall", input: {} }];
    rows[1]!.parts = [{ type: "tool-result", toolCallId: "call", toolName: "memory_recall", output: { type: "text", value: "known material" } }];
    const items = projectSubagentTranscript(rows); expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "tool", status: { phase: "settled", outcome: "completed" } });
    rows[1]!.attemptId = "different-attempt"; expect(projectSubagentTranscript(rows)).toHaveLength(2);
    expect(projectSubagentTranscript(history().messages).every((item) => !("committed" in item))).toBe(true);
  });
});
