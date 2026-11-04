import { describe, expect, it, vi } from "vitest";
import type { ScreenshotOutput } from "@taki/shared";
import { nativeToolImages } from "../agents/native-tool-images.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { brokerReturning, catalogsReturning, fakeHost, registryReturning, testGovernance, testApproval } from "../testing/capability-tool-harness.ts";
import { createPrivacyPause } from "../perception/privacy-pause.ts";
import type { CapabilityBroker } from "./capability-broker.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import type { ScreenshotStore } from "./screenshot-store.ts";
import { createScreenshotTool } from "./screenshot-tool.ts";

const OUTPUT: ScreenshotOutput = { mediaType: "image/png", dataBase64: "AAAA", width: 1920, height: 1080 };
const EXEC_OPTS = { toolCallId: "c1", messages: [] } as never;
function toolWith(deps: { registry: ConnectionRegistry; broker: CapabilityBroker; store: ScreenshotStore }) {
  const { logger } = createCaptureLogger();
  return createScreenshotTool({ ...deps, attachments: { save: () => ({ ref: `attachments/${"a".repeat(64)}.png`, bytes: 3 }) },
    catalogs: catalogsReturning("screenshot"), logger, governance: testGovernance(), approval: testApproval() });
}
function successfulDeps() {
  return { registry: registryReturning(fakeHost("screenshot")), broker: brokerReturning({ ok: true, output: OUTPUT }),
    store: { save: vi.fn(() => ({ path: "C:/ws/screenshots/x.png", bytes: 42 })) } };
}

describe("native screenshot capture", () => {
  it("retains faithful capture status and native evidence while keeping bytes out of the JSON tool result", async () => {
    const deps = successfulDeps();
    const tools = toolWith(deps);
    const result = await tools.screenshot?.execute?.({}, EXEC_OPTS);
    expect(result).toMatchObject({ ok: true, path: "C:/ws/screenshots/x.png", width: 1920, height: 1080, bytes: 42 });
    expect(nativeToolImages(result)?.images).toEqual([OUTPUT].map(({ mediaType, dataBase64 }) => ({ mediaType, dataBase64 })));
    expect(nativeToolImages(result)?.refs[0]?.ref).toMatch(/^attachments\//);
    expect(JSON.stringify(result)).not.toContain("AAAA");
    expect(result).not.toHaveProperty("description");
    expect(deps.store.save).toHaveBeenCalledTimes(1);
  });

  it("stamps the capture before persistence without a later translator call", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-01T10:00:00.000Z") });
    try {
      const deps = successfulDeps();
      deps.store.save.mockImplementation(() => { vi.setSystemTime(new Date("2026-08-01T10:00:07.000Z")); return { path: "x.png", bytes: 42 }; });
      expect(await toolWith(deps).screenshot?.execute?.({}, EXEC_OPTS)).toMatchObject({ capturedAt: "2026-08-01T10:00:00.000Z" });
    } finally { vi.useRealTimers(); }
  });

  it("returns NO_NODE without creating native evidence or persisting a capture", async () => {
    const deps = { ...successfulDeps(), registry: registryReturning(undefined) };
    const result = await toolWith(deps).screenshot?.execute?.({}, EXEC_OPTS);
    expect(result).toMatchObject({ ok: false, code: "NO_NODE" });
    expect(nativeToolImages(result)).toBeUndefined();
    expect(deps.store.save).not.toHaveBeenCalled();
  });

  it("preserves a denied capture outcome without saving or projecting pixels", async () => {
    const deps = { ...successfulDeps(), broker: brokerReturning({ ok: false, code: "DENIED", message: "user denied" }) };
    const result = await toolWith(deps).screenshot?.execute?.({}, EXEC_OPTS);
    expect(result).toEqual({ ok: false, code: "DENIED", message: "user denied" });
    expect(nativeToolImages(result)).toBeUndefined();
    expect(deps.store.save).not.toHaveBeenCalled();
  });

  it("returns a bounded truthful storage failure without logging private exception data", async () => {
    const deps = successfulDeps();
    deps.store.save.mockImplementation(() => { throw new Error("disk full secret screen text"); });
    expect(await toolWith(deps).screenshot?.execute?.({}, EXEC_OPTS)).toEqual({ ok: false, code: "INTERNAL_ERROR", message: "Screenshot capture or storage failed." });
  });

  it("allows an explicit on-demand ask during ambient Privacy Pause through normal governance", async () => {
    const pause = createPrivacyPause(); pause.pauseUntilResumed();
    expect(pause.isPaused()).toBe(true);
    expect(await toolWith(successfulDeps()).screenshot?.execute?.({}, EXEC_OPTS)).toMatchObject({ ok: true });
  });
});
