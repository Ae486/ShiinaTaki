/**
 * INPUT:  operation payloads and provider outcomes
 * OUTPUT: validated success/error envelopes carrying runtime request and authority lineage
 * POS:    shared contract — one normalized result shape for Local and future Hindsight providers
 */
import { z } from "zod";
import { MemoryProviderCapabilitiesSchema, MemoryErrorSchema } from "./memory-provider-domain-schema.ts";
import { EditResultSchema, InvalidateResultSchema, RecallResultSchema, ReflectResultSchema, RestoreResultSchema, RetainResultSchema } from "./memory-provider-operation-schema.ts";

const Id = z.string().min(1).max(256);
const Base = { requestId: Id, providerId: Id, authorityEpochId: Id };
const ErrorBase = { requestId: Id, providerId: Id, authorityEpochId: Id.nullable(), capabilities: MemoryProviderCapabilitiesSchema.nullable(), error: MemoryErrorSchema };
export const MemorySuccessEnvelopeSchema = <T extends z.ZodType>(data: T) => z.strictObject({ ok: z.literal(true), ...Base, capabilities: MemoryProviderCapabilitiesSchema, data })
  .superRefine((value, context) => {
    if (value.providerId !== value.capabilities.providerId) context.addIssue({ code: "custom", path: ["capabilities", "providerId"], message: "capability provider identity mismatch" });
  });
export const MemoryErrorEnvelopeSchema = z.strictObject({ ok: z.literal(false), ...ErrorBase })
  .superRefine((value, context) => {
    if (value.capabilities && value.providerId !== value.capabilities.providerId) context.addIssue({ code: "custom", path: ["capabilities", "providerId"], message: "capability provider identity mismatch" });
  });
export const RetainEnvelopeSchema = z.union([MemorySuccessEnvelopeSchema(RetainResultSchema), MemoryErrorEnvelopeSchema]);
export const RecallEnvelopeSchema = z.union([MemorySuccessEnvelopeSchema(RecallResultSchema), MemoryErrorEnvelopeSchema]);
export const ReflectEnvelopeSchema = z.union([MemorySuccessEnvelopeSchema(ReflectResultSchema), MemoryErrorEnvelopeSchema]);
export const EditEnvelopeSchema = z.union([MemorySuccessEnvelopeSchema(EditResultSchema), MemoryErrorEnvelopeSchema]);
export const InvalidateEnvelopeSchema = z.union([MemorySuccessEnvelopeSchema(InvalidateResultSchema), MemoryErrorEnvelopeSchema]);
export const RestoreEnvelopeSchema = z.union([MemorySuccessEnvelopeSchema(RestoreResultSchema), MemoryErrorEnvelopeSchema]);
export type MemoryResult<T> = {
  ok: true;
  requestId: string;
  providerId: string;
  authorityEpochId: string;
  capabilities: z.infer<typeof MemoryProviderCapabilitiesSchema>;
  data: T;
} | {
  ok: false;
  requestId: string;
  providerId: string;
  authorityEpochId: string | null;
  capabilities: z.infer<typeof MemoryProviderCapabilitiesSchema> | null;
  error: z.infer<typeof MemoryErrorSchema>;
};
export type RetainEnvelope = z.infer<typeof RetainEnvelopeSchema>;
export type RecallEnvelope = z.infer<typeof RecallEnvelopeSchema>;
export type ReflectEnvelope = z.infer<typeof ReflectEnvelopeSchema>;
export type EditEnvelope = z.infer<typeof EditEnvelopeSchema>;
export type InvalidateEnvelope = z.infer<typeof InvalidateEnvelopeSchema>;
export type RestoreEnvelope = z.infer<typeof RestoreEnvelopeSchema>;
