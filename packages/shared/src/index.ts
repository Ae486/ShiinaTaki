/**
 * INPUT:  n/a
 * OUTPUT: the @taki/shared public API — named re-exports of every protocol schema + type
 * POS:    shared — the package's only public entry (no export *; no internal barrels)
 */
export { PingSchema, PongSchema } from "./ping-schema.ts";
export type { Ping, Pong } from "./ping-schema.ts";

export {
  JSON_RPC_APP_ERROR,
  JSON_RPC_ERROR_CODES,
  JsonRpcClientFrameSchema,
  JsonRpcErrorObjectSchema,
  JsonRpcErrorResponseSchema,
  JsonRpcIdSchema,
  JsonRpcInboundFrameSchema,
  JsonRpcNotificationSchema,
  JsonRpcRequestSchema,
  JsonRpcSuccessResponseSchema,
} from "./json-rpc-schema.ts";
export type {
  JsonRpcClientFrame,
  JsonRpcErrorObject,
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcInboundFrame,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
} from "./json-rpc-schema.ts";

export { ErrorCodeSchema } from "./error-code-schema.ts";
export type { ErrorCode } from "./error-code-schema.ts";

export {
  HOST_CATALOG_SCHEMA_VERSION, HOST_CONTROL_METHODS, HOST_CONTROL_PROTOCOL_VERSION,
  CapabilityCancellationSchema, CapabilityCancelReasonSchema, CapabilityCancelSchema,
  CapabilityChallengeSchema, CapabilityExecutionKindSchema, CapabilityResumeSchema,
  CapabilitySettlementStateSchema, HostCapabilityDescriptorSchema, HostCapabilityGovernanceSupportSchema, HostCatalogPublishParamsSchema,
  HostDeclarationSchema, HostFrameAckSchema, HostFrameRejectReasonSchema, HostLocalReadinessSchema,
  HostMcpDescriptorSchema, HostNegotiationSchema, HostOperationControlSchema, HostGovernanceEvidenceSchema,
  HostGovernanceCellSchema, HostGovernanceProjectionPayloadSchema, HostGovernanceProjectionSchema, HostProtocolRangeSchema,
  HostSkillDescriptorSchema, HostWorkspaceDescriptorSchema, PositiveGenerationSchema, Sha256HexSchema,
  canonicalHostGovernanceProjection,
} from "./host-control-api.ts";
export type {
  CapabilityCancellation, CapabilityCancel, CapabilityCancelReason, CapabilityChallenge,
  CapabilityExecutionKind, CapabilityResume, CapabilitySettlementState, HostCapabilityDescriptor, HostCapabilityGovernanceSupport,
  HostCatalogPublishParams, HostDeclaration, HostFrameAck, HostFrameRejectReason, HostLocalReadiness,
  HostMcpDescriptor, HostNegotiation, HostOperationControl, HostGovernanceProjection, HostGovernanceProjectionPayload,
  HostGovernanceCell, HostGovernanceEvidence, HostProtocolRange, HostSkillDescriptor,
  HostWorkspaceDescriptor,
} from "./host-control-api.ts";

export { CONNECT_METHOD, ConnectParamsSchema, ConnectResultSchema, RoleSchema } from "./connect-schema.ts";
export type { ConnectParams, ConnectResult, Role } from "./connect-schema.ts";

export {
  CHAT_METHODS,
  ChatCancelParamsSchema,
  ChatCancelResultSchema,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ChatSendParamsSchema,
  ChatSendResultSchema,
  IMAGE_MEDIA_TYPES,
  ImageAttachmentSchema,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "./chat-schema.ts";
export type {
  ChatCancelParams,
  ChatCancelResult,
  ChatComplete,
  ChatDelta,
  ChatError,
  ChatSendParams,
  ChatSendResult,
  ImageAttachment,
} from "./chat-schema.ts";

export {
  TIMELINE_HISTORY_LIMIT_DEFAULT,
  TIMELINE_HISTORY_LIMIT_MAX,
  TIMELINE_METHODS,
  TimelineAppendedSchema,
  TimelineEntrySchema,
  TimelineHistoryParamsSchema,
  TimelineHistoryResultSchema,
  TimelinePartSchema,
  TimelineRemovedSchema,
  TimelineRoleSchema,
  TimelineSubscribeParamsSchema,
  TimelineSubscribeResultSchema,
  TimelineToolOutputSchema,
} from "./timeline-schema.ts";
export type {
  TimelineAppended,
  TimelineEntry,
  TimelineHistoryParams,
  TimelineHistoryResult,
  TimelinePart,
  TimelineRemoved,
  TimelineRole,
  TimelineSubscribeParams,
  TimelineSubscribeResult,
  TimelineToolOutput,
} from "./timeline-schema.ts";

export {
  MEMORY_METHODS,
  MemoryAutoStatusSchema,
  MemoryStatusParamsSchema,
  MemoryStatusResultSchema,
  MemorySummaryStatusSchema,
  MemoryTidyDefectsSchema,
  MemoryTidyParamsSchema,
  MemoryTidyResultSchema,
  MemoryWindowSlotSchema,
} from "./memory-schema.ts";
export type {
  MemoryAutoStatus,
  MemoryStatusParams,
  MemoryStatusResult,
  MemorySummaryStatus,
  MemoryTidyDefects,
  MemoryTidyParams,
  MemoryTidyResult,
  MemoryWindowSlot,
} from "./memory-schema.ts";

export {
  CONFIG_METHODS,
  ConfigApplySchema,
  ConfigChangedSchema,
  ConfigEntrySchema,
  ConfigInputSchema,
  ConfigListParamsSchema,
  ConfigListResultSchema,
  ConfigRefusalReasonSchema,
  ConfigSetParamsSchema,
  ConfigSetResultSchema,
  ConfigSubscribeParamsSchema,
  ConfigSubscribeResultSchema,
  ConfigValueSchema,
} from "./config-schema.ts";
export type {
  ConfigApply,
  ConfigChanged,
  ConfigEntry,
  ConfigInput,
  ConfigListParams,
  ConfigListResult,
  ConfigRefusalReason,
  ConfigSetParams,
  ConfigSetResult,
  ConfigSubscribeParams,
  ConfigSubscribeResult,
  ConfigValue,
} from "./config-schema.ts";

export {
  TIMING_CONFIG_KEYS,
  TIMING_POLICY_DEVELOPMENT_DEFAULTS,
  TimingDurationMsSchema,
  TimingPolicySchema,
  isTimingConfigKey,
  timingPolicyCandidate,
} from "./timing-policy-schema.ts";
export type { TimingConfigKey, TimingPolicy, TimingPolicyField } from "./timing-policy-schema.ts";

export {
  MEDIA_METHODS,
  MediaClearParamsSchema,
  MediaClearResultSchema,
  MediaGetParamsSchema,
  MediaGetResultSchema,
  MediaUsageParamsSchema,
  MediaUsageResultSchema,
} from "./media-schema.ts";
export type {
  MediaClearParams,
  MediaClearResult,
  MediaGetParams,
  MediaGetResult,
  MediaUsageParams,
  MediaUsageResult,
} from "./media-schema.ts";

export {
  CHARACTER_METHODS,
  CharacterCostumeResolutionParamsSchema,
  CharacterCostumeResolutionResultSchema,
  CharacterCostumesParamsSchema,
  CharacterCostumesResultSchema,
  CharacterIdSchema,
  CharacterImportErrorSchema,
  CharacterImportParamsSchema,
  CharacterImportResultSchema,
  CharacterListParamsSchema,
  CharacterListResultSchema,
  CharacterSourceSchema,
  CharacterSummarySchema,
  CostumeAvailabilitySchema,
} from "./character-schema.ts";
export type {
  CharacterCostumeResolutionParams,
  CharacterCostumeResolutionResult,
  CharacterCostumesParams,
  CharacterCostumesResult,
  CharacterId,
  CharacterImportError,
  CharacterImportParams,
  CharacterImportResult,
  CharacterListParams,
  CharacterListResult,
  CharacterSource,
  CharacterSummary,
  CostumeAvailability,
} from "./character-schema.ts";

export {
  AVATAR_METHODS,
  AvatarCommandSchema,
  AvatarReportParamsSchema,
  AvatarReportResultSchema,
  AvatarSubscribeParamsSchema,
  AvatarSubscribeResultSchema,
} from "./avatar-schema.ts";
export type {
  AvatarCommand,
  AvatarReportParams,
  AvatarReportResult,
  AvatarSubscribeParams,
  AvatarSubscribeResult,
} from "./avatar-schema.ts";

export {
  APPROVAL_BINDING_REVISION, APPROVAL_DISCLOSURE_REVISION, APPROVAL_METHODS, APPROVAL_PRESENTATION_REVISION, ApprovalChoiceSchema, ApprovalClosedReasonSchema, ApprovalClosedSchema, ApprovalDecisionBindingSchema, ApprovalDecisionInertReasonSchema, ApprovalDecisionListItemSchema, ApprovalDecisionProvenanceSchema, ApprovalDecisionScopeSchema, ApprovalDecisionUsabilitySchema, ApprovalSafeLabelsSchema, ApprovalDisclosureAckSchema, ApprovalDurableDecisionBindingSchema, ApprovalDurableDecisionSchema, ApprovalStoredDurableDecisionBindingSchema, ApprovalListParamsSchema, ApprovalListResultSchema, ApprovalPresentationSchema, ApprovalRespondStatusSchema, ApprovalRevokeParamsSchema, ApprovalRevokeResultSchema, ApprovalRevokeStatusSchema, CanonicalApprovalRequestSchema, CanonicalApprovalRespondParamsSchema, CanonicalApprovalRespondResultSchema, canonicalApprovalDecisionScope, canonicalApprovalDurableDecisionBinding, canonicalStoredApprovalDurableDecisionBinding,
} from "./approval-api.ts";
export type {
  ApprovalChoice, ApprovalClosed, ApprovalClosedReason, ApprovalDecisionBinding, ApprovalDecisionListItem, ApprovalDecisionProvenance, ApprovalDecisionScope, ApprovalDecisionUsability, ApprovalSafeLabels, ApprovalDisclosureAck, ApprovalDurableDecision, ApprovalDurableDecisionBinding, ApprovalListParams, ApprovalListResult, ApprovalStoredDurableDecisionBinding, ApprovalPresentation, ApprovalRevokeParams, ApprovalRevokeResult, CanonicalApprovalRequest, CanonicalApprovalRespondParams, CanonicalApprovalRespondResult,
} from "./approval-api.ts";
export { LegacyApprovalRequestSchema, LegacyApprovalRespondParamsSchema, LegacyApprovalRespondResultSchema, LegacyApprovalScopeSchema } from "./legacy-approval-schema.ts";
export type { LegacyApprovalRequest, LegacyApprovalRespondParams, LegacyApprovalRespondResult, LegacyApprovalScope } from "./legacy-approval-schema.ts";

export {
  CANONICAL_GOVERNANCE_REGISTRY, CanonicalCapabilityIdentitySchema, CanonicalCapabilitySubjectSchema, CapabilityGovernanceDescriptorSchema,
  GOVERNANCE_REGISTRY_REVISION, GovernanceApprovalMemorySchema, GovernanceCellDescriptorSchema, GovernanceClassifierAuthoritySchema,
  GovernanceEvaluationInputSchema, GovernanceEvaluationReasonSchema, GovernanceEvaluationResultSchema, GovernanceExecutionCodeSchema, GovernanceOverrideModeSchema,
  GovernanceOverrideSchema, GovernanceRegistrySchema, GovernanceRevisionSchema, GovernanceStableIdSchema,
  LegacyPermissionCellKeySchema, LegacyPermissionCellSetParamsSchema,
  LegacyPermissionCellStateSchema, LegacyPermissionLevelStateSchema, PERMISSION_METHODS,
  PermissionCellKeySchema, PermissionDecisionKeySchema, PermissionCellsGetParamsSchema,
  PermissionCellSetParamsSchema, PermissionCellSetResultSchema, PermissionCellsStateSchema,
  PermissionCellStateSchema, PermissionLevelGetParamsSchema, PermissionLevelSchema,
  PermissionLevelSetParamsSchema, PermissionLevelStateSchema, PermissionPostureSchema,
  createGovernanceRegistry, evaluateGovernance, governanceCell, governanceDescriptor,
} from "./governance-api.ts";
export type {
  CanonicalCapabilityIdentity, CanonicalCapabilitySubject, CapabilityGovernanceDescriptor,
  GovernanceCellDescriptor, GovernanceEvaluationInput, GovernanceEvaluationResult, GovernanceExecutionCode,
  GovernanceOverride, GovernanceRegistry, LegacyPermissionCellSetParams,
  LegacyPermissionCellState, LegacyPermissionLevelState, PermissionCellKey, PermissionDecisionKey,
  PermissionCellsGetParams, PermissionCellSetParams, PermissionCellSetResult, PermissionCellsState,
  PermissionCellState, PermissionLevelGetParams, PermissionLevel, PermissionLevelSetParams,
  PermissionLevelState, PermissionPosture,
} from "./governance-api.ts";

export {
  PERCEPTION_METHODS,
  PerceptionActivityEntrySchema,
  PerceptionCardParamsSchema,
  PerceptionCardSchema,
  PerceptionPauseGetParamsSchema,
  PerceptionPauseSetParamsSchema,
  PerceptionPauseStateSchema,
  PerceptionSamplingStatusSchema,
} from "./perception-schema.ts";
export type {
  PerceptionActivityEntry,
  PerceptionCard,
  PerceptionCardParams,
  PerceptionPauseGetParams,
  PerceptionPauseSetParams,
  PerceptionPauseState,
  PerceptionSamplingStatus,
} from "./perception-schema.ts";

export {
  CAPABILITY_METHODS,
  CapabilityErrorCodeSchema,
  CapabilityErrorSchema,
  CapabilityRequestSchema,
  CapabilityRespondParamsSchema,
  CapabilityRespondResultSchema,
} from "./capability-schema.ts";
export type {
  CapabilityError, CapabilityErrorCode, CapabilityRequest,
  CapabilityRespondParams, CapabilityRespondResult,
} from "./capability-schema.ts";

export {
  ClipboardReadOutputSchema, ClipboardWriteOutputSchema, ExecOutputSchema,
  ForegroundWindowOutputSchema, ProcessInfoSchema, ProcessListOutputSchema,
  ScreenshotOutputSchema, ShellOpenOutputSchema,
} from "./capability-outputs.ts";
export type {
  ClipboardReadOutput, ClipboardWriteOutput, ExecOutput, ForegroundWindowOutput,
  ProcessInfo, ProcessListOutput, ScreenshotOutput, ShellOpenOutput,
} from "./capability-outputs.ts";

export { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from "./ws-defaults.ts";
