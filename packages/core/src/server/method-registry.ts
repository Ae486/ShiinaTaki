/**
 * INPUT:  method registrations ({ method, paramsSchema, handler }) + inbound JSON-RPC requests
 * OUTPUT: createMethodRegistry() -> { register, dispatch }; dispatch returns a JSON-RPC response object
 * POS:    core/server — the WS method table + pluggable seam (invariant 7); zod-validates params before the handler
 */
import {
  JSONRPCErrorException,
  createJSONRPCErrorResponse,
  createJSONRPCSuccessResponse,
  type JSONRPCErrorResponse,
  type JSONRPCSuccessResponse,
} from "json-rpc-2.0";
import { ErrorCodeSchema, JSON_RPC_ERROR_CODES, type JsonRpcRequest, type Role } from "@taki/shared";
import type { ZodType } from "zod";
import { appErrorResponse } from "./app-error.ts";
import type { Connection } from "./connection-registry.ts";

/**
 * Per-connection handler context: `notify` pushes a JSON-RPC notification back to the one
 * socket this request arrived on; `connection` is that socket's auth state; `close` asks the
 * server to close the socket after this response is flushed (fail-closed auth refusals).
 */
export interface MethodContext {
  notify: (method: string, params: unknown) => void;
  connection: Connection;
  close: () => void;
}

export interface MethodDefinition<P> {
  method: string;
  /** Roles allowed to call this method once authenticated (dispatch returns FORBIDDEN otherwise). */
  roles: Role[];
  paramsSchema: ZodType<P>;
  handler: (params: P, ctx: MethodContext) => Promise<unknown> | unknown;
}

export type JsonRpcResponse = JSONRPCSuccessResponse | JSONRPCErrorResponse;

export interface MethodRegistry {
  register: <P>(def: MethodDefinition<P>) => void;
  dispatch: (request: JsonRpcRequest, ctx: MethodContext) => Promise<JsonRpcResponse>;
}

interface RegisteredMethod {
  roles: Role[];
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
      methods.set(def.method, { roles: def.roles, paramsSchema: def.paramsSchema, run });
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

      // Role gate applies once authenticated; the ws-server pre-auth gate guarantees a
      // still-awaiting connection can only reach the connect method (which any role may call).
      const connection = ctx.connection.state;
      if (connection.status === "authenticated" && !method.roles.includes(connection.role)) {
        return appErrorResponse(
          request.id,
          ErrorCodeSchema.enum.FORBIDDEN,
          `role ${connection.role} may not call ${request.method}`,
        );
      }

      try {
        const result = await method.run(parsed.data, ctx);
        return createJSONRPCSuccessResponse(request.id, result);
      } catch (error) {
        // A throwing handler must degrade into a response — never an unhandled rejection that
        // kills the process. A JSONRPCErrorException carries its own coded envelope (app errors).
        if (error instanceof JSONRPCErrorException) {
          return createJSONRPCErrorResponse(request.id, error.code, error.message, error.data);
        }
        const message = error instanceof Error ? error.message : String(error);
        return createJSONRPCErrorResponse(request.id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message);
      }
    },
  };
}
