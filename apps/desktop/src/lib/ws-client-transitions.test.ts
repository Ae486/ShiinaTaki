import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIMING_POLICY_DEVELOPMENT_DEFAULTS } from "@taki/shared";
import { createTransitionOperatorFixture } from "../../../../packages/core/src/testing/memory-transition-operator-fixtures.ts";
import { W3_AT } from "../../../../packages/core/src/testing/memory-transition-candidate-fixtures.ts";
import { createWsClient } from "./ws-client.ts";
import { createBrowserTransport } from "./ws-transport.ts";
import { createTimingPolicyStore } from "./timing-policy.ts";
import { createMemoryTransitionsController, INITIAL_TRANSITIONS } from "../windows/home/pages/operations/memory-transitions-controller.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("actual authenticated WS transition client", () => {
  it("uses real producers, recovers a lost acknowledgement on a second observer and never replays", async () => {
    const fixture = await createTransitionOperatorFixture();
    const clients: ReturnType<typeof createWsClient>[] = [];
    const open = async () => {
      const client = createWsClient({ transport: createBrowserTransport(fixture.url),
        timingPolicy: createTimingPolicyStore({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, longRpcMs: 1000, interactiveRpcMs: 5000 }),
        onTimingPolicyDiagnostic: () => undefined });
      clients.push(client);
      expect((await client.connect({ deviceId: crypto.randomUUID(), deviceName: "owned W7", role: "operator", capabilities: [] })).ok).toBe(true);
      return client;
    };
    let state = INITIAL_TRANSITIONS;
    const controller = createMemoryTransitionsController((next) => { state = next; });
    try {
      const first = await open(); const second = await open();
      const changed: string[] = []; second.onMemoryOperationChanged((op) => changed.push(op.state)); await second.subscribeMemoryOperations();
      controller.replace(first); await vi.waitFor(() => expect(state.loading).toBe(false));
      expect(state.error).toBeNull();
      expect(state.status?.actions.find((action) => action.kind === "transition.return-local")?.allowed).toBe(true);
      fixture.control.previewDelayMs = 1800;
      await controller.preview("transition.return-local"); expect(state.previewError).toContain("读取超时");
      expect(fixture.control.submits).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 1000)); expect(state.preview).toBeNull();
      fixture.control.previewDelayMs = 0; fixture.control.submitDelayMs = 1800;
      fixture.control.holdBinding = true;
      await controller.preview("transition.return-local"); expect(state.preview).not.toBeNull();
      await Promise.all([controller.confirm(), controller.confirm()]);
      expect(fixture.control.submits).toBe(1);
      expect(fixture.service.overview().entries[0]?.operation.state).toBe("running");
      first.close(); controller.replace(second);
      fixture.releaseBinding();
      await fixture.owner.stop(); await controller.refresh();
      await vi.waitFor(() => { expect(state.status?.provider).toBe("local"); expect(state.status?.entries[0]?.operation.state).toBe("completed"); });
      const original = state.status!.entries[0]!.operation;
      expect(original.state).toBe("completed");
      expect(changed).toContain("running"); expect(changed).toContain("completed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      controller.replace(null); controller.replace(second); await controller.refresh();
      expect(state.status?.entries[0]?.operation.operationId).toBe(original.operationId);
      expect(fixture.control.submits).toBe(1);
    } finally { controller.dispose(); clients.forEach((client) => client.close()); await fixture.close(); }
  }, 30_000);
});
