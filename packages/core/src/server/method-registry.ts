/**
 * INPUT:  method registrations ({ method, paramsSchema, handler }) + inbound JSON-RPC requests
 * OUTPUT: createMethodRegistry() -> { register, dispatch }; dispatch returns a JSON-RPC response object
 * POS:    core/server — the WS method table + pluggable seam (invariant 7); zod-validates params before the handler
 */
import {
  createJSONRPCErrorResponse,
  createJSONRPCSuccessResponse,
  type JSONRPCErrorResponse,
  type JSONRPCSuccessResponse,
} from "json-rpc-2.0";
import { JSON_RPC_ERROR_CODES, type JsonRpcRequest } from "@taki/shared";
import type { ZodType } from "zod";

/**
 * Per-connection handler context: `notify` pushes a JSON-RPC notification back
 * to the one socket this request arrived on (bound by the WS server).
 */
export interface MethodContext {
  notify: (method: string, params: unknown) => void;
}

export interface MethodDefinition<P> {
  method: string;
  paramsSchema: ZodType<P>;
  handler: (params: P, ctx: MethodContext) => Promise<unknown> | unknown;
}

export type JsonRpcResponse = JSONRPCSuccessResponse | JSONRPCErrorResponse;

export interface MethodRegistry {
  register: <P>(def: MethodDefinition<P>) => void;
  dispatch: (request: JsonRpcRequest, ctx: MethodContext) => Promise<JsonRpcResponse>;
}

interface RegisteredMethod {
  paramsSchema: ZodType;
  run: (params: unknown, ctx: MethodContext) => Promise<unknown> | unknown;
}

/**
 * Method table + dispatcher — the pluggable seam (invariant 7): adding a WS
 * method is one `register` call, never a switch statement edit. Params are
 * zod-validated before the handler runs; the lib builds the response envelopes.
 */
export function createMethodRegistry(): MethodRegistry {
  const methods = new Map<string, RegisteredMethod>();

  return {
    register<P>(def: MethodDefinition<P>): void {
      // params is validated against paramsSchema in dispatch before run is called.
      const run = (params: unknown, ctx: MethodContext): Promise<unknown> | unknown =>
        def.handler(params as P, ctx);
      methods.set(def.method, { paramsSchema: def.paramsSchema, run });
    },

    async dispatch(request: JsonRpcRequest, ctx: MethodContext): Promise<JsonRpcResponse> {
      const method = methods.get(request.method);
      if (!method) {
        return createJSONRPCErrorResponse(
          request.id,
          JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
          `Method not found: ${request.method}`,
        );
      }

      const parsed = method.paramsSchema.safeParse(request.params);
      if (!parsed.success) {
        return createJSONRPCErrorResponse(
          request.id,
          JSON_RPC_ERROR_CODES.INVALID_PARAMS,
          "Invalid params",
          { issues: parsed.error.issues },
        );
      }

      try {
        const result = await method.run(parsed.data, ctx);
        return createJSONRPCSuccessResponse(request.id, result);
      } catch (error) {
        // A throwing handler must degrade into a response — never an unhandled
        // rejection that kills the process (error-handling spec).
        const message = error instanceof Error ? error.message : String(error);
        return createJSONRPCErrorResponse(request.id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message);
      }
    },
  };
}
