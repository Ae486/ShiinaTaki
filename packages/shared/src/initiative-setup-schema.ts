/**
 * INPUT: operator setup actions and current Core configuration, Skill and source projections
 * OUTPUT: bounded initiative setup/status contracts using the existing config and Pattern authorities
 * POS: shared/protocol — setup never grants permission or silently activates a Pattern
 */
import { z } from "zod";
import { ConfigEntrySchema } from "./config-schema.ts";
import { InteractionPatternDefinitionSchema } from "./interaction-pattern-schema.ts";

const Id = z.string().min(1).max(200);
export const INITIATIVE_SETUP_METHODS = {
  read: "initiative.setup.read", installSkill: "initiative.setup.install-skill",
  proposeSeed: "initiative.setup.propose-seed", changed: "initiative.setup.changed",
} as const;
export const InitiativeSetupReadParamsSchema = z.strictObject({ characterId: Id });
export type InitiativeSetupReadParams = z.infer<typeof InitiativeSetupReadParamsSchema>;
export const InitiativeSeedIdSchema = z.enum(["evening-reflection"]);
export const InitiativeSetupStatusSchema = z.strictObject({
  characterId: Id,
  targetCharacterId: Id.nullable(),
  targetReady: z.boolean(),
  settings: z.array(ConfigEntrySchema).max(24),
  timezone: z.string().min(1).max(100),
  timezoneConfirmed: z.boolean(),
  sources: z.strictObject({
    activityAvailable: z.boolean(), application: z.string().max(120).nullable(),
    presence: z.enum(["present", "unknown"]), intentionAvailable: z.boolean(),
  }),
  completions: z.array(z.strictObject({ runId: Id, label: z.string().min(1).max(240) })).max(50),
  skill: z.strictObject({
    state: z.enum(["missing", "ready", "disabled", "conflict", "unavailable"]),
    packageId: Id.nullable(), configRevision: z.number().int().positive().nullable(),
  }),
  seeds: z.array(z.strictObject({
    seedId: InitiativeSeedIdSchema, title: z.string().min(1).max(120),
    description: z.string().min(1).max(500), definition: InteractionPatternDefinitionSchema,
    existingPatternId: Id.nullable(),
  })).max(8),
});
export type InitiativeSetupStatus = z.infer<typeof InitiativeSetupStatusSchema>;
export const InitiativeSetupInstallSkillParamsSchema = InitiativeSetupReadParamsSchema;
export type InitiativeSetupInstallSkillParams = z.infer<typeof InitiativeSetupInstallSkillParamsSchema>;
export const InitiativeSetupInstallSkillResultSchema = z.strictObject({
  status: z.enum(["installed", "unchanged", "refused"]),
  reason: z.enum(["name-conflict", "package-disabled", "import-failed"]).nullable(),
  setup: InitiativeSetupStatusSchema,
});
export type InitiativeSetupInstallSkillResult = z.infer<typeof InitiativeSetupInstallSkillResultSchema>;
export const InitiativeSetupProposeSeedParamsSchema = z.strictObject({
  characterId: Id, commandId: Id, seedId: InitiativeSeedIdSchema,
});
export type InitiativeSetupProposeSeedParams = z.infer<typeof InitiativeSetupProposeSeedParamsSchema>;
