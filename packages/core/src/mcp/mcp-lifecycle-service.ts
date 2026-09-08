/**
 * INPUT: desired-state repo, runtime manager, and operator mcp.* parameters
 * OUTPUT: typed CRUD/test/reconnect orchestration with post-commit invalidation before runtime reconciliation
 * POS: core/mcp operator controller; merged views expose opaque markers and never secret values
 */
import type {
  McpAddParams,
  McpDesiredServer,
  McpDisableParams,
  McpEditParams,
  McpEnableParams,
  McpGetParams,
  McpReconnectParams,
  McpRefusalReason,
  McpRemoveParams,
  McpRemoveResult,
  McpServerStatus,
  McpServerView,
  McpTestParams,
  McpTestResult,
} from "@taki/shared";
import type { McpDesiredRepo } from "./mcp-desired-repo.ts";
import { sanitizeKey } from "./mcp-tool-identity.ts";
import type { McpManager } from "./mcp-manager.ts";
import type { ExtensionChangeObserver } from "../extensions/notify-extension-change.ts";

/** A lifecycle refusal the methods layer converts to MCP_REFUSED + reason before any registry echo point. */
export class McpRefusedError extends Error {
  readonly reason: McpRefusalReason;
  constructor(reason: McpRefusalReason, message: string) {
    super(message);
    this.name = "McpRefusedError";
    this.reason = reason;
  }
}

export interface McpLifecycleService {
  list(): McpServerView[];
  get(params: McpGetParams): McpServerView;
  add(params: McpAddParams): Promise<McpServerView>;
  edit(params: McpEditParams): Promise<McpServerView>;
  enable(params: McpEnableParams): Promise<McpServerView>;
  disable(params: McpDisableParams): McpServerView;
  remove(params: McpRemoveParams): McpRemoveResult;
  test(params: McpTestParams): Promise<McpTestResult>;
  reconnect(params: McpReconnectParams): Promise<McpServerView>;
  statuses(): McpServerStatus[];
}

interface LifecycleContext {
  repo: McpDesiredRepo;
  manager: McpManager;
  onChange?: ExtensionChangeObserver;
}

export function createMcpLifecycleService(deps: LifecycleContext): McpLifecycleService {
  const context: LifecycleContext = { ...deps };
  return {
    list: () => context.repo.list().map((row) => viewOf(context, row)),
    get: (params) => viewOf(context, requireRow(context, params.serverId)),
    add: (params) => addServer(context, params),
    edit: (params) => editServer(context, params),
    enable: (params) => enableServer(context, params),
    disable: (params) => disableServer(context, params),
    remove: (params) => removeServer(context, params),
    test: (params) => testServer(context, params),
    reconnect: (params) => reconnectServer(context, params),
    statuses: () => context.manager.statuses(),
  };
}

function runtimeStatus(context: LifecycleContext, serverId: string): McpServerStatus {
  return context.manager.statuses().find((status) => status.serverId === serverId) ?? {
    serverId,
    phase: "disconnected",
    runtimeGeneration: null,
    leaseCount: 0,
    toolCount: 0,
    lastOutcome: null,
  };
}

function viewOf(context: LifecycleContext, row: McpDesiredServer): McpServerView {
  const status = runtimeStatus(context, row.serverId);
  return {
    serverId: row.serverId,
    ownerHostId: row.ownerHostId,
    config: row.config,
    enabled: row.enabled,
    selectedTools: row.selectedTools,
    configRevision: row.configRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    status,
  };
}

function requireRow(context: LifecycleContext, serverId: string): McpDesiredServer {
  const row = context.repo.get(serverId);
  if (row === null) throw new McpRefusedError("unknown-server", `no desired MCP server ${serverId}`);
  return row;
}

// Defense-in-depth for the key-collision guard: distinct valid ids cannot fold onto the same model-facing
// prefix, and an id colliding with an EXISTING desired id's fold is refused before any candidate runs.
function assertNoPrefixCollision(context: LifecycleContext, serverId: string): void {
  const fold = sanitizeKey(serverId);
  for (const existing of context.repo.list()) {
    if (existing.serverId !== serverId && sanitizeKey(existing.serverId) === fold) {
      throw new McpRefusedError("key-collision", `server id ${serverId} collides with ${existing.serverId}`);
    }
  }
}

async function addServer(context: LifecycleContext, params: McpAddParams): Promise<McpServerView> {
  if (context.repo.get(params.serverId) !== null) {
    throw new McpRefusedError("duplicate-server", `desired MCP server ${params.serverId} already exists`);
  }
  assertNoPrefixCollision(context, params.serverId);
  const row = context.repo.add({
    serverId: params.serverId,
    config: params.config,
    selectedTools: params.selectedTools ?? [],
    enabled: params.enabled ?? true,
  }, context.onChange);
  if (row.enabled) await context.manager.applyDesired(row);
  return viewOf(context, context.repo.get(row.serverId) ?? row);
}

async function editServer(context: LifecycleContext, params: McpEditParams): Promise<McpServerView> {
  requireRow(context, params.serverId);
  const row = context.repo.edit(params, context.onChange);
  if (row.enabled) await context.manager.applyDesired(row);
  else context.manager.disableServer(row);
  return viewOf(context, context.repo.get(row.serverId) ?? row);
}

async function enableServer(context: LifecycleContext, params: McpEnableParams): Promise<McpServerView> {
  requireRow(context, params.serverId);
  const row = context.repo.setEnabled({ serverId: params.serverId, enabled: true, expectedConfigRevision: params.expectedConfigRevision }, context.onChange);
  await context.manager.applyDesired(row);
  return viewOf(context, context.repo.get(row.serverId) ?? row);
}

function disableServer(context: LifecycleContext, params: McpDisableParams): McpServerView {
  requireRow(context, params.serverId);
  const row = context.repo.setEnabled({ serverId: params.serverId, enabled: false, expectedConfigRevision: params.expectedConfigRevision }, context.onChange);
  context.manager.disableServer(row); // lease blocking + drain/close exactly once (no restart)
  return viewOf(context, context.repo.get(row.serverId) ?? row);
}

function removeServer(context: LifecycleContext, params: McpRemoveParams): McpRemoveResult {
  requireRow(context, params.serverId);
  context.repo.remove(params, context.onChange);
  context.manager.removeServer(params.serverId);
  return { status: "removed" as const, serverId: params.serverId };
}

async function testServer(context: LifecycleContext, params: McpTestParams): Promise<McpTestResult> {
  if ("serverId" in params) {
    const row = requireRow(context, params.serverId);
    return context.manager.test({ serverId: row.serverId, config: row.config, selectedTools: row.selectedTools });
  }
  return context.manager.test({ serverId: "test-candidate", config: params.config, selectedTools: params.selectedTools ?? [] });
}

async function reconnectServer(context: LifecycleContext, params: McpReconnectParams): Promise<McpServerView> {
  const row = requireRow(context, params.serverId);
  if (!row.enabled) throw new McpRefusedError("server-disabled", `desired MCP server ${row.serverId} is disabled`);
  await context.manager.applyDesired(row);
  return viewOf(context, context.repo.get(row.serverId) ?? row);
}
