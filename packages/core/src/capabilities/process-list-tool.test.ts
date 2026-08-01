import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { brokerReturning, fakeNode, registryReturning } from "../testing/capability-tool-harness.ts";
import { createCompanionFixture } from "../testing/companion-fixture.ts";
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

afterEach(() => {
  vi.useRealTimers();
});

describe("createProcessListTool", () => {
  it("routes and shapes the snapshot Value into { ok, processes, count, capturedAt } (T4/Q5)", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-01T10:00:00.000Z") });
    const tools = toolWith(registryReturning(fakeNode("process-list")), brokerReturning({ ok: true, output: SNAPSHOT }));
    expect(await tools.process_list?.execute?.({}, EXEC_OPTS)).toEqual({
      ok: true,
      processes: SNAPSHOT.processes,
      count: 1,
      capturedAt: "2026-08-01T10:00:00.000Z",
    });
  });

  it("stamps capturedAt at EACH execute — two calls carry two stamps (Q5)", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-01T10:00:00.000Z") });
    const tools = toolWith(registryReturning(fakeNode("process-list")), brokerReturning({ ok: true, output: SNAPSHOT }));

    const first = (await tools.process_list?.execute?.({}, EXEC_OPTS)) as { capturedAt: string };
    vi.setSystemTime(new Date("2026-08-01T10:05:00.000Z"));
    const second = (await tools.process_list?.execute?.({}, EXEC_OPTS)) as { capturedAt: string };

    expect(first.capturedAt).toBe("2026-08-01T10:00:00.000Z");
    expect(second.capturedAt).toBe("2026-08-01T10:05:00.000Z");
  });

  it("capturedAt survives the timeline replay byte-stable (Q5 — the state-snapshot family's persistence contract)", async () => {
    const f = createCompanionFixture();
    try {
      const result = { ok: true, processes: SNAPSHOT.processes, count: 1, capturedAt: "2026-08-01T10:00:00.000Z" };
      f.conversation.appendTurn("taki", [
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "process_list", input: {} }] },
        { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "process_list", output: { type: "json", value: result } }] },
      ]);

      const toolMessage = f.conversation.history("taki").find((message) => message.role === "tool");
      const output = (toolMessage?.content[0] as unknown as { output: { value: { capturedAt: string } } }).output;
      // Byte-stable: the stamp is DATA inside the persisted result, never recomputed at replay time.
      expect(output.value.capturedAt).toBe("2026-08-01T10:00:00.000Z");
    } finally {
      f.cleanup();
    }
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
