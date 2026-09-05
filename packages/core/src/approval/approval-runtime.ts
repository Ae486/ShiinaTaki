/**
 * INPUT:  Core Database, governance, registries, logger, and optional read-only approval label resolver
 * OUTPUT: composeApprovalRuntime(...) — canonical authority, interactive service, tool adapter, and method cleanup wiring
 * POS:    core/approval — production composition seam for interactive Core/MCP Approval; legacy modules stay dormant
 */
import type { Logger } from "../logging/logger.ts";
import type { Database } from "../db/sqlite.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createCoreToolGovernanceAdapter } from "../governance/core-tool-governance-adapter.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import type { MethodRegistry } from "../server/method-registry.ts";
import { registerApprovalMethods } from "../server/methods/approval-methods.ts";
import { registerPermissionMethods } from "../server/methods/permission-methods.ts";
import { createApprovalDecisionService } from "./approval-decision-service.ts";
import { createApprovalInteractionService } from "./approval-interaction-service.ts";
import { createApprovalStateRepo } from "./approval-state-repo.ts";
import type { RunEvent } from "@taki/shared";
import type { ApprovalLabelResolver } from "./approval-labels.ts";

export function composeApprovalRuntime(input: {
  db: Database;
  governance: GovernancePolicyService;
  coreHostId: string;
  registry: MethodRegistry;
  connections: ConnectionRegistry;
  logger: Logger;
  recordRunEvent?: (event: Omit<RunEvent, "eventId" | "seq">) => void;
  resolveLabels?: ApprovalLabelResolver;
}) {
  const authority = createApprovalDecisionService(createApprovalStateRepo(input.db));
  const approval = createApprovalInteractionService(authority, input.recordRunEvent, input.resolveLabels);
  registerPermissionMethods(input.registry, {
    service: input.governance,
    logger: input.logger,
    onChanged: (generation) => approval.invalidatePolicy(generation),
  });
  registerApprovalMethods(input.registry, approval);
  input.connections.onRemove((connection) => approval.disconnect(connection));
  return {
    approval,
    coreToolGovernance: createCoreToolGovernanceAdapter(input.governance, input.coreHostId, approval),
  };
}
