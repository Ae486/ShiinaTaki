/**
 * INPUT:  exact capability.respond terminal frame plus authenticated Node MethodContext.connection
 * OUTPUT: node-only acknowledgement; settles only the owning Host/generation pending attempt
 * POS:    core/server/methods — payload identity is cross-checked; connection provenance is authoritative
 */
import {
  CAPABILITY_METHODS,
  CapabilityRespondParamsSchema,
  type CapabilityRespondParams,
  type CapabilityRespondResult,
} from "@taki/shared";
import type { CapabilityBroker } from "../../capabilities/capability-broker.ts";
import type { ConnectionRegistry } from "../connection-registry.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function capabilityRespondMethod(
  broker: CapabilityBroker,
  connections: ConnectionRegistry,
): MethodDefinition<CapabilityRespondParams> {
  return {
    method: CAPABILITY_METHODS.respond,
    roles: ["node"],
    paramsSchema: CapabilityRespondParamsSchema,
    handler: (params, ctx): CapabilityRespondResult => {
      const state = ctx.connection.state;
      if (state.status !== "authenticated" || !state.host) return { accepted: false, reason: "wrong_host" };
      if (!connections.isCurrentHost(ctx.connection)) return { accepted: false, reason: "stale_generation" };
      return broker.resolve(params, {
        hostId: state.host.hostId,
        connectionGeneration: state.host.connectionGeneration,
      });
    },
  };
}
