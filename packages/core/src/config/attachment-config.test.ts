import { describe, expect, it } from "vitest";
import { loadAttachmentConfig } from "./attachment-config.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("loadAttachmentConfig", () => {
  it("defaults to 14 days when unset", () => {
    expect(loadAttachmentConfig({})).toEqual({ ttlDays: 14, ttlMs: 14 * DAY_MS });
  });

  it("honors a positive integer override", () => {
    expect(loadAttachmentConfig({ TAKI_ATTACHMENT_TTL_DAYS: "7" })).toEqual({ ttlDays: 7, ttlMs: 7 * DAY_MS });
  });

  it.each(["0", "-3", "abc", "3.5"])("throws at boot on garbage/zero/negative: %s (fail-closed)", (value) => {
    expect(() => loadAttachmentConfig({ TAKI_ATTACHMENT_TTL_DAYS: value })).toThrow(/TAKI_ATTACHMENT_TTL_DAYS/);
  });
});
