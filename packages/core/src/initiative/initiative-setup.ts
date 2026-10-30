/**
 * INPUT: actual config/time/source projections, Pattern authority and normal Skill setup
 * OUTPUT: bounded operator setup status and explicit example proposals without activation
 * POS: core/initiative — product setup projection; existing services retain all writable authority
 */
import { InitiativeSetupStatusSchema, InitiativeSetupReadParamsSchema, InitiativeSetupProposeSeedParamsSchema,
  type InitiativeSetupStatus, type InitiativeSetupProposeSeedParams,
  type InitiativeSetupInstallSkillResult, type InteractionPatternDefinition, type InteractionPatternMutationResult } from "@taki/shared";
import type { ConfigSource } from "../config/config-source.ts";
import { INITIATIVE_TARGET_KEY } from "../config/initiative-wake-knobs.ts";
import type { UserTimezoneService } from "../time/user-timezone-service.ts";
import type { InteractionPatternService } from "./patterns/pattern-service.ts";
import type { createAuthoringSkillSetup } from "./authoring-skill.ts";

const EVENING: InteractionPatternDefinition = {
  title: "晚间回顾", purpose: "在选定晚间时段，结合相关记忆考虑是否适合简短回顾近况；没有合适话题时保持安静。",
  conditions: { all: [{ kind: "local_time_window", start: "20:00", end: "22:00", daysOfWeek: [1, 2, 3, 4, 5, 6, 7] },
    { kind: "presence_present" }] },
  contextSelectors: ["memory_global", "memory_character", "presence"],
  allowedOutcomes: ["silent", "express", "speak"], timing: { minimumGapMinutes: 1440, chance: 1 },
  lifetime: { startsAt: null, expiresAt: null },
};
interface Dependencies {
  config: ConfigSource; timezone: UserTimezoneService; patterns: InteractionPatternService;
  skill: ReturnType<typeof createAuthoringSkillSetup>;
  sources(): InitiativeSetupStatus["sources"];
  completions(characterId: string): InitiativeSetupStatus["completions"];
  targetReady(characterId: string): boolean;
  onChanged?(characterId: string): void;
}

export function initiativeTarget(config: ConfigSource): string | null {
  const value = config.resolve(INITIATIVE_TARGET_KEY)?.value;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function createInitiativeSetup(input: Dependencies) {
  const read = (characterId: string): InitiativeSetupStatus => {
    const target = initiativeTarget(input.config);
    const timezone = input.timezone.read();
    return InitiativeSetupStatusSchema.parse({
      characterId, targetCharacterId: target, targetReady: target !== null && input.targetReady(target),
      settings: input.config.effectiveAll().filter((entry) => entry.key.startsWith("TAKI_INITIATIVE_") && !entry.secret),
      timezone: timezone.timezone, timezoneConfirmed: timezone.confirmedAt !== null,
      sources: input.sources(), completions: input.completions(characterId), skill: input.skill.state(),
      seeds: [{ seedId: "evening-reflection", title: EVENING.title,
        description: "可修改的示例：在 20:00–22:00 且你在场时考虑回顾近况；必须确认后才生效。",
        definition: structuredClone(EVENING), existingPatternId: input.patterns.findSeed(characterId, "evening-reflection")?.patternId ?? null }],
    });
  };
  return {
    read,
    async installSkill(characterId: string): Promise<InitiativeSetupInstallSkillResult> {
      InitiativeSetupReadParamsSchema.parse({ characterId });
      const result = await input.skill.install();
      if (result.status === "installed") {
        try { input.onChanged?.(characterId); }
        catch { /* A disconnected observer cannot relabel the committed Skill import. */ }
      }
      return { ...result, setup: read(characterId) };
    },
    proposeSeed(params: InitiativeSetupProposeSeedParams): InteractionPatternMutationResult {
      const parsed = InitiativeSetupProposeSeedParamsSchema.safeParse(params);
      if (!parsed.success) return { status: "refused", reason: "invalid_request", current: null };
      const value = parsed.data;
      return input.patterns.propose({ characterId: value.characterId, commandId: value.commandId,
        patternId: null, expectedVersion: 0, definition: structuredClone(EVENING) },
      { kind: "seed", seedId: value.seedId, seedVersion: "1" });
    },
  };
}
export type InitiativeSetup = ReturnType<typeof createInitiativeSetup>;
