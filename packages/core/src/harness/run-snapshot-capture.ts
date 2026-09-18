/**
 * INPUT:  live Extension/Host, Governance, Memory, and model-route authorities at Run admission
 * OUTPUT: cancellable immutable RunSnapshot draft and exact execution context under any explicit admission deadline
 * POS:    core/harness — provider-neutral admission adapter; raw prompts, tools, secrets, and payloads never persist
 */
import { createHash } from "node:crypto";
import type { ToolSet } from "ai";
import type { TriggerRequest } from "@taki/shared";
import type { ExtensionRunContext } from "../extensions/extension-run-context.ts";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { EffectLifecycleService } from "./effect-lifecycle-service.ts";
import type { CapturedRunSnapshot, RunSnapshotCapture } from "./run-service.ts";
import type { CapturedMemoryRun } from "../memory/canonical-memory-run.ts";
import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";

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
}

export function createRunSnapshotCapture(input: CaptureDeps): RunSnapshotCapture<TurnInteractive> {
  return {
    capture: (request, runId, interactive) => captureWithLifetime({ input, request, runId, interactive }),
  };
}

async function captureWithLifetime(args: CaptureInput): Promise<CapturedRunSnapshot> {
  const lifetime = captureLifetime(args.request.deadlineAt, args.interactive?.signal);
  try {
    lifetime.assert();
    const captured = await captureSnapshot({ ...args, signal: lifetime.signal });
    lifetime.assert(); return captured;
  } catch (error) { lifetime.assert(); throw error; }
  finally { lifetime.dispose(); }
}

async function captureSnapshot(args: CaptureInput): Promise<CapturedRunSnapshot> {
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
  const memory = await (args.signal ? input.memory.captureRun(request.characterId, args.signal) : input.memory.captureRun(request.characterId));
  if (args.signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
  const memorySnapshot = Object.isFrozen(memory.snapshot) && Object.isFrozen(memory.snapshot.capabilities)
    ? memory.snapshot : createMemoryRunReference(memory.snapshot);
  const executionContext = Object.freeze({
    tools: captureTools(context.tools),
    memoryTools: captureTools(memory.tools),
    memorySnapshot,
    automaticMemoryRecall: memory.automaticRecall,
    memoryPrompt: memory.prompt,
    assembleMemory: memory.assemble,
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
    contextDecision: { sourceCategories: ["character", "memory", "extensions"], tokenAccounting: "unknown" as const },
    replayDecision: { status: "not_captured" as const },
    budget: { deadlineAt: request.deadlineAt, budgetHint: request.budgetHint },
    implementation: { runtimeVersion: "slice1", schemaVersion: "slice1.v1" },
    sourceRefs: [] } };
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
