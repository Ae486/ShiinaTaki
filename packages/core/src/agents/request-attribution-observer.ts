/**
 * INPUT: final native envelope, current construction descriptors and exact dispatch-scoped Effect
 * OUTPUT: isolated bounded measurements in the existing Run Event ledger
 * POS: core/agents — optional observation; canonical model usage remains the existing settlement authority
 */
import type { ContextRequestMeasuredPayload, ContextWindowSnapshot } from "@taki/shared";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { currentModelUsageOwner } from "../observability/model-usage-context.ts";
import { measureRequestComposition, type RequestDescriptors } from "./request-composition.ts";
import type { NativeDispatchInput } from "./native-image-attempt.ts";

export function recordRequestAttribution(input: {
  lifecycle?: EffectLifecycleService; request: NativeDispatchInput; descriptors: RequestDescriptors;
  population: ContextRequestMeasuredPayload["population"]; primaryInputSeq?: number; stepNumber: number;
  window?: () => ContextWindowSnapshot; now?: () => number;
}): void {
  try {
    const owner = currentModelUsageOwner();
    if (owner?.owner !== "run" || !owner.effect || !input.lifecycle?.record) return;
    const effect = owner.effect;
    if (effect.sourceRef.type !== "model" || input.population === "primary" && input.primaryInputSeq === undefined) return;
    const occurredAt = new Date((input.now ?? Date.now)()).toISOString();
    const window = input.window?.();
    input.lifecycle.record({ runId: effect.runId, attemptId: effect.attemptId, schemaVersion: "context-request.v1",
      category: "context", kind: "context.request.measured", occurredAt, source: "core.context-observer", payload: {
        kind: "context.request.measured", state: "captured", effectId: effect.effectId,
        provider: effect.sourceRef.provider, modelId: effect.sourceRef.modelId, population: input.population,
        ...(input.primaryInputSeq === undefined ? {} : { primaryInputSeq: input.primaryInputSeq }),
        stepNumber: input.stepNumber, dispatchedAt: occurredAt, ...(window ? { window } : {}),
        composition: measureRequestComposition(input.request, input.descriptors),
      } });
  } catch { /* Optional attribution can neither cancel nor retry an otherwise valid provider operation. */ }
}
