import { afterEach, describe, expect, it, vi } from "vitest";
import { HINDSIGHT_CONFIGURATION_METHODS, TIMING_POLICY_DEVELOPMENT_DEFAULTS } from "@taki/shared";
import { configurationObservationFixture } from "../../../../packages/core/src/testing/hindsight-configuration-fixture.ts";
import { createWsClient } from "./ws-client.ts";
import { rpcMethodPolicy } from "./rpc-deadline.ts";
import { createTimingPolicyStore } from "./timing-policy.ts";

const owned: Array<() => void> = [];
afterEach(() => { for (const dispose of owned.splice(0)) dispose(); vi.useRealTimers(); });
function fixture() {
  const core = configurationObservationFixture(); owned.push(() => core.service.dispose());
  const sent: Array<{ id: string | number; method: string; params: unknown }> = [];
  const handlers: Array<(value: string) => void> = [];
  const client = createWsClient({ transport: { send: (payload) => sent.push(JSON.parse(payload)), close: () => undefined,
    onMessage: (handler) => handlers.push(handler), onOpen: () => undefined, onClose: () => undefined },
  timingPolicy: createTimingPolicyStore({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, interactiveRpcMs: 1000 }), onTimingPolicyDiagnostic: () => undefined });
  owned.push(() => client.close());
  const reply = (result: unknown) => handlers.forEach((handler) => handler(JSON.stringify({ jsonrpc: "2.0", id: sent.at(-1)!.id, result })));
  return { core, client, sent, reply };
}

describe("configuration methods through actual WsClient", () => {
  it("sends only the selected scope and validates actual Core status/observation responses", async () => {
    const f = fixture(); const params = { scope: { kind: "character" as const, characterId: "taki" } };
    const status = f.client.hindsightConfigurationStatus(params); f.reply(f.core.service.status(params));
    expect((await status).status).toBe("not_observed");
    const observe = f.client.hindsightConfigurationObserve(params); f.reply(await f.core.service.observe(params));
    expect((await observe).status).toBe("observed");
    expect(f.sent.map(({ method, params: input }) => ({ method, input }))).toEqual([
      { method: HINDSIGHT_CONFIGURATION_METHODS.status, input: params }, { method: HINDSIGHT_CONFIGURATION_METHODS.observe, input: params },
    ]);
  });

  it("rejects additional wire fields and invalid outgoing scopes", async () => {
    const f = fixture(); const params = { scope: { kind: "global" as const } };
    const status = f.client.hindsightConfigurationStatus(params);
    const assertion = expect(status).rejects.toThrow();
    f.reply({ ...f.core.service.status(params), rawSecret: "SENTINEL" }); await assertion;
    await expect(f.client.hindsightConfigurationObserve({ scope: { kind: "character", characterId: "" } })).rejects.toThrow();
    expect(f.sent).toHaveLength(1);
  });

  it("uses bounded read-only deadlines for both methods, with no automatic retry", async () => {
    vi.useFakeTimers(); const f = fixture();
    for (const method of Object.values(HINDSIGHT_CONFIGURATION_METHODS)) expect(rpcMethodPolicy(method)).toMatchObject({ class: "interactive", timeoutOutcome: "read-only" });
    const result = f.client.hindsightConfigurationObserve({ scope: { kind: "global" } });
    const assertion = expect(result).rejects.toMatchObject({ name: "RpcDeadlineExceededError", outcomeUnknown: false });
    await vi.advanceTimersByTimeAsync(1000); await assertion; expect(f.sent).toHaveLength(1);
  });
});
