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
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ChatSendParamsSchema,
  ChatSendResultSchema,
} from "./chat-schema.ts";
export type {
  ChatComplete,
  ChatDelta,
  ChatError,
  ChatSendParams,
  ChatSendResult,
} from "./chat-schema.ts";

export {
  TIMELINE_HISTORY_LIMIT_DEFAULT,
  TIMELINE_HISTORY_LIMIT_MAX,
  TIMELINE_METHODS,
  TimelineAppendedSchema,
  TimelineEntrySchema,
  TimelineHistoryParamsSchema,
  TimelineHistoryResultSchema,
  TimelineRoleSchema,
  TimelineSubscribeParamsSchema,
  TimelineSubscribeResultSchema,
} from "./timeline-schema.ts";
export type {
  TimelineAppended,
  TimelineEntry,
  TimelineHistoryParams,
  TimelineHistoryResult,
  TimelineRole,
  TimelineSubscribeParams,
  TimelineSubscribeResult,
} from "./timeline-schema.ts";

export { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from "./ws-defaults.ts";
