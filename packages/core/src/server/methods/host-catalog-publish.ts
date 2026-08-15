/**
 * INPUT:  complete host.catalogPublish params plus authenticated MethodContext.connection provenance
 * OUTPUT: hostCatalogPublishMethod(catalogs) -> node-only RPC acknowledgement
 * POS:    core/server/methods — the sole authenticated publication path into the live Host catalog store
 */
import {
  HOST_CONTROL_METHODS,
  HostCatalogPublishParamsSchema,
  type HostCatalogPublishParams,
  type HostFrameAck,
} from "@taki/shared";
import type { HostCatalogStore } from "../../hosts/host-catalog.ts";
import type { ConnectionRegistry } from "../connection-registry.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function hostCatalogPublishMethod(
  catalogs: HostCatalogStore,
  connections: ConnectionRegistry,
): MethodDefinition<HostCatalogPublishParams> {
  return {
    method: HOST_CONTROL_METHODS.catalogPublish,
    roles: ["node"],
    paramsSchema: HostCatalogPublishParamsSchema,
    onInvalidParams: (params, ctx) => retireInvalidCandidate(
      { catalogs, connections }, params, ctx.connection,
    ),
    handler: (params, ctx): HostFrameAck => {
      const state = ctx.connection.state;
      if (state.status !== "authenticated" || !state.host) return { accepted: false, reason: "wrong_host" };
      if (!connections.isCurrentHost(ctx.connection)) return { accepted: false, reason: "stale_generation" };
      const result = catalogs.publish(params, state.host);
      if (!result.accepted && matchesProvenance(params, state.host)) {
        catalogs.retire(state.host.hostId, state.host.connectionGeneration);
      }
      return result;
    },
  };
}

function retireInvalidCandidate(
  deps: { catalogs: HostCatalogStore; connections: ConnectionRegistry },
  params: unknown,
  connection: Parameters<ConnectionRegistry["isCurrentHost"]>[0],
): void {
  const state = connection.state;
  if (state.status !== "authenticated" || !state.host || !deps.connections.isCurrentHost(connection)) return;
  if (!matchesProvenance(params, state.host)) return;
  deps.catalogs.retire(state.host.hostId, state.host.connectionGeneration);
}

function matchesProvenance(
  candidate: unknown,
  provenance: { hostId: string; connectionGeneration: number },
): boolean {
  if (typeof candidate !== "object" || candidate === null) return false;
  const value = candidate as { hostId?: unknown; connectionGeneration?: unknown };
  return value.hostId === provenance.hostId && value.connectionGeneration === provenance.connectionGeneration;
}
