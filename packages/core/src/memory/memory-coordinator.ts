/**
 * INPUT:  persisted authority epoch, provider registry, and provider-neutral operation requests
 * OUTPUT: immutable Run capture and capability-checked dispatch with one validated envelope and no implicit fallback
 * POS:    core/memory — provider-neutral routing seam; admitted Runs retain the exact selected provider
 */
import { randomUUID } from "node:crypto";
import {
  EditEnvelopeSchema, InvalidateEnvelopeSchema, MemoryErrorSchema, MemoryProviderCapabilitiesSchema,
  MutationRequestSchema, RecallEnvelopeSchema, RecallRequestSchema, ReflectEnvelopeSchema, ReflectRequestSchema,
  RestoreEnvelopeSchema, RetainEnvelopeSchema, RetainRequestSchema, MemoryAuthorityEpochSchema, type MemoryAuthorityEpoch,
  HindsightMemoryRecallEnvelopeV1Schema, HindsightMemoryReflectEnvelopeV1Schema, HindsightMemoryMutationEnvelopeV1Schema,
  HindsightMemoryRetainEnvelopeV1Schema, hindsightApplicationTaggedJson, hindsightApplicationWireJson, parseHindsightApplicationJson,
  type MemoryProviderCapabilities, type MemoryResult, type MutationRequest, type MutationResult,
  type RecallRequest, type RecallResult, type ReflectRequest, type ReflectResult, type RetainRequest, type RetainResult, type RunMemoryReference,
} from "@taki/shared";
import type { CanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import type { MemoryProvider, MemoryProviderCallContext } from "./memory-provider.ts";
import { createMemoryRunReference, freezeMemoryCapabilities, memoryCapabilityDigest,
  sameMemoryCapabilities, sameStableMemoryCapabilities, writableMemoryCapabilities } from "./memory-capability-snapshot.ts";
import { recallMatchesNamespace } from "./memory-recall-selection.ts";

type Operation = "retain" | "recall" | "reflect" | "mutate";
interface CoordinatorDeps { authority: Pick<CanonicalMemoryAuthorityRepo, "authorityEpoch">; providers: Map<string, MemoryProvider> }
interface ProviderBinding { epoch: MemoryAuthorityEpoch; provider: MemoryProvider; capabilities: MemoryProviderCapabilities; snapshot: RunMemoryReference; methods: MemoryProvider }
interface DispatchInput { deps: CoordinatorDeps; operation: Operation; request: unknown; call?: MemoryCoordinatorCallOptions; binding?: ProviderBinding }
interface ProviderDispatchInput extends DispatchInput { requestId: string; epoch: MemoryAuthorityEpoch }
interface ProviderInvocation extends ProviderDispatchInput {
  provider: MemoryProvider; context: MemoryProviderCallContext; caps: MemoryProviderCapabilities;
}
export interface MemoryCoordinatorCallOptions {
  requestId?: string;
  actor?: MemoryProviderCallContext["actor"];
  expectedAuthorityEpochId?: string;
  expectedProviderId?: string;
  expectedProviderLineageId?: string;
  expectedCapabilityDigest?: string;
  signal?: AbortSignal;
  provenance?: MemoryProviderCallContext["provenance"];
}
export interface MemoryCoordinator {
  capabilities(): Promise<MemoryProviderCapabilities>;
  retain(request: RetainRequest, call?: MemoryCoordinatorCallOptions): Promise<MemoryResult<RetainResult>>;
  recall(request: RecallRequest, call?: MemoryCoordinatorCallOptions): Promise<MemoryResult<RecallResult>>;
  reflect(request: ReflectRequest, call?: MemoryCoordinatorCallOptions): Promise<MemoryResult<ReflectResult>>;
  mutate(request: MutationRequest, call?: MemoryCoordinatorCallOptions): Promise<MemoryResult<MutationResult>>;
}

export interface CapturedMemoryCoordinator {
  readonly isCurrent?: () => boolean;
  readonly snapshot: RunMemoryReference;
  readonly authority: MemoryAuthorityEpoch;
  readonly coordinator: MemoryCoordinator;
}
export interface MemoryCoordinatorRuntime extends MemoryCoordinator {
  captureRun(): Promise<CapturedMemoryCoordinator>;
}

export function createMemoryCoordinator(deps: CoordinatorDeps): MemoryCoordinatorRuntime {
  return { ...operations(deps), captureRun: () => captureRun(deps) };
}

function operations(deps: CoordinatorDeps, binding?: ProviderBinding): MemoryCoordinator {
  return {
    capabilities: () => binding ? Promise.resolve(binding.capabilities) : capabilities(deps),
    retain: (request, call) => dispatch({ deps, binding, operation: "retain", request, call }) as Promise<MemoryResult<RetainResult>>,
    recall: (request, call) => dispatch({ deps, binding, operation: "recall", request, call }) as Promise<MemoryResult<RecallResult>>,
    reflect: (request, call) => dispatch({ deps, binding, operation: "reflect", request, call }) as Promise<MemoryResult<ReflectResult>>,
    mutate: (request, call) => dispatch({ deps, binding, operation: "mutate", request, call }) as Promise<MemoryResult<MutationResult>>,
  };
}

async function captureRun(deps: CoordinatorDeps): Promise<CapturedMemoryCoordinator> {
  const epoch = Object.freeze(MemoryAuthorityEpochSchema.parse(deps.authority.authorityEpoch()));
  const provider = requireProvider(deps, epoch);
  const methods = Object.freeze({ providerId: provider.providerId, providerLineageId: provider.providerLineageId,
    capabilities: provider.capabilities, retain: provider.retain,
    recall: provider.recall, reflect: provider.reflect, mutate: provider.mutate });
  const caps = freezeMemoryCapabilities(await provider.capabilities());
  const snapshot = createMemoryRunReference({ providerId: epoch.providerId, providerLineageId: epoch.providerLineageId,
    authorityEpochId: epoch.epochId, contractVersion: caps.contractVersion, capabilities: caps });
  const binding = Object.freeze({ epoch, provider, methods, capabilities: caps, snapshot });
  if (caps.providerId !== epoch.providerId || !bindingCurrent(deps, binding)) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  return Object.freeze({ snapshot, authority: epoch, isCurrent: () => bindingCurrent(deps, binding), coordinator: Object.freeze(operations(deps, binding)) });
}

async function capabilities(deps: CoordinatorDeps): Promise<MemoryProviderCapabilities> {
  const epoch = deps.authority.authorityEpoch();
  const provider = requireProvider(deps, epoch);
  const snapshot = MemoryProviderCapabilitiesSchema.parse(await provider.capabilities());
  if (snapshot.providerId !== epoch.providerId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  deps.authority.authorityEpoch(epoch.epochId);
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
  if (input.binding && !bindingCurrent(deps, input.binding)) return errorEnvelope({ requestId, epoch: input.binding.epoch, caps: input.binding.capabilities, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory Run authority is stale" });
  if (call?.expectedAuthorityEpochId && call.expectedAuthorityEpochId !== epoch.value.epochId) {
    return errorEnvelope({ requestId, epoch: epoch.value, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory authority is stale" });
  }
  if (call?.expectedProviderId && call.expectedProviderId !== epoch.value.providerId) return errorEnvelope({ requestId, epoch: epoch.value, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory provider identity is stale" });
  if (call?.expectedProviderLineageId && call.expectedProviderLineageId !== epoch.value.providerLineageId) return errorEnvelope({ requestId, epoch: epoch.value, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory provider lineage is stale" });
  // Frozen Pending/G1 write admission is narrower than D77 read evidence. Detect any lossy retain parse
  // against the original input synchronously, before capabilities or a write port can be invoked.
  if (epoch.value.providerId === "hindsight" && operation === "retain" && !retainMetadataPreserved(request, parsed.value)) {
    return errorEnvelope({ requestId, epoch: epoch.value, code: "MEMORY_INVALID_REQUEST", message: "memory retain metadata cannot be represented without loss" });
  }
  return dispatchToProvider({ ...input, request: parsed.value, requestId, epoch: input.binding?.epoch ?? epoch.value });
}

async function dispatchToProvider(input: ProviderDispatchInput): Promise<MemoryResult<unknown>> {
  const { deps, operation, request, call, requestId, epoch } = input;
  let provider: MemoryProvider;
  try { provider = input.binding?.provider ?? requireProvider(deps, epoch); }
  catch (error) { return providerResolutionFailure(error, { requestId, epoch }); }
  let caps: MemoryProviderCapabilities;
  try { caps = MemoryProviderCapabilitiesSchema.parse(await provider.capabilities()); }
  catch { return errorEnvelope({ requestId, epoch, caps: input.binding?.capabilities,
    code: input.binding ? "MEMORY_AUTHORITY_MISMATCH" : "MEMORY_INTERNAL_ERROR", message: "memory capability snapshot invalid" }); }
  if (!capabilitiesCurrent(input, caps)) return errorEnvelope({ requestId, epoch, caps: input.binding?.capabilities ?? caps, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory capabilities are stale" });
  if (caps.providerId !== provider.providerId) return errorEnvelope({ requestId, epoch, caps, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory provider identity is stale" });
  if (!caps[capabilityFor(operation, request)]) return errorEnvelope({ requestId, epoch, caps, code: "MEMORY_CAPABILITY_UNSUPPORTED", message: "memory operation unsupported" });
  if (!providerCurrent(input, provider)) return errorEnvelope({ requestId, epoch, caps, code: "MEMORY_AUTHORITY_MISMATCH", message: "memory authority changed before dispatch" });
  if (call?.signal?.aborted) return errorEnvelope({ requestId, epoch, caps, code: "MEMORY_OPERATION_CANCELLED", message: "memory operation cancelled" });
  const context = { requestId, authorityEpochId: epoch.epochId, actor: call?.actor ?? "foreground-agent", signal: call?.signal, provenance: call?.provenance };
  return invokeProvider({ ...input, provider, context, caps });
}

function capabilitiesCurrent(input: ProviderDispatchInput, caps: MemoryProviderCapabilities): boolean {
  const captured = input.binding?.capabilities;
  // A Run's own admission recall can lift vector health to ready; refusing its later writes for that would be spurious.
  if (captured && !(input.operation === "recall" ? sameStableMemoryCapabilities(captured, caps) : writableMemoryCapabilities(captured, caps))) return false;
  const expected = input.call?.expectedCapabilityDigest;
  return expected === undefined || expected === (input.binding?.snapshot.capabilityDigest ?? memoryCapabilityDigest(caps));
}

async function invokeProvider(input: ProviderInvocation): Promise<MemoryResult<unknown>> {
  const { deps, provider, operation, request, context, epoch, caps } = input;
  // The adapter receives a mutable request object; its in-place edits cannot redefine the invocation witness.
  let requestSnapshot: unknown;
  try {
    // structuredClone overflows on some deeply nested retain metadata that the frozen request schema accepts.
    // Retain has no optional undefined fields, so the existing iterative JSON codec makes an exact JSON snapshot.
    requestSnapshot = epoch.providerId === "hindsight" && operation === "retain"
      ? parseHindsightApplicationJson(hindsightApplicationWireJson(request)) : structuredClone(request);
  } catch {
    return errorEnvelope({ requestId: context.requestId, epoch, caps, code: "MEMORY_INVALID_REQUEST", message: "memory request cannot be snapshotted" });
  }
  let raw: unknown;
  try { raw = await callProvider(input); }
  catch { return postInvocationFailure(input, "MEMORY_INTERNAL_ERROR", "memory provider failed"); }
  let result: MemoryResult<unknown>;
  try { result = parseEnvelope({ operation, request: requestSnapshot, value: raw, providerId: epoch.providerId }); }
  catch { return postInvocationFailure(input, "MEMORY_INTERNAL_ERROR", "memory provider envelope is invalid"); }
  let currentCaps: MemoryProviderCapabilities;
  try { currentCaps = MemoryProviderCapabilitiesSchema.parse(await provider.capabilities()); }
  catch { return postInvocationFailure(input, input.binding ? "MEMORY_AUTHORITY_MISMATCH" : "MEMORY_INTERNAL_ERROR", "memory capability snapshot is unavailable"); }
  // The capability snapshot is part of the invocation contract.  Comparing only with the
  // post-call snapshot would accept a provider that changed capabilities mid-operation and
  // echoed the changed snapshot back in its envelope.  Reject both the envelope mismatch
  // and any snapshot drift so callers never observe a result under different capabilities.
  if (!matchesInvocation({ result, context, provider, epoch, operation, capabilities: caps, currentCapabilities: currentCaps })
    || !matchesOperationResult(result, { ...input, request: requestSnapshot })) {
    return postInvocationFailure(input, "MEMORY_AUTHORITY_MISMATCH", "memory provider envelope identity is stale");
  }
  let active: MemoryAuthorityEpoch;
  try { active = deps.authority.authorityEpoch(epoch.epochId); }
  catch { return postInvocationFailure(input, "MEMORY_AUTHORITY_MISMATCH", "memory authority changed during operation"); }
  if (active.providerId !== provider.providerId || active.providerLineageId !== provider.providerLineageId) return postInvocationFailure(input, "MEMORY_AUTHORITY_MISMATCH", "memory authority changed during operation", active);
  if (!providerCurrent(input, provider)) return postInvocationFailure(input, "MEMORY_AUTHORITY_MISMATCH", "memory provider changed during operation");
  return result;
}

// eslint-disable-next-line max-params
function postInvocationFailure(
  input: ProviderInvocation,
  readCode: "MEMORY_AUTHORITY_MISMATCH" | "MEMORY_INTERNAL_ERROR",
  readMessage: string,
  activeEpoch = input.epoch,
): MemoryResult<never> {
  const writeMayHaveApplied = input.operation === "retain" || input.operation === "mutate";
  return errorEnvelope({
    requestId: input.context.requestId,
    epoch: activeEpoch,
    caps: input.caps,
    code: writeMayHaveApplied ? "MEMORY_OUTCOME_UNKNOWN" : readCode,
    message: writeMayHaveApplied ? "memory operation outcome is unknown" : readMessage,
  });
}

function requireProvider(deps: CoordinatorDeps, epoch: MemoryAuthorityEpoch): MemoryProvider {
  const provider = deps.providers.get(epoch.providerId);
  if (!provider) throw new Error("MEMORY_PROVIDER_UNAVAILABLE");
  if (provider.providerId !== epoch.providerId || provider.providerLineageId !== epoch.providerLineageId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  return provider;
}

function bindingCurrent(deps: CoordinatorDeps, binding: ProviderBinding): boolean {
  if (!providerCurrent({ deps, epoch: binding.epoch }, binding.provider)) return false;
  return (["capabilities", "retain", "recall", "reflect", "mutate"] as const)
    .every((key) => binding.provider[key] === binding.methods[key]);
}

function providerCurrent(input: { deps: CoordinatorDeps; epoch: MemoryAuthorityEpoch; binding?: ProviderBinding }, provider: MemoryProvider): boolean {
  try {
    if (provider.providerId !== input.epoch.providerId || provider.providerLineageId !== input.epoch.providerLineageId) return false;
    const current = input.deps.authority.authorityEpoch(input.epoch.epochId);
    if (current.epochId !== input.epoch.epochId || current.providerId !== input.epoch.providerId || current.providerLineageId !== input.epoch.providerLineageId) return false;
    if (input.deps.providers.get(input.epoch.providerId) !== provider) return false;
    return !input.binding || bindingCurrent(input.deps, input.binding);
  } catch { return false; }
}

function readEpoch(deps: CoordinatorDeps, requestId: string): { ok: true; value: MemoryAuthorityEpoch } | { ok: false; result: MemoryResult<never> } {
  try { return { ok: true, value: deps.authority.authorityEpoch() }; }
  catch (error) { return { ok: false, result: authorityFailure(error, { requestId }) }; }
}

function parseRequest(operation: Operation, request: unknown): { ok: true; value: unknown } | { ok: false } {
  const schema = operation === "retain" ? RetainRequestSchema : operation === "recall" ? RecallRequestSchema : operation === "reflect" ? ReflectRequestSchema : MutationRequestSchema;
  try {
    const result = schema.safeParse(request);
    return result.success ? { ok: true, value: result.data } : { ok: false };
  } catch { return { ok: false }; } // Legacy recursive JSON validation can throw before producing Zod issues.
}

function retainMetadataPreserved(original: unknown, parsed: unknown): boolean {
  try { return hindsightApplicationTaggedJson((original as RetainRequest).metadata)
    === hindsightApplicationTaggedJson((parsed as RetainRequest).metadata); }
  catch { return false; }
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

function parseEnvelope(input: { operation: Operation; request: unknown; value: unknown; providerId: string }): MemoryResult<unknown> {
  const { operation, request, value, providerId } = input;
  // The admitted authority selects this adapter. An untrusted envelope's providerId cannot widen validation.
  if (providerId === "hindsight") {
    if (operation === "retain") return HindsightMemoryRetainEnvelopeV1Schema.parse(value);
    if (operation === "recall") return HindsightMemoryRecallEnvelopeV1Schema.parse(value);
    if (operation === "reflect") return HindsightMemoryReflectEnvelopeV1Schema.parse(value);
    return HindsightMemoryMutationEnvelopeV1Schema.parse(value);
  }
  if (operation === "retain") return RetainEnvelopeSchema.parse(value);
  if (operation === "recall") return RecallEnvelopeSchema.parse(value);
  if (operation === "reflect") return ReflectEnvelopeSchema.parse(value);
  const kind = (request as MutationRequest).kind;
  return (kind === "edit" ? EditEnvelopeSchema : kind === "invalidate" ? InvalidateEnvelopeSchema : RestoreEnvelopeSchema).parse(value);
}

function matchesInvocation(input: { result: MemoryResult<unknown>; context: MemoryProviderCallContext; provider: MemoryProvider; epoch: MemoryAuthorityEpoch; operation: Operation; capabilities: MemoryProviderCapabilities; currentCapabilities: MemoryProviderCapabilities }): boolean {
  const { result, context, provider, epoch, operation, capabilities, currentCapabilities } = input;
  if (result.requestId !== context.requestId || result.providerId !== provider.providerId || result.authorityEpochId !== epoch.epochId) return false;
  if (result.capabilities === null || !sameStableMemoryCapabilities(result.capabilities, capabilities) || !sameStableMemoryCapabilities(capabilities, currentCapabilities)) return false;
  if (operation !== "recall") return sameMemoryCapabilities(result.capabilities, capabilities) && sameMemoryCapabilities(capabilities, currentCapabilities);
  if (result.capabilities.vectorRetrieval !== currentCapabilities.vectorRetrieval) return false;
  return !result.ok || (result.data as RecallResult).vectorState === currentCapabilities.vectorRetrieval;
}

function matchesOperationResult(result: MemoryResult<unknown>, input: ProviderInvocation): boolean {
  if (!result.ok) return true;
  const authorityEpochId = input.epoch.epochId;
  if (input.operation === "recall") {
    const request = input.request as RecallRequest;
    return recallMatchesNamespace(result.data as RecallResult, { authorityEpochId, bankId: request.bankId });
  }
  if (input.operation !== "mutate") return true;
  const request = input.request as MutationRequest; const data = result.data as MutationResult;
  if (data.outcome === "pending") {
    // Both requests have passed the same strict schema, whose field order is deterministic. The durable receipt
    // must describe this exact accepted intent, including omitted versus null patch fields, not a different write.
    return data.pending.authorityEpochId === authorityEpochId && data.pending.bankId === request.bankId
      && data.pending.operationId === input.context.requestId
      && JSON.stringify(data.pending.operation.request) === JSON.stringify(request);
  }
  return data.record === null || (data.record.unit.authorityEpochId === authorityEpochId
    && data.record.unit.bankId === request.bankId && data.record.unit.memoryId === request.memoryId);
}

interface ErrorInput { requestId: string; epoch?: MemoryAuthorityEpoch; caps?: MemoryProviderCapabilities; code: "MEMORY_INVALID_REQUEST" | "MEMORY_OPERATION_CANCELLED" | "MEMORY_OUTCOME_UNKNOWN" | "MEMORY_AUTHORITY_MISMATCH" | "MEMORY_PROVIDER_UNAVAILABLE" | "MEMORY_INTEGRITY_ERROR" | "MEMORY_INTERNAL_ERROR" | "MEMORY_CAPABILITY_UNSUPPORTED"; message: string }
function errorEnvelope(input: ErrorInput): MemoryResult<never> {
  const policies = {
    MEMORY_INVALID_REQUEST: ["validation", false, "fix-request"], MEMORY_OPERATION_CANCELLED: ["availability", false, "none"],
    MEMORY_AUTHORITY_MISMATCH: ["authority", false, "check-provider"], MEMORY_PROVIDER_UNAVAILABLE: ["availability", true, "check-provider"],
    MEMORY_INTEGRITY_ERROR: ["integrity", false, "check-provider"], MEMORY_INTERNAL_ERROR: ["internal", false, "check-provider"], MEMORY_OUTCOME_UNKNOWN: ["availability", false, "check-provider"], MEMORY_CAPABILITY_UNSUPPORTED: ["capability", false, "none"],
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
