/**
 * INPUT:  bounded C2 checkpoint from the current authenticated Node connection
 * OUTPUT: one live-pending permit or closed refusal; operators cannot invoke this method
 * POS:    core/server/methods — connection provenance is supplied by transport, never caller JSON
 */
import { HINDSIGHT_DEPLOYMENT_METHODS, InjectionCheckpointV1Schema,
  type InjectionCheckpointV1, type InjectionCheckpointResult } from "@taki/shared/hindsight-deployment";
import type { CapabilityBroker } from "../../capabilities/capability-broker.ts";
import type { ConnectionRegistry } from "../connection-registry.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function hindsightDeploymentCheckpointMethod(broker: CapabilityBroker, connections: ConnectionRegistry): MethodDefinition<InjectionCheckpointV1> {
  return { method: HINDSIGHT_DEPLOYMENT_METHODS.checkpoint, roles: ["node"], paramsSchema: InjectionCheckpointV1Schema,
    handler: (params, context): InjectionCheckpointResult => {
      const state = context.connection.state;
      if (state.status !== "authenticated" || !state.host || !connections.isCurrentHost(context.connection)
        || Buffer.byteLength(JSON.stringify(params)) > 32 * 1024) return { state: "unavailable", reason: "host-unavailable" };
      return broker.authorizeHindsightInjection(params, { hostId: state.host.hostId, connectionGeneration: state.host.connectionGeneration });
    } };
}
