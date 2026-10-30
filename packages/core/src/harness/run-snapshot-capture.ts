/**
 * INPUT:  live Extension/Host, Governance, Memory, and model-route authorities at Run admission
 * OUTPUT: cancellable immutable RunSnapshot plus exact Memory/tool bindings and captured presentation names
 * POS:    core/harness — provider-neutral admission adapter; raw prompts, tools, secrets, and payloads never persist
 */
import { createHash } from "node:crypto";
import type { ToolSet } from "ai";
import { captureToolDisplayNames, InitiativeSelectedContextSchema, type InitiativeSelectedContext, type TriggerRequest, type SubagentWorkScope } from "@taki/shared";
import type { ExtensionRunContext } from "../extensions/extension-run-context.ts";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { EffectLifecycleService } from "./effect-lifecycle-service.ts";
import type { CapturedRunSnapshot, RunSnapshotCapture } from "./run-service.ts";
import type { CapturedMemoryRun } from "../memory/canonical-memory-run.ts";
import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";
import { createInitiativeMemoryRecall } from "../memory/initiative-memory-recall.ts";
import { childMemoryExclusions, projectChildMemory } from "./delegation-tools.ts";

interface CaptureDeps {
  extensions: { runContext(interactive?: TurnInteractive, runId?: string): ExtensionRunContext };
  governance: Pick<GovernancePolicyService, "level">;
  approval?: Pick<ApprovalInteractionService, "approvalGeneration">;
  memory: { captureRun(characterId: string, signal?: AbortSignal): Promise<CapturedMemoryRun> };
  provider: string;
  modelId: string;
  effects?: EffectLifecycleService;
}
interface CaptureInput {
  input: CaptureDeps; request: TriggerRequest; runId: string; interactive?: TurnInteractive; signal?: AbortSignal;
  selectedContext?: InitiativeSelectedContext;
  workScope?: SubagentWorkScope;
}

export function createRunSnapshotCapture(input: CaptureDeps): RunSnapshotCapture<TurnInteractive> {
  return {
    capture: (request, runId, options) => captureWithLifetime({ input, request, runId,
      interactive: options?.admission, selectedContext: options?.selectedContext, workScope: options?.workScope, signal: options?.signal }),
  };
}

async function captureWithLifetime(args: CaptureInput): Promise<CapturedRunSnapshot> {
  const lifetime = captureLifetime(args.request.deadlineAt, args.signal ?? args.interactive?.signal);
  try {
    lifetime.assert();
    const captured = await captureSnapshot({ ...args, signal: lifetime.signal });
    lifetime.assert(); return captured;
  } catch (error) { lifetime.assert(); throw error; }
  finally { lifetime.dispose(); }
}

async function captureSnapshot(args: CaptureInput): Promise<CapturedRunSnapshot> {
  const { input, request } = args;
  if (request.initiator === "heartbeat" && !args.selectedContext) throw new Error("INITIATIVE_CONTEXT_REQUIRED");
  const selected = args.selectedContext ? InitiativeSelectedContextSchema.parse(args.selectedContext) : undefined;
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
  const memory = await (args.signal ? input.memory.captureRun(request.characterId, args.signal) : input.memory.captureRun(request.characterId));
  if (args.signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
  const memorySnapshot = Object.isFrozen(memory.snapshot) && Object.isFrozen(memory.snapshot.capabilities)
    ? memory.snapshot : createMemoryRunReference(memory.snapshot);
  const selectedRecall = selected?.relatedMemory ? createInitiativeMemoryRecall(memory, selected.relatedMemory) : undefined;
  const executionContext = Object.freeze({
    authorityCurrent: () => input.governance.level().policyGeneration === governance.policyGeneration
      && memory.isCurrent?.() !== false && selectedRecall?.isCurrent() !== false,
    selectedContext: selected ? freezeSelection(selected) : undefined,
    tools: captureTools(context.tools),
    toolDisclosure: context.toolDisclosure,
    ...captureMemoryTools(memory.tools, args.workScope, selectedRecall?.tools),
    memorySnapshot,
    automaticMemoryRecall: memory.automaticRecall,
    memoryPrompt: memory.prompt,
    assembleMemory: memory.assemble,
      toolDisplayNames: captureToolDisplayNames(context.toolDisplayNames),
    instructions: context.instructions,
  });
  return { context: executionContext, snapshot: { schemaVersion: "slice1.v1", characterId: request.characterId,
    initiator: request.initiator, provenance: request.provenance, deliveryClass: request.deliveryClass,
    contextMode: request.contextMode, modelProvider: input.provider, modelId: input.modelId,
    primaryHostId: context.snapshot.primaryHostId, hosts, extensions,
    extensionSnapshotDigest: digest({ primaryHostId: context.snapshot.primaryHostId, hosts, extensions }),
    governance: { policyGeneration: governance.policyGeneration, registryRevision: governance.registryRevision,
      approvalGeneration: input.approval?.approvalGeneration() ?? 1 },
    memory: memorySnapshot,
    contextDecision: { sourceCategories: selected ? [...new Set(selected.manifest.sources.map((source) => source.category))] : ["character", "memory", "extensions"], tokenAccounting: selected?.manifest.accountingQuality ?? "unknown" as const },
    ...(selected ? { initiativeContext: selected.manifest } : {}),
    replayDecision: { status: "not_captured" as const },
    budget: { deadlineAt: request.deadlineAt, budgetHint: request.budgetHint },
    implementation: { runtimeVersion: "slice1", schemaVersion: "slice1.v1" },
    sourceRefs: [] } };
}

function captureMemoryTools(tools: ToolSet, scope: SubagentWorkScope | undefined, selected: ToolSet | undefined) {
  const child = scope?.kind === "subagent";
  return { memoryTools: captureTools(child ? projectChildMemory(tools) : selected ?? tools),
    memoryToolExclusions: child ? childMemoryExclusions(tools) : undefined };
}

function freezeSelection(selected: InitiativeSelectedContext): InitiativeSelectedContext {
  for (const source of selected.manifest.sources) Object.freeze(source);
  Object.freeze(selected.manifest.sources); Object.freeze(selected.manifest);
  Object.freeze(selected.allowedToolNames); Object.freeze(selected.candidateIds);
  if (selected.candidatePolicies) {
    for (const policy of selected.candidatePolicies) { Object.freeze(policy.allowedOutcomes); Object.freeze(policy); }
    Object.freeze(selected.candidatePolicies);
  }
  if (selected.relatedMemory) { Object.freeze(selected.relatedMemory.scopes); Object.freeze(selected.relatedMemory); }
  return Object.freeze(selected);
}

function captureLifetime(deadlineAt?: string, caller?: AbortSignal) {
  if (deadlineAt === undefined) return { signal: caller, dispose: () => undefined,
    assert: () => { if (caller?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED"); } };
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline)) throw new Error("RUN_DEADLINE_EXCEEDED");
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let failure: Error | undefined;
  const stop = (code: "MEMORY_OPERATION_CANCELLED" | "RUN_DEADLINE_EXCEEDED") => {
    if (failure) return;
    failure = new Error(code); controller.abort(failure); clearTimeout(timer);
  };
  const cancel = () => stop("MEMORY_OPERATION_CANCELLED");
  const arm = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { stop("RUN_DEADLINE_EXCEEDED"); return; }
    // A distant explicit deadline must not overflow Node's timer into a 1ms abort.
    timer = setTimeout(arm, Math.min(remaining, 2_147_483_647)); timer.unref?.();
  };
  caller?.addEventListener("abort", cancel, { once: true });
  if (caller?.aborted) cancel(); else arm();
  return { signal: controller.signal,
    assert: () => { if (!failure && Date.now() >= deadline) stop("RUN_DEADLINE_EXCEEDED"); if (failure) throw failure; },
    dispose: () => { clearTimeout(timer); caller?.removeEventListener("abort", cancel); } };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function captureTools(tools: ToolSet): ToolSet {
  if (Object.isFrozen(tools) && Object.values(tools).every(Object.isFrozen)) return tools;
  // Preserve non-enumerable governance sidecars while detaching replaceable tool descriptors from the source.
  const entries = Object.entries(tools).map(([name, value]) => [name,
    Object.freeze(Object.create(Object.getPrototypeOf(value), Object.getOwnPropertyDescriptors(value))) as ToolSet[string]]);
  return Object.freeze(Object.fromEntries(entries));
}
