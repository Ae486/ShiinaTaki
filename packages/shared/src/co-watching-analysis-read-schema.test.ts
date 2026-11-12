import { describe, expect, it } from "vitest";
import { CoWatchingAnalysisReadParamsSchema, CoWatchingAnalysisReadResultSchema } from "./co-watching-analysis-read-schema.ts";

describe("ordinary registered-analysis reads", () => {
  it("defaults to the first analysis page and rejects invalid selection fields", () => {
    const analysisId = "11111111-1111-4111-8111-111111111111";
    expect(CoWatchingAnalysisReadParamsSchema.parse({ analysisId })).toEqual({ analysisId, view: "analysis", offset: 0 });
    for (const extra of [{ offset: -1 }, { offset: 0.1 }, { view: "start" }, { requestId: analysisId }]) {
      expect(CoWatchingAnalysisReadParamsSchema.safeParse({ analysisId, ...extra }).success).toBe(false);
    }
  });
  it("keeps failed reads separate from empty content and rejects unknown failure states", () => {
    expect(CoWatchingAnalysisReadResultSchema.parse({ ok: false, reason: "reference_changed", message: "Select again" }))
      .toEqual({ ok: false, reason: "reference_changed", message: "Select again" });
    expect(CoWatchingAnalysisReadResultSchema.safeParse({ ok: true, content: "" }).success).toBe(false);
    expect(CoWatchingAnalysisReadResultSchema.safeParse({ ok: false, reason: "analysis_queued", message: "Unexpected work" }).success).toBe(false);
  });
});
