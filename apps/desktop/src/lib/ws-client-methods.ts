/**
 * INPUT:  a JSON-RPC client bound to the operator socket + call params from the UI hooks.
 * OUTPUT: handshake() (connect outcome) + requestMethods() — the plain request/response half of the WsClient
 *         (chat/timeline/media/character/config/memory/perception/permission governance).
 * POS:    ui/lib — the outbound half of ws-client (no turn/stream state lives here). Every result is parsed through a
 *         @taki/shared schema: the zod boundary holds for every inbound frame.
 */

import { JSONRPCErrorException, type JSONRPCParams, type JSONRPCServerAndClient } from "json-rpc-2.0";
import {
  AVATAR_METHODS,
  CHARACTER_METHODS,
  CHAT_METHODS,
  CONFIG_METHODS,
  CONNECT_METHOD,
  CharacterCostumeResolutionResultSchema,
  CharacterCostumesResultSchema,
  CharacterImportResultSchema,
  CharacterListResultSchema,
  ChatCancelResultSchema,
  ConfigListResultSchema,
  ConfigSetResultSchema,
  ConfigSubscribeResultSchema,
  ConnectResultSchema,
  ErrorCodeSchema,
  MEDIA_METHODS,
  MEMORY_METHODS,
  MediaClearResultSchema,
  MediaGetResultSchema,
  MediaUsageResultSchema,
  MemoryStatusResultSchema,
  MemoryTidyResultSchema,
  PERCEPTION_METHODS,
  PerceptionCardSchema,
  PerceptionPauseStateSchema,
  PERMISSION_METHODS,
  PermissionCellSetResultSchema,
  PermissionCellsStateSchema,
  PermissionLevelStateSchema,
  TIMELINE_METHODS,
  TimelineHistoryResultSchema,
  type AvatarReportParams,
  type CharacterImportParams,
  type ConfigSetParams,
  type ConnectParams,
  type ErrorCode,
  type PerceptionPauseSetParams,
  type PermissionCellSetParams,
  type PermissionLevelSetParams,
  type TimelineHistoryParams,
  type TimingPolicy,
} from "@taki/shared";
import { requestWithDeadline } from "./rpc-deadline.ts";

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

/** The handshake outcome: authenticated, or refused with the app ErrorCode (PAIRING_REQUIRED / AUTH_FAILED / ...). */
export type ConnectOutcome = { ok: true; token?: string } | { ok: false; code: ErrorCode | null; message: string };

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
    return { ok: true, token: result.token };
  } catch (error) {
    if (error instanceof JSONRPCErrorException) {
      return { ok: false, code: appErrorCode(error.data), message: error.message };
    }
    throw error;
  }
}

export function requestMethods(rpc: JSONRPCServerAndClient, timing: () => TimingPolicy) {
  const request = <T>(method: string, params: JSONRPCParams): Promise<T> => requestWithDeadline({ rpc, timing, method, params });
  let configSubscription: Promise<void> | null = null;
  return {
    subscribeAvatar: async (characterId: string) => void (await request(AVATAR_METHODS.subscribe, { characterId })),
    reportAvatar: async (params: AvatarReportParams) => {
      // One centralized trace for EVERY re-report (boot / costume promotion / manual switch / drift self-heal): the
      // provable-re-report the acceptance needs. A dead-names regression shows here as a count mismatch (1b).
      console.info(`[avatar] reported vocab motions=${params.motions.length} expressions=${params.expressions.length}`);
      await request(AVATAR_METHODS.report, params);
    },
    chatCancel: async (characterId: string) =>
      ChatCancelResultSchema.parse(await request(CHAT_METHODS.cancel, { characterId })).cancelled,
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
    configList: async () => ConfigListResultSchema.parse(await request(CONFIG_METHODS.list, {})),
    configSet: async (params: ConfigSetParams) =>
      ConfigSetResultSchema.parse(await request(CONFIG_METHODS.set, params)),
    subscribeConfig: () => {
      configSubscription ??= request<unknown>(CONFIG_METHODS.subscribe, {}).then((result) => {
        ConfigSubscribeResultSchema.parse(result);
      });
      return configSubscription;
    },
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
    ...permissionMethods(request),
  };
}
