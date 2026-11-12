import { describe, expect, it, vi } from "vitest";
import type { EffectLifecycle } from "@taki/shared";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createModelObserver } from "./model-observability.ts";
import { createToolInvocationBridge } from "./tool-invocation.ts";

function effect(effectId: string): EffectLifecycle {
  return { schemaVersion: "effect.v1", effectId, runId: "run", attemptId: "attempt", kind: "model",
    state: "intent_committed", version: 0, sourceRef: { type: "model", provider: "mock", modelId: "mock" }, replayPosture: "never" };
}

function fixture() {
  const lifecycle = { settle: vi.fn(() => ({ stale: false, duplicate: false })), record: vi.fn() } as unknown as EffectLifecycleService;
  const invocations = createToolInvocationBridge({ runId: "run", attemptId: "attempt" });
  const model = createModelObserver({ lifecycle, runId: "run", attemptId: "attempt" }, { now: () => 1_000, invocations });
  const bind = (effectId: string) => {
    model.start({ callId: "generation" } as never);
    return model.observer.bindEffect({ effect: effect(effectId), provider: "mock", modelId: "mock" });
  };
  return { lifecycle, invocations, model, bind };
}

function end(content: unknown[] = []) {
  return { callId: "generation", provider: "mock", modelId: "mock", finishReason: "stop", content,
    usage: { inputTokens: 0, inputTokenDetails: {}, outputTokens: 0, outputTokenDetails: {}, totalTokens: 0 },
    performance: { responseTimeMs: 10 } } as never;
}

describe("exact model request observation", () => {
  it("settles successive Effects under one generation without letting duplicate old callbacks settle the new one", () => {
    const f = fixture();
    f.bind("model-a");
    const first = end();
    f.model.end(first);
    f.bind("model-b");
    f.model.end(first);
    expect(f.lifecycle.settle).toHaveBeenCalledTimes(1);
    f.model.end(end());
    expect(vi.mocked(f.lifecycle.settle).mock.calls.map(([value]) => value.effectId)).toEqual(["model-a", "model-b"]);
  });

  it("retires only the failed request and preserves the retry's own first-output and terminal identities", () => {
    const f = fixture();
    const first = f.bind("failed-request");
    f.model.observer.fail({ ...first, errorCode: "provider_error", outcome: "failed" });
    const retry = f.bind("retry-request");
    f.model.observer.firstOutput({ ...retry, outputKind: "reasoning" });
    f.model.observer.firstOutput({ ...first, outputKind: "tool" });
    f.model.end(end());
    const records = vi.mocked(f.lifecycle.record!).mock.calls.map(([value]) => value.payload);
    expect(records.filter((value) => value.kind === "model.stream.first")).toEqual([
      expect.objectContaining({ effectId: "retry-request", outputKind: "reasoning" }),
    ]);
    expect(vi.mocked(f.lifecycle.settle).mock.calls.map(([value]) => value.effectId)).toEqual(["failed-request", "retry-request"]);
  });

  it("does not guess an association when a generation has several unfinished request candidates", () => {
    const f = fixture();
    const a = f.bind("model-a");
    f.bind("model-b");
    const toolCall = { type: "tool-call", toolCallId: "call", toolName: "echo" };
    f.model.end(end([toolCall]));
    expect(f.invocations.capture(toolCall).modelEffectId).toBeUndefined();
    expect(f.lifecycle.settle).not.toHaveBeenCalled();
    expect(() => f.model.assertHealthy()).toThrow("MODEL_OBSERVATION_AMBIGUOUS");
    f.model.observer.firstOutput({ ...a, outputKind: "text" });
    expect(vi.mocked(f.lifecycle.record!).mock.calls.at(-1)?.[0].payload).toMatchObject({ effectId: "model-a" });
  });

  it("stores only start identity/time rather than copying SDK request fields", () => {
    const f = fixture();
    const event = Object.defineProperty({ callId: "generation" }, "messages", {
      enumerable: true, get() { throw new Error("raw request was read"); },
    });
    expect(() => f.model.start(event as never)).not.toThrow();
    f.model.observer.bindEffect({ effect: effect("model"), provider: "mock", modelId: "mock" });
    f.model.end(end());
    expect(f.lifecycle.settle).toHaveBeenCalledOnce();
  });
});
