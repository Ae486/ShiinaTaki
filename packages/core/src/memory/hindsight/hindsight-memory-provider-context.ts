/**
 * INPUT:  captured Hindsight authority, B3 connection/Bank routes and verified application replica
 * OUTPUT: guarded foreground HTTP allowances or explicit operation deadlines, verified capabilities and closed public error envelopes
 * POS:    core/memory/hindsight — runtime identity boundary; degraded availability never changes Memory Authority
 */
import {
  MEMORY_ERROR_POLICY, MemoryErrorSchema, MemoryProviderCapabilitiesSchema,
  type HindsightConnectionProjection, type MemoryProviderCapabilities, type MemoryReplicaBank,
  type MemoryResult, type MemoryErrorCode, type RetainRequest, type RetainResult, type MutationRequest, type MutationResult,
  type RecallPendingOverlayEntry,
} from "@taki/shared";
import type { CanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import type { HindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-contract.ts";
import type { HindsightRuntimeAdmissionRepo } from "../../db/hindsight-runtime-admission-repo.ts";
import type { PendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import type { MemoryProviderCallContext } from "../memory-provider.ts";
import type { HindsightClient, HindsightCallContext } from "./hindsight-client.ts";
import { HindsightApplicationRefusal } from "./hindsight-application-client.ts";
import { admitHindsightApplication, requireHindsightApplicationCapability, requireHindsightApplicationClient } from "./hindsight-application-capability.ts";
import { hindsightApplicationDeadline } from "./hindsight-application-body-transfer.ts";
import { sameApplicationValue, type HindsightApplicationScope } from "./hindsight-application-integrity.ts";
import { HindsightPolicyRefusal } from "./hindsight-policy-context.ts";
import { HindsightError } from "./hindsight-errors.ts";
import type { HindsightRuntimeSynchronizeInput } from "./hindsight-runtime-bank-service.ts";

export interface HindsightMemoryWritePort {
  retain(context: MemoryProviderCallContext, request: RetainRequest): Promise<RetainResult>;
  mutate(context: MemoryProviderCallContext, request: MutationRequest): Promise<MutationResult>;
  mutationOverlays?(bankId: string): RecallPendingOverlayEntry[];
  ownsPendingOperation?(operationId: string): boolean;
}
export interface HindsightMemoryProviderDeps {
  epochId: string; authority: CanonicalMemoryAuthorityRepo; replica: HindsightApplicationReplicaRepo;
  admission: HindsightRuntimeAdmissionRepo; pending: PendingMemoryRepo; client: HindsightClient;
  connection: HindsightConnectionProjection; configFingerprint: string;
  bank(bankId: string): MemoryReplicaBank;
  assertConnection(): void;
  synchronize(input: HindsightRuntimeSynchronizeInput): Promise<void>;
  writes: HindsightMemoryWritePort;
  now?: () => string;
  signal?: AbortSignal;
}
export type HindsightMemoryProviderState = ReturnType<typeof createHindsightMemoryProviderState>;

export function createHindsightMemoryProviderState(deps: HindsightMemoryProviderDeps) {
  const epoch = deps.authority.authorityEpoch(deps.epochId);
  if (epoch.providerId !== "hindsight") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const client = requireHindsightApplicationClient(deps.client);
  let vector: MemoryProviderCapabilities["vectorRetrieval"] = "degraded";
  const identity = { authorityEpochId: deps.epochId, configFingerprint: deps.configFingerprint };
  const now = deps.now ?? (() => new Date().toISOString());
  const assert = (context?: MemoryProviderCallContext, bankId?: string) => {
    if (deps.signal?.aborted || context?.signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
    deps.assertConnection();
    const current = deps.authority.authorityEpoch(deps.epochId);
    if (context && context.authorityEpochId !== deps.epochId || current.providerId !== "hindsight"
      || current.providerLineageId !== epoch.providerLineageId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    if (bankId !== undefined && deps.bank(bankId).bankId !== bankId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  };
  const capabilities = async (request?: () => HindsightCallContext): Promise<MemoryProviderCapabilities> => {
    assert();
    let evidence = deps.admission.read(identity);
    if (!evidence) {
      const remaining = request ?? hindsightApplicationDeadline({ timeoutMs: deps.connection.requestTimeoutMs, signal: deps.signal });
      const result = await admitHindsightApplication({ client, expectedLineage: epoch.providerLineageId,
        request: () => { assert(); return remaining(); } });
      assert(); evidence = deps.admission.save({ ...identity, manifest: result.manifest, admittedAt: now() });
    }
    return project(evidence);
  };
  const project = (evidence: NonNullable<ReturnType<HindsightRuntimeAdmissionRepo["read"]>>) => {
    const admitted = requireHindsightApplicationCapability(evidence.manifest);
    return MemoryProviderCapabilitiesSchema.parse({ providerId: "hindsight", contractVersion: 1,
      retain: true, recall: true, reflect: admitted.guardedReflect, edit: true, invalidate: true, restore: true,
      conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: vector, derivedMemoryRead: true });
  };
  return { deps, epoch, client, now, assert, capabilities,
    capabilitiesSnapshot: () => { assert(); const evidence = deps.admission.read(identity); return evidence ? project(evidence) : undefined; },
    setVector: (value: "ready" | "degraded") => { vector = value; } };
}

export function hindsightProviderCall(state: HindsightMemoryProviderState, input: {
  context: MemoryProviderCallContext; bankId: string; operationTimeoutMs?: number; mode?: "foreground";
}) {
  state.assert(input.context, input.bankId);
  const signals = [state.deps.signal, input.context.signal].filter((signal): signal is AbortSignal => signal !== undefined);
  const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;
  // Foreground reads own no total business timer. Explicit operation allowances
  // still shrink across every phase, including Reflect's independent deadline.
  const deadline = input.mode === "foreground" && input.operationTimeoutMs === undefined
    ? () => ({ timeoutMs: state.deps.connection.requestTimeoutMs, signal })
    : hindsightApplicationDeadline({ timeoutMs: input.operationTimeoutMs ?? state.deps.connection.requestTimeoutMs, signal });
  return () => { state.assert(input.context, input.bankId); return deadline(); };
}

export function hindsightProviderBank(state: HindsightMemoryProviderState, input: { context: MemoryProviderCallContext; bankId: string }) {
  state.assert(input.context, input.bankId);
  const route = state.deps.bank(input.bankId); const bound = state.deps.replica.bankBinding(input.bankId);
  if (!bound?.bank || bound.bankDeleted || bound.bindingState !== "bound") throw new Error("HINDSIGHT_APPLICATION_BANK_UNAVAILABLE");
  if (bound.authorityEpochId !== state.epoch.epochId || bound.namespace.provider_lineage !== state.epoch.providerLineageId
    || bound.scope.kind !== route.scope || bound.scope.characterId !== route.characterId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  return { bankId: input.bankId, namespace: bound.namespace, bank: bound.bank, route, bankScope: bound.scope };
}

export function assertHindsightProviderScope(state: HindsightMemoryProviderState, input: {
  context: MemoryProviderCallContext; scope: HindsightApplicationScope;
}): void {
  const bank = hindsightProviderBank(state, { context: input.context, bankId: input.scope.bankId });
  if (!sameApplicationValue(bank.namespace, input.scope.namespace)) throw new Error("MEMORY_AUTHORITY_MISMATCH");
}

export function hindsightAvailabilityFailure(error: unknown): boolean {
  // B5 recovery intentionally rethrows its closed diagnostic as a plain Error.
  // Preserve that availability meaning across the adapter: losing the native
  // ACK must leave the already durable intent pending, not report an internal bug.
  const code = error instanceof HindsightError ? error.code : error instanceof Error ? error.message : "";
  return ["HINDSIGHT_UNREACHABLE", "HINDSIGHT_TIMEOUT", "HINDSIGHT_DEADLINE_EXCEEDED", "HINDSIGHT_HEALTH_FAILED",
    "HINDSIGHT_SECRET_UNAVAILABLE", "HINDSIGHT_AUTHENTICATION_FAILED"].includes(code);
}

export function hindsightProviderError<T>(input: {
  context: MemoryProviderCallContext; capabilities: MemoryProviderCapabilities | null; error: unknown;
}): MemoryResult<T> {
  const code = publicCode(input.error);
  const [category, retryable, nextAction] = MEMORY_ERROR_POLICY[code];
  return { ok: false, requestId: input.context.requestId, providerId: "hindsight", authorityEpochId: input.context.authorityEpochId,
    capabilities: input.capabilities, error: MemoryErrorSchema.parse({ code, category, retryable, nextAction, message: MESSAGES[code] }) };
}

function publicCode(error: unknown): MemoryErrorCode {
  if (hindsightAvailabilityFailure(error)) return "MEMORY_PROVIDER_UNAVAILABLE";
  if (error instanceof HindsightApplicationRefusal || error instanceof HindsightPolicyRefusal) {
    const code = error instanceof HindsightApplicationRefusal ? error.refusal.code : error.code;
    if (code === "native_version_conflict" || code === "artifact_conflict") return "MEMORY_REVISION_MISMATCH";
    if (code === "capability_unsupported") return "MEMORY_CAPABILITY_UNSUPPORTED";
    if (code === "namespace_mismatch" || code === "bank_deleted") return "MEMORY_AUTHORITY_MISMATCH";
    return "MEMORY_INTEGRITY_ERROR";
  }
  const code = error instanceof HindsightError ? error.code : error instanceof Error ? error.message : "";
  if (Object.hasOwn(MESSAGES, code)) return code as MemoryErrorCode;
  if (code === "HINDSIGHT_CANCELLED") return "MEMORY_OPERATION_CANCELLED";
  if (code === "HINDSIGHT_EXTENSION_UNSUPPORTED") return "MEMORY_CAPABILITY_UNSUPPORTED";
  if (code === "HINDSIGHT_APPLICATION_BANK_UNAVAILABLE" || code === "HINDSIGHT_CHECKPOINT_MISSING") return "MEMORY_PROVIDER_UNAVAILABLE";
  if (code.includes("AUTHORITY") || code.includes("NAMESPACE") || code.includes("BANK_BINDING") || code.includes("LINEAGE")) return "MEMORY_AUTHORITY_MISMATCH";
  if (code.includes("IDENTITY_CONFLICT")) return "MEMORY_REQUEST_ID_CONFLICT";
  if (code.includes("PAYLOAD_UNSAFE") || code.includes("PAYLOAD_UNSUPPORTED") || code.includes("PAYLOAD_TOO_LARGE")) return "MEMORY_INVALID_REQUEST";
  if (code.includes("APPLICATION_") || code.includes("INTEGRITY")) return "MEMORY_INTEGRITY_ERROR";
  return "MEMORY_INTERNAL_ERROR";
}
const MESSAGES: Record<MemoryErrorCode, string> = {
  MEMORY_INVALID_REQUEST: "memory request is invalid or unsupported", MEMORY_NOT_FOUND: "memory record was not found",
  MEMORY_REQUEST_ID_CONFLICT: "memory request identity was reused", MEMORY_REVISION_MISMATCH: "memory revision is stale",
  MEMORY_CAPABILITY_UNSUPPORTED: "memory operation is unsupported", MEMORY_AUTHORITY_MISMATCH: "memory authority or Bank binding changed",
  MEMORY_OPERATION_CANCELLED: "memory operation cancelled", MEMORY_OUTCOME_UNKNOWN: "memory operation outcome is unknown",
  MEMORY_PROVIDER_UNAVAILABLE: "Hindsight is unavailable", MEMORY_INTEGRITY_ERROR: "memory evidence is invalid",
  MEMORY_INTERNAL_ERROR: "memory provider failed",
};
