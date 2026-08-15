/**
 * INPUT:  governance and permission leaf modules
 * OUTPUT: named public exports for the canonical Core policy/operator contract
 * POS:    shared/governance — focused API facade keeping the package root within size limits
 */
export {
  LegacyPermissionCellKeySchema, LegacyPermissionCellSetParamsSchema,
  LegacyPermissionCellStateSchema, LegacyPermissionLevelStateSchema, PERMISSION_METHODS,
  PermissionCellKeySchema, PermissionDecisionKeySchema, PermissionCellsGetParamsSchema,
  PermissionCellSetParamsSchema, PermissionCellSetResultSchema, PermissionCellsStateSchema,
  PermissionCellStateSchema, PermissionLevelGetParamsSchema, PermissionLevelSchema,
  PermissionLevelSetParamsSchema, PermissionLevelStateSchema, PermissionPostureSchema,
} from "./permission-level-schema.ts";
export type {
  LegacyPermissionCellSetParams, LegacyPermissionCellState, LegacyPermissionLevelState,
  PermissionCellKey, PermissionDecisionKey, PermissionCellsGetParams, PermissionCellSetParams,
  PermissionCellSetResult, PermissionCellsState, PermissionCellState, PermissionLevelGetParams,
  PermissionLevel, PermissionLevelSetParams, PermissionLevelState, PermissionPosture,
} from "./permission-level-schema.ts";

export {
  CanonicalCapabilityIdentitySchema, CanonicalCapabilitySubjectSchema,
  CapabilityGovernanceDescriptorSchema, GovernanceApprovalMemorySchema,
  GovernanceCellDescriptorSchema, GovernanceClassifierAuthoritySchema,
  GovernanceExecutionCodeSchema,
  GovernanceEvaluationInputSchema, GovernanceEvaluationReasonSchema,
  GovernanceEvaluationResultSchema, GovernanceOverrideModeSchema, GovernanceOverrideSchema,
  GovernanceRegistrySchema, GovernanceRevisionSchema, GovernanceStableIdSchema,
} from "./governance-schema.ts";
export type {
  CanonicalCapabilityIdentity, CanonicalCapabilitySubject, CapabilityGovernanceDescriptor,
  GovernanceCellDescriptor, GovernanceEvaluationInput, GovernanceEvaluationResult, GovernanceExecutionCode,
  GovernanceOverride, GovernanceRegistry,
} from "./governance-schema.ts";
export {
  CANONICAL_GOVERNANCE_REGISTRY, GOVERNANCE_REGISTRY_REVISION,
  createGovernanceRegistry, governanceCell, governanceDescriptor,
} from "./governance-registry.ts";
export { evaluateGovernance } from "./governance-evaluator.ts";
