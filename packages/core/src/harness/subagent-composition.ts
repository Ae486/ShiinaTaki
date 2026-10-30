/**
 * INPUT: the existing Run/Effect/Agent/Delivery owners and private delegation repositories
 * OUTPUT: one composed child service, delayed-report adapter and authenticated read/control surface
 * POS: core/harness — application wiring only; no duplicate state or execution authority
 */
import type { SubagentDependencies } from "./subagent-state.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { RunDeliveryRepo } from "../db/run-delivery-repo.ts";
import type { DeliveryCoordinator } from "../delivery/delivery-coordinator.ts";
import type { MethodRegistry } from "../server/method-registry.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import { createDirectRequestReports } from "../delivery/direct-request-report.ts";
import { createSubagentService } from "./subagent-service.ts";
import { createSubagentSubscriptions } from "./subagent-subscriptions.ts";
import { createSubagentTools } from "../agents/subagent-tools.ts";
import { registerSubagentMethods } from "../server/methods/subagent-methods.ts";

export function composeSubagents(input: Omit<SubagentDependencies, "changed" | "reports" | "mainTools"> & {
  timeline: TimelineRepo; deliveries: RunDeliveryRepo; delivery: DeliveryCoordinator; registry: MethodRegistry; connections: ConnectionRegistry;
}) {
  const subscriptions = createSubagentSubscriptions(input.connections);
  const reports = createDirectRequestReports({ ...input, changed: subscriptions.publish });
  const service = createSubagentService({ ...input, changed: subscriptions.publish, reports,
    mainTools: (characterId, turn) => createSubagentTools({ service, characterId, turn }) });
  registerSubagentMethods(input.registry, { service, subscriptions, connections: input.connections });
  service.released();
  return { service, reports,
    released() { service.released(); reports.released(); },
    async close() { await service.close(); await reports.close(); subscriptions.close(); } };
}
