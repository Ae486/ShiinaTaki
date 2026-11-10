/**
 * INPUT: trusted maintenance owner identity captured before a provider invocation
 * OUTPUT: bounded optional correlation for auxiliary model-call observations
 * POS: shared/protocol — correlation only; existing operation repositories retain execution authority
 */
import { z } from "zod";
import { CharacterIdSchema } from "./character-schema.ts";

export const MaintenanceKindSchema = z.enum(["tidy", "compact"]);
export const MaintenanceOperationRefSchema = z.strictObject({
  kind: MaintenanceKindSchema,
  operationId: z.string().min(1).max(200),
  characterId: CharacterIdSchema,
});
export type MaintenanceOperationRef = z.infer<typeof MaintenanceOperationRefSchema>;
