import { describe, expect, it } from "vitest";
import { coWatchingInput } from "../testing/co-watching-fixture.ts";
import { verifyCoWatchingNative } from "./native-result.ts";

describe("governed native complete-result boundary", () => {
  it("accepts verified structured content and ordinary MCP text envelopes", () => {
    const f = coWatchingInput();
    expect(verifyCoWatchingNative(f.raw, f.analysis).native.analysis.moments).toHaveLength(2);
    expect(verifyCoWatchingNative({ content: [{ type: "text", text: JSON.stringify(f.raw.structuredContent) }] }, f.analysis).native).toBeDefined();
  });
  it.each(["hash", "media", "identity", "time", "duplicate"])("rejects changed %s evidence", (kind) => {
    const f = coWatchingInput(); const value = f.raw.structuredContent;
    if (kind === "hash") value.sha256 = "b".repeat(64);
    if (kind === "media") value.result.source.resolved = { ...f.analysis.media, cid: "123" };
    if (kind === "identity") value.result.identity = { ...value.identity, job_id: f.analysis.native.requestId };
    if (kind === "time") value.result.analysis.moments[0]!.end_seconds = 301;
    if (kind === "duplicate") value.result.analysis.moments[1]!.moment_id = "first";
    expect(() => verifyCoWatchingNative(f.raw, f.analysis)).toThrow("CO_WATCHING_ANALYSIS_MISMATCH");
  });
  it("refuses an MCP failure even when it carries an otherwise valid result", () => {
    const f = coWatchingInput(); expect(() => verifyCoWatchingNative({ ...f.raw, isError: true }, f.analysis)).toThrow("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  });
});
