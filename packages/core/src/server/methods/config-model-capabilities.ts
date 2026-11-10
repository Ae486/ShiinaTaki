/**
 * INPUT:  an operator-only model-capability request and the effective non-secret MAIN configuration.
 * OUTPUT: configModelCapabilitiesMethod(source) — declared catalog facts separate from installed adapter support.
 * POS:    Core settings method — independent read so catalog latency never blocks config.list or writes.
 */
import { MODEL_CAPABILITIES_METHOD, ModelCapabilitiesParamsSchema, type ModelCapabilitiesParams } from "@taki/shared";
import { createModelCapabilitiesReader } from "../../config/model-capabilities.ts";
import type { ConfigSource } from "../../config/config-source.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function configModelCapabilitiesMethod(source: ConfigSource,
  active?: () => { baseUrl: string; modelId: string } | undefined): MethodDefinition<ModelCapabilitiesParams> {
  const read = createModelCapabilitiesReader(source, undefined, active);
  return { method: MODEL_CAPABILITIES_METHOD, roles: ["operator"], paramsSchema: ModelCapabilitiesParamsSchema, handler: read };
}
