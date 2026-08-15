import { describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import {
  TEST_HOST_ID,
  brokerCapturing,
  brokerReturning,
  catalogsReturning,
  fakeHost,
  registryReturning,
  testGovernance,
  testApproval,
} from "../testing/capability-tool-harness.ts";
import type { CapabilityBroker } from "./capability-broker.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import { createExecTool } from "./exec-tool.ts";

const EXEC_OPTS = { toolCallId: "c1", messages: [] } as never;

function toolWith(registry: ConnectionRegistry, broker: CapabilityBroker) {
  const { logger } = createCaptureLogger();
  return createExecTool({ registry, catalogs: catalogsReturning("exec", { execution: "effect", cancellation: "non-cooperative" }), broker, logger, governance: testGovernance(), approval: testApproval() });
}

const RAN = { exitCode: 0, stdout: "hi\n", stderr: "", truncated: false, timedOut: false, durationMs: 12 };

describe("createExecTool (#12)", () => {
  it("passes the bare command to the node and returns the ExecOutput fields", async () => {
    const { broker, sent } = brokerCapturing({ ok: true, output: RAN });
    const tools = toolWith(registryReturning(fakeHost("exec")), broker);
    const result = await tools.exec?.execute?.({ command: "git status" }, EXEC_OPTS);
    expect(result).toEqual({ ok: true, ...RAN });
    // The Shell parses the one true string; the Core never pre-splits into argv (ruling 16).
    expect(sent).toEqual({
      capability: "exec",
      input: { command: "git status" },
      hostId: TEST_HOST_ID,
    });
  });

  it("surfaces a nonzero exit / timeout as a SUCCESSFUL result, not a tool error (ruling 17)", async () => {
    const timedOut = { exitCode: null, stdout: "", stderr: "", truncated: true, timedOut: true, durationMs: 30000 };
    const tools = toolWith(registryReturning(fakeHost("exec")), brokerReturning({ ok: true, output: timedOut }));
    expect(await tools.exec?.execute?.({ command: "sleep 99" }, EXEC_OPTS)).toEqual({ ok: true, ...timedOut });
  });

  it("passes a Shell DENIED (block / deny-mode / dialog-deny) through and never throws", async () => {
    const tools = toolWith(
      registryReturning(fakeHost("exec")),
      brokerReturning({ ok: false, code: "DENIED", message: "denied" }),
    );
    expect(await tools.exec?.execute?.({ command: "rm -rf /" }, EXEC_OPTS)).toEqual({
      ok: false,
      code: "DENIED",
      message: "denied",
    });
  });
});
