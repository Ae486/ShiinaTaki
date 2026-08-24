/**
 * INPUT:  the shared Shell-capability route deps, the screenshot store/describe bridges, and an optional operator
 * OUTPUT: createCapabilityTools(deps) -> (interactive?) => the six Shell-routed capability tools as one ToolSet
 * POS:    core/capabilities — per-call construction binds the initiating operator socket (challenge ownership);
 *         the agent's per-turn bag, the unattended fallback, and the dev trigger all reuse this exact factory
 */
import type { ToolSet } from "ai";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import type { Logger } from "../logging/logger.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import type { HostCatalogStore } from "../hosts/host-catalog.ts";
import type { CapabilityBroker } from "./capability-broker.ts";
import type { InteractiveOperator } from "./route-capability.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createClipboardReadTool } from "./clipboard-read-tool.ts";
import { createClipboardWriteTool } from "./clipboard-write-tool.ts";
import { createExecTool } from "./exec-tool.ts";
import { createProcessListTool } from "./process-list-tool.ts";
import { createScreenshotStore } from "./screenshot-store.ts";
import { createScreenshotTool } from "./screenshot-tool.ts";
import { createShellOpenTool } from "./shell-open-tool.ts";

export interface CapabilityToolsDeps {
  registry: ConnectionRegistry;
  catalogs: HostCatalogStore;
  broker: CapabilityBroker;
  logger: Logger;
  governance: GovernancePolicyService;
  approval: ApprovalInteractionService;
  screenshotsDir: string;
  describe?: (input: { dataBase64: string; mediaType: string; prompt?: string }) => Promise<string | null>;
  effects?: EffectLifecycleService;
}

export function createCapabilityTools(
  deps: CapabilityToolsDeps,
): (interactive?: InteractiveOperator) => ToolSet {
  const routeDeps = (interactive?: InteractiveOperator) => ({
    registry: deps.registry,
    catalogs: deps.catalogs,
    broker: deps.broker,
    logger: deps.logger,
    governance: deps.governance,
    approval: deps.approval,
    effects: deps.effects,
    interactive,
  });
  return (interactive) => ({
    // The core is the single sanctioned Workspace writer (invariant 2); the Shell only returns base64 over the wire.
    ...createScreenshotTool({
      ...routeDeps(interactive),
      store: createScreenshotStore({ screenshotsDir: deps.screenshotsDir }),
      describe: deps.describe,
    }),
    ...createProcessListTool(routeDeps(interactive)),
    ...createClipboardReadTool(routeDeps(interactive)),
    ...createClipboardWriteTool(routeDeps(interactive)),
    ...createShellOpenTool(routeDeps(interactive)),
    ...createExecTool(routeDeps(interactive)),
  });
}
