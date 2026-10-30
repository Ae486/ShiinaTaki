/**
 * INPUT: deadline-bound operator RPC requests and Shared Pattern/setup/policy/backoff contracts
 * OUTPUT: schema-verified initiative management methods on the existing WsClient
 * POS: ui/lib — transport facade only; no policy, command replay or state authority
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import {
  INTERACTION_PATTERN_METHODS, INITIATIVE_SETUP_METHODS, INITIATIVE_WAKE_METHODS,
  InteractionPatternListResultSchema, InteractionPatternGetResultSchema, InteractionPatternHistoryResultSchema,
  InteractionPatternMutationResultSchema, InitiativeSetupStatusSchema, InitiativeSetupInstallSkillResultSchema,
  InitiativeWakePolicyStatusSchema,
  INITIATIVE_BACKOFF_METHODS, InitiativeBackoffStatusSchema,
  type InteractionPatternListParams, type InteractionPatternGetParams, type InteractionPatternHistoryParams,
  type InteractionPatternProposeParams, type InteractionPatternConfirmParams, type InteractionPatternChangeStateParams,
  type InteractionPatternRollbackParams, type InitiativeSetupReadParams, type InitiativeSetupInstallSkillParams,
  type InitiativeSetupProposeSeedParams, type InitiativeWakeReadParams,
  type InitiativeBackoffReadParams, type InitiativeBackoffResetParams,
} from "@taki/shared";

export function initiativeMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    initiativePatternsList: async (params: InteractionPatternListParams) =>
      InteractionPatternListResultSchema.parse(await request(INTERACTION_PATTERN_METHODS.list, params)),
    initiativePatternRead: async (params: InteractionPatternGetParams) =>
      InteractionPatternGetResultSchema.parse(await request(INTERACTION_PATTERN_METHODS.get, params)),
    initiativePatternHistory: async (params: InteractionPatternHistoryParams) =>
      InteractionPatternHistoryResultSchema.parse(await request(INTERACTION_PATTERN_METHODS.history, params)),
    initiativePatternPropose: async (params: InteractionPatternProposeParams) =>
      InteractionPatternMutationResultSchema.parse(await request(INTERACTION_PATTERN_METHODS.propose, params)),
    initiativePatternConfirm: async (params: InteractionPatternConfirmParams) =>
      InteractionPatternMutationResultSchema.parse(await request(INTERACTION_PATTERN_METHODS.confirm, params)),
    initiativePatternChangeState: async (params: InteractionPatternChangeStateParams) =>
      InteractionPatternMutationResultSchema.parse(await request(INTERACTION_PATTERN_METHODS.changeState, params)),
    initiativePatternRollback: async (params: InteractionPatternRollbackParams) =>
      InteractionPatternMutationResultSchema.parse(await request(INTERACTION_PATTERN_METHODS.rollback, params)),
    initiativeSetupRead: async (params: InitiativeSetupReadParams) =>
      InitiativeSetupStatusSchema.parse(await request(INITIATIVE_SETUP_METHODS.read, params)),
    initiativeSetupInstallSkill: async (params: InitiativeSetupInstallSkillParams) =>
      InitiativeSetupInstallSkillResultSchema.parse(await request(INITIATIVE_SETUP_METHODS.installSkill, params)),
    initiativeSetupProposeSeed: async (params: InitiativeSetupProposeSeedParams) =>
      InteractionPatternMutationResultSchema.parse(await request(INITIATIVE_SETUP_METHODS.proposeSeed, params)),
    initiativeWakePolicy: async (params: InitiativeWakeReadParams) =>
      InitiativeWakePolicyStatusSchema.parse(await request(INITIATIVE_WAKE_METHODS.read, params)),
    initiativeBackoffRead: async (params: InitiativeBackoffReadParams) =>
      InitiativeBackoffStatusSchema.parse(await request(INITIATIVE_BACKOFF_METHODS.read, params)),
    initiativeBackoffReset: async (params: InitiativeBackoffResetParams) =>
      InitiativeBackoffStatusSchema.parse(await request(INITIATIVE_BACKOFF_METHODS.reset, params)),
  };
}

export type InitiativeMethods = ReturnType<typeof initiativeMethods>;
