/**
 * INPUT:  a capability name + input, a ConnectionRegistry and a CapabilityBroker
 * OUTPUT: routeCapability(deps, capability, input) -> { ok:true, output:unknown } | { ok:false, code, message }
 * POS:    core/capabilities — the shared route→broker step every Shell-backed tool reuses; never throws
 */
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import type { CapabilityBroker, CapabilityFailureCode } from "./capability-broker.ts";

export interface CapabilityRouteDeps {
  registry: ConnectionRegistry;
  broker: CapabilityBroker;
}

/** Closed failure vocabulary: the broker's codes plus the no-node-connected case (never an open string). */
export type RouteFailureCode = CapabilityFailureCode | "NO_NODE";

/** The opaque outcome a Shell tool parses with its own output schema, or a structured failure it returns verbatim. */
export type RouteResult =
  | { ok: true; output: unknown }
  | { ok: false; code: RouteFailureCode; message: string };

/**
 * Finds a node advertising `capability`, pushes the request through the broker, and normalizes the answer.
 * NO_NODE when nothing is connected; otherwise the broker's own outcome (DENIED / EXEC_FAILED / TIMEOUT / …).
 */
export async function routeCapability(
  deps: CapabilityRouteDeps,
  capability: string,
  input: unknown,
): Promise<RouteResult> {
  const node = deps.registry.findNodeForCapability(capability);
  if (!node?.notify) {
    return { ok: false, code: "NO_NODE", message: `no connected device provides ${capability}` };
  }
  const outcome = await deps.broker.request(capability, input, node.notify);
  if (!outcome.ok) return { ok: false, code: outcome.code, message: outcome.message };
  return { ok: true, output: outcome.output };
}
