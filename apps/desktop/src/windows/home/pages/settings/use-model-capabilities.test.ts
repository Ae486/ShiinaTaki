import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ModelCapabilitiesResult } from "@taki/shared";
import { createReadCoordinator } from "@/lib/read-coordinator.js";
import { createModelCapabilitiesLoad } from "./use-model-capabilities.ts";

const baseURL = "https://api.openai.com/v1";
function result(model = "model", url = baseURL): ModelCapabilitiesResult {
  return {
    configured: { model, identity: createHash("sha256").update(JSON.stringify([url, model])).digest("hex") },
    apply: "restart", adapter: { kind: "openai-compatible", toolCalling: true, imageInput: true, nativeWebSearch: false },
    catalog: { status: "unknown", reason: "model" },
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

describe("configured model capability read lifetime", () => {
  it("verifies the Core's safe identity without passing model or URL into the request", async () => {
    const client = { configModelCapabilities: vi.fn(async () => result()) };
    const load = createModelCapabilitiesLoad({ client, model: "model", baseURL });
    expect(await load()).toEqual(result());
    expect(client.configModelCapabilities).toHaveBeenCalledExactlyOnceWith();
  });

  it("rejects changed model or endpoint even if the response is otherwise valid", async () => {
    const client = { configModelCapabilities: vi.fn(async () => result("model", "https://relay.invalid/v1")) };
    await expect(createModelCapabilitiesLoad({ client, model: "model", baseURL })()).rejects.toThrow("模型配置已变化");
    client.configModelCapabilities.mockResolvedValue(result("new-model"));
    await expect(createModelCapabilitiesLoad({ client, model: "model", baseURL })()).rejects.toThrow("模型配置已变化");
  });

  it("retires both old success and failure after an actual config/client change", async () => {
    const previous = deferred<ModelCapabilitiesResult>();
    const client = { configModelCapabilities: vi.fn(() => previous.promise) };
    const sink = { started: vi.fn(), loaded: vi.fn(), failed: vi.fn(), retired: vi.fn() };
    const reads = createReadCoordinator<ModelCapabilitiesResult>(sink);
    reads.replace(createModelCapabilitiesLoad({ client, model: "model", baseURL }));
    const old = reads.demand();
    await flush();
    const current = { configModelCapabilities: vi.fn(async () => result("next", "https://new.invalid/v1")) };
    reads.replace(createModelCapabilitiesLoad({ client: current, model: "next", baseURL: "https://new.invalid/v1" }));
    await reads.demand();
    previous.resolve(result());
    await old;
    expect(sink.loaded).toHaveBeenCalledExactlyOnceWith(result("next", "https://new.invalid/v1"));
    const failed = deferred<ModelCapabilitiesResult>();
    reads.replace(createModelCapabilitiesLoad({ client: { configModelCapabilities: () => failed.promise }, model: "model", baseURL }));
    const retired = reads.demand();
    await flush();
    reads.replace(null);
    failed.reject(new Error("retired failure"));
    await retired;
    expect(sink.failed).not.toHaveBeenCalled();
  });

  it("joins explicit refresh demand and performs no reads while hidden", async () => {
    const pending = deferred<ModelCapabilitiesResult>();
    const client = { configModelCapabilities: vi.fn(() => pending.promise) };
    const sink = { started: vi.fn(), loaded: vi.fn(), failed: vi.fn(), retired: vi.fn() };
    const reads = createReadCoordinator<ModelCapabilitiesResult>(sink);
    reads.replace(createModelCapabilitiesLoad({ client, model: "model", baseURL }));
    reads.setActive(false);
    await reads.demand();
    expect(client.configModelCapabilities).not.toHaveBeenCalled();
    reads.setActive(true);
    const first = reads.demand();
    const joined = reads.demand();
    await flush();
    expect(client.configModelCapabilities).toHaveBeenCalledTimes(1);
    reads.setActive(false);
    pending.resolve(result());
    await Promise.all([first, joined]);
    expect(sink.loaded).not.toHaveBeenCalled();
  });
});
