/**
 * INPUT:  ConfigListParams from a dispatched config.list request + the resolved config source
 * OUTPUT: configListMethod(source) -> MethodDefinition (operator-only); every knob with value + provenance
 * POS:    core/server/methods — one file per WS method; secrets ride as set/not-set only (masking lives in the
 *         source, so no surface can leak one). NO Rust mirror — operator↔core
 */
import { CONFIG_METHODS, ConfigListParamsSchema, type ConfigListParams, type ConfigListResult } from "@taki/shared";
import type { ConfigSource } from "../../config/config-source.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function configListMethod(source: ConfigSource): MethodDefinition<ConfigListParams> {
  return {
    method: CONFIG_METHODS.list,
    roles: ["operator"], // settings are an operator surface; the agent has no path to read or rewrite its own knobs
    paramsSchema: ConfigListParamsSchema,
    handler: (): ConfigListResult => ({ entries: source.effectiveAll() }),
  };
}
