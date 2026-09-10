/**
 * INPUT:  validated durable D78 evidence selected by the current Local manifest
 * OUTPUT: versioned operator progress counts, with explicit nulls when evidence cannot be read
 * POS:    shared cutover status — current imports are separate from immutable historical B2 counters
 */
import { z } from "zod";

const Count = z.int().min(0).nullable();
export const HindsightCurrentStatusSchema = z.strictObject({
  schemaVersion: z.literal(1), manifestId: z.string().min(1).max(256), state: z.enum(["available", "unavailable"]),
  bankCount: Count, preparedBankCount: Count, preparationGapCount: Count, importedBankCount: Count,
  objectMappingCount: Count, memoryUnitMappingCount: Count, verificationBankCount: Count, verifiedBankCount: Count,
  nativeInvalidatedBankCount: Count,
}).superRefine((value, context) => {
  const counts = [value.bankCount, value.preparedBankCount, value.preparationGapCount, value.importedBankCount,
    value.objectMappingCount, value.memoryUnitMappingCount, value.verificationBankCount, value.verifiedBankCount, value.nativeInvalidatedBankCount];
  if (value.state === "available" ? counts.some((count) => count === null) : counts.some((count) => count !== null)) {
    context.addIssue({ code: "custom", message: "unavailable current evidence must use null counts" });
  }
});
export type HindsightCurrentStatus = z.infer<typeof HindsightCurrentStatusSchema>;
