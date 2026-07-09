/**
 * INPUT:  a JSON-RPC id (or null) + a closed-union ErrorCode + human/LLM-readable message
 * OUTPUT: appErrorResponse(...) -> error response object; appException(...) -> throwable for handlers
 * POS:    core/server — the app-error envelope (JSON_RPC_APP_ERROR + error.data.code); every auth/dispatch refusal rides it
 */
import { JSONRPCErrorException, createJSONRPCErrorResponse, type JSONRPCErrorResponse } from "json-rpc-2.0";
import { JSON_RPC_APP_ERROR, type ErrorCode, type JsonRpcId } from "@taki/shared";

export function appErrorResponse(id: JsonRpcId | null, code: ErrorCode, message: string): JSONRPCErrorResponse {
  return createJSONRPCErrorResponse(id, JSON_RPC_APP_ERROR, message, { code });
}

/** Throw from a method handler; the registry maps it to the same app-error envelope as above. */
export function appException(code: ErrorCode, message: string): JSONRPCErrorException {
  return new JSONRPCErrorException(message, JSON_RPC_APP_ERROR, { code });
}
