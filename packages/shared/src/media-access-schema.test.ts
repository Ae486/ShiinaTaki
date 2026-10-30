import { describe, expect, it } from "vitest";
import { MediaAccessProbeResultSchema } from "./media-access-schema.ts";

const proof = {
  schema_version: "bilinote.media-access.v1",
  service_instance_id: "11111111-1111-4111-8111-111111111111",
  source: { platform: "bilibili", bvid: "BV1BTP5euE75", cid: "28581954126", page: 1,
    canonical_url: "https://www.bilibili.com/video/BV1BTP5euE75?p=1" },
  title: "Video", duration_seconds: null,
  access: { kind: "video_range", byte_length: 1024, checked_at: 1_792_000_000_000 },
};

describe("native media access evidence", () => {
  it("keeps unknown duration and exact resolved part", () => {
    expect(MediaAccessProbeResultSchema.parse(proof)).toEqual(proof);
  });
  it("rejects a readable title without actual bytes, missing identity and mismatched URL", () => {
    for (const changed of [
      { ...proof, access: undefined },
      { ...proof, access: { ...proof.access, byte_length: 0 } },
      { ...proof, source: { ...proof.source, cid: "" } },
      { ...proof, source: { ...proof.source, canonical_url: "https://www.bilibili.com/video/BV1BTP5euE75?p=2" } },
      { ...proof, duration_seconds: Number.POSITIVE_INFINITY },
      { ...proof, cookie: "must not be disclosed" },
    ]) expect(MediaAccessProbeResultSchema.safeParse(changed).success).toBe(false);
  });
});
