import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { historicalToolStatus, toolOutputDetails } from "./tool-result-display.ts";
import { ToolCard } from "./tool-card.tsx";

describe("truthful and useful tool output", () => {
  it("distinguishes structured failure, unknown MCP content, denial, cancellation and confirmed success", () => {
    expect(historicalToolStatus({ type: "json", value: { ok: false } })).toMatchObject({ outcome: "failed" });
    expect(historicalToolStatus({ type: "json", value: { isError: true } })).toMatchObject({ outcome: "failed" });
    expect(historicalToolStatus({ type: "content", value: [{ type: "text", text: "an error may have been converted" }] })).toMatchObject({ outcome: "outcome_unknown" });
    expect(historicalToolStatus({ type: "execution-denied" })).toMatchObject({ outcome: "failed" });
    expect(historicalToolStatus({ type: "json", value: { ok: false, error: { code: "MEMORY_OPERATION_CANCELLED" } } })).toMatchObject({ outcome: "cancelled" });
    expect(historicalToolStatus({ type: "json", value: { ok: true, result: 7 } })).toMatchObject({ outcome: "completed" });
  });

  it("unwraps only known transport/control envelopes and preserves meaningful business fields", () => {
    const details = toolOutputDetails({ type: "json", value: { jsonrpc: "2.0", id: "transport-id", result: {
      ok: true, data: { id: "business-id", version: "published version", answer: "actual value" },
    } } });
    expect(details).toContain("business-id"); expect(details).toContain("published version");
    expect(details).toContain("actual value"); expect(details).not.toContain("transport-id");
    expect(details).not.toContain("jsonrpc");
    expect(toolOutputDetails({ type: "json", value: { ok: true } })).toBeNull();
  });

  it("shows actual MCP text without media bytes and keeps returned markup literal inside a collapsed disclosure", () => {
    const details = toolOutputDetails({ type: "content", value: [
      { type: "text", text: "<script>literal result</script>" }, { type: "image", data: "private-image-bytes" },
    ] });
    expect(details).toBe("<script>literal result</script>");
    const markup = renderToStaticMarkup(<ToolCard name="unknown-routing-key" status={{ phase: "settled", outcome: "failed" }} details={details} />);
    expect(markup).toContain("<details"); expect(markup).not.toContain(" open");
    expect(markup).toContain("&lt;script&gt;"); expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("unknown-routing-key"); expect(markup).not.toContain("private-image-bytes");
    const empty = renderToStaticMarkup(<ToolCard name="echo" status={{ phase: "settled", outcome: "completed" }} />);
    expect(empty).not.toContain("<details");
  });
});
