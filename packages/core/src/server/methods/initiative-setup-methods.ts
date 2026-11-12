/**
 * INPUT: live operator setup requests and existing initiative/Monitor projections
 * OUTPUT: explicit Skill import/example proposal and optional Monitor policy reads
 * POS: core/server/methods — bounded adapters; setup neither activates a habit nor grants authority
 */
import { INITIATIVE_SETUP_METHODS, INITIATIVE_WAKE_METHODS, InitiativeSetupReadParamsSchema,
  InitiativeSetupInstallSkillParamsSchema, InitiativeSetupProposeSeedParamsSchema, InitiativeWakeReadParamsSchema,
  type InitiativeWakePolicyStatus } from "@taki/shared";
import type { InitiativeSetup } from "../../initiative/initiative-setup.ts";
import type { ConnectionRegistry } from "../connection-registry.ts";
import type { MethodRegistry } from "../method-registry.ts";
import { requireInitiativeOperator } from "./interaction-pattern-methods.ts";
import { appException } from "../app-error.ts";

export function registerInitiativeSetupMethods(registry: MethodRegistry, input: {
  setup: InitiativeSetup; connections: ConnectionRegistry; monitorEnabled(): boolean;
  policy(characterId: string): InitiativeWakePolicyStatus;
}): void {
  registry.register({ method: INITIATIVE_SETUP_METHODS.read, roles: ["operator"], paramsSchema: InitiativeSetupReadParamsSchema,
    handler(params, ctx) { requireInitiativeOperator(ctx, input.connections); return input.setup.read(params.characterId); } });
  registry.register({ method: INITIATIVE_SETUP_METHODS.installSkill, roles: ["operator"], paramsSchema: InitiativeSetupInstallSkillParamsSchema,
    handler(params, ctx) { requireInitiativeOperator(ctx, input.connections); return input.setup.installSkill(params.characterId); } });
  registry.register({ method: INITIATIVE_SETUP_METHODS.proposeSeed, roles: ["operator"], paramsSchema: InitiativeSetupProposeSeedParamsSchema,
    handler(params, ctx) { requireInitiativeOperator(ctx, input.connections); return input.setup.proposeSeed(params); } });
  registry.register({ method: INITIATIVE_WAKE_METHODS.read, roles: ["operator"], paramsSchema: InitiativeWakeReadParamsSchema,
    handler(params, ctx) {
      requireInitiativeOperator(ctx, input.connections);
      if (!input.monitorEnabled()) throw appException("FORBIDDEN", "The Monitor is disabled");
      return input.policy(params.characterId);
    } });
}
