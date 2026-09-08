/**
 * INPUT:  a JSON-RPC client bound to the operator socket + call params from the UI hooks.
 * OUTPUT: echo-verified handshake() plus schema-verified operator read, write and subscription methods
 * POS:    ui/lib — the outbound half of ws-client (no turn/stream state lives here). Every result is parsed through a
 *         @taki/shared schema: the zod boundary holds for every inbound frame.
 */

import { JSONRPCErrorException, type JSONRPCParams, type JSONRPCServerAndClient } from "json-rpc-2.0";
import {
  AVATAR_METHODS,
  APPROVAL_METHODS,
  ApprovalListResultSchema,
  ApprovalRevokeResultSchema,
  CanonicalApprovalRespondResultSchema,
  CHARACTER_METHODS,
  CHAT_METHODS,
  CONNECT_METHOD,
  CharacterCostumeResolutionResultSchema,
  CharacterCostumesResultSchema,
  CharacterImportResultSchema,
  CharacterListResultSchema,
  ChatCancelResultSchema,
  ChatActivityReadResultSchema,
  ConnectResultSchema,
  ErrorCodeSchema,
  EXTENSION_METHODS,
  ExtensionConvergenceResultSchema,
  MEDIA_METHODS,
  MEMORY_METHODS,
  MCP_METHODS,
  MediaClearResultSchema,
  MediaGetResultSchema,
  MediaUsageResultSchema,
  MemoryStatusResultSchema,
  MemoryTidyResultSchema,
  MonitorStateResultSchema,
  McpGetResultSchema,
  McpListResultSchema,
  McpMutationResultSchema,
  McpRemoveResultSchema,
  McpStatusResultSchema,
  McpTestResultSchema,
  SKILL_METHODS,
  SkillInspectResultSchema,
  SkillListResultSchema,
  SkillMutationResultSchema,
  SkillRemoveResultSchema,
  SkillReconcileResultSchema,
  PERCEPTION_METHODS,
  OBSERVABILITY_METHODS,
  SECRET_METHODS,
  SecretSetResultSchema,
  PerceptionCardSchema,
  PerceptionPauseStateSchema,
  PERMISSION_METHODS,
  PermissionCellSetResultSchema,
  PermissionCellsStateSchema,
  PermissionLevelStateSchema,
  TIMELINE_METHODS,
  TimelineHistoryResultSchema,
  RunMonitorListResultSchema,
  RunMonitorSubscribeResultSchema,
  RunMonitorUnsubscribeResultSchema,
  TrajectoryInspectorSchema,
  TrajectoryResultSchema,
  type AvatarReportParams,
  type ApprovalRevokeParams,
  type CanonicalApprovalRespondParams,
  type CharacterImportParams,
  type ConnectParams,
  type ConnectResult,
  type ErrorCode,
  type McpAddParams,
  type McpEditParams,
  type McpEnableParams,
  type McpTestParams,
  type SkillImportParams,
  type SkillMutationParams,
  type SecretSetParams,
  type PerceptionPauseSetParams,
  type PermissionCellSetParams,
  type PermissionLevelSetParams,
  type TimelineHistoryParams,
  type TimingPolicy,
  type RunMonitorListParams,
  type RunMonitorSubscribeParams,
  type TrajectoryInspectParams,
  type TrajectoryParams,
} from "@taki/shared";
import { requestWithDeadline } from "./rpc-deadline.ts";
import { configMethods } from "./ws-config-methods.ts";
import { readSubscriptionMethods } from "./ws-read-subscriptions.ts";

function permissionMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    permissionLevelGet: async () =>
      PermissionLevelStateSchema.parse(await request(PERMISSION_METHODS.levelGet, {})),
    permissionLevelSet: async (params: PermissionLevelSetParams) =>
      PermissionLevelStateSchema.parse(await request(PERMISSION_METHODS.levelSet, params)),
    permissionCellsGet: async () =>
      PermissionCellsStateSchema.parse(await request(PERMISSION_METHODS.cellsGet, {})),
    permissionCellSet: async (params: PermissionCellSetParams) =>
      PermissionCellSetResultSchema.parse(await request(PERMISSION_METHODS.cellSet, params)),
  };
}

function approvalMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    approvalRespond: async (params: CanonicalApprovalRespondParams) =>
      CanonicalApprovalRespondResultSchema.parse(await request(APPROVAL_METHODS.respond, params)),
    approvalList: async () => ApprovalListResultSchema.parse(await request(APPROVAL_METHODS.list, {})),
    approvalRevoke: async (params: ApprovalRevokeParams) =>
      ApprovalRevokeResultSchema.parse(await request(APPROVAL_METHODS.revoke, params)),
  };
}

function extensionMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    extensionStatus: async () => ExtensionConvergenceResultSchema.parse(await request(EXTENSION_METHODS.status, {})),
  };
}

/** The MCP lifecycle family: every result parsed through its @taki/shared schema at the boundary. */
function mcpMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    mcpList: async () => McpListResultSchema.parse(await request(MCP_METHODS.list, {})),
    mcpGet: async (serverId: string) => McpGetResultSchema.parse(await request(MCP_METHODS.get, { serverId })),
    mcpAdd: async (params: McpAddParams) => McpMutationResultSchema.parse(await request(MCP_METHODS.add, params)),
    mcpEdit: async (params: McpEditParams) => McpMutationResultSchema.parse(await request(MCP_METHODS.edit, params)),
    mcpEnable: async (params: McpEnableParams) => McpMutationResultSchema.parse(await request(MCP_METHODS.enable, params)),
    mcpDisable: async (params: McpEnableParams) => McpMutationResultSchema.parse(await request(MCP_METHODS.disable, params)),
    mcpRemove: async (params: McpEnableParams) => McpRemoveResultSchema.parse(await request(MCP_METHODS.remove, params)),
    mcpTest: async (params: McpTestParams) => McpTestResultSchema.parse(await request(MCP_METHODS.test, params)),
    mcpReconnect: async (serverId: string) => McpMutationResultSchema.parse(await request(MCP_METHODS.reconnect, { serverId })),
    mcpStatus: async () => McpStatusResultSchema.parse(await request(MCP_METHODS.status, {})),
    // The MCP page's write-only secret-value path: the value goes ONLY to secret.set (the sanctioned sensitive
    // method), never into any mcp.* frame or cached view; the desired config keeps the opaque marker.
    secretSet: async (params: SecretSetParams) => SecretSetResultSchema.parse(await request(SECRET_METHODS.set, params)),
  };
}

function skillMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    skillList: async () => SkillListResultSchema.parse(await request(SKILL_METHODS.list, {})),
    skillInspect: async (packageId: string) => SkillInspectResultSchema.parse(await request(SKILL_METHODS.inspect, { packageId })),
    skillImport: async (params: SkillImportParams) => SkillMutationResultSchema.parse(await request(SKILL_METHODS.import, params)),
    skillEnable: async (params: SkillMutationParams) => SkillMutationResultSchema.parse(await request(SKILL_METHODS.enable, params)),
    skillDisable: async (params: SkillMutationParams) => SkillMutationResultSchema.parse(await request(SKILL_METHODS.disable, params)),
    skillRemove: async (params: SkillMutationParams) => SkillRemoveResultSchema.parse(await request(SKILL_METHODS.remove, params)),
    skillReconcile: async () => SkillReconcileResultSchema.parse(await request(SKILL_METHODS.reconcile, {})),
  };
}

/** The handshake outcome: authenticated, or refused with the app ErrorCode (PAIRING_REQUIRED / AUTH_FAILED / ...). */
export type ConnectOutcome =
  | ({ ok: true } & Pick<ConnectResult, "token" | "approvalCommandDisclosureRevision">)
  | { ok: false; code: ErrorCode | null; message: string };

function appErrorCode(data: unknown): ErrorCode | null {
  if (typeof data !== "object" || data === null || !("code" in data)) return null;
  const parsed = ErrorCodeSchema.safeParse(data.code);
  return parsed.success ? parsed.data : null;
}

export async function handshake(
  rpc: JSONRPCServerAndClient,
  timing: () => TimingPolicy,
  params: ConnectParams,
): Promise<ConnectOutcome> {
  try {
    const result = ConnectResultSchema.parse(await requestWithDeadline({ rpc, timing, method: CONNECT_METHOD, params }));
    if (params.approvalCommandDisclosureRevision !== undefined
      && result.approvalCommandDisclosureRevision !== params.approvalCommandDisclosureRevision) {
      return { ok: false, code: null, message: "Core 版本不支持完整命令审批，请更新 Core 后重试。" };
    }
    return { ok: true, token: result.token, approvalCommandDisclosureRevision: result.approvalCommandDisclosureRevision };
  } catch (error) {
    if (error instanceof JSONRPCErrorException) {
      return { ok: false, code: appErrorCode(error.data), message: error.message };
    }
    throw error;
  }
}

function avatarMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    subscribeAvatar: async (characterId: string) => void (await request(AVATAR_METHODS.subscribe, { characterId })),
    reportAvatar: async (params: AvatarReportParams) => {
      // One centralized trace for every re-report makes vocabulary drift observable without logging names.
      console.info(`[avatar] reported vocab motions=${params.motions.length} expressions=${params.expressions.length}`);
      await request(AVATAR_METHODS.report, params);
    },
  };
}

export function requestMethods(rpc: JSONRPCServerAndClient, timing: () => TimingPolicy) {
  const request = <T>(method: string, params: JSONRPCParams): Promise<T> => requestWithDeadline({ rpc, timing, method, params });
  return {
    ...avatarMethods(request),
    chatCancel: async (characterId: string, runId?: string) =>
      ChatCancelResultSchema.parse(await request(CHAT_METHODS.cancel, { characterId, ...(runId ? { runId } : {}) })).cancelled,
    chatActivityRead: async (characterId: string) =>
      ChatActivityReadResultSchema.parse(await request(CHAT_METHODS.activityRead, { characterId })),
    timelineHistory: async (params: TimelineHistoryParams) =>
      TimelineHistoryResultSchema.parse(await request(TIMELINE_METHODS.history, params)),
    subscribeTimeline: async (characterId: string) => void (await request(TIMELINE_METHODS.subscribe, { characterId })),
    mediaGet: async (ref: string) => MediaGetResultSchema.parse(await request(MEDIA_METHODS.get, { ref })),
    importCharacter: async (params: CharacterImportParams) =>
      CharacterImportResultSchema.parse(await request(CHARACTER_METHODS.import, params)),
    listCharacters: async () => CharacterListResultSchema.parse(await request(CHARACTER_METHODS.list, {})),
    characterCostumes: async (characterId: string) =>
      CharacterCostumesResultSchema.parse(await request(CHARACTER_METHODS.costumes, { characterId })),
    costumeResolution: async (characterId: string, costume: string) =>
      CharacterCostumeResolutionResultSchema.parse(
        await request(CHARACTER_METHODS.costumeResolution, { characterId, costume }),
      ),
    ...configMethods(request),
    ...readSubscriptionMethods(request),
    memoryTidy: async (characterId: string) =>
      MemoryTidyResultSchema.parse(await request(MEMORY_METHODS.tidy, { characterId })),
    memoryStatus: async (characterId: string) =>
      MemoryStatusResultSchema.parse(await request(MEMORY_METHODS.status, { characterId })),
    mediaUsage: async () => MediaUsageResultSchema.parse(await request(MEDIA_METHODS.usage, {})),
    mediaClear: async () => MediaClearResultSchema.parse(await request(MEDIA_METHODS.clear, {})),
    perceptionPauseGet: async () =>
      PerceptionPauseStateSchema.parse(await request(PERCEPTION_METHODS.pauseGet, {})),
    perceptionPauseSet: async (params: PerceptionPauseSetParams) =>
      PerceptionPauseStateSchema.parse(await request(PERCEPTION_METHODS.pauseSet, params)),
    perceptionCard: async () => PerceptionCardSchema.parse(await request(PERCEPTION_METHODS.card, {})),
    monitorState: async () => MonitorStateResultSchema.parse(await request(OBSERVABILITY_METHODS.state, {})),
    monitorList: async (params: RunMonitorListParams) => RunMonitorListResultSchema.parse(await request(OBSERVABILITY_METHODS.list, params)),
    monitorTrajectory: async (params: TrajectoryParams) => TrajectoryResultSchema.parse(await request(OBSERVABILITY_METHODS.trajectory, params)),
    monitorInspect: async (params: TrajectoryInspectParams) => TrajectoryInspectorSchema.parse(await request(OBSERVABILITY_METHODS.inspect, params)),
    subscribeMonitor: async (params: RunMonitorSubscribeParams) => void RunMonitorSubscribeResultSchema.parse(await request(OBSERVABILITY_METHODS.subscribe, params)),
    unsubscribeMonitor: async () => void RunMonitorUnsubscribeResultSchema.parse(await request(OBSERVABILITY_METHODS.unsubscribe, {})),
    ...permissionMethods(request),
    ...approvalMethods(request),
    ...extensionMethods(request),
    ...mcpMethods(request),
    ...skillMethods(request),
  };
}
