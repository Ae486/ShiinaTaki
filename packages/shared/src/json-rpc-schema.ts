/**
 * INPUT:  candidate JSON values (parsed WS frames) on both ends
 * OUTPUT: zod schemas for the JSON-RPC 2.0 envelope (request/notification/response/client-frame) + JSON_RPC_ERROR_CODES
 * POS:    shared/protocol — single source of truth for the wire envelope (invariant 3); mirrored in Rust via serde
 */
import { z } from "zod";

export const JsonRpcIdSchema = z.union([z.string(), z.number()]);
export type JsonRpcId = z.infer<typeof JsonRpcIdSchema>;

const JSONRPC_VERSION = "2.0";

// strictObject so an inbound notification carrying an `id` (i.e. a request) is
// not silently accepted as a notification — it forces request/notification apart.
export const JsonRpcRequestSchema = z.strictObject({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: JsonRpcIdSchema,
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcNotificationSchema = z.strictObject({
  jsonrpc: z.literal(JSONRPC_VERSION),
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcNotification = z.infer<typeof JsonRpcNotificationSchema>;

export const JsonRpcInboundFrameSchema = z.union([JsonRpcRequestSchema, JsonRpcNotificationSchema]);
export type JsonRpcInboundFrame = z.infer<typeof JsonRpcInboundFrameSchema>;

export const JsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: JsonRpcIdSchema,
  result: z.unknown(),
});
export type JsonRpcSuccessResponse = z.infer<typeof JsonRpcSuccessResponseSchema>;

export const JsonRpcErrorObjectSchema = z.object({
  code: z.int(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type JsonRpcErrorObject = z.infer<typeof JsonRpcErrorObjectSchema>;

export const JsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: JsonRpcIdSchema.nullable(),
  error: JsonRpcErrorObjectSchema,
});
export type JsonRpcErrorResponse = z.infer<typeof JsonRpcErrorResponseSchema>;

// A frame a JSON-RPC client may receive: a response to its request, or a
// server-pushed notification. The CLI validates every inbound frame against
// this before routing it.
export const JsonRpcClientFrameSchema = z.union([
  JsonRpcSuccessResponseSchema,
  JsonRpcErrorResponseSchema,
  JsonRpcNotificationSchema,
]);
export type JsonRpcClientFrame = z.infer<typeof JsonRpcClientFrameSchema>;

export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// Server-defined app error (JSON-RPC "server error" range). Domain/auth failures ride
// this code with the machine-readable ErrorCode in error.data.code (prd §3, error-handling spec).
export const JSON_RPC_APP_ERROR = -32000;
