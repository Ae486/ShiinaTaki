/**
 * INPUT:  exact capability.challenge frames plus authenticated Node MethodContext.connection
 * OUTPUT: node-only acknowledgement; bridges only the owning Host/generation pending attempt
 * POS:    core/server/methods — payload identity and provenance are cross-checked before any Approval work
 */
import {
  CapabilityChallengeSchema,
  HOST_CONTROL_METHODS,
  type CapabilityChallenge,
  type CapabilityRespondResult,
} from "@taki/shared";
import type { CapabilityBroker } from "../../capabilities/capability-broker.ts";
import type { ConnectionRegistry } from "../connection-registry.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function capabilityChallengeMethod(
  broker: CapabilityBroker,
  connections: ConnectionRegistry,
): MethodDefinition<CapabilityChallenge> {
  return {
    method: HOST_CONTROL_METHODS.challenge,
    roles: ["node"],
    paramsSchema: CapabilityChallengeSchema,
    handler: (params, ctx): CapabilityRespondResult => {
      const state = ctx.connection.state;
      if (state.status !== "authenticated" || !state.host) return { accepted: false, reason: "wrong_host" };
      if (!connections.isCurrentHost(ctx.connection)) return { accepted: false, reason: "stale_generation" };
      return broker.challenge(params, {
        hostId: state.host.hostId,
        connectionGeneration: state.host.connectionGeneration,
      });
    },
  };
}
