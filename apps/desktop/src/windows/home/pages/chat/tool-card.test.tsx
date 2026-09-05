import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry, TimelinePart } from "@taki/shared";
import { TimelineMessage } from "./timeline-message.tsx";
import { ToolCard } from "./tool-card.tsx";

describe("readable tool cards", () => {
  it("prefers the captured target over a fixed name and does not expose the canonical routing key", () => {
    const markup = renderToStaticMarkup(<ToolCard name="screenshot" displayName="Captured server · actual.tool" state="done" />);
    expect(markup).toContain("Captured server · actual.tool");
    expect(markup).toContain("完成");
    expect(markup).not.toContain("screenshot");
    expect(markup).not.toContain("屏幕截图");
  });

  it("preserves valid maximum-length names", () => {
    const displayName = "🛠".repeat(120);
    const markup = renderToStaticMarkup(<ToolCard name="opaque_route" displayName={displayName} state="call" />);
    expect(markup).toContain(displayName);
    expect(markup).toContain("调用中");
    expect(markup).not.toContain("opaque_route");
  });

  it.each([undefined, "", " \t\n", "x".repeat(241), "🛠".repeat(121)])(
    "uses fixed or generic names when optional metadata is absent or invalid (%#)", (displayName) => {
      const fixed = renderToStaticMarkup(<ToolCard name="screenshot" displayName={displayName} state="done" />);
      const unknown = renderToStaticMarkup(<ToolCard name="old_mcp_opaque_4f19" displayName={displayName} state="error" />);
      expect(fixed).toContain("屏幕截图");
      expect(fixed).not.toContain("screenshot");
      expect(unknown).toContain("工具调用");
      expect(unknown).toContain("失败");
      expect(unknown).not.toContain("old_mcp_opaque_4f19");
    },
  );

  it("passes captured call/result labels through timeline rows while retaining their existing status", () => {
    const parts: TimelinePart[] = [
      { type: "tool-call", toolCallId: "call", toolName: "opaque_route", displayName: "Source · actual.tool" },
      { type: "tool-result", toolCallId: "call", toolName: "opaque_route", displayName: "Source · actual.tool",
        output: { type: "execution-denied", reason: "permission denied" } },
    ];
    for (const part of parts) {
      const entry: TimelineEntry = { seq: 1, id: "550e8400-e29b-41d4-a716-446655440000", characterId: "taki",
        role: part.type === "tool-call" ? "assistant" : "tool", content: "[tool-call: opaque_route]",
        parts: [part], createdAt: "2026-09-06T00:00:00.000Z" };
      const markup = renderToStaticMarkup(<TimelineMessage entry={entry} />);
      expect(markup).toContain("Source · actual.tool");
      expect(markup).toContain(part.type === "tool-call" ? "调用中" : "已拒绝");
      expect(markup).not.toContain("opaque_route");
    }
  });
});
