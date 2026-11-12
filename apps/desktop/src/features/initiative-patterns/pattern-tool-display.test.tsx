import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { toolOutputDetails } from "@/windows/home/pages/chat/tool-result-display.js";
import { ToolCard } from "@/windows/home/pages/chat/tool-card.js";
import { pattern } from "./pattern-test-fixtures.ts";

describe("Pattern tool semantic projection", () => {
  it("renders canonical typed output without exposing internal identities in expanded cards", () => {
    const value = { ok: true, status: "applied", pattern: pattern() };
    const details = toolOutputDetails({ type: "json", value }, "manage_interaction_pattern");
    const markup = renderToStaticMarkup(<ToolCard name="manage_interaction_pattern" displayName="管理互动习惯" status={{ phase: "settled", outcome: "completed" }} details={details} />);
    expect(markup).toContain("晚间回顾"); expect(markup).toContain("25%"); expect(markup).toContain("管理互动习惯");
    for (const hidden of ["opaque-pattern", "opaque-revision", "178923", "178922", "patternId", "revisionId", "manage_interaction_pattern"]) expect(markup).not.toContain(hidden);
  });
  it("keeps list/history useful and malformed or error payloads conservative", () => {
    const row = pattern();
    expect(toolOutputDetails({ type: "json", value: { ok: true, patterns: [row], nextAfter: "opaque-cursor" } }, "manage_interaction_pattern")).toContain("晚间回顾");
    expect(toolOutputDetails({ type: "json", value: { ok: true, revisions: [row.candidateRevision], nextBefore: 812832 } }, "manage_interaction_pattern")).not.toContain("812832");
    expect(toolOutputDetails({ type: "json", value: { ok: false, code: "PATTERN_REFUSED", reason: "conflict", current: row, message: "opaque-leak" } }, "manage_interaction_pattern")).toContain("已被其他操作更新");
    expect(toolOutputDetails({ type: "error-text", value: "opaque-leak" }, "manage_interaction_pattern")).not.toContain("opaque-leak");
    expect(toolOutputDetails(undefined, "manage_interaction_pattern")).toBe("");
  });
});
