import { afterEach, describe, expect, it, vi } from "vitest";
import { EXTENSION_METHODS, JSON_RPC_APP_ERROR, PERCEPTION_METHODS, TIMING_POLICY_DEVELOPMENT_DEFAULTS } from "@taki/shared";
import { createWsClient } from "./ws-client.ts";
import { createTimingPolicyStore } from "./timing-policy.ts";
import { rpcMethodPolicy } from "./rpc-deadline.ts";
import type { WsTransport } from "./ws-transport.ts";

function fixture() {
  const sent: Array<{ id: number; method: string; params: unknown }> = [];
  const frames: Array<(frame: string) => void> = [];
  const closed: Array<() => void> = [];
  const transport: WsTransport = {
    send: (frame) => { sent.push(JSON.parse(frame)); }, close: () => undefined,
    onOpen: () => undefined, onMessage: (handler) => { frames.push(handler); }, onClose: (handler) => { closed.push(handler); },
  };
  const deliver = (value: unknown) => { for (const handler of frames) handler(JSON.stringify(value)); };
  const client = createWsClient({ transport, timingPolicy: createTimingPolicyStore({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, interactiveRpcMs: 10 }) });
  return { client, sent, deliver, closed,
    result: (result: unknown) => deliver({ jsonrpc: "2.0", id: sent.at(-1)?.id, result }),
    error: (code: number, data?: unknown) => deliver({ jsonrpc: "2.0", id: sent.at(-1)?.id, error: { code, message: "setup failed", data } }),
  };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe.each([
  { name: "perception", method: PERCEPTION_METHODS.subscribe, subscribe: "subscribePerception" as const },
  { name: "extension", method: EXTENSION_METHODS.subscribe, subscribe: "subscribeExtensions" as const },
])("$name subscription setup", ({ method, subscribe }) => {
  it("shares pending and successful setup on the physical client", async () => {
    const f = fixture();
    const first = f.client[subscribe]();
    const second = f.client[subscribe]();
    expect(first).toBe(second);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ method, params: {} });
    f.result({ status: "ok" });
    await expect(first).resolves.toBe("supported");
    await expect(f.client[subscribe]()).resolves.toBe("supported");
    expect(f.sent).toHaveLength(1);
    f.client.close();
  });

  it.each(["refusal", "malformed", "timeout"])("retries %s deliberately on the same client without a fallback", async (failure) => {
    vi.useFakeTimers();
    const f = fixture();
    const pending = f.client[subscribe]();
    const failed = expect(pending).rejects.toBeInstanceOf(Error);
    if (failure === "refusal") f.error(JSON_RPC_APP_ERROR, { code: "FORBIDDEN" });
    else if (failure === "malformed") f.result({ status: "ok", extra: true });
    else await vi.advanceTimersByTimeAsync(10);
    await failed;
    expect(f.sent).toHaveLength(1);
    const retry = f.client[subscribe]();
    expect(f.sent).toHaveLength(2);
    f.result({ status: "ok" });
    await expect(retry).resolves.toBe("supported");
    expect(rpcMethodPolicy(method).timeoutOutcome).toBe("read-only");
    f.client.close();
  });

  it("remembers only the exact JSON-RPC unsupported-method outcome", async () => {
    const f = fixture();
    const pending = f.client[subscribe]();
    f.error(-32601);
    await expect(pending).resolves.toBe("unsupported");
    await expect(f.client[subscribe]()).resolves.toBe("unsupported");
    expect(f.sent).toHaveLength(1);
    f.client.close();
  });
});

describe("strict invalidation routes", () => {
  it("validates typed hints, isolates consumers, unsubscribes and retires queued pushes", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = fixture();
    const perception = vi.fn();
    const extension = vi.fn();
    f.client.onPerceptionChanged(() => { throw new Error("observer failed"); });
    const stop = f.client.onPerceptionChanged(perception);
    f.client.onExtensionChanged(extension);
    const push = (method: string, params: unknown) => f.deliver({ jsonrpc: "2.0", method, params });
    push(PERCEPTION_METHODS.changed, { revision: 1 });
    push(EXTENSION_METHODS.changed, { revision: 2, targets: ["mcp", "extension-status"] });
    expect(perception).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
    expect(extension).toHaveBeenCalledExactlyOnceWith({ revision: 2, targets: ["mcp", "extension-status"] });
    for (const params of [{ revision: -1 }, { revision: 2, title: "private" }, { revision: 1.5 }]) push(PERCEPTION_METHODS.changed, params);
    for (const targets of [[], ["mcp", "mcp"], ["unknown"]]) push(EXTENSION_METHODS.changed, { revision: 3, targets });
    expect(perception).toHaveBeenCalledTimes(1);
    expect(extension).toHaveBeenCalledTimes(1);
    stop();
    push(PERCEPTION_METHODS.changed, { revision: 4 });
    f.client.close();
    push(EXTENSION_METHODS.changed, { revision: 5, targets: ["skills"] });
    expect(perception).toHaveBeenCalledTimes(1);
    expect(extension).toHaveBeenCalledTimes(1);
  });
});
