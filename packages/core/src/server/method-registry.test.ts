import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { JSONRPCErrorException } from "json-rpc-2.0";
import { JSON_RPC_APP_ERROR, JSON_RPC_ERROR_CODES, type JsonRpcRequest, type Role } from "@taki/shared";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import type { Connection } from "./connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "./method-registry.ts";

function ctxFor(connection: Connection, notify: (m: string, p: unknown) => void = () => {}): MethodContext {
  return { notify, connection, close: () => {}, onClose: () => {} };
}
function authed(role: Role = "operator"): Connection {
  return { state: { status: "authenticated", deviceId: "d", role, capabilities: [] } };
}
function awaiting(): Connection {
  return { state: { status: "awaiting" } };
}

const NOOP_CTX = ctxFor(authed());

function request(method: string, params: unknown, id: string | number = "1"): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

describe("createMethodRegistry dispatch", () => {
  it("routes a known method to its handler and wraps the result in a success response", async () => {
    const registry = createMethodRegistry();
    registry.register({
      method: "echo",
      roles: ["operator"],
      paramsSchema: z.object({ text: z.string() }),
      handler: (params) => ({ echoed: params.text }),
    });

    const res = await registry.dispatch(request("echo", { text: "hi" }), NOOP_CTX);

    expect(res).toEqual({ jsonrpc: "2.0", id: "1", result: { echoed: "hi" } });
  });

  it("passes the socket-bound ctx through to the handler", async () => {
    const registry = createMethodRegistry();
    const notify = vi.fn();
    registry.register({
      method: "ping",
      roles: ["operator"],
      paramsSchema: z.object({}),
      handler: (_params, ctx) => {
        ctx.notify("evt", { a: 1 });
        return {};
      },
    });

    await registry.dispatch(request("ping", {}), ctxFor(authed(), notify));

    expect(notify).toHaveBeenCalledWith("evt", { a: 1 });
  });

  it("returns a METHOD_NOT_FOUND error for an unregistered method", async () => {
    const registry = createMethodRegistry();

    const res = await registry.dispatch(request("nope", {}), NOOP_CTX);

    expect(res).toMatchObject({
      jsonrpc: "2.0",
      id: "1",
      error: { code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND },
    });
  });

  it("returns INVALID_PARAMS with zod issues in error.data when params fail validation", async () => {
    const registry = createMethodRegistry();
    registry.register({
      method: "echo",
      roles: ["operator"],
      paramsSchema: z.object({ text: z.string() }),
      handler: () => ({}),
    });

    const res = await registry.dispatch(request("echo", { text: 123 }), NOOP_CTX);

    expect(res).toMatchObject({ id: "1", error: { code: JSON_RPC_ERROR_CODES.INVALID_PARAMS } });
    const data = (res as { error: { data: { issues: unknown[] } } }).error.data;
    expect(Array.isArray(data.issues)).toBe(true);
    expect(data.issues.length).toBeGreaterThan(0);
  });

  it("returns INTERNAL_ERROR when method-specific fail-closed cleanup throws", async () => {
    const registry = createMethodRegistry();
    registry.register({
      method: "candidate.publish",
      roles: ["node"],
      paramsSchema: z.object({ value: z.string() }),
      onInvalidParams: () => {
        throw new Error("cleanup failed");
      },
      handler: () => ({}),
    });

    const res = await registry.dispatch(request("candidate.publish", { value: 1 }), ctxFor(authed("node")));

    expect(res).toMatchObject({ id: "1", error: { code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message: "cleanup failed" } });
  });

  it("degrades a throwing handler into an INTERNAL_ERROR response instead of rejecting", async () => {
    const registry = createMethodRegistry();
    registry.register({
      method: "boom",
      roles: ["operator"],
      paramsSchema: z.object({}),
      handler: () => {
        throw new Error("handler exploded");
      },
    });

    const res = await registry.dispatch(request("boom", {}), NOOP_CTX);

    expect(res).toMatchObject({
      jsonrpc: "2.0",
      id: "1",
      error: { code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message: "handler exploded" },
    });
  });

  it("returns FORBIDDEN when the authenticated role is not permitted for the method", async () => {
    const registry = createMethodRegistry();
    const handler = vi.fn(() => ({}));
    registry.register({ method: "node.only", roles: ["node"], paramsSchema: z.object({}), handler });

    const res = await registry.dispatch(request("node.only", {}), ctxFor(authed("operator")));

    expect(res).toMatchObject({ id: "1", error: { code: JSON_RPC_APP_ERROR, data: { code: "FORBIDDEN" } } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("skips the role gate for a still-awaiting connection (the connect method path)", async () => {
    const registry = createMethodRegistry();
    registry.register({
      method: "connect",
      roles: ["operator"],
      paramsSchema: z.object({}),
      handler: () => ({ status: "ok" }),
    });

    const res = await registry.dispatch(request("connect", {}), ctxFor(awaiting()));

    expect(res).toEqual({ jsonrpc: "2.0", id: "1", result: { status: "ok" } });
  });
});

describe("createMethodRegistry failure logging", () => {
  function failing(thrown: unknown) {
    const { logger, records } = createCaptureLogger(); const registry = createMethodRegistry({ logger });
    registry.register({ method: "chat.send", roles: ["operator"], paramsSchema: z.object({ text: z.string() }),
      handler: () => { throw thrown; } });
    return { registry, records };
  }

  it("logs an unexpected failure once with the method and its closed code, keeping the response message", async () => {
    const { registry, records } = failing(new Error("HINDSIGHT_APPLICATION_NATIVE_VERSION_CONFLICT"));
    const res = await registry.dispatch(request("chat.send", { text: "secret prompt" }), NOOP_CTX);
    expect(res).toMatchObject({ error: { code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message: "HINDSIGHT_APPLICATION_NATIVE_VERSION_CONFLICT" } });
    expect(records).toEqual([{ level: "error", obj: { method: "chat.send", code: "HINDSIGHT_APPLICATION_NATIVE_VERSION_CONFLICT" },
      msg: "method failed unexpectedly" }]);
  });

  it("logs only the error class for a free-text failure, never its message or params", async () => {
    const { registry, records } = failing(new TypeError("cannot read key sk-live-123 of prompt"));
    await registry.dispatch(request("chat.send", { text: "secret prompt" }), NOOP_CTX);
    expect(records.map((record) => record.obj)).toEqual([{ method: "chat.send", code: "TypeError" }]);
    expect(JSON.stringify(records)).not.toMatch(/sk-live|secret prompt/);
  });

  it("does not log a deliberate JSON-RPC error", async () => {
    const { registry, records } = failing(new JSONRPCErrorException("busy", JSON_RPC_APP_ERROR));
    await registry.dispatch(request("chat.send", { text: "x" }), NOOP_CTX);
    expect(records).toEqual([]);
  });
});
