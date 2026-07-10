/**
 * INPUT:  CapabilityRespondParams from a dispatched capability.respond request + a CapabilityBroker
 * OUTPUT: capabilityRespondMethod(broker) -> MethodDefinition (node-only); settles the pending request
 * POS:    core/server/methods — one file per WS method; the node's answer to a capability.request notification
 */
import {
  CAPABILITY_METHODS,
  CapabilityRespondParamsSchema,
  type CapabilityRespondParams,
  type CapabilityRespondResult,
} from "@taki/shared";
import type { CapabilityBroker } from "../../capabilities/capability-broker.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function capabilityRespondMethod(broker: CapabilityBroker): MethodDefinition<CapabilityRespondParams> {
  return {
    method: CAPABILITY_METHODS.respond,
    roles: ["node"], // executing capabilities is a node concern; operators converse/approve (mirrors approval.respond)
    paramsSchema: CapabilityRespondParamsSchema,
    // Unknown/late requestId -> {accepted:false} (the request already timed out) — a normal answer, never an error.
    handler: (params): CapabilityRespondResult => broker.resolve(params),
  };
}
