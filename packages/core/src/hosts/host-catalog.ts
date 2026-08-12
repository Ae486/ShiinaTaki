/**
 * INPUT:  authenticated Host provenance plus complete HostCatalogPublishParams candidates
 * OUTPUT: createHostCatalogStore() -> publish/retire/get/list/routable capability ownership
 * POS:    core/hosts — atomic observed catalog authority; payload owns local readiness, Core owns live availability
 */
import type {
  HostCapabilityDescriptor,
  HostCatalogPublishParams,
  HostFrameAck,
  HostMcpDescriptor,
  HostNegotiation,
  HostSkillDescriptor,
  HostWorkspaceDescriptor,
} from "@taki/shared";

type LiveWorkspaceDescriptor = Readonly<Omit<HostWorkspaceDescriptor, "transferCapabilityIds">> & {
  readonly transferCapabilityIds: readonly string[];
};

type LiveMcpDescriptor = Readonly<Omit<HostMcpDescriptor, "toolNames">> & {
  readonly toolNames: readonly string[];
};

export interface LiveHostCatalog extends Omit<
  HostCatalogPublishParams,
  "capabilities" | "workspaces" | "skills" | "mcpServers"
> {
  readonly capabilities: readonly Readonly<HostCapabilityDescriptor>[];
  readonly workspaces: readonly LiveWorkspaceDescriptor[];
  readonly skills: readonly Readonly<HostSkillDescriptor>[];
  readonly mcpServers: readonly LiveMcpDescriptor[];
  readonly connected: true;
  readonly authenticated: true;
  readonly revoked: false;
  readonly lastSeenAt: string;
}

export interface HostCatalogStore {
  publish(candidate: HostCatalogPublishParams, provenance: HostNegotiation, now?: string): HostFrameAck;
  retire(hostId: string, connectionGeneration: number): void;
  get(hostId: string): LiveHostCatalog | undefined;
  list(): readonly LiveHostCatalog[];
  hostsForCapability(capabilityId: string): readonly LiveHostCatalog[];
}

export function createHostCatalogStore(): HostCatalogStore {
  const live = new Map<string, LiveHostCatalog>();

  return {
    publish(candidate, provenance, now = new Date().toISOString()) {
      if (candidate.hostId !== provenance.hostId) return { accepted: false, reason: "wrong_host" };
      if (candidate.connectionGeneration !== provenance.connectionGeneration) {
        return { accepted: false, reason: "stale_generation" };
      }
      if (
        candidate.protocolVersion !== provenance.protocolVersion ||
        candidate.catalogSchemaVersion !== provenance.catalogSchemaVersion
      ) {
        return { accepted: false, reason: "unsupported_version" };
      }
      const current = live.get(candidate.hostId);
      if (
        current?.connectionGeneration === candidate.connectionGeneration &&
        candidate.catalogGeneration <= current.catalogGeneration
      ) {
        return { accepted: false, reason: "stale_generation" };
      }
      live.set(candidate.hostId, snapshot(candidate, now));
      return { accepted: true };
    },
    retire(hostId, connectionGeneration) {
      const current = live.get(hostId);
      if (current?.connectionGeneration === connectionGeneration) live.delete(hostId);
    },
    get: (hostId) => live.get(hostId),
    list: () => Object.freeze([...live.values()]),
    hostsForCapability(capabilityId) {
      return Object.freeze([...live.values()].filter(
        (host) => host.readiness === "ready" && host.capabilities.some((item) => item.capabilityId === capabilityId),
      ));
    },
  };
}

function snapshot(candidate: HostCatalogPublishParams, lastSeenAt: string): LiveHostCatalog {
  return Object.freeze({
    ...candidate,
    capabilities: Object.freeze(candidate.capabilities.map((item) => Object.freeze({ ...item }))),
    workspaces: Object.freeze(candidate.workspaces.map((item) => Object.freeze({
      ...item,
      transferCapabilityIds: Object.freeze([...item.transferCapabilityIds]),
    }))),
    skills: Object.freeze(candidate.skills.map((item) => Object.freeze({ ...item }))),
    mcpServers: Object.freeze(candidate.mcpServers.map((item) => Object.freeze({
      ...item,
      toolNames: Object.freeze([...item.toolNames]),
    }))),
    connected: true,
    authenticated: true,
    revoked: false,
    lastSeenAt,
  });
}
