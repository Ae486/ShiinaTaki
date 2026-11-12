import { describe, expect, it, vi } from "vitest";
import { ContextRequestMeasuredPayloadSchema, type EffectLifecycle, type RunEvent } from "@taki/shared";
import { createNativeImageAttempt } from "./native-image-attempt.ts";
import { createModelEffectMiddleware } from "./model-effect-middleware.ts";
import { recordRequestAttribution } from "./request-attribution-observer.ts";
import { contextText } from "./context-attribution.ts";
import { currentModelUsageOwner, withRunUsageOwner } from "../observability/model-usage-context.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";

describe("post-filter dispatch Effect attribution", () => {
  it("captures the committed Effect after image invalidation, never outer params, and isolates collector failure", async () => {
    const records: Omit<RunEvent, "seq" | "eventId">[] = [];
    const effects: EffectLifecycle[] = [];
    let current = true;
    const lifecycle: EffectLifecycleService = {
      prepare(input) {
        const effect = { ...input, effectId: `physical-${effects.length}`, version: 0 } as unknown as EffectLifecycle;
        effects.push(effect); current = false; input.onCommitIntent?.(effect); return effect;
      }, settle: () => ({ duplicate: false, stale: false }), get: () => undefined, unfinished: () => [],
      record: (event) => { records.push(event); if (records.length === 2) throw new Error("optional storage failure"); },
    };
    const native = createNativeImageAttempt({ context: { images: [{ mediaType: "image/png", dataBase64: "AA==" }],
      context: "retired observation", isCurrent: () => current, release() {} }, onDispatch(request, descriptors) {
      expect(currentModelUsageOwner()?.owner).toBe("run");
      recordRequestAttribution({ lifecycle, request, descriptors: { ...descriptors, instructions: contextText("Rules", "instructions"), toolOrigins: new Map() },
        population: "primary", primaryInputSeq: 8, stepNumber: 0, window: () => ({ declaredRealTokens: 10000,
          effectiveRealTokens: 8000, estimatorWindowUnits: 4000, factor: 2 }) });
    } });
    const middleware = createModelEffectMiddleware({ lifecycle, runId: "r", attemptId: "a" });
    const provider = vi.fn(async () => ({ content: [], usage: { inputTokens: { total: 10 }, outputTokens: { total: 1 } } }));
    for (let request = 0; request < 2; request += 1) {
      current = true;
      const messages = native.project([{ role: "user", content: "valid question" }]);
      const params = { prompt: [{ role: "system", content: "Rules" }, ...messages.map((message) => message.role === "user" && typeof message.content === "string"
        ? { ...message, content: [{ type: "text", text: message.content }] } : message)] };
      const nativeModel = native.model({ specificationVersion: "v4", provider: "fixture", modelId: "main", supportedUrls: {},
        doGenerate: provider, doStream: vi.fn() } as never);
      const delegate = nativeModel as unknown as { doGenerate(params: unknown): Promise<unknown> };
      await middleware.wrapGenerate?.({ params, model: { provider: "fixture", modelId: "main" }, doGenerate: () => delegate.doGenerate(params) } as never);
      expect(params.prompt.some((message) => JSON.stringify(message).includes("retired observation"))).toBe(false);
    }
    expect(provider).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(2);
    const measured = records.map((record) => ContextRequestMeasuredPayloadSchema.parse(record.payload));
    expect(measured.map((record) => record.effectId)).toEqual(effects.map((effect) => effect.effectId));
    expect(measured.every((record) => !record.composition.coverage.hasHeuristicMedia)).toBe(true);
    expect(JSON.stringify(records)).not.toContain("valid question");
    expect(JSON.stringify(records)).not.toContain("retired observation");
    expect(currentModelUsageOwner()).toBeUndefined();
  });

  it("does not invent a model Effect for untracked or old one-argument owner scopes", () => {
    const record = vi.fn();
    const input = { lifecycle: { record } as unknown as EffectLifecycleService,
      request: { instructions: "", outgoing: [], preparedTools: [] },
      descriptors: { texts: new Map(), interactions: new Map(), toolOrigins: new Map() }, population: "other" as const, stepNumber: 0 };
    recordRequestAttribution(input);
    withRunUsageOwner(() => recordRequestAttribution(input));
    expect(record).not.toHaveBeenCalled();
  });
});
