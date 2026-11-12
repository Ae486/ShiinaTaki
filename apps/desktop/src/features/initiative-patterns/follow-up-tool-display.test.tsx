import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { toolOutputDetails } from "@/windows/home/pages/chat/tool-result-display.js";
import { ToolCard } from "@/windows/home/pages/chat/tool-card.js";

// Matches the current Core producer's semantic output, including nullable event timing.
const result = { ok: true, status: "created", state: "active", purpose: "Ask about the interview",
  notBefore: "2026-09-29T10:00:00.000Z", expiresAt: "2026-09-29T12:00:00.000Z", reportedEventTime: null, disposition: null };

describe("follow-up tool semantic details", () => {
  it("renders the current producer outcome and bounded window in Chinese without asserting delivery or resolution", () => {
    const details = toolOutputDetails({ type: "json", value: result }, "plan_follow_up");
    const markup = renderToStaticMarkup(<ToolCard name="plan_follow_up" displayName="安排后续跟进"
      status={{ phase: "settled", outcome: "completed" }} details={details} />);
    for (const text of ["已记录后续跟进计划", "等待有效时机", "最早考虑时间", "有效期至", "不保证发言", "不表示相关事情已经解决"]) {
      expect(markup).toContain(text);
    }
    expect(markup).not.toContain("plan_follow_up"); expect(markup).not.toContain("reportedEventTime");
  });

  it("keeps unknown/error payloads and live status fallback out of ordinary and accessible text", () => {
    for (const output of [undefined, { type: "error-text" as const, value: "private-error-id" },
      { type: "json" as const, value: { unknown: "private-error-id" } }]) {
      const details = toolOutputDetails(output, "plan_follow_up");
      const markup = renderToStaticMarkup(<ToolCard name="plan_follow_up" displayName="安排后续跟进"
        status={{ phase: "settled", outcome: "failed", message: "private-error-id" }} details={details} />);
      expect(markup).not.toContain("private-error-id");
      expect(markup).not.toContain("plan_follow_up");
    }
    expect(toolOutputDetails({ type: "json", value: { ok: false, code: "FORBIDDEN", reason: "source_stale", message: "private-error-id" } }, "plan_follow_up"))
      .toBe("当前对话来源已失效，未创建计划。");
  });

  it("preserves the original deadline and closed state in duplicate/expired results", () => {
    const details = toolOutputDetails({ type: "json", value: { ...result, status: "duplicate", state: "terminal",
      purpose: null, disposition: "expired" } }, "plan_follow_up");
    expect(details).toContain("保留原有时间窗口"); expect(details).toContain("已过期，不再触发");
    expect(details).not.toContain("已记录后续跟进计划");
  });

  it("keeps copyable details and the full expanded/accessibility markup semantic even with extra canonical bindings", () => {
    const canonical = { ...result, intentionId: "private-intention-id", canonicalRunKey: "private-canonical-key",
      sourceKey: "e".repeat(64), source: { timelineId: "private-timeline-id", runId: "private-run-id", attemptId: "private-attempt-id" } };
    const original = JSON.stringify(canonical);
    const details = toolOutputDetails({ type: "json", value: canonical }, "plan_follow_up");
    const markup = renderToStaticMarkup(<ToolCard name="plan_follow_up" displayName="安排后续跟进"
      status={{ phase: "settled", outcome: "completed" }} details={details} />);
    // ToolCard has no separate clipboard path: its selectable preformatted text is this same projection.
    expect(details).toContain("有效期至"); expect(markup).toContain("展开或收起详情");
    for (const hidden of ["private-intention-id", "private-canonical-key", "private-timeline-id", "private-run-id", "private-attempt-id",
      "e".repeat(64), "canonicalRunKey", "sourceKey", "timelineId", "plan_follow_up"]) {
      expect(markup).not.toContain(hidden); expect(details).not.toContain(hidden);
    }
    expect(JSON.stringify(canonical)).toBe(original);
  });
});
