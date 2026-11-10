/**
 * INPUT: operator model-profile requests and Core configuration/readiness projections
 * OUTPUT: coherent Main/Utility draft, application, test and invalidation schemas
 * POS: shared/protocol — secret values exist only in write/test input, never a read result
 */
import { z } from "zod";

export const MODEL_PROFILE_METHODS = {
  list: "config.modelProfiles", save: "config.modelProfileSave", test: "config.modelProfileTest",
  subscribe: "config.modelProfilesSubscribe", changed: "config.modelProfilesChanged",
} as const;
export const ModelSlotSchema = z.enum(["main", "utility"]);
export type ModelSlot = z.infer<typeof ModelSlotSchema>;
export const ModelProfileFormSchema = z.object({
  mode: z.enum(["configured", "inherit", "disabled"]),
  baseUrl: z.string().max(4096), model: z.string().max(512), auth: z.enum(["none", "api-key"]),
  apiKey: z.string().min(1).max(16384).optional(),
});
export type ModelProfileForm = z.infer<typeof ModelProfileFormSchema>;
export const ModelProfileDraftSchema = ModelProfileFormSchema.omit({ apiKey: true }).extend({ secretSet: z.boolean() });
export const ActiveModelProfileSchema = ModelProfileDraftSchema.extend({
  revision: z.number().int().nonnegative(), source: z.enum(["application", "environment", "inherited"]),
});
export const ModelProfileStatusSchema = z.object({
  slot: ModelSlotSchema, revision: z.number().int().nonnegative(), draft: ModelProfileDraftSchema,
  active: ActiveModelProfileSchema.nullable(), state: z.enum(["ready", "unconfigured", "disabled", "invalid"]),
  applicationState: z.enum(["applied", "draft", "failed"]), issues: z.array(z.string()),
});
export type ModelProfileStatus = z.infer<typeof ModelProfileStatusSchema>;
export const ModelProfilesResultSchema = z.object({ profiles: z.array(ModelProfileStatusSchema) });
export type ModelProfilesResult = z.infer<typeof ModelProfilesResultSchema>;
export const ModelProfilesParamsSchema = z.object({});
export const ModelProfileSaveParamsSchema = z.object({
  slot: ModelSlotSchema, expectedRevision: z.number().int().nonnegative(),
  action: z.enum(["draft", "apply", "reset"]), profile: ModelProfileFormSchema.optional(),
}).refine((value) => value.action === "reset" || value.profile !== undefined, { path: ["profile"], message: "Profile is required" });
export type ModelProfileSaveParams = z.infer<typeof ModelProfileSaveParamsSchema>;
export const ModelProfileTestParamsSchema = z.object({
  slot: ModelSlotSchema, expectedRevision: z.number().int().nonnegative(), profile: ModelProfileFormSchema.optional(),
});
export type ModelProfileTestParams = z.infer<typeof ModelProfileTestParamsSchema>;
export const ModelProfileTestResultSchema = z.object({ ok: z.boolean(), code: z.string(), message: z.string() });
export type ModelProfileTestResult = z.infer<typeof ModelProfileTestResultSchema>;
export const ModelProfilesChangedSchema = z.object({ slots: z.array(ModelSlotSchema) });
export type ModelProfilesChanged = z.infer<typeof ModelProfilesChangedSchema>;
