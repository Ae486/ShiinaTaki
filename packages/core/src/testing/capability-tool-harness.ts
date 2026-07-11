/**
 * INPUT:  a capability name + a canned CapabilityOutcome
 * OUTPUT: fakeNode / registryReturning / brokerReturning — the minimal ConnectionRegistry + CapabilityBroker doubles
 * POS:    core/testing — shared test scaffolding for the Shell-backed capability tools (route→broker); test-only
 */
import type { CapabilityBroker, CapabilityOutcome } from "../capabilities/capability-broker.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";

export function fakeNode(capability: string) {
  return {
    state: { status: "authenticated", deviceId: "n1", role: "node", capabilities: [capability] },
    notify: () => undefined,
  } as never;
}

export function registryReturning(node: unknown): ConnectionRegistry {
  return {
    create: () => ({ state: { status: "awaiting" } }),
    authenticate: () => undefined,
    remove: () => undefined,
    list: () => [],
    findNodeForCapability: () => node as never,
    onRemove: () => undefined,
  };
}

export function brokerReturning(outcome: CapabilityOutcome): CapabilityBroker {
  return { request: () => Promise.resolve(outcome), resolve: () => ({ accepted: false }), denyAll: () => undefined };
}

/** Captures the last request the tool routed, so a test can assert the input passthrough, then answers with `outcome`. */
export function brokerCapturing(outcome: CapabilityOutcome): {
  broker: CapabilityBroker;
  sent: { capability?: string; input?: unknown };
} {
  const sent: { capability?: string; input?: unknown } = {};
  const broker: CapabilityBroker = {
    request: (capability, input) => {
      sent.capability = capability;
      sent.input = input;
      return Promise.resolve(outcome);
    },
    resolve: () => ({ accepted: false }),
    denyAll: () => undefined,
  };
  return { broker, sent };
}
