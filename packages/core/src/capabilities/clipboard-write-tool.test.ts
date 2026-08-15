import { describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { testGovernance, testApproval } from "../testing/capability-tool-harness.ts";
import {
  TEST_HOST_ID,
  brokerCapturing,
  brokerReturning,
  catalogsReturning,
  fakeHost,
  registryReturning,
} from "../testing/capability-tool-harness.ts";
import type { CapabilityBroker } from "./capability-broker.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import { createClipboardWriteTool } from "./clipboard-write-tool.ts";

const EXEC_OPTS = { toolCallId: "c1", messages: [] } as never;

function toolWith(registry: ConnectionRegistry, broker: CapabilityBroker) {
  const { logger } = createCaptureLogger();
  return createClipboardWriteTool({ registry, catalogs: catalogsReturning("clipboard-write", { execution: "effect", cancellation: "non-cooperative" }), broker, logger, governance: testGovernance(), approval: testApproval() });
}

describe("createClipboardWriteTool (T5)", () => {
  it("passes the text to the node and acks { ok:true }", async () => {
    const { broker, sent } = brokerCapturing({ ok: true, output: { ok: true } });
    const tools = toolWith(registryReturning(fakeHost("clipboard-write")), broker);
    expect(await tools.clipboard_write?.execute?.({ text: "paste me" }, EXEC_OPTS)).toEqual({ ok: true });
    expect(sent).toEqual({
      capability: "clipboard-write",
      input: { text: "paste me" },
      hostId: TEST_HOST_ID,
    });
  });

  it("passes a Shell failure through and never throws (T7)", async () => {
    const tools = toolWith(
      registryReturning(fakeHost("clipboard-write")),
      brokerReturning({ ok: false, code: "DENIED", message: "denied" }),
    );
    expect(await tools.clipboard_write?.execute?.({ text: "x" }, EXEC_OPTS)).toEqual({
      ok: false,
      code: "DENIED",
      message: "denied",
    });
  });
});
