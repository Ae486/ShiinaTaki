import { describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { brokerCapturing, brokerReturning, fakeNode, registryReturning } from "../testing/capability-tool-harness.ts";
import type { CapabilityBroker } from "./capability-broker.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import { createShellOpenTool } from "./shell-open-tool.ts";

const EXEC_OPTS = { toolCallId: "c1", messages: [] } as never;

function toolWith(registry: ConnectionRegistry, broker: CapabilityBroker) {
  const { logger } = createCaptureLogger();
  return createShellOpenTool({ registry, broker, logger });
}

describe("createShellOpenTool (T6)", () => {
  it("passes kind+target to the node and echoes the opened target", async () => {
    const { broker, sent } = brokerCapturing({ ok: true, output: { ok: true, opened: "https://example.com" } });
    const tools = toolWith(registryReturning(fakeNode("shell-open")), broker);
    const result = await tools.shell_open?.execute?.({ kind: "url", target: "https://example.com" }, EXEC_OPTS);
    expect(result).toEqual({ ok: true, opened: "https://example.com" });
    expect(sent).toEqual({ capability: "shell-open", input: { kind: "url", target: "https://example.com" } });
  });

  it("passes a Shell EXEC_FAILED (e.g. unsupported scheme) through and never throws (T7)", async () => {
    const tools = toolWith(
      registryReturning(fakeNode("shell-open")),
      brokerReturning({ ok: false, code: "EXEC_FAILED", message: "unsupported url scheme" }),
    );
    expect(await tools.shell_open?.execute?.({ kind: "url", target: "javascript:1" }, EXEC_OPTS)).toEqual({
      ok: false,
      code: "EXEC_FAILED",
      message: "unsupported url scheme",
    });
  });
});
