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
 * server to close the socket after this response is flushed (fail-closed auth refusals);
 * `onClose` registers a cleanup to run when that socket closes (subscription teardown).
 */
export interface MethodContext {
  notify: (method: string, params: unknown) => void;
  connection: Connection;
  close: () => void;
  onClose: (cb: () => void) => void;
}

export interface MethodDefinition<P> {
  method: string;
  /** Roles allowed to call this method once authenticated (dispatch returns FORBIDDEN otherwise). */
  roles: Role[];
  paramsSchema: ZodType<P>;
  /** Optional fail-closed cleanup for a method whose invalid candidate must retire prior live state. */
  onInvalidParams?: (params: unknown, ctx: MethodContext) => void;
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
  onInvalidParams?: (params: unknown, ctx: MethodContext) => void;
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
      methods.set(def.method, {
        roles: def.roles,
        paramsSchema: def.paramsSchema,
        onInvalidParams: def.onInvalidParams,
        run,
      });
    },

    dispatch: (request, ctx) => dispatch(methods, request, ctx),
  };
}

async function dispatch(
  methods: Map<string, RegisteredMethod>,
  request: JsonRpcRequest,
  ctx: MethodContext,
): Promise<JsonRpcResponse> {
  const method = methods.get(request.method);
  if (!method) {
    return createJSONRPCErrorResponse(request.id, JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${request.method}`);
  }
  const parsed = method.paramsSchema.safeParse(request.params);
  if (!parsed.success) return invalidParams({ method, request, ctx, issues: parsed.error.issues });
  const connection = ctx.connection.state;
  if (connection.status === "authenticated" && !method.roles.includes(connection.role)) {
    return appErrorResponse(request.id, ErrorCodeSchema.enum.FORBIDDEN, `role ${connection.role} may not call ${request.method}`);
  }
  try {
    return createJSONRPCSuccessResponse(request.id, await method.run(parsed.data, ctx));
  } catch (error) {
    if (error instanceof JSONRPCErrorException) {
      return createJSONRPCErrorResponse(request.id, error.code, error.message, error.data);
    }
    const message = error instanceof Error ? error.message : String(error);
    return createJSONRPCErrorResponse(request.id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message);
  }
}

interface InvalidParamsInput {
  method: RegisteredMethod;
  request: JsonRpcRequest;
  ctx: MethodContext;
  issues: unknown;
}

function invalidParams({ method, request, ctx, issues }: InvalidParamsInput): JsonRpcResponse {
  try {
    method.onInvalidParams?.(request.params, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createJSONRPCErrorResponse(request.id, JSON_RPC_ERROR_CODES.INTERNAL_ERROR, message);
  }
  return createJSONRPCErrorResponse(request.id, JSON_RPC_ERROR_CODES.INVALID_PARAMS, "Invalid params", { issues });
}
