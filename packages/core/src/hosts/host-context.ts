/**
 * INPUT:  validated live Host catalogs plus an explicit primaryHostId
 * OUTPUT: immutable HostContextSnapshot and a bounded control-only renderer
 * POS:    core/hosts — future Run-assembly seam; content cannot supply or override sealed Host facts
 */
import type { LiveHostCatalog } from "./host-catalog.ts";

export interface HostContextSnapshot {
  readonly primaryHostId: string;
  readonly hosts: readonly Readonly<{
    hostId: string;
    available: boolean;
    connectionGeneration: number;
    catalogGeneration: number;
    capabilityIds: readonly string[];
    workspaceIds: readonly string[];
    skillIds: readonly string[];
    mcpServerIds: readonly string[];
    transferCapabilityIds: readonly string[];
  }>[];
}

export function createHostContext(primaryHostId: string, catalogs: readonly LiveHostCatalog[]): HostContextSnapshot {
  return Object.freeze({
    primaryHostId,
    hosts: Object.freeze(catalogs.map((catalog) => Object.freeze({
      hostId: catalog.hostId,
      available: catalog.readiness === "ready",
      connectionGeneration: catalog.connectionGeneration,
      catalogGeneration: catalog.catalogGeneration,
      capabilityIds: Object.freeze(catalog.capabilities.map((item) => item.capabilityId)),
      workspaceIds: Object.freeze(catalog.workspaces.map((item) => item.workspaceId)),
      skillIds: Object.freeze(catalog.skills.map((item) => item.skillId)),
      mcpServerIds: Object.freeze(catalog.mcpServers.map((item) => item.mcpServerId)),
      transferCapabilityIds: Object.freeze(catalog.workspaces.flatMap((item) => item.transferCapabilityIds)),
    }))),
  });
}

export function renderHostContext(snapshot: HostContextSnapshot): string {
  return `<host-context>${JSON.stringify(snapshot)}</host-context>`;
}
