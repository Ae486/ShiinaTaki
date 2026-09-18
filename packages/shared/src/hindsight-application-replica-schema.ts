/**
 * INPUT:  policy-bearing Canonical projections produced from verified D77 native/application evidence
 * OUTPUT: lossless replica payload and record contracts with unchanged logical identity and credential checks
 * POS:    shared application replica — frozen B5 decoders keep their own behavior and hash domain
 */
import { z } from "zod";
import { HindsightCurrentCanonicalBankSchema, HindsightCurrentCanonicalSourceSchema,
  HindsightCurrentCanonicalRecordSchema, HindsightCurrentCanonicalDerivedSchema } from "./hindsight-current-canonical-schema.ts";
import { MemoryReplicaRecordSchema } from "./memory-replica-schema.ts";

export const HindsightApplicationReplicaPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bank"), value: HindsightCurrentCanonicalBankSchema }),
  z.strictObject({ kind: z.literal("document"), value: HindsightCurrentCanonicalSourceSchema }),
  z.strictObject({ kind: z.literal("memory_unit"), value: HindsightCurrentCanonicalRecordSchema }),
  z.strictObject({ kind: z.enum(["mental_model", "directive"]), value: HindsightCurrentCanonicalDerivedSchema }),
]).superRefine((value, context) => {
  if (containsCredentialField(value)) context.addIssue({ code: "custom", message: "replica payload contains credential configuration" });
});
export type HindsightApplicationReplicaPayload = z.infer<typeof HindsightApplicationReplicaPayloadSchema>;
export const HindsightApplicationReplicaRecordSchema = MemoryReplicaRecordSchema.safeExtend({
  payload: HindsightApplicationReplicaPayloadSchema.nullable(),
});
export type HindsightApplicationReplicaRecord = z.infer<typeof HindsightApplicationReplicaRecordSchema>;

function containsCredentialField(value: unknown): boolean {
  const stack: unknown[] = [value]; const visited = new Set<object>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    for (const [key, item] of Object.entries(current)) {
      if (/api[_-]?key|authorization|password|access[_-]?token|refresh[_-]?token|client[_-]?secret/i.test(key)) return true;
      stack.push(item);
    }
  }
  return false;
}
