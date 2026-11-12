import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry, TimelinePart } from "@taki/shared";
import { TimelineMessage } from "./timeline-message.tsx";
import { ToolCard } from "./tool-card.tsx";
import { projectChatTranscript } from "./chat-transcript.ts";

describe("readable tool cards", () => {
  it("keeps the live heading outside the later disclosure and renders no empty control", () => {
    const pending = renderToStaticMarkup(<ToolCard name="echo" displayName="Selected tool" status={{ phase: "executing" }} />);
    const settled = renderToStaticMarkup(<ToolCard name="echo" displayName="Selected tool"
      status={{ phase: "settled", outcome: "failed", message: "Actual failure explanation" }} />);
    expect(pending.startsWith("<div")).toBe(true);
    expect(settled.startsWith("<div")).toBe(true);
    expect(pending).not.toContain("<summary");
    expect(settled.indexOf("Selected tool")).toBeLessThan(settled.indexOf("<details"));
    expect(settled).not.toContain(" open");
    const blank = renderToStaticMarkup(<ToolCard name="echo" status={{ phase: "settled", outcome: "completed" }} details={" \n "} />);
    expect(blank).not.toContain("<summary");
  });

  it("prefers the captured target over a fixed name and does not expose the canonical routing key", () => {
    const markup = renderToStaticMarkup(<ToolCard name="screenshot" displayName="Captured server · actual.tool" status={{ phase: "settled", outcome: "completed" }} />);
    expect(markup).toContain("Captured server · actual.tool");
    expect(markup).toContain("完成");
    expect(markup).not.toContain("screenshot");
    expect(markup).not.toContain("屏幕截图");
  });

  it("preserves valid maximum-length names", () => {
    const displayName = "🛠".repeat(120);
    const markup = renderToStaticMarkup(<ToolCard name="opaque_route" displayName={displayName} status={{ phase: "received" }} />);
    expect(markup).toContain(displayName);
    expect(markup).toContain("等待处理");
    expect(markup).not.toContain("opaque_route");
  });

  it.each([undefined, "", " \t\n", "x".repeat(241), "🛠".repeat(121)])(
    "uses fixed or generic names when optional metadata is absent or invalid (%#)", (displayName) => {
      const fixed = renderToStaticMarkup(<ToolCard name="screenshot" displayName={displayName} status={{ phase: "settled", outcome: "completed" }} />);
      const unknown = renderToStaticMarkup(<ToolCard name="old_mcp_opaque_4f19" displayName={displayName} status={{ phase: "settled", outcome: "failed" }} />);
      expect(fixed).toContain("屏幕截图");
      expect(fixed).not.toContain("screenshot");
      expect(unknown).toContain("工具调用");
      expect(unknown).toContain("失败");
      expect(unknown).not.toContain("old_mcp_opaque_4f19");
    },
  );

  it("passes captured labels through history while an orphan call stays inactive and denial is failure", () => {
    const parts: TimelinePart[] = [
      { type: "tool-call", toolCallId: "call", toolName: "opaque_route", displayName: "Source · actual.tool" },
      { type: "tool-result", toolCallId: "call", toolName: "opaque_route", displayName: "Source · actual.tool",
        output: { type: "execution-denied", reason: "permission denied" } },
    ];
    for (const part of parts) {
      const entry: TimelineEntry = { seq: 1, id: "550e8400-e29b-41d4-a716-446655440000", characterId: "taki",
        role: part.type === "tool-call" ? "assistant" : "tool", content: "[tool-call: opaque_route]",
        parts: [part], createdAt: "2026-09-06T00:00:00.000Z" };
      const markup = renderToStaticMarkup(<>{projectChatTranscript([entry], []).map((item) => <TimelineMessage key={item.key} item={item} />)}</>);
      expect(markup).toContain("Source · actual.tool");
      expect(markup).toContain(part.type === "tool-call" ? "结果未确认" : "失败");
      expect(markup).not.toContain("opaque_route");
    }
  });
});
