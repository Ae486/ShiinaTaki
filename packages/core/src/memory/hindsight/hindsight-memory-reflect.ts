/**
 * INPUT:  a captured Bank, canonical reflect request and independently negotiated guarded-reflect capability
 * OUTPUT: actual native reflection, evidence, usage and trace under persisted policy and a fixed five-minute operation deadline
 * POS:    core/memory/hindsight — no local synthesis or unguarded native reflect fallback
 */
import { randomUUID } from "node:crypto";
import { TakiApplicationReadContextSchema, TakiApplicationJsonObjectSchema, type ReflectRequest, type ReflectResult } from "@taki/shared";
import type { MemoryProviderCallContext } from "../memory-provider.ts";
import { admitHindsightApplication } from "./hindsight-application-capability.ts";
import { prepareHindsightApplicationBody, uploadHindsightApplicationBody } from "./hindsight-application-body-transfer.ts";
import { assertHindsightProviderScope, hindsightProviderBank, hindsightProviderCall,
  type HindsightMemoryProviderState } from "./hindsight-memory-provider-context.ts";

// Native generation can outlast the ordinary request budget. Synchronization,
// admission and policy upload share this allowance with the final guarded call.
export const HINDSIGHT_REFLECT_OPERATION_TIMEOUT_MS = 300_000;

export async function reflectHindsightMemory(state: HindsightMemoryProviderState, input: {
  context: MemoryProviderCallContext; request: ReflectRequest;
}): Promise<ReflectResult> {
  const call = hindsightProviderCall(state, { context: input.context, bankId: input.request.bankId,
    operationTimeoutMs: HINDSIGHT_REFLECT_OPERATION_TIMEOUT_MS });
  await state.deps.synchronize({ bankId: input.request.bankId, context: call() });
  const bank = hindsightProviderBank(state, { context: input.context, bankId: input.request.bankId });
  const admission = await admitHindsightApplication({ client: state.client, request: call, expectedLineage: state.epoch.providerLineageId });
  state.assert(input.context, bank.bankId);
  state.deps.admission.save({ authorityEpochId: state.epoch.epochId, configFingerprint: state.deps.configFingerprint,
    manifest: admission.manifest, admittedAt: state.now() });
  if (!admission.guardedReflect) throw new Error("MEMORY_CAPABILITY_UNSUPPORTED");
  const policyContext = TakiApplicationReadContextSchema.parse({ namespace: bank.namespace, bank_id: bank.bankId,
    purpose: "reflect", policy_contract_version: "1.0.0", captured_at: state.now(), scope: bank.bankScope,
    actor: input.context.actor === "operator" ? "user" : input.context.actor === "foreground-agent" ? "agent" : "system", mood: null });
  const body = prepareHindsightApplicationBody({ ...bank, schema: "application-read-context.v1", value: policyContext });
  const reference = await uploadHindsightApplicationBody({ ...bank, client: state.client, body, context: call() });
  const requestId = randomUUID();
  const result = await state.client.reflectApplication({ bankId: bank.bankId, context: call(), request: {
    namespace: bank.namespace, request_id: requestId, policy_context_ref: reference,
    native_request: { query: input.request.query, budget: input.request.budget, max_tokens: input.request.maxTokens,
      include: { facts: {}, tool_calls: { output: true } } },
  } });
  assertHindsightProviderScope(state, { context: input.context, scope: bank });
  if (result.admission.context_hash !== reference.payload_hash || result.request_id !== requestId
    || result.admission.linearization !== "before_each_model_submission") throw new Error("HINDSIGHT_APPLICATION_REFLECT_EVIDENCE_INVALID");
  const response = result.native_response;
  return { text: response.text, structuredContent: response.structured_output ?? null,
    evidence: { memoryIds: unique((response.based_on?.memories ?? []).flatMap((item) => item.id ? [item.id] : [])),
      mentalModelIds: unique((response.based_on?.mental_models ?? []).map((item) => item.id)),
      directiveIds: unique((response.based_on?.directives ?? []).map((item) => item.id)) },
    usage: { inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null },
    trace: response.trace ? TakiApplicationJsonObjectSchema.parse(response.trace) : null };
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
