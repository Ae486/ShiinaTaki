/**
 * INPUT:  MethodRegistry plus the MCP lifecycle service (desired repo + runtime manager) and a Logger
 * OUTPUT: registerMcpMethods(...) — the operator-only mcp.* family's single registration seam (list/get/add/
 *         edit/enable/disable/remove/test/reconnect/status); typed MCP_CONFIG_CONFLICT / MCP_REFUSED refusals
 *         with sanitized boundaries BEFORE the registry's verbatim error echo points
 * POS:    core/server/methods — thin controllers over mcp-lifecycle-service; no agent tool reaches these
 */
import {
  ErrorCodeSchema,
  MCP_METHODS,
  McpAddParamsSchema,
  McpDisableParamsSchema,
  McpEditParamsSchema,
  McpEnableParamsSchema,
  McpGetParamsSchema,
  McpListParamsSchema,
  McpReconnectParamsSchema,
  McpRemoveParamsSchema,
  McpStatusParamsSchema,
  McpTestParamsSchema,
  type McpAddParams,
  type McpDisableParams,
  type McpEditParams,
  type McpEnableParams,
  type McpGetParams,
  type McpListResult,
  type McpGetResult,
  type McpListParams,
  type McpMutationResult,
  type McpReconnectParams,
  type McpRemoveParams,
  type McpRemoveResult,
  type McpStatusParams,
  type McpStatusResult,
  type McpTestParams,
  type McpTestResult,
} from "@taki/shared";
import { McpConfigConflictError } from "../../mcp/mcp-desired-repo.ts";
import { McpRefusedError, type McpLifecycleService } from "../../mcp/mcp-lifecycle-service.ts";
import type { Logger } from "../../logging/logger.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition, MethodRegistry } from "../method-registry.ts";

export interface McpMethodDeps {
  service: McpLifecycleService;
  logger: Logger;
}

export function registerMcpMethods(registry: MethodRegistry, deps: McpMethodDeps): void {
  registry.register(mcpList(deps));
  registry.register(mcpGet(deps));
  registry.register(mcpAdd(deps));
  registry.register(mcpEdit(deps));
  registry.register(mcpEnable(deps));
  registry.register(mcpDisable(deps));
  registry.register(mcpRemove(deps));
  registry.register(mcpTest(deps));
  registry.register(mcpReconnect(deps));
  registry.register(mcpStatus(deps));
}

function mcpList(deps: McpMethodDeps): MethodDefinition<McpListParams> {
  return {
    method: MCP_METHODS.list, roles: ["operator"], paramsSchema: McpListParamsSchema,
    handler: (): McpListResult => guarded(deps, () => ({ servers: deps.service.list() })),
  };
}

function mcpGet(deps: McpMethodDeps): MethodDefinition<McpGetParams> {
  return {
    method: MCP_METHODS.get, roles: ["operator"], paramsSchema: McpGetParamsSchema,
    handler: (params): McpGetResult => guarded(deps, () => ({ server: deps.service.get(params) })),
  };
}

function mcpAdd(deps: McpMethodDeps): MethodDefinition<McpAddParams> {
  return {
    method: MCP_METHODS.add, roles: ["operator"], paramsSchema: McpAddParamsSchema,
    handler: (params): Promise<McpMutationResult> => guarded(deps, async () => ({ server: await deps.service.add(params) })),
  };
}

function mcpEdit(deps: McpMethodDeps): MethodDefinition<McpEditParams> {
  return {
    method: MCP_METHODS.edit, roles: ["operator"], paramsSchema: McpEditParamsSchema,
    handler: (params): Promise<McpMutationResult> => guarded(deps, async () => ({ server: await deps.service.edit(params) })),
  };
}

function mcpEnable(deps: McpMethodDeps): MethodDefinition<McpEnableParams> {
  return {
    method: MCP_METHODS.enable, roles: ["operator"], paramsSchema: McpEnableParamsSchema,
    handler: (params): Promise<McpMutationResult> => guarded(deps, async () => ({ server: await deps.service.enable(params) })),
  };
}

function mcpDisable(deps: McpMethodDeps): MethodDefinition<McpDisableParams> {
  return {
    method: MCP_METHODS.disable, roles: ["operator"], paramsSchema: McpDisableParamsSchema,
    handler: (params): McpMutationResult => guarded(deps, () => ({ server: deps.service.disable(params) })),
  };
}

function mcpRemove(deps: McpMethodDeps): MethodDefinition<McpRemoveParams> {
  return {
    method: MCP_METHODS.remove, roles: ["operator"], paramsSchema: McpRemoveParamsSchema,
    handler: (params): McpRemoveResult => guarded(deps, () => deps.service.remove(params)),
  };
}

function mcpTest(deps: McpMethodDeps): MethodDefinition<McpTestParams> {
  return {
    method: MCP_METHODS.test, roles: ["operator"], paramsSchema: McpTestParamsSchema,
    handler: (params): Promise<McpTestResult> => guarded(deps, () => deps.service.test(params)),
  };
}

function mcpReconnect(deps: McpMethodDeps): MethodDefinition<McpReconnectParams> {
  return {
    method: MCP_METHODS.reconnect, roles: ["operator"], paramsSchema: McpReconnectParamsSchema,
    handler: (params): Promise<McpMutationResult> => guarded(deps, async () => ({ server: await deps.service.reconnect(params) })),
  };
}

function mcpStatus(deps: McpMethodDeps): MethodDefinition<McpStatusParams> {
  return {
    method: MCP_METHODS.status, roles: ["operator"], paramsSchema: McpStatusParamsSchema,
    handler: (): McpStatusResult => guarded(deps, () => ({ servers: deps.service.statuses() })),
  };
}

/**
 * Sanitization boundary BEFORE method-registry.ts echo points: revision conflicts carry the current revision,
 * lifecycle refusals carry a bounded machine reason, param-shape failures pass through (path/message only), and
 * anything unexpected becomes a fixed-message INTERNAL_ERROR — the real cause goes to the log, value-free.
 */
function guarded<T>(deps: McpMethodDeps, run: () => T): T;
function guarded<T>(deps: McpMethodDeps, run: () => Promise<T>): Promise<T>;
function guarded(deps: McpMethodDeps, run: () => unknown): unknown {
  try {
    const result = run();
    // Candidate/publication work is async: sanitize rejections at the same boundary as synchronous throws.
    if (result instanceof Promise) return result.catch((error: unknown) => {
      throw sanitizeMcpError(deps, error);
    });
    return result;
  } catch (error) {
    throw sanitizeMcpError(deps, error);
  }
}

function sanitizeMcpError(deps: McpMethodDeps, error: unknown): unknown {
  if (error instanceof McpConfigConflictError) {
    return appException(ErrorCodeSchema.enum.MCP_CONFIG_CONFLICT, error.message, { currentConfigRevision: error.currentConfigRevision });
  }
  if (error instanceof McpRefusedError) {
    return appException(ErrorCodeSchema.enum.MCP_REFUSED, error.message, { reason: error.reason });
  }
  if (error instanceof Error && error.name === "ZodError") return error;
  deps.logger.child({ mod: "mcp" }).error({ err: error instanceof Error ? error.name : "unknown" }, "mcp method failed");
  return appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "mcp lifecycle operation failed");
}
