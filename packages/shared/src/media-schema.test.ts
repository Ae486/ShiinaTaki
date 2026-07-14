import { describe, expect, it } from "vitest";
import {
  MEDIA_METHODS,
  MediaClearParamsSchema,
  MediaClearResultSchema,
  MediaGetParamsSchema,
  MediaGetResultSchema,
  MediaUsageParamsSchema,
  MediaUsageResultSchema,
} from "./media-schema.ts";

describe("MEDIA_METHODS", () => {
  it("names the three media methods", () => {
    expect(MEDIA_METHODS).toEqual({ get: "media.get", clear: "media.clear", usage: "media.usage" });
  });
});

describe("media.get schemas (T3)", () => {
  it("round-trips get params + result", () => {
    expect(MediaGetParamsSchema.parse({ ref: "attachments/abc.png" })).toEqual({ ref: "attachments/abc.png" });
    const result = { mediaType: "image/webp" as const, dataBase64: "aGk=" };
    expect(MediaGetResultSchema.parse(result)).toEqual(result);
  });

  it("rejects an empty ref and an unsupported result media type", () => {
    expect(MediaGetParamsSchema.safeParse({ ref: "" }).success).toBe(false);
    expect(MediaGetResultSchema.safeParse({ mediaType: "image/svg+xml", dataBase64: "aGk=" }).success).toBe(false);
    expect(MediaGetResultSchema.safeParse({ mediaType: "image/png", dataBase64: "" }).success).toBe(false);
  });
});

describe("media.clear schemas", () => {
  it("round-trips clear params + result", () => {
    expect(MediaClearParamsSchema.parse({})).toEqual({});
    expect(MediaClearResultSchema.parse({ removedCount: 3, freedBytes: 1024 })).toEqual({ removedCount: 3, freedBytes: 1024 });
  });

  it("rejects negative or non-integer counts", () => {
    expect(MediaClearResultSchema.safeParse({ removedCount: -1, freedBytes: 0 }).success).toBe(false);
    expect(MediaClearResultSchema.safeParse({ removedCount: 1.5, freedBytes: 0 }).success).toBe(false);
  });
});

describe("media.usage schemas (D27, reserved for M5)", () => {
  it("round-trips usage params + result", () => {
    expect(MediaUsageParamsSchema.parse({})).toEqual({});
    const usage = { attachmentCount: 2, attachmentBytes: 4096, memoryTextBytes: 128 };
    expect(MediaUsageResultSchema.parse(usage)).toEqual(usage);
  });

  it("rejects a negative byte total", () => {
    expect(MediaUsageResultSchema.safeParse({ attachmentCount: 0, attachmentBytes: -1, memoryTextBytes: 0 }).success).toBe(false);
  });
});
