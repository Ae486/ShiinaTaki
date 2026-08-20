/**
 * INPUT:  Shared canonical operation payloads and internal Core call context
 * OUTPUT: async provider/vector interfaces and typed operation result contract
 * POS:    core/memory — provider-neutral seam for dormant Local and future Hindsight implementations
 */
import type { MemoryProviderCapabilities, MemoryResult, RecallRequest, RecallResult, ReflectRequest, ReflectResult, RetainRequest, RetainResult, MutationRequest, MutationResult, CanonicalMemoryRecord } from "@taki/shared";
export type { MemoryResult } from "@taki/shared";
export interface MemoryProviderCallContext { requestId: string; authorityEpochId: string; actor: "foreground-agent" | "background-policy" | "operator" | "migration"; signal?: AbortSignal; }
export interface VectorRecallCandidate { memoryId: string; score: number; }
export interface MemoryVectorProjection { status(): Promise<"building" | "ready" | "degraded">; scheduleUpsert(record: CanonicalMemoryRecord): void; scheduleDelete(ref: { authorityEpochId: string; bankId: string; memoryId: string }): void; search(request: RecallRequest): Promise<VectorRecallCandidate[]>; rebuild(records: AsyncIterable<CanonicalMemoryRecord>): Promise<void>; }
export interface MemoryProvider { readonly providerId: string; readonly providerLineageId: string; capabilities(): Promise<MemoryProviderCapabilities>; retain(ctx: MemoryProviderCallContext, request: RetainRequest): Promise<MemoryResult<RetainResult>>; recall(ctx: MemoryProviderCallContext, request: RecallRequest): Promise<MemoryResult<RecallResult>>; reflect(ctx: MemoryProviderCallContext, request: ReflectRequest): Promise<MemoryResult<ReflectResult>>; mutate(ctx: MemoryProviderCallContext, request: MutationRequest): Promise<MemoryResult<MutationResult>>; }
