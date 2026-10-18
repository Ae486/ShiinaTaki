/**
 * INPUT:  authenticated bounded JSON transport and one Core-mapped Bank/nonce
 * OUTPUT: optional API-engine observation or fixed Native refusal, capped at 16 KiB
 * POS:    core/memory/hindsight — no health probe, configuration write or retry
 */
import { HindsightConfigurationObservationSchema, HindsightConfigurationRefusalSchema, HINDSIGHT_CONFIGURATION_MAX_BYTES,
  type HindsightConfigurationObservation, type HindsightConfigurationRefusal } from "@taki/shared";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";

export interface HindsightConfigurationClient {
  observeConfiguration(input: { bankId: string; nonce: string; context: HindsightCallContext }):
    Promise<HindsightConfigurationObservation | HindsightConfigurationRefusal>;
}

export function createHindsightConfigurationMethods(request: <T>(input: HindsightRequestInput<T>) => Promise<T>): HindsightConfigurationClient {
  return { observeConfiguration: (input) => request<HindsightConfigurationObservation | HindsightConfigurationRefusal>({
    path: `/ext/taki-memory/banks/${encodeURIComponent(input.bankId)}/configuration-observation?nonce=${encodeURIComponent(input.nonce)}`,
    context: input.context, schema: HindsightConfigurationObservationSchema,
    maxResponseBytes: HINDSIGHT_CONFIGURATION_MAX_BYTES,
    responses: { 403: HindsightConfigurationRefusalSchema, 422: HindsightConfigurationRefusalSchema, 503: HindsightConfigurationRefusalSchema },
  }) };
}
