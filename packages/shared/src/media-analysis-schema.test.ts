import { expect, it } from "vitest";
import { MediaAnalysisStartSchema, MediaAnalysisJobSchema, MediaRecommendationStartSchema } from "./media-analysis-schema.ts";

it("requires a bounded explicit request and never supplies a default source, duration or acceptance identity", () => {
  const request = { characterId: "taki", requestId: "00000000-0000-4000-8000-000000000001",
    videoUrl: "https://www.bilibili.com/video/BV1UEaq6qEZt?p=2", instruction: "Explain this part", lifetimeMinutes: 5 };
  expect(MediaAnalysisStartSchema.parse(request)).toEqual(request);
  expect(MediaAnalysisStartSchema.safeParse({ ...request, lifetimeMinutes: 0 }).success).toBe(false);
  expect(MediaAnalysisStartSchema.safeParse({ ...request, requestId: undefined }).success).toBe(false);
  expect(MediaAnalysisStartSchema.safeParse({ ...request, sourceRef: "invented-playback" }).success).toBe(false);
});

it("bounds recommendation selection without a fake instruction or Co-Watching consent", () => {
  const request = { characterId: "taki", requestId: "00000000-0000-4000-8000-000000000001",
    videoUrls: ["https://www.bilibili.com/video/BV1UEaq6qEZt?p=2"], lifetimeMinutes: 5 };
  expect(MediaRecommendationStartSchema.parse(request)).toEqual(request);
  expect(MediaRecommendationStartSchema.safeParse({ ...request, videoUrls: [] }).success).toBe(false);
  expect(MediaRecommendationStartSchema.safeParse({ ...request, videoUrls: Array.from({ length: 4 }, () => request.videoUrls[0]) }).success).toBe(false);
  expect(MediaRecommendationStartSchema.safeParse({ ...request, instruction: "Pretend this is user consent" }).success).toBe(false);
  expect(MediaRecommendationStartSchema.safeParse({ ...request, accepted: true }).success).toBe(false);
});

it("keeps native failure and unknown analysis identity explicit in an accepted view", () => {
  const job = { requestId: "00000000-0000-4000-8000-000000000001", characterId: "taki",
    videoUrl: "https://www.bilibili.com/video/BV1UEaq6qEZt?p=2", status: "failed", reason: "probe_failed",
    runId: "00000000-0000-4000-8000-000000000002", analysisId: null, title: null, expiresAt: "2026-10-17T12:00:00Z" };
  expect(MediaAnalysisJobSchema.parse(job)).toEqual(job);
  expect(MediaAnalysisJobSchema.safeParse({ ...job, status: "ready_to_watch" }).success).toBe(false);
});
