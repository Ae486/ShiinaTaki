/**
 * INPUT:  live Extension/Host, Governance, Memory, and model-route authorities at Run admission
 * OUTPUT: redaction-safe RunSnapshot plus process-local execution bindings and captured presentation names
 * POS:    core/harness — provider-neutral admission adapter; raw prompts, tools, secrets, and payloads never persist
 */
import { createHash } from "node:crypto";
import type { ToolSet } from "ai";
import { captureToolDisplayNames, type MemoryProviderCapabilities, type TriggerRequest } from "@taki/shared";
import type { ExtensionRunContext } from "../extensions/extension-run-context.ts";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { EffectLifecycleService } from "./effect-lifecycle-service.ts";
import type { CapturedRunSnapshot, RunSnapshotCapture } from "./run-service.ts";

interface SnapshotMemoryReference {
  providerId: string;
  providerLineageId?: string;
  authorityEpochId?: string;
  contractVersion: number;
  capabilities: MemoryProviderCapabilities;
}

interface CaptureDeps {
  extensions: { runContext(interactive?: TurnInteractive, runId?: string): ExtensionRunContext };
  governance: Pick<GovernancePolicyService, "level">;
  approval?: Pick<ApprovalInteractionService, "approvalGeneration">;
  memory: { snapshot(): SnapshotMemoryReference; createTools(characterId: string): ToolSet };
  provider: string;
  modelId: string;
  effects?: EffectLifecycleService;
}

export function createRunSnapshotCapture(input: CaptureDeps): RunSnapshotCapture<TurnInteractive> {
  return {
    capture: (request, runId, interactive) => captureSnapshot({ input, request, runId, interactive }),
  };
}

async function captureSnapshot(args: {
  input: CaptureDeps;
  request: TriggerRequest;
  runId: string;
  interactive?: TurnInteractive;
}): Promise<CapturedRunSnapshot> {
  const { input, request } = args;
  if (args.interactive) {
    args.interactive.runId = args.runId;
    args.interactive.effects ??= input.effects;
  }
  const context = input.extensions.runContext(args.interactive, args.runId);
  const hosts = context.snapshot.hosts.map((host) => ({ hostId: host.hostId, available: host.available,
    connectionGeneration: host.connectionGeneration, catalogGeneration: host.catalogGeneration }));
  const extensions = context.snapshot.entries.map((entry) => ({ extensionId: entry.identity.extensionId,
    kind: entry.identity.kind, ownerHostId: entry.identity.ownerHostId, subjectId: entry.identity.subjectId,
    subjectRevision: entry.identity.subjectRevision, connectionGeneration: entry.identity.connectionGeneration,
    catalogGeneration: entry.identity.catalogGeneration, callMode: entry.callMode, available: entry.available }));
  const governance = input.governance.level();
  const memory = input.memory.snapshot();
  const executionContext = Object.freeze({
    tools: context.tools,
    toolDisplayNames: captureToolDisplayNames(context.toolDisplayNames),
    memoryTools: Object.freeze(input.memory.createTools(request.characterId)),
    instructions: context.instructions,
  });
  return { context: executionContext, snapshot: { schemaVersion: "slice1.v1", characterId: request.characterId,
    initiator: request.initiator, provenance: request.provenance, deliveryClass: request.deliveryClass,
    contextMode: request.contextMode, modelProvider: input.provider, modelId: input.modelId,
    primaryHostId: context.snapshot.primaryHostId, hosts, extensions,
    extensionSnapshotDigest: digest({ primaryHostId: context.snapshot.primaryHostId, hosts, extensions }),
    governance: { policyGeneration: governance.policyGeneration, registryRevision: governance.registryRevision,
      approvalGeneration: input.approval?.approvalGeneration() ?? 1 },
    memory: { ...memory, capabilityDigest: digest(memory.capabilities) },
    contextDecision: { sourceCategories: ["character", "memory", "extensions"], tokenAccounting: "unknown" as const },
    replayDecision: { status: "not_captured" as const },
    budget: { deadlineAt: request.deadlineAt, budgetHint: request.budgetHint },
    implementation: { runtimeVersion: "slice1", schemaVersion: "slice1.v1" },
    sourceRefs: [] } };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
