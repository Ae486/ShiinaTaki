import { afterEach, describe, expect, it, vi } from "vitest";
import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import {
  CHARACTER_METHODS,
  CHAT_METHODS,
  CONFIG_METHODS,
  EXTENSION_METHODS,
  MEMORY_AUTHORITY_METHODS,
  MEMORY_METHODS,
  MEMORY_OPERATION_METHODS,
  MEMORY_REPLICA_METHODS,
  MEMORY_TRANSITION_METHODS,
  PERMISSION_METHODS,
  SECRET_METHODS,
  SKILL_METHODS,
  TIMING_POLICY_DEVELOPMENT_DEFAULTS,
} from "@taki/shared";
import { RpcDeadlineExceededError, requestWithDeadline, rpcMethodPolicy } from "./rpc-deadline.ts";

afterEach(() => {
  vi.useRealTimers();
});

function rpcHarness() {
  const sent: unknown[] = [];
  const rpc = new JSONRPCServerAndClient(
    new JSONRPCServer(),
    new JSONRPCClient((payload) => {
      sent.push(payload);
    }),
  );
  return { rpc, sent };
}

describe("RPC deadline method policy", () => {
  it("gives transition preview a bounded read deadline and parameter-sensitive submit an unknown outcome", () => {
    expect(rpcMethodPolicy(MEMORY_TRANSITION_METHODS.preview)).toEqual({ class: "long", timing: "longRpcMs", timeoutOutcome: "read-only" });
    expect(rpcMethodPolicy(MEMORY_TRANSITION_METHODS.status).timeoutOutcome).toBe("read-only");
    expect(rpcMethodPolicy(MEMORY_TRANSITION_METHODS.overview).timeoutOutcome).toBe("read-only");
    expect(rpcMethodPolicy(MEMORY_OPERATION_METHODS.submit, { request: { kind: "transition.emergency-local" } }))
      .toEqual({ class: "long", timing: "longRpcMs", timeoutOutcome: "unknown" });
    expect(rpcMethodPolicy(MEMORY_OPERATION_METHODS.submit, { request: { kind: "replica.sync" } }).class).toBe("interactive");
  });
  it("classifies handshake, chat acknowledgement, long work, reads, and mutations", () => {
    expect(rpcMethodPolicy(CHAT_METHODS.send)).toEqual({ class: "chat-ack", timing: "chatAckMs", timeoutOutcome: "unknown" });
    expect(rpcMethodPolicy(CHARACTER_METHODS.import)).toEqual({ class: "long", timing: "longRpcMs", timeoutOutcome: "unknown" });
    expect(rpcMethodPolicy(MEMORY_METHODS.status)).toEqual({ class: "interactive", timing: "interactiveRpcMs", timeoutOutcome: "read-only" });
    expect(rpcMethodPolicy(CONFIG_METHODS.set).timeoutOutcome).toBe("unknown");
    expect(rpcMethodPolicy(PERMISSION_METHODS.levelGet).timeoutOutcome).toBe("read-only");
    expect(rpcMethodPolicy(PERMISSION_METHODS.cellsGet).timeoutOutcome).toBe("read-only");
    expect(rpcMethodPolicy(PERMISSION_METHODS.levelSet).timeoutOutcome).toBe("unknown");
    expect(rpcMethodPolicy(PERMISSION_METHODS.cellSet).timeoutOutcome).toBe("unknown");
    expect(rpcMethodPolicy(EXTENSION_METHODS.status).timeoutOutcome).toBe("read-only");
    expect(rpcMethodPolicy(SKILL_METHODS.list).timeoutOutcome).toBe("read-only");
    expect(rpcMethodPolicy(SKILL_METHODS.import)).toEqual({ class: "long", timing: "longRpcMs", timeoutOutcome: "unknown" });
    expect(rpcMethodPolicy(MEMORY_AUTHORITY_METHODS.status).timeoutOutcome).toBe("read-only");
    expect(rpcMethodPolicy(MEMORY_OPERATION_METHODS.status).timeoutOutcome).toBe("read-only");
    expect(rpcMethodPolicy(MEMORY_OPERATION_METHODS.list).timeoutOutcome).toBe("read-only");
    expect(rpcMethodPolicy(MEMORY_OPERATION_METHODS.submit)).toEqual({ class: "interactive", timing: "interactiveRpcMs", timeoutOutcome: "unknown" });
    expect(rpcMethodPolicy(MEMORY_OPERATION_METHODS.cancel).timeoutOutcome).toBe("unknown");
    expect(rpcMethodPolicy(MEMORY_REPLICA_METHODS.configure).timeoutOutcome).toBe("unknown");
    expect(rpcMethodPolicy(SECRET_METHODS.set).timeoutOutcome).toBe("unknown");
    expect(rpcMethodPolicy(SECRET_METHODS.clear).timeoutOutcome).toBe("unknown");
    expect(rpcMethodPolicy(SECRET_METHODS.presence).timeoutOutcome).toBe("read-only");
  });
});

describe("requestWithDeadline", () => {
  it("uses native timeout cleanup and ignores a late response", async () => {
    vi.useFakeTimers();
    const { rpc, sent } = rpcHarness();
    const timing = () => ({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, interactiveRpcMs: 10 });
    const request = requestWithDeadline({ rpc, timing, method: CONFIG_METHODS.list, params: {} });
    const rejection = expect(request).rejects.toMatchObject({
      name: "RpcDeadlineExceededError",
      method: CONFIG_METHODS.list,
      outcomeUnknown: false,
    });

    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    expect(Reflect.get(rpc.client, "idToResolveMap")).toHaveProperty("size", 0);
    const id = (sent[0] as { id: number }).id;
    expect(() => rpc.client.receive({ jsonrpc: "2.0", id, result: { entries: [] } })).not.toThrow();
    expect(Reflect.get(rpc.client, "idToResolveMap")).toHaveProperty("size", 0);
  });

  it("isolates concurrent requests and marks mutation timeout outcome unknown", async () => {
    vi.useFakeTimers();
    const { rpc, sent } = rpcHarness();
    const timing = () => ({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, interactiveRpcMs: 10, longRpcMs: 30 });
    const mutation = requestWithDeadline({ rpc, timing, method: CONFIG_METHODS.set, params: { key: "x", value: 1 } });
    const long = requestWithDeadline<string>({ rpc, timing, method: MEMORY_METHODS.tidy, params: { characterId: "taki" } });
    const rejection = expect(mutation).rejects.toBeInstanceOf(RpcDeadlineExceededError);

    await vi.advanceTimersByTimeAsync(10);
    await rejection;
    const mutationError = await mutation.catch((cause: unknown) => cause);
    expect(mutationError).toMatchObject({ outcomeUnknown: true });
    const longId = (sent[1] as { id: number }).id;
    rpc.client.receive({ jsonrpc: "2.0", id: longId, result: "ok" });
    await expect(long).resolves.toBe("ok");
    expect(Reflect.get(rpc.client, "idToResolveMap")).toHaveProperty("size", 0);
  });
});
