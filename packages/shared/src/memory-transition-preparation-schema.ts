/**
 * INPUT:  complete current Local capture and exact reused or unused native target admission
 * OUTPUT: durable transition delta preparation and factual historical-result identities
 * POS:    shared W3 persistence contract — executor takeover reuses the original semantic command
 */
import { z } from "zod";
import { HindsightTransitionDeltaRequestSchema, HindsightTransitionDeltaResultSchema } from "./hindsight-transition-delta-schema.ts";
import { MemoryTransitionScopeMappingSchema } from "./memory-transition-candidate-schema.ts";
import { HindsightTransitionStatusSchema } from "./hindsight-transition-schema.ts";
import { HindsightSnapshotMetadataWireSchema, HindsightSnapshotPageWireSchema } from "./hindsight-native-snapshot-schema.ts";
import { TakiApplicationReadBundleManifestSchema, TakiApplicationRecordPageSchema } from "./hindsight-application-read-schema.ts";
import { TakiApplicationBodyRefSchema } from "./hindsight-application-primitives-schema.ts";
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
export const MemoryTransitionUnusedInventorySchema = z.strictObject({ nativeSnapshot: HindsightSnapshotMetadataWireSchema,
  nativePages: z.array(HindsightSnapshotPageWireSchema), applicationManifest: TakiApplicationReadBundleManifestSchema,
  applicationPages: z.array(TakiApplicationRecordPageSchema), bodies: z.array(z.strictObject({ ref: TakiApplicationBodyRefSchema, base64: z.string() })) });
export type MemoryTransitionUnusedInventory = z.infer<typeof MemoryTransitionUnusedInventorySchema>;
export const MemoryTransitionPreparationSchema = z.strictObject({ version: z.literal(1), preparationId: Hash,
  transitionId: z.uuid(), captureId: Hash, baselineId: Hash, scope: MemoryTransitionScopeMappingSchema,
  target: HindsightTransitionStatusSchema, request: HindsightTransitionDeltaRequestSchema,
  unusedInventory: MemoryTransitionUnusedInventorySchema.nullable(),
});
export type MemoryTransitionPreparation = z.infer<typeof MemoryTransitionPreparationSchema>;
export const MemoryTransitionDeltaEvidenceSchema = z.strictObject({ version: z.literal(1), resultId: Hash,
  transitionId: z.uuid(), preparationId: Hash, result: HindsightTransitionDeltaResultSchema,
});
export type MemoryTransitionDeltaEvidence = z.infer<typeof MemoryTransitionDeltaEvidenceSchema>;
