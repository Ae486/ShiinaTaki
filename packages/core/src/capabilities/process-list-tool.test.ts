import { describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { brokerReturning, fakeNode, registryReturning } from "../testing/capability-tool-harness.ts";
import type { CapabilityBroker } from "./capability-broker.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import { createProcessListTool } from "./process-list-tool.ts";

const EXEC_OPTS = { toolCallId: "c1", messages: [] } as never;
const SNAPSHOT = {
  processes: [{ pid: 1, name: "init", parentPid: null, memoryBytes: 5_000_000_000, startTime: 1_720_000_000 }],
  count: 1,
};

function toolWith(registry: ConnectionRegistry, broker: CapabilityBroker) {
  const { logger } = createCaptureLogger();
  return createProcessListTool({ registry, broker, logger });
}

describe("createProcessListTool", () => {
  it("routes and shapes the snapshot Value into { ok, processes, count } (T4)", async () => {
    const tools = toolWith(registryReturning(fakeNode("process-list")), brokerReturning({ ok: true, output: SNAPSHOT }));
    expect(await tools.process_list?.execute?.({}, EXEC_OPTS)).toEqual({
      ok: true,
      processes: SNAPSHOT.processes,
      count: 1,
    });
  });

  it("returns NO_NODE when no capable device is connected (T7)", async () => {
    const tools = toolWith(registryReturning(undefined), brokerReturning({ ok: true, output: SNAPSHOT }));
    expect(await tools.process_list?.execute?.({}, EXEC_OPTS)).toMatchObject({ ok: false, code: "NO_NODE" });
  });

  it("passes a Shell DENIED failure through to the model (T7)", async () => {
    const tools = toolWith(
      registryReturning(fakeNode("process-list")),
      brokerReturning({ ok: false, code: "DENIED", message: "denied" }),
    );
    expect(await tools.process_list?.execute?.({}, EXEC_OPTS)).toEqual({ ok: false, code: "DENIED", message: "denied" });
  });

  it("degrades a malformed payload into a structured error — never throws (T7)", async () => {
    const tools = toolWith(registryReturning(fakeNode("process-list")), brokerReturning({ ok: true, output: { nope: 1 } }));
    expect(await tools.process_list?.execute?.({}, EXEC_OPTS)).toMatchObject({ ok: false, code: "INTERNAL_ERROR" });
  });
});
