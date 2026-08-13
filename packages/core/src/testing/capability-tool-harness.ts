/**
 * INPUT:  a capability descriptor and canned CapabilityOutcome
 * OUTPUT: fakeHost / registryReturning / catalogsReturning / brokerReturning test doubles
 * POS:    core/testing — shared test scaffolding for the Host-qualified Shell capability tools
 */
import type { HostCapabilityDescriptor } from "@taki/shared";
import { openDatabase } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { CapabilityBroker, CapabilityOutcome } from "../capabilities/capability-broker.ts";
import { createHostCatalogStore, type HostCatalogStore } from "../hosts/host-catalog.ts";
import type { Connection, ConnectionRegistry } from "../server/connection-registry.ts";

export const TEST_HOST_ID = "11111111-1111-4111-8111-111111111111";

export function testGovernance() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  return createGovernancePolicyService(createGovernancePolicyRepo(db));
}

export function fakeHost(capability: string): Connection {
  return {
    state: {
      status: "authenticated",
      deviceId: TEST_HOST_ID,
      role: "node",
      capabilities: [capability],
      host: { hostId: TEST_HOST_ID, connectionGeneration: 1, protocolVersion: 2, catalogSchemaVersion: 2 },
    },
    notify: () => undefined,
  };
}

export function registryReturning(host: Connection | undefined): ConnectionRegistry {
  return {
    create: () => ({ state: { status: "awaiting" } }),
    authenticate: () => undefined,
    remove: () => undefined,
    list: () => host ? [host] : [],
    findHost: () => host,
    isCurrentHost: (connection) => connection === host,
    onRemove: () => undefined,
  };
}

export function catalogsReturning(capability: string, descriptor?: Partial<HostCapabilityDescriptor>): HostCatalogStore {
  const store = createHostCatalogStore();
  store.publish({
    hostId: TEST_HOST_ID,
    label: "Test Host",
    protocolVersion: 2,
    catalogSchemaVersion: 2,
    connectionGeneration: 1,
    catalogGeneration: 1,
    publishedAt: "2026-08-12T00:00:00.000Z",
    readiness: "ready",
    capabilities: [{
      capabilityId: capability,
      execution: descriptor?.execution ?? "read",
      cancellation: descriptor?.cancellation ?? "cooperative",
      governance: descriptor?.governance ?? {
        descriptorRevision: 1,
        classifierId: capability === "shell-open" ? "shell-open-target" : capability === "exec" ? "exec-command" : "fixed-risk",
        classifierRevision: 1,
      },
    }],
    workspaces: [], skills: [], mcpServers: [],
  }, { hostId: TEST_HOST_ID, connectionGeneration: 1, protocolVersion: 2, catalogSchemaVersion: 2 });
  return store;
}

export function brokerReturning(outcome: CapabilityOutcome): CapabilityBroker {
  return {
    request: () => Promise.resolve(outcome),
    resolve: () => ({ accepted: false, reason: "unknown_request" }),
    cancelGeneration: () => undefined,
  };
}

export function brokerCapturing(outcome: CapabilityOutcome) {
  const sent: { capability?: string; input?: unknown; hostId?: string } = {};
  const broker: CapabilityBroker = {
    request: (target, input) => {
      sent.capability = target.descriptor.capabilityId;
      sent.input = input;
      sent.hostId = target.hostId;
      return Promise.resolve(outcome);
    },
    resolve: () => ({ accepted: false, reason: "unknown_request" }),
    cancelGeneration: () => undefined,
  };
  return { broker, sent };
}
