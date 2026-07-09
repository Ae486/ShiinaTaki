import { describe, expect, it } from "vitest";
import {
  JSON_RPC_APP_ERROR,
  JSON_RPC_ERROR_CODES,
  JsonRpcClientFrameSchema,
  JsonRpcErrorObjectSchema,
  JsonRpcErrorResponseSchema,
  JsonRpcInboundFrameSchema,
  JsonRpcNotificationSchema,
  JsonRpcSuccessResponseSchema,
} from "./json-rpc-schema.ts";

describe("JsonRpcInboundFrameSchema", () => {
  const cases: Array<{ label: string; frame: unknown; valid: boolean }> = [
    { label: "request with string id", frame: { jsonrpc: "2.0", id: "1", method: "chat.send", params: { a: 1 } }, valid: true },
    { label: "request with number id", frame: { jsonrpc: "2.0", id: 7, method: "chat.send" }, valid: true },
    { label: "notification without id", frame: { jsonrpc: "2.0", method: "chat.delta", params: {} }, valid: true },
    { label: "missing jsonrpc", frame: { id: "1", method: "chat.send" }, valid: false },
    { label: "wrong jsonrpc version", frame: { jsonrpc: "1.0", id: "1", method: "chat.send" }, valid: false },
    { label: "missing method", frame: { jsonrpc: "2.0", id: "1" }, valid: false },
    { label: "bad id type (boolean)", frame: { jsonrpc: "2.0", id: true, method: "chat.send" }, valid: false },
    { label: "bad id type (object)", frame: { jsonrpc: "2.0", id: {}, method: "chat.send" }, valid: false },
    { label: "not an object", frame: "nope", valid: false },
  ];

  it.each(cases)("$label", ({ frame, valid }) => {
    expect(JsonRpcInboundFrameSchema.safeParse(frame).success).toBe(valid);
  });

  it("classifies a frame carrying an id as a request", () => {
    const parsed = JsonRpcInboundFrameSchema.parse({ jsonrpc: "2.0", id: "9", method: "m" });
    expect("id" in parsed).toBe(true);
  });
});

describe("JsonRpcNotificationSchema", () => {
  it("accepts a bare notification", () => {
    expect(JsonRpcNotificationSchema.safeParse({ jsonrpc: "2.0", method: "m" }).success).toBe(true);
  });

  it("rejects a notification carrying an id", () => {
    expect(JsonRpcNotificationSchema.safeParse({ jsonrpc: "2.0", id: "9", method: "m" }).success).toBe(false);
  });
});

describe("response schemas", () => {
  it("accepts a success response", () => {
    expect(
      JsonRpcSuccessResponseSchema.safeParse({ jsonrpc: "2.0", id: "1", result: { messageId: "x" } }).success,
    ).toBe(true);
  });

  it("accepts an error response with a null id", () => {
    expect(
      JsonRpcErrorResponseSchema.safeParse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })
        .success,
    ).toBe(true);
  });

  it("rejects a non-integer error code", () => {
    expect(JsonRpcErrorObjectSchema.safeParse({ code: 1.5, message: "x" }).success).toBe(false);
  });
});

describe("JsonRpcClientFrameSchema", () => {
  const cases: Array<{ label: string; frame: unknown; valid: boolean }> = [
    { label: "success response (ack)", frame: { jsonrpc: "2.0", id: "1", result: { messageId: "m" } }, valid: true },
    { label: "error response", frame: { jsonrpc: "2.0", id: "1", error: { code: -32601, message: "x" } }, valid: true },
    { label: "server notification", frame: { jsonrpc: "2.0", method: "chat.delta", params: {} }, valid: true },
    { label: "garbage object", frame: { hello: "world" }, valid: false },
    { label: "inbound request (a client never receives these)", frame: { jsonrpc: "2.0", id: "1", method: "chat.send" }, valid: false },
  ];

  it.each(cases)("$label", ({ frame, valid }) => {
    expect(JsonRpcClientFrameSchema.safeParse(frame).success).toBe(valid);
  });
});

describe("JSON_RPC_ERROR_CODES", () => {
  it("matches the JSON-RPC 2.0 reserved codes", () => {
    expect(JSON_RPC_ERROR_CODES).toEqual({
      PARSE_ERROR: -32700,
      INVALID_REQUEST: -32600,
      METHOD_NOT_FOUND: -32601,
      INVALID_PARAMS: -32602,
      INTERNAL_ERROR: -32603,
    });
  });
});

describe("JSON_RPC_APP_ERROR", () => {
  it("is the server-defined app error code (-32000)", () => {
    expect(JSON_RPC_APP_ERROR).toBe(-32000);
  });
});
