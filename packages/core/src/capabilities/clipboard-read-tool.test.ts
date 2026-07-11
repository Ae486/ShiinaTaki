import { describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { brokerReturning, fakeNode, registryReturning } from "../testing/capability-tool-harness.ts";
import type { CapabilityBroker } from "./capability-broker.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import { createClipboardReadTool } from "./clipboard-read-tool.ts";

const EXEC_OPTS = { toolCallId: "c1", messages: [] } as never;

function toolWith(registry: ConnectionRegistry, broker: CapabilityBroker) {
  const { logger } = createCaptureLogger();
  return createClipboardReadTool({ registry, broker, logger });
}

describe("createClipboardReadTool (T5)", () => {
  it("returns the clipboard text", async () => {
    const tools = toolWith(registryReturning(fakeNode("clipboard-read")), brokerReturning({ ok: true, output: { text: "hi" } }));
    expect(await tools.clipboard_read?.execute?.({}, EXEC_OPTS)).toEqual({ ok: true, text: "hi" });
  });

  it("returns an empty string for an empty clipboard (ruling 6)", async () => {
    const tools = toolWith(registryReturning(fakeNode("clipboard-read")), brokerReturning({ ok: true, output: { text: "" } }));
    expect(await tools.clipboard_read?.execute?.({}, EXEC_OPTS)).toEqual({ ok: true, text: "" });
  });

  it("passes a Shell failure through and never throws (T7)", async () => {
    const tools = toolWith(
      registryReturning(fakeNode("clipboard-read")),
      brokerReturning({ ok: false, code: "EXEC_FAILED", message: "occupied" }),
    );
    expect(await tools.clipboard_read?.execute?.({}, EXEC_OPTS)).toEqual({
      ok: false,
      code: "EXEC_FAILED",
      message: "occupied",
    });
  });
});
