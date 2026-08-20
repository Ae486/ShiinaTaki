/**
 * INPUT:  persisted Local authority epoch, provider registry, and provider-neutral operation requests
 * OUTPUT: async capability-checked dispatch with one validated envelope and no implicit fallback
 * POS:    core/memory — authority routing seam; production composition remains legacy until Batch 2
 */
import { randomUUID } from "node:crypto";
import {
  EditEnvelopeSchema, InvalidateEnvelopeSchema, MemoryErrorSchema, MemoryProviderCapabilitiesSchema,
  MutationRequestSchema, RecallEnvelopeSchema, RecallRequestSchema, ReflectEnvelopeSchema, ReflectRequestSchema,
  RestoreEnvelopeSchema, RetainEnvelopeSchema, RetainRequestSchema, type MemoryAuthorityEpoch,
  type MemoryProviderCapabilities, type MemoryResult, type MutationRequest, type MutationResult,
  type RecallRequest, type RecallResult, type ReflectRequest, type ReflectResult, type RetainRequest, type RetainResult,
} from "@taki/shared";
import type { CanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import type { MemoryProvider, MemoryProviderCallContext } from "./memory-provider.ts";

type Operation = "retain" | "recall" | "reflect" | "mutate";
interface CoordinatorDeps { authority: CanonicalMemoryAuthorityRepo; providers: Map<string, MemoryProvider> }
interface DispatchInput { deps: CoordinatorDeps; operation: Operation; request: unknown; call?: MemoryCoordinatorCallOptions }
interface ProviderDispatchInput extends DispatchInput { requestId: string; epoch: MemoryAuthorityEpoch }
interface ProviderInvocation extends ProviderDispatchInput {
  provider: MemoryProvider; context: MemoryProviderCallContext; caps: MemoryProviderCapabilities;
}
export interface MemoryCoordinatorCallOptions { requestId?: string; actor?: MemoryProviderCallContext["actor"]; expectedAuthorityEpochId?: string; signal?: AbortSignal; }
export interface MemoryCoordinator {
  capabilities(): Promise<MemoryProviderCapabilities>;
  retain(request: RetainRequest, call?: MemoryCoordinatorCallOptions): Promise<MemoryResult<RetainResult>>;
  recall(request: RecallRequest, call?: MemoryCoordinatorCallOptions): Promise<MemoryResult<RecallResult>>;
  reflect(request: ReflectRequest, call?: MemoryCoordinatorCallOptions): Promise<MemoryResult<ReflectResult>>;
  mutate(request: MutationRequest, call?: MemoryCoordinatorCallOptions): Promise<MemoryResult<MutationResult>>;
}

export function createMemoryCoordinator(deps: CoordinatorDeps): MemoryCoordinator {
  return {
    capabilities: () => capabilities(deps),
    retain: (request, call) => dispatch({ deps, operation: "retain", request, call }) as Promise<MemoryResult<RetainResult>>,
    recall: (request, call) => dispatch({ deps, operation: "recall", request, call }) as Promise<MemoryResult<RecallResult>>,
    reflect: (request, call) => dispatch({ deps, operation: "reflect", request, call }) as Promise<MemoryResult<ReflectResult>>,
    mutate: (request, call) => dispatch({ deps, operation: "mutate", request, call }) as Promise<MemoryResult<MutationResult>>,
  };
}

async function capabilities(deps: CoordinatorDeps): Promise<MemoryProviderCapabilities> {
  const epoch = deps.authority.activeEpoch();
  const provider = requireProvider(deps, epoch);
  const snapshot = MemoryProviderCapabilitiesSchema.parse(await provider.capabilities());
  if (snapshot.providerId !== epoch.providerId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  deps.authority.activeEpoch(epoch.epochId);
  return snapshot;
}

async function dispatch(input: DispatchInput): Promise<MemoryResult<unknown>> {
  const { deps, operation, request, call } = input;
  const requestId = call?.requestId ?? randomUUID();
  if (call?.signal?.aborted) return errorEnvelope({ requestId, code: "MEMORY_OPERATION_CANCELLED", message: "memory operation cancelled" });
  const parsed = parseRequest(operation, request);
  if (!parsed.ok) return errorEnvelope({ requestId, code: "MEMORY_INVALID_REQUEST", message: "memory request is invalid" });
  const epoch = readEpoch(deps, requestId);
  if (!epoch.ok) return epoch.result;
  if (call?.expectedAuthorityEpochId && call.expectedAuthorityEpochId !== epoch.value.epochId) {
    return errorEnvelope({ requestId, epoch: epoch.value, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory authority is stale" });
  }
  return dispatchToProvider({ deps, operation, request: parsed.value, call, requestId, epoch: epoch.value });
}

async function dispatchToProvider(input: ProviderDispatchInput): Promise<MemoryResult<unknown>> {
  const { deps, operation, request, call, requestId, epoch } = input;
  let provider: MemoryProvider;
  try { provider = requireProvider(deps, epoch); }
  catch (error) { return providerResolutionFailure(error, { requestId, epoch }); }
  let caps: MemoryProviderCapabilities;
  try { caps = MemoryProviderCapabilitiesSchema.parse(await provider.capabilities()); } catch { return errorEnvelope({ requestId, epoch, code: "MEMORY_INTERNAL_ERROR", message: "memory capability snapshot invalid" }); }
  if (caps.providerId !== provider.providerId) return errorEnvelope({ requestId, epoch, caps, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory provider identity is stale" });
  if (!caps[capabilityFor(operation, request)]) return errorEnvelope({ requestId, epoch, caps, code: "MEMORY_CAPABILITY_UNSUPPORTED", message: "memory operation unsupported" });
  if (call?.signal?.aborted) return errorEnvelope({ requestId, epoch, caps, code: "MEMORY_OPERATION_CANCELLED", message: "memory operation cancelled" });
  const context = { requestId, authorityEpochId: epoch.epochId, actor: call?.actor ?? "foreground-agent", signal: call?.signal };
  return invokeProvider({ ...input, provider, context, caps });
}

async function invokeProvider(input: ProviderInvocation): Promise<MemoryResult<unknown>> {
  const { deps, provider, operation, request, context, epoch, caps } = input;
  let result: MemoryResult<unknown>;
  try { result = parseEnvelope(operation, request, await callProvider(input)); }
  catch { return errorEnvelope({ requestId: context.requestId, epoch, caps, code: "MEMORY_INTERNAL_ERROR", message: "memory provider failed" }); }
  let currentCaps: MemoryProviderCapabilities;
  try { currentCaps = MemoryProviderCapabilitiesSchema.parse(await provider.capabilities()); }
  catch { return errorEnvelope({ requestId: context.requestId, epoch, caps, code: "MEMORY_INTERNAL_ERROR", message: "memory capability snapshot invalid" }); }
  // The capability snapshot is part of the invocation contract.  Comparing only with the
  // post-call snapshot would accept a provider that changed capabilities mid-operation and
  // echoed the changed snapshot back in its envelope.  Reject both the envelope mismatch
  // and any snapshot drift so callers never observe a result under different capabilities.
  if (!matchesInvocation({ result, context, provider, epoch, operation, capabilities: caps, currentCapabilities: currentCaps })) {
    return errorEnvelope({ requestId: context.requestId, epoch, caps, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory provider envelope identity is stale" });
  }
  let active: MemoryAuthorityEpoch;
  try { active = deps.authority.activeEpoch(epoch.epochId); }
  catch (error) { return authorityFailure(error, { requestId: context.requestId, epoch, caps }); }
  if (active.providerId !== provider.providerId || active.providerLineageId !== provider.providerLineageId) return errorEnvelope({ requestId: context.requestId, epoch: active, caps, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory authority changed during operation" });
  return result;
}

function requireProvider(deps: CoordinatorDeps, epoch: MemoryAuthorityEpoch): MemoryProvider {
  const provider = deps.providers.get(epoch.providerId);
  if (!provider) throw new Error("MEMORY_PROVIDER_UNAVAILABLE");
  if (provider.providerId !== epoch.providerId || provider.providerLineageId !== epoch.providerLineageId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  return provider;
}

function readEpoch(deps: CoordinatorDeps, requestId: string): { ok: true; value: MemoryAuthorityEpoch } | { ok: false; result: MemoryResult<never> } {
  try { return { ok: true, value: deps.authority.activeEpoch() }; }
  catch (error) { return { ok: false, result: authorityFailure(error, { requestId }) }; }
}

function parseRequest(operation: Operation, request: unknown): { ok: true; value: unknown } | { ok: false } {
  const schema = operation === "retain" ? RetainRequestSchema : operation === "recall" ? RecallRequestSchema : operation === "reflect" ? ReflectRequestSchema : MutationRequestSchema;
  const result = schema.safeParse(request);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}

function capabilityFor(operation: Operation, request: unknown): "retain" | "recall" | "reflect" | "edit" | "invalidate" | "restore" {
  if (operation !== "mutate") return operation;
  const kind = (request as MutationRequest).kind;
  return kind === "edit" ? "edit" : kind;
}

function callProvider(input: ProviderInvocation): Promise<MemoryResult<unknown>> {
  const { provider, operation, context, request } = input;
  if (operation === "retain") return provider.retain(context, request as RetainRequest);
  if (operation === "recall") return provider.recall(context, request as RecallRequest);
  if (operation === "reflect") return provider.reflect(context, request as ReflectRequest);
  return provider.mutate(context, request as MutationRequest);
}

function parseEnvelope(operation: Operation, request: unknown, value: unknown): MemoryResult<unknown> {
  if (operation === "retain") return RetainEnvelopeSchema.parse(value);
  if (operation === "recall") return RecallEnvelopeSchema.parse(value);
  if (operation === "reflect") return ReflectEnvelopeSchema.parse(value);
  const kind = (request as MutationRequest).kind;
  return (kind === "edit" ? EditEnvelopeSchema : kind === "invalidate" ? InvalidateEnvelopeSchema : RestoreEnvelopeSchema).parse(value);
}

function matchesInvocation(input: { result: MemoryResult<unknown>; context: MemoryProviderCallContext; provider: MemoryProvider; epoch: MemoryAuthorityEpoch; operation: Operation; capabilities: MemoryProviderCapabilities; currentCapabilities: MemoryProviderCapabilities }): boolean {
  const { result, context, provider, epoch, operation, capabilities, currentCapabilities } = input;
  if (result.requestId !== context.requestId || result.providerId !== provider.providerId || result.authorityEpochId !== epoch.epochId) return false;
  if (result.capabilities === null || !sameStableCapabilities(result.capabilities, capabilities) || !sameStableCapabilities(capabilities, currentCapabilities)) return false;
  if (operation !== "recall") return sameCapabilities(result.capabilities, capabilities);
  if (result.capabilities.vectorRetrieval !== currentCapabilities.vectorRetrieval) return false;
  return !result.ok || (result.data as RecallResult).vectorState === currentCapabilities.vectorRetrieval;
}

function sameCapabilities(left: MemoryProviderCapabilities, right: MemoryProviderCapabilities): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStableCapabilities(left: MemoryProviderCapabilities, right: MemoryProviderCapabilities): boolean {
  return JSON.stringify({ ...left, vectorRetrieval: undefined }) === JSON.stringify({ ...right, vectorRetrieval: undefined });
}

interface ErrorInput { requestId: string; epoch?: MemoryAuthorityEpoch; caps?: MemoryProviderCapabilities; code: "MEMORY_INVALID_REQUEST" | "MEMORY_OPERATION_CANCELLED" | "MEMORY_AUTHORITY_MISMATCH" | "MEMORY_PROVIDER_UNAVAILABLE" | "MEMORY_INTEGRITY_ERROR" | "MEMORY_INTERNAL_ERROR" | "MEMORY_CAPABILITY_UNSUPPORTED"; message: string }
function errorEnvelope(input: ErrorInput): MemoryResult<never> {
  const policies = {
    MEMORY_INVALID_REQUEST: ["validation", false, "fix-request"], MEMORY_OPERATION_CANCELLED: ["availability", false, "none"],
    MEMORY_AUTHORITY_MISMATCH: ["authority", false, "check-provider"], MEMORY_PROVIDER_UNAVAILABLE: ["availability", true, "check-provider"],
    MEMORY_INTEGRITY_ERROR: ["integrity", false, "check-provider"], MEMORY_INTERNAL_ERROR: ["internal", false, "check-provider"], MEMORY_CAPABILITY_UNSUPPORTED: ["capability", false, "none"],
  } as const;
  const [category, retryable, nextAction] = policies[input.code];
  const error = MemoryErrorSchema.parse({ code: input.code, category, message: input.message, retryable, nextAction });
  return { ok: false, requestId: input.requestId, providerId: input.epoch?.providerId ?? "unknown", authorityEpochId: input.epoch?.epochId ?? null, capabilities: input.caps ?? null, error };
}

function providerResolutionFailure(error: unknown, input: Pick<ErrorInput, "requestId" | "epoch">): MemoryResult<never> {
  const mismatch = error instanceof Error && error.message.includes("AUTHORITY_MISMATCH");
  return errorEnvelope({ ...input, code: mismatch ? "MEMORY_AUTHORITY_MISMATCH" : "MEMORY_PROVIDER_UNAVAILABLE", message: mismatch ? "memory provider lineage is stale" : "memory provider unavailable" });
}

function authorityFailure(error: unknown, input: Pick<ErrorInput, "requestId" | "epoch" | "caps">): MemoryResult<never> {
  const integrity = error instanceof Error && error.message.includes("INTEGRITY_ERROR");
  return errorEnvelope({ ...input, code: integrity ? "MEMORY_INTEGRITY_ERROR" : "MEMORY_AUTHORITY_MISMATCH", message: integrity ? "memory authority state is invalid" : "memory authority is unavailable" });
}
