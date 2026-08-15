/**
 * INPUT:  authenticated connection retirement events plus live Host catalog and capability broker stores
 * OUTPUT: bindHostGenerationRetirement(deps) -> synchronous generation-scoped catalog/work retirement
 * POS:    core/hosts — composition seam shared by main.ts and replacement-race tests
 */
import type { CapabilityBroker } from "../capabilities/capability-broker.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import type { HostCatalogStore } from "./host-catalog.ts";

export interface HostGenerationRetirementDeps {
  connections: ConnectionRegistry;
  catalogs: HostCatalogStore;
  broker: CapabilityBroker;
}

export function bindHostGenerationRetirement(deps: HostGenerationRetirementDeps): void {
  deps.connections.onRemove((connection) => {
    const state = connection.state;
    if (state.status !== "authenticated" || !state.host) return;
    const { hostId, connectionGeneration } = state.host;
    deps.catalogs.retire(hostId, connectionGeneration);
    deps.broker.cancelGeneration(hostId, connectionGeneration, "Host disconnected");
  });
}
