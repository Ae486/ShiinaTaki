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
  CONNECT_METHOD,
  ConnectParamsSchema,
  ConnectResultSchema,
  RoleSchema,
} from "./connect-schema.ts";
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
  APPROVAL_METHODS,
  ApprovalRequestSchema,
  ApprovalRespondParamsSchema,
  ApprovalRespondResultSchema,
  ApprovalScopeSchema,
} from "./approval-schema.ts";
export type {
  ApprovalRequest,
  ApprovalRespondParams,
  ApprovalRespondResult,
  ApprovalScope,
} from "./approval-schema.ts";

export {
  PERMISSION_METHODS,
  PermissionCellKeySchema,
  PermissionCellSetParamsSchema,
  PermissionCellSetResultSchema,
  PermissionCellsStateSchema,
  PermissionCellStateSchema,
  PermissionLevelSchema,
  PermissionLevelStateSchema,
  PermissionPostureSchema,
} from "./permission-level-schema.ts";
export type {
  PermissionCellKey,
  PermissionCellSetParams,
  PermissionCellSetResult,
  PermissionCellsState,
  PermissionCellState,
  PermissionLevel,
  PermissionLevelState,
  PermissionPosture,
} from "./permission-level-schema.ts";

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
  CapabilityError,
  CapabilityErrorCode,
  CapabilityRequest,
  CapabilityRespondParams,
  CapabilityRespondResult,
} from "./capability-schema.ts";

export {
  ClipboardReadOutputSchema,
  ClipboardWriteOutputSchema,
  ExecOutputSchema,
  ForegroundWindowOutputSchema,
  ProcessInfoSchema,
  ProcessListOutputSchema,
  ScreenshotOutputSchema,
  ShellOpenOutputSchema,
} from "./capability-outputs.ts";
export type {
  ClipboardReadOutput,
  ClipboardWriteOutput,
  ExecOutput,
  ForegroundWindowOutput,
  ProcessInfo,
  ProcessListOutput,
  ScreenshotOutput,
  ShellOpenOutput,
} from "./capability-outputs.ts";

export { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from "./ws-defaults.ts";
