/**
 * INPUT:  a JSON-RPC id (or null) + a closed-union ErrorCode + human/LLM-readable message + optional extra data fields
 * OUTPUT: appErrorResponse(...) -> error response object; appException(...) -> throwable for handlers
 * POS:    core/server — the app-error envelope (JSON_RPC_APP_ERROR + error.data.code); every auth/dispatch refusal rides it
 */
import { JSONRPCErrorException, createJSONRPCErrorResponse, type JSONRPCErrorResponse } from "json-rpc-2.0";
import { JSON_RPC_APP_ERROR, type ErrorCode, type JsonRpcId } from "@taki/shared";

export function appErrorResponse(id: JsonRpcId | null, code: ErrorCode, message: string): JSONRPCErrorResponse {
  return createJSONRPCErrorResponse(id, JSON_RPC_APP_ERROR, message, { code });
}

/**
 * Throw from a method handler; the registry maps it to the same app-error envelope as above. `data` merges extra
 * machine-readable fields alongside `code` (e.g. an operator-only domain `reason` that has no Rust-mirrored ErrorCode).
 */
export function appException(code: ErrorCode, message: string, data?: Record<string, unknown>): JSONRPCErrorException {
  return new JSONRPCErrorException(message, JSON_RPC_APP_ERROR, { code, ...data });
}
