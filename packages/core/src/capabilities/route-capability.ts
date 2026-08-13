/**
 * INPUT:  explicit/legacy target Host resolution, validated live catalogs, connection registry, broker, logger
 * OUTPUT: routeCapability(deps, request) -> structured result; never selects first match
 * POS:    core/capabilities — explicit Host-qualified router; legacy compatibility resolves only one routable Host
 */
import type { Logger } from "../logging/logger.ts";
import type { HostCatalogStore } from "../hosts/host-catalog.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import type { CapabilityBroker, CapabilityFailureCode } from "./capability-broker.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";

export interface CapabilityRouteDeps {
  registry: ConnectionRegistry;
  catalogs: HostCatalogStore;
  broker: CapabilityBroker;
  logger: Logger;
  governance: GovernancePolicyService;
}

export type RouteFailureCode = CapabilityFailureCode | "NO_NODE" | "TARGET_HOST_REQUIRED" | "CAPABILITY_MISSING";
export type RouteResult =
  | { ok: true; output: unknown }
  | { ok: false; code: RouteFailureCode; message: string; state?: "cancelled" | "outcome_unknown" };

export interface CapabilityRouteRequest {
  capabilityId: string;
  input: unknown;
  targetHostId?: string;
}

export async function routeCapability(
  deps: CapabilityRouteDeps,
  request: CapabilityRouteRequest,
): Promise<RouteResult> {
  const { capabilityId, input, targetHostId } = request;
  const log = deps.logger.child({ mod: "capability" });
  const resolved = resolveTarget(deps, capabilityId, targetHostId);
  if (!resolved.ok) {
    log.warn({ capability: capabilityId, code: resolved.code }, "capability routing failed");
    return resolved;
  }
  const { catalog, connection, descriptor } = resolved;
  if (!connection.notify) return { ok: false, code: "NO_NODE", message: `Host ${catalog.hostId} is unavailable` };
  const dispatchPolicy = deps.governance.hostDispatchPolicy(capabilityId);
  const expected = dispatchPolicy.compatibility;
  if (
    descriptor.governance.descriptorRevision !== expected.descriptorRevision
    || descriptor.governance.classifierRevision !== expected.classifierRevision
    || descriptor.governance.classifierId !== expected.classifierId
  ) {
    return {
      ok: false,
      code: "CAPABILITY_MISSING",
      message: `Host ${catalog.hostId} governance metadata is incompatible with ${capabilityId}`,
    };
  }
  return deps.broker.request({
    hostId: catalog.hostId,
    connectionGeneration: catalog.connectionGeneration,
    catalogGeneration: catalog.catalogGeneration,
    descriptor,
    notify: connection.notify,
    policyGeneration: dispatchPolicy.policyGeneration,
    governanceProjection: dispatchPolicy.projection,
  }, input);
}

function resolveTarget(deps: CapabilityRouteDeps, capabilityId: string, targetHostId?: string) {
  const candidates = deps.catalogs.hostsForCapability(capabilityId);
  const catalog = targetHostId
    ? candidates.find((item) => item.hostId === targetHostId)
    : candidates.length === 1 ? candidates[0] : undefined;
  if (!catalog) {
    if (!targetHostId && candidates.length > 1) {
      return { ok: false as const, code: "TARGET_HOST_REQUIRED" as const, message: `multiple Hosts provide ${capabilityId}; targetHostId is required` };
    }
    return { ok: false as const, code: targetHostId ? "CAPABILITY_MISSING" as const : "NO_NODE" as const, message: `no routable Host provides ${capabilityId}` };
  }
  const connection = deps.registry.findHost(catalog.hostId);
  const descriptor = catalog.capabilities.find((item) => item.capabilityId === capabilityId);
  if (!connection || !descriptor) return { ok: false as const, code: "NO_NODE" as const, message: `Host ${catalog.hostId} is unavailable` };
  return { ok: true as const, catalog, connection, descriptor };
}
