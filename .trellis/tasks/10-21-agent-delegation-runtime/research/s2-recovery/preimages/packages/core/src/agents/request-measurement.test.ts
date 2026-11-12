import { describe, expect, it } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { estimatePreparedToolSchemaTokens, estimateToolSchemaTokens, measureRequest } from "./request-measurement.ts";
import { fireUsageReport } from "./turn-usage-report.ts";

const replay = {
  sourceRows: 12,
  liveRows: 10,
  selectedRows: 8,
  summaryTokens: 20,
  liveTokensBeforeFolds: 100,
  foldedTokensSaved: 15,
  historyTokens: 75,
  tokenBoundaryHit: true,
  sourceBackstopHit: false,
};

describe("request measurement", () => {
  it("separates replay/summary cost from the actual request envelope", () => {
    const measurement = measureRequest({
      replay,
      messages: [{ role: "user", content: "你好" }],
      instructions: "stable instructions",
      toolSchemaTokens: 30,
      envelopeReserveTokens: 100,
    });
    expect(measurement).toMatchObject({ ...replay, toolSchemaTokens: 30, accountingQuality: "estimated" });
    expect(measurement.instructionTokens).toBeGreaterThan(0);
    expect(measurement.requestMessageTokens).toBeGreaterThan(0);
    const requestTail = Math.max(0, measurement.requestMessageTokens - replay.historyTokens);
    expect(measurement.responseReserveTokens).toBe(100 - requestTail - measurement.instructionTokens - 30);
    expect(measurement.projectedRequestTokens).toBe(measurement.estimatedInputTokens + measurement.responseReserveTokens);
  });

  it("prices the provider-facing tool name, description and JSON schema without execute closures", async () => {
    const short = await estimateToolSchemaTokens({ a: tool({ description: "a", inputSchema: z.object({ x: z.string() }) }) }, ["a"]);
    const long = await estimateToolSchemaTokens({ a: tool({ description: "a much longer description", inputSchema: z.object({ x: z.string(), count: z.number() }) }) }, ["a"]);
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it("resolves dynamic descriptions with the SDK's absent-context behavior", async () => {
    const measured = await estimateToolSchemaTokens({
      dynamic: tool({
        description: ({ context }) => context?.label ?? "default description",
        inputSchema: z.object({}),
      }),
    }, ["dynamic"]);

    const fixed = await estimateToolSchemaTokens({
      dynamic: tool({ description: "default description", inputSchema: z.object({}) }),
    }, ["dynamic"]);
    expect(measured).toBe(fixed);
  });

  it("prices provider-defined tool ids and arguments", async () => {
    const small = await estimateToolSchemaTokens({ search: {
      type: "provider", id: "openai.web_search", args: { depth: "low" },
    } as never }, ["search"]);
    const large = await estimateToolSchemaTokens({ search: {
      type: "provider", id: "openai.web_search", args: { depth: "high", domains: ["example.com", "example.org"] },
    } as never }, ["search"]);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
  });

  it("prices the SDK-prepared definitions without re-invoking dynamic descriptions", () => {
    let calls = 0;
    const definitions = [{ type: "function", name: "dynamic", description: `description-${++calls}`, inputSchema: {} }];
    const measured = estimatePreparedToolSchemaTokens(definitions);
    expect(calls).toBe(1);
    expect(measured).toBeGreaterThan(0);
  });

  it("rejects a non-finite envelope value instead of producing misleading calibration data", () => {
    expect(() => measureRequest({ replay, messages: [{ role: "user", content: "x" }], instructions: "stable",
      toolSchemaTokens: 1, envelopeReserveTokens: Number.NaN })).toThrow("envelopeReserveTokens is not finite");
  });

  it("does not emit a usage sample when prepared schema measurement fails", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const reports: unknown[] = [];
    fireUsageReport({ onUsage: (report) => reports.push(report) }, {
      usage: Promise.resolve({ inputTokens: 10, outputTokens: 2 }), instructions: "stable", outgoing: [], tools: {},
      toolOrder: [], preparedTools: [circular], replay,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(reports).toEqual([]);
  });

  it("counts cache-read tokens toward projected pressure even when total usage is absent", () => {
    const measured = measureRequest({ replay, messages: [], instructions: "x", toolSchemaTokens: 0,
      envelopeReserveTokens: 0, cacheReadTokens: 500 });
    expect(measured.projectedInputTokens).toBeGreaterThanOrEqual(500);
    expect(measured.cacheReadTokens).toBe(500);
  });

  it("falls back to the local envelope estimate for a zero provider sample", () => {
    const estimated = measureRequest({ replay, messages: [{ role: "user", content: "x" }], instructions: "stable",
      toolSchemaTokens: 1, envelopeReserveTokens: 0 });
    const zero = measureRequest({ replay, messages: [{ role: "user", content: "x" }], instructions: "stable",
      toolSchemaTokens: 1, envelopeReserveTokens: 0, providerInputTokens: 0 });
    expect(zero.projectedInputTokens).toBe(estimated.projectedInputTokens);
    expect(zero.accountingQuality).toBe("estimated");
  });

  it("uses a positive provider input sample as the complete-envelope calibration anchor", () => {
    const measured = measureRequest({ replay, messages: [{ role: "user", content: "x" }], instructions: "stable",
      toolSchemaTokens: 1, envelopeReserveTokens: 0, providerInputTokens: 900 });
    expect(measured.projectedInputTokens).toBe(900);
    expect(measured.accountingQuality).toBe("provider");
  });
});
