import { describe, expect, it } from "vitest";
import { createToolInvocationBridge } from "./tool-invocation.ts";

const request = (modelEffectId: string) => ({ callId: "one-generation", modelEffectId });
const call = (toolCallId = "call", toolName = "echo") => ({ type: "tool-call", toolCallId, toolName });
const bridge = () => createToolInvocationBridge({ runId: "run", attemptId: "attempt" });

describe("immutable tool invocation bridge", () => {
  it("connects the actual SDK object to one exact Effect and never copies raw input", () => {
    const value = bridge();
    const sdkCall = Object.defineProperty(call(), "input", { get() { throw new Error("raw input was read"); } });
    value.observeRequestTool(request("first-model"), sdkCall);
    const captured = value.capture(sdkCall);
    value.bindModelContent([sdkCall], request("first-model"));
    expect(value.get(sdkCall)).toBe(captured);
    expect(captured).toMatchObject({ modelEffectId: "first-model", callId: "one-generation" });
    expect(Object.isFrozen(captured)).toBe(true);
    expect(captured).not.toHaveProperty("input");
  });

  it("retains a late result's snapshot when a later request reuses the same toolCallId", () => {
    const value = bridge();
    const first = call();
    const second = call();
    value.bindModelContent([first], request("model-a"));
    value.bindModelContent([second], request("model-b"));
    const a = value.capture(first);
    const b = value.capture(second);
    expect(a.invocationId).not.toBe(b.invocationId);
    const lateResult = { ...call(), type: "tool-result" };
    value.alias(lateResult, a);
    expect(value.result(lateResult)).toBe(a);
    expect(value.get(first)?.modelEffectId).toBe("model-a");
    expect(value.get(second)?.modelEffectId).toBe("model-b");
  });

  it("deduplicates repeated callbacks for the same confirmed request and call", () => {
    const value = bridge();
    const first = call();
    const duplicate = call();
    value.bindModelContent([first, duplicate], request("model-a"));
    expect(value.capture(first)).toBe(value.capture(duplicate));
  });

  it("leaves an ambiguous early association immutable and ungrouped", () => {
    const value = bridge();
    value.observeRequestTool(request("model-a"), call());
    value.observeRequestTool(request("model-b"), call());
    const sdkCall = call();
    const captured = value.capture(sdkCall);
    expect(captured.modelEffectId).toBeUndefined();
    value.bindModelContent([sdkCall], request("model-b"));
    expect(value.get(sdkCall)).toBe(captured);
    expect(captured.modelEffectId).toBeUndefined();
  });

  it("does not correlate a bare result to the newest of several reused IDs", () => {
    const value = bridge();
    value.bindModelContent([call()], request("model-a"));
    value.bindModelContent([call()], request("model-b"));
    value.observeRequestTool(request("model-c"), call());
    expect(value.result(call()).modelEffectId).toBeUndefined();
  });

  it("captures a full 240-unit own-key name and ignores later catalog replacement", () => {
    const name = "工具".repeat(120);
    const names = { echo: name };
    const value = createToolInvocationBridge({ runId: "run", attemptId: "attempt", toolDisplayNames: names });
    names.echo = "replacement";
    expect(value.capture(call()).displayName).toBe(name);
    const inherited = createToolInvocationBridge({
      runId: "run", attemptId: "attempt", toolDisplayNames: Object.create({ echo: "inherited" }) as Record<string, string>,
    });
    expect(inherited.capture(call()).displayName).toBeUndefined();
  });

  it("keeps unknown/invalid labels absent and uses the fixed known-tool name", () => {
    const value = createToolInvocationBridge({
      runId: "run", attemptId: "attempt", toolDisplayNames: { echo: "x".repeat(241), read_file: "  " },
    });
    expect(value.capture(call()).displayName).toBeUndefined();
    expect(value.capture(call("other", "read_file")).displayName).toBe("读取工作区文件");
  });
});
