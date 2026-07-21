import { describe, expect, it } from "vitest";
import type { ScreenshotOutput } from "@taki/shared";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import type { CapabilityBroker, CapabilityOutcome } from "./capability-broker.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import type { SavedScreenshot, ScreenshotStore } from "./screenshot-store.ts";
import { createScreenshotTool } from "./screenshot-tool.ts";

const OUTPUT: ScreenshotOutput = { mediaType: "image/png", dataBase64: "AAAA", width: 1920, height: 1080 };
const EXEC_OPTS = { toolCallId: "c1", messages: [] } as never;

function nodeConnection() {
  return { state: { status: "authenticated", deviceId: "n1", role: "node", capabilities: ["screenshot"] }, notify: () => undefined } as never;
}

function registryReturning(node: unknown): ConnectionRegistry {
  return {
    create: () => ({ state: { status: "awaiting" } }),
    authenticate: () => undefined,
    remove: () => undefined,
    list: () => [],
    findNodeForCapability: () => node as never,
    onRemove: () => undefined,
  };
}

function brokerReturning(outcome: CapabilityOutcome): CapabilityBroker {
  return {
    request: () => Promise.resolve(outcome),
    resolve: () => ({ accepted: false }),
    denyAll: () => undefined,
  };
}

function store(onSave: () => SavedScreenshot): ScreenshotStore {
  return { save: onSave };
}

function toolWith(deps: {
  registry: ConnectionRegistry;
  broker: CapabilityBroker;
  store: ScreenshotStore;
  describe?: (input: { dataBase64: string; mediaType: string; prompt?: string }) => Promise<string | null>;
}) {
  const { logger } = createCaptureLogger();
  return createScreenshotTool({ ...deps, logger });
}

describe("createScreenshotTool", () => {
  it("routes, persists the output and returns { ok, path, width, height, bytes } (T8)", async () => {
    const tools = toolWith({
      registry: registryReturning(nodeConnection()),
      broker: brokerReturning({ ok: true, output: OUTPUT }),
      store: store(() => ({ path: "C:/ws/screenshots/x.png", bytes: 42 })),
    });
    const result = await tools.screenshot?.execute?.({}, EXEC_OPTS);
    expect(result).toEqual({ ok: true, path: "C:/ws/screenshots/x.png", width: 1920, height: 1080, bytes: 42 });
  });

  it("returns NO_NODE when no capable device is connected (T9)", async () => {
    const tools = toolWith({
      registry: registryReturning(undefined),
      broker: brokerReturning({ ok: true, output: OUTPUT }),
      store: store(() => ({ path: "x", bytes: 0 })),
    });
    expect(await tools.screenshot?.execute?.({}, EXEC_OPTS)).toMatchObject({ ok: false, code: "NO_NODE" });
  });

  it("passes a shell DENIED failure through to the model (T9 denied passthrough)", async () => {
    const tools = toolWith({
      registry: registryReturning(nodeConnection()),
      broker: brokerReturning({ ok: false, code: "DENIED", message: "user denied" }),
      store: store(() => ({ path: "x", bytes: 0 })),
    });
    expect(await tools.screenshot?.execute?.({}, EXEC_OPTS)).toEqual({ ok: false, code: "DENIED", message: "user denied" });
  });

  it("never throws even when persistence fails — degrades to a structured error (T10)", async () => {
    const tools = toolWith({
      registry: registryReturning(nodeConnection()),
      broker: brokerReturning({ ok: true, output: OUTPUT }),
      store: store(() => {
        throw new Error("disk full");
      }),
    });
    const result = await tools.screenshot?.execute?.({}, EXEC_OPTS);
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR", message: "disk full" });
  });

  it("includes the VLM description in the result when a describe bridge is wired", async () => {
    const tools = toolWith({
      registry: registryReturning(nodeConnection()),
      broker: brokerReturning({ ok: true, output: OUTPUT }),
      store: store(() => ({ path: "x.png", bytes: 42 })),
      describe: (input) => Promise.resolve(`screen shows ${input.mediaType} of ${input.dataBase64.length} chars`),
    });
    const result = await tools.screenshot?.execute?.({}, EXEC_OPTS);
    expect(result).toEqual({
      ok: true,
      path: "x.png",
      width: 1920,
      height: 1080,
      bytes: 42,
      description: "screen shows image/png of 4 chars",
    });
  });

  it("omits description (plain result) when the bridge degrades to null", async () => {
    const tools = toolWith({
      registry: registryReturning(nodeConnection()),
      broker: brokerReturning({ ok: true, output: OUTPUT }),
      store: store(() => ({ path: "x.png", bytes: 42 })),
      describe: () => Promise.resolve(null),
    });
    const result = await tools.screenshot?.execute?.({}, EXEC_OPTS);
    expect(result).toEqual({ ok: true, path: "x.png", width: 1920, height: 1080, bytes: 42 });
  });

  it("threads describePrompt from the tool input into the describe bridge (T2b item 6)", async () => {
    const seen: Array<{ dataBase64: string; mediaType: string; prompt?: string }> = [];
    const tools = toolWith({
      registry: registryReturning(nodeConnection()),
      broker: brokerReturning({ ok: true, output: OUTPUT }),
      store: store(() => ({ path: "x.png", bytes: 42 })),
      describe: (input) => {
        seen.push(input);
        return Promise.resolve("focused description");
      },
    });
    const result = await tools.screenshot?.execute?.({ describePrompt: "the error dialog" }, EXEC_OPTS);
    expect(seen[0]?.prompt).toBe("the error dialog");
    expect(result).toMatchObject({ ok: true, description: "focused description" });
  });

  it("calls the describe bridge with no prompt when describePrompt is absent (default path unchanged)", async () => {
    const seen: Array<{ dataBase64: string; mediaType: string; prompt?: string }> = [];
    const tools = toolWith({
      registry: registryReturning(nodeConnection()),
      broker: brokerReturning({ ok: true, output: OUTPUT }),
      store: store(() => ({ path: "x.png", bytes: 42 })),
      describe: (input) => {
        seen.push(input);
        return Promise.resolve("plain description");
      },
    });
    const result = await tools.screenshot?.execute?.({}, EXEC_OPTS);
    expect(seen[0]?.prompt).toBeUndefined();
    expect(result).toEqual({ ok: true, path: "x.png", width: 1920, height: 1080, bytes: 42, description: "plain description" });
  });
});
