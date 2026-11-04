import { describe, expect, it } from "vitest";
import { loadAmbientScreenshotConfig } from "./ambient-screenshot-config.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("loadAmbientScreenshotConfig", () => {
  it("is OFF with drop-after-consumption retention by default (the conservative factory posture)", () => {
    expect(loadAmbientScreenshotConfig({})).toEqual({ enabled: false, retention: { mode: "drop-after-consumption" } });
  });

  it("accepts only explicit true/1 as an enable", () => {
    for (const value of ["1", "true", "TRUE", " True "]) {
      expect(loadAmbientScreenshotConfig({ TAKI_AMBIENT_SCREENSHOT: value }).enabled).toBe(true);
    }
    for (const value of ["0", "false", ""]) {
      expect(loadAmbientScreenshotConfig({ TAKI_AMBIENT_SCREENSHOT: value }).enabled).toBe(false);
    }
    // A typo must be fatal at boot, never a silent posture — this flag decides whether the screen is watched.
    expect(() => loadAmbientScreenshotConfig({ TAKI_AMBIENT_SCREENSHOT: "yes" })).toThrow();
  });

  it("parses the three retention shapes", () => {
    expect(loadAmbientScreenshotConfig({ TAKI_AMBIENT_SCREENSHOT_RETENTION: "keep" }).retention).toEqual({ mode: "keep" });
    expect(loadAmbientScreenshotConfig({ TAKI_AMBIENT_SCREENSHOT_RETENTION: "drop" }).retention).toEqual({
      mode: "drop-after-consumption",
    });
    expect(loadAmbientScreenshotConfig({ TAKI_AMBIENT_SCREENSHOT_RETENTION: "7" }).retention).toEqual({
      mode: "delete-after-days",
      days: 7,
      ttlMs: 7 * DAY_MS,
    });
  });

  it("fails the boot on a garbage retention rather than silently disabling expiry", () => {
    for (const value of ["0", "-1", "3.5", "forever"]) {
      expect(() => loadAmbientScreenshotConfig({ TAKI_AMBIENT_SCREENSHOT_RETENTION: value })).toThrow(
        /TAKI_AMBIENT_SCREENSHOT_RETENTION/,
      );
    }
  });
});
