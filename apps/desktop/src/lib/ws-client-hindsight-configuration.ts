/**
 * INPUT:  the authenticated operator client's deadline-bound JSON-RPC request function
 * OUTPUT: strict Shared-validated configuration status and explicit observation reads
 * POS:    ui/lib — optional API-runtime evidence, separate from model health and setup
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import {
  HINDSIGHT_CONFIGURATION_METHODS,
  HindsightConfigurationParamsSchema,
  HindsightConfigurationStatusSchema,
  type HindsightConfigurationParams,
  type HindsightConfigurationStatus,
} from "@taki/shared";

export interface HindsightConfigurationMethods {
  hindsightConfigurationStatus(params: HindsightConfigurationParams): Promise<HindsightConfigurationStatus>;
  hindsightConfigurationObserve(params: HindsightConfigurationParams): Promise<HindsightConfigurationStatus>;
}

export function hindsightConfigurationMethods(
  request: <T>(method: string, params: JSONRPCParams) => Promise<T>,
): HindsightConfigurationMethods {
  const read = async (method: string, params: HindsightConfigurationParams) => HindsightConfigurationStatusSchema.parse(
    await request(method, HindsightConfigurationParamsSchema.parse(params)),
  );
  return {
    hindsightConfigurationStatus: (params) => read(HINDSIGHT_CONFIGURATION_METHODS.status, params),
    hindsightConfigurationObserve: (params) => read(HINDSIGHT_CONFIGURATION_METHODS.observe, params),
  };
}
