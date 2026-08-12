import { describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { brokerReturning, catalogsReturning, fakeHost, registryReturning } from "../testing/capability-tool-harness.ts";
import type { CapabilityBroker } from "./capability-broker.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import { createClipboardReadTool } from "./clipboard-read-tool.ts";

const EXEC_OPTS = { toolCallId: "c1", messages: [] } as never;

function toolWith(registry: ConnectionRegistry, broker: CapabilityBroker) {
  const { logger } = createCaptureLogger();
  return createClipboardReadTool({ registry, catalogs: catalogsReturning("clipboard-read"), broker, logger });
}

describe("createClipboardReadTool (T5)", () => {
  it("returns the clipboard text with its capture stamp (Q5)", async () => {
    const tools = toolWith(registryReturning(fakeHost("clipboard-read")), brokerReturning({ ok: true, output: { text: "hi" } }));
    const result = (await tools.clipboard_read?.execute?.({}, EXEC_OPTS)) as { ok: boolean; text: string; capturedAt: string };
    expect(result).toMatchObject({ ok: true, text: "hi" });
    expect(Number.isNaN(Date.parse(result.capturedAt))).toBe(false); // ISO stamp, stamped at execute (Q5)
  });

  it("returns an empty string for an empty clipboard (ruling 6)", async () => {
    const tools = toolWith(registryReturning(fakeHost("clipboard-read")), brokerReturning({ ok: true, output: { text: "" } }));
    expect(await tools.clipboard_read?.execute?.({}, EXEC_OPTS)).toMatchObject({ ok: true, text: "" });
  });

  it("passes a Shell failure through and never throws (T7)", async () => {
    const tools = toolWith(
      registryReturning(fakeHost("clipboard-read")),
      brokerReturning({ ok: false, code: "EXEC_FAILED", message: "occupied" }),
    );
    expect(await tools.clipboard_read?.execute?.({}, EXEC_OPTS)).toEqual({
      ok: false,
      code: "EXEC_FAILED",
      message: "occupied",
    });
  });
});
