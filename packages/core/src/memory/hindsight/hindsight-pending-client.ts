/**
 * INPUT:  frozen canonical retain/mutation requests and deterministic native operation UUIDs
 * OUTPUT: native asynchronous retain acknowledgement and B0 conditional-mutation outcomes
 * POS:    core/memory/hindsight — bounded wire adapter; neither acknowledgement proves derived completion
 */
import { z } from "zod";
import {
  MutationRequestSchema, RetainRequestSchema, type HindsightNativeMutation, type HindsightNativeRetainItem,
  type MutationRequest, type RetainRequest,
} from "@taki/shared";
import type { HindsightCallContext, HindsightRequestInput } from "./hindsight-client.ts";
import { HindsightRetainResponseSchema } from "./hindsight-import-contracts.ts";
import { canonicalJson, canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";

const NativeMutationSchema = z.object({
  id: z.uuid(), revision: z.int().min(1), state: z.enum(["valid", "invalidated"]),
  text: z.string().min(1).max(100_000), entities: z.array(z.string().min(1).max(256)).max(128),
}).passthrough();
const StaleMutationSchema = z.object({
  error: z.literal("memory_revision_mismatch"), memory_id: z.uuid(),
  expected_revision: z.int().min(1), current_revision: z.int().min(1),
});
const ConflictingMutationSchema = z.object({
  error: z.literal("memory_mutation_id_conflict"), mutation_id: z.uuid(), memory_id: z.uuid(),
});
const MutationOutcomeSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("accepted"), memoryId: z.uuid(), revision: z.int().min(1),
    state: z.enum(["valid", "invalidated"]), changed: z.boolean(), resultHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ outcome: z.literal("superseded"), currentRevision: z.int().min(1).nullable() }),
  z.strictObject({ outcome: z.literal("identity_conflict") }),
]);
export type HindsightPendingMutationOutcome = z.infer<typeof MutationOutcomeSchema>;
interface RetainInput { request: RetainRequest; documentId: string; operationId: string; originalAt: string; context: HindsightCallContext }
interface MutationInput { request: MutationRequest; operationId: string; context: HindsightCallContext }
export interface HindsightPendingClient {
  retainPending(input: RetainInput): Promise<{ operationId: string }>;
  mutatePending(input: MutationInput): Promise<HindsightPendingMutationOutcome>;
}

export function createHindsightPendingMethods(request: <T>(input: HindsightRequestInput<T>) => Promise<T>): HindsightPendingClient {
  return {
    retainPending: async (input) => {
      const operationId = z.uuid().parse(input.operationId);
      const value = RetainRequestSchema.parse(input.request);
      const result = await request({ path: `/v1/default/banks/${encodeURIComponent(value.bankId)}/memories`,
        init: { method: "POST", body: JSON.stringify({ items: [retainItem({ ...input, request: value })], async: true, operation_id: operationId }) },
        context: input.context, schema: HindsightRetainResponseSchema });
      if (!result.success || !result.async || result.bank_id !== value.bankId || result.operation_id !== operationId
        || result.items_count !== 1 || (result.operation_ids && (result.operation_ids.length !== 1 || result.operation_ids[0] !== operationId))) {
        throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
      }
      return { operationId };
    },
    mutatePending: (input) => {
      const value = MutationRequestSchema.parse(input.request);
      const operationId = z.uuid().parse(input.operationId);
      z.uuid().parse(value.memoryId);
      return request<HindsightPendingMutationOutcome>({
        path: `/v1/default/banks/${encodeURIComponent(value.bankId)}/memories/${encodeURIComponent(value.memoryId)}`,
        init: { method: "PATCH", body: JSON.stringify(mutationBody(value, operationId)) }, context: input.context,
        schema: { parse: (raw) => acceptedMutation(value, raw) },
        responses: {
          404: { parse: () => ({ outcome: "superseded", currentRevision: null }) },
          412: { parse: (raw) => staleMutation(value, raw) },
          409: { parse: (raw) => {
            const conflict = ConflictingMutationSchema.parse(raw);
            if (conflict.memory_id !== value.memoryId || conflict.mutation_id !== operationId) throw new Error();
            return { outcome: "identity_conflict" };
          } },
        },
      });
    },
  };
}

export function retainItem(input: Pick<RetainInput, "request" | "documentId" | "originalAt">): HindsightNativeRetainItem {
  const value = input.request;
  const metadata = Object.fromEntries(Object.entries(value.metadata).map(([key, item]) => [key, typeof item === "string" ? item : canonicalJson(item)]));
  return { content: value.content, document_id: input.documentId, context: value.context,
    timestamp: value.timestamp ?? input.originalAt, tags: value.tags, entities: value.entities.map((text) => ({ text })),
    metadata, observation_scopes: value.observationScopes, strategy: value.strategy, update_mode: value.updateMode };
}

export function mutationBody(value: MutationRequest, operationId: string): HindsightNativeMutation {
  const identity = { expected_revision: value.expectedRevision, mutation_id: operationId };
  if (value.kind === "invalidate") return { ...identity, state: "invalidated", reason: value.reason };
  if (value.kind === "restore") return { ...identity, state: "valid" };
  const patch = value.patch;
  if (patch.layerId !== undefined && !patch.entities?.includes(`taki-layer:${patch.layerId}`)) {
    throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
  }
  return { ...identity, text: patch.text, context: patch.context === null ? "" : patch.context,
    occurred_start: patch.occurredStart, occurred_end: patch.occurredEnd, fact_type: patch.factType, entities: patch.entities };
}

function acceptedMutation(request: MutationRequest, raw: unknown): HindsightPendingMutationOutcome {
  const value = NativeMutationSchema.parse(raw);
  if (value.id !== request.memoryId || value.revision < request.expectedRevision || value.revision > request.expectedRevision + 1
    || (request.kind === "invalidate" && value.state !== "invalidated") || (request.kind === "restore" && value.state !== "valid")) throw new Error();
  return MutationOutcomeSchema.parse({ outcome: "accepted", memoryId: value.id, revision: value.revision,
    state: value.state, changed: value.revision > request.expectedRevision, resultHash: canonicalPayloadHash(value) });
}

function staleMutation(request: MutationRequest, raw: unknown): HindsightPendingMutationOutcome {
  const stale = StaleMutationSchema.parse(raw);
  if (stale.memory_id !== request.memoryId || stale.expected_revision !== request.expectedRevision
    || stale.current_revision === stale.expected_revision) throw new Error();
  return { outcome: "superseded", currentRevision: stale.current_revision };
}
