/**
 * INPUT:  a JSON-RPC client bound to the operator socket + call params from the UI hooks.
 * OUTPUT: handshake() (connect outcome) + requestMethods() — the plain request/response half of the WsClient
 *         (chat/timeline/media/character/config/memory/perception).
 * POS:    ui/lib — the outbound half of ws-client (no turn/stream state lives here). Every result is parsed through a
 *         @taki/shared schema: the zod boundary holds for every inbound frame.
 */

import { JSONRPCErrorException, type JSONRPCServerAndClient } from "json-rpc-2.0";
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
  TIMELINE_METHODS,
  TimelineHistoryResultSchema,
  type AvatarReportParams,
  type CharacterImportParams,
  type ConfigSetParams,
  type ConnectParams,
  type ErrorCode,
  type PerceptionPauseSetParams,
  type TimelineHistoryParams,
} from "@taki/shared";

/** The handshake outcome: authenticated, or refused with the app ErrorCode (PAIRING_REQUIRED / AUTH_FAILED / ...). */
export type ConnectOutcome = { ok: true; token?: string } | { ok: false; code: ErrorCode | null; message: string };

function appErrorCode(data: unknown): ErrorCode | null {
  if (typeof data !== "object" || data === null || !("code" in data)) return null;
  const parsed = ErrorCodeSchema.safeParse(data.code);
  return parsed.success ? parsed.data : null;
}

export async function handshake(rpc: JSONRPCServerAndClient, params: ConnectParams): Promise<ConnectOutcome> {
  try {
    const result = ConnectResultSchema.parse(await rpc.request(CONNECT_METHOD, params));
    return { ok: true, token: result.token };
  } catch (error) {
    if (error instanceof JSONRPCErrorException) {
      return { ok: false, code: appErrorCode(error.data), message: error.message };
    }
    throw error;
  }
}

export function requestMethods(rpc: JSONRPCServerAndClient) {
  return {
    subscribeAvatar: async (characterId: string) => void (await rpc.request(AVATAR_METHODS.subscribe, { characterId })),
    reportAvatar: async (params: AvatarReportParams) => {
      // One centralized trace for EVERY re-report (boot / costume promotion / manual switch / drift self-heal): the
      // provable-re-report the acceptance needs. A dead-names regression shows here as a count mismatch (1b).
      console.info(`[avatar] reported vocab motions=${params.motions.length} expressions=${params.expressions.length}`);
      await rpc.request(AVATAR_METHODS.report, params);
    },
    chatCancel: async (characterId: string) =>
      ChatCancelResultSchema.parse(await rpc.request(CHAT_METHODS.cancel, { characterId })).cancelled,
    timelineHistory: async (params: TimelineHistoryParams) =>
      TimelineHistoryResultSchema.parse(await rpc.request(TIMELINE_METHODS.history, params)),
    subscribeTimeline: async (characterId: string) => void (await rpc.request(TIMELINE_METHODS.subscribe, { characterId })),
    mediaGet: async (ref: string) => MediaGetResultSchema.parse(await rpc.request(MEDIA_METHODS.get, { ref })),
    importCharacter: async (params: CharacterImportParams) =>
      CharacterImportResultSchema.parse(await rpc.request(CHARACTER_METHODS.import, params)),
    listCharacters: async () => CharacterListResultSchema.parse(await rpc.request(CHARACTER_METHODS.list, {})),
    characterCostumes: async (characterId: string) =>
      CharacterCostumesResultSchema.parse(await rpc.request(CHARACTER_METHODS.costumes, { characterId })),
    costumeResolution: async (characterId: string, costume: string) =>
      CharacterCostumeResolutionResultSchema.parse(
        await rpc.request(CHARACTER_METHODS.costumeResolution, { characterId, costume }),
      ),
    configList: async () => ConfigListResultSchema.parse(await rpc.request(CONFIG_METHODS.list, {})),
    configSet: async (params: ConfigSetParams) =>
      ConfigSetResultSchema.parse(await rpc.request(CONFIG_METHODS.set, params)),
    subscribeConfig: async () =>
      void ConfigSubscribeResultSchema.parse(await rpc.request(CONFIG_METHODS.subscribe, {})),
    memoryTidy: async (characterId: string) =>
      MemoryTidyResultSchema.parse(await rpc.request(MEMORY_METHODS.tidy, { characterId })),
    memoryStatus: async (characterId: string) =>
      MemoryStatusResultSchema.parse(await rpc.request(MEMORY_METHODS.status, { characterId })),
    mediaUsage: async () => MediaUsageResultSchema.parse(await rpc.request(MEDIA_METHODS.usage, {})),
    mediaClear: async () => MediaClearResultSchema.parse(await rpc.request(MEDIA_METHODS.clear, {})),
    perceptionPauseGet: async () =>
      PerceptionPauseStateSchema.parse(await rpc.request(PERCEPTION_METHODS.pauseGet, {})),
    perceptionPauseSet: async (params: PerceptionPauseSetParams) =>
      PerceptionPauseStateSchema.parse(await rpc.request(PERCEPTION_METHODS.pauseSet, params)),
    perceptionCard: async () => PerceptionCardSchema.parse(await rpc.request(PERCEPTION_METHODS.card, {})),
  };
}
