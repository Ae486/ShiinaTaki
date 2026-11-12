import { describe, expect, it, vi } from "vitest";
import type { JSONRPCParams } from "json-rpc-2.0";
import { MODEL_CAPABILITIES_METHOD } from "@taki/shared";
import { configMethods } from "./ws-config-methods.ts";

describe("model capability WS boundary", () => {
  it("uses its separate operator read and rejects malformed declarations at the boundary", async () => {
    const observed = vi.fn<(method: string, params: JSONRPCParams) => Promise<unknown>>(
      async () => ({ configured: { model: "model", identity: "unsafe" } }),
    );
    const request = async <T>(method: string, params: JSONRPCParams): Promise<T> => await observed(method, params) as T;
    const methods = configMethods(request);
    await expect(methods.configModelCapabilities()).rejects.toThrow();
    expect(observed).toHaveBeenCalledExactlyOnceWith(MODEL_CAPABILITIES_METHOD, {});
  });
});
