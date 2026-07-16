/**
 * INPUT:  a WsTransport (browser WebSocket by default) + inbound JSON-RPC frames from the Core; every frame is zod-parsed here.
 * OUTPUT: createWsClient({transport}) -> WsClient: connect()/chat()/subscribeAvatar()/reportAvatar() +
 *         timelineHistory()/subscribeTimeline()/mediaGet() (chat window) + importCharacter()/listCharacters()/
 *         characterCostumes()/costumeResolution() (#18) + avatar/timeline push handlers.
 * POS:    ui/lib — the Pet UI's operator transport to the Agent Core (mirrors apps/cli chat-client, browser WS). THE
 *         zod boundary: past this file inbound data is trusted typed data (type-safety spec). No React/Tauri imports.
 */

import { JSONRPCClient, JSONRPCErrorException, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import {
  AVATAR_METHODS,
  AvatarCommandSchema,
  CHARACTER_METHODS,
  CHAT_METHODS,
  CONNECT_METHOD,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  CharacterCostumeResolutionResultSchema,
  CharacterCostumesResultSchema,
  CharacterImportResultSchema,
  CharacterListResultSchema,
  ConnectResultSchema,
  ErrorCodeSchema,
  JsonRpcClientFrameSchema,
  MEDIA_METHODS,
  MediaGetResultSchema,
  TIMELINE_METHODS,
  TimelineAppendedSchema,
  TimelineHistoryResultSchema,
  type AvatarCommand,
  type AvatarReportParams,
  type CharacterCostumeResolutionResult,
  type CharacterCostumesResult,
  type CharacterImportParams,
  type CharacterImportResult,
  type CharacterListResult,
  type ChatSendParams,
  type ConnectParams,
  type ErrorCode,
  type JsonRpcClientFrame,
  type MediaGetResult,
  type TimelineEntry,
  type TimelineHistoryParams,
  type TimelineHistoryResult,
} from "@taki/shared";
import type { WsTransport } from "./ws-transport.ts";

/** Streamed-turn callbacks: deltas append into the bubble, complete/error settle it (mirrors the CLI's ChatHandlers). */
export interface ChatHandlers {
  // messageId keys the in-flight assistant row (the chat window drops it when its persisted entry arrives, #17).
  onDelta: (delta: string, messageId: string) => void;
  onComplete?: () => void;
  onError?: (code: ErrorCode, message: string) => void;
}

/** The handshake outcome: authenticated, or refused with the app ErrorCode (PAIRING_REQUIRED / AUTH_FAILED / ...). */
export type ConnectOutcome =
  | { ok: true; token?: string }
  | { ok: false; code: ErrorCode | null; message: string };

export interface WsClient {
  connect(params: ConnectParams): Promise<ConnectOutcome>;
  chat(params: ChatSendParams, handlers: ChatHandlers): Promise<void>;
  subscribeAvatar(characterId: string): Promise<void>;
  reportAvatar(params: AvatarReportParams): Promise<void>;
  /** Fetches one newest-first page of a character's timeline (the chat window's history paging). */
  timelineHistory(params: TimelineHistoryParams): Promise<TimelineHistoryResult>;
  /** Subscribes this socket to a character's live timeline.appended pushes (chat window backlog + live). */
  subscribeTimeline(characterId: string): Promise<void>;
  /** Fetches one attachment's bytes for scroll-back rendering; rejects (FORBIDDEN/missing) surface to the caller. */
  mediaGet(ref: string): Promise<MediaGetResult>;
  /** Imports an operator-picked model archive (base64) into the Workspace; returns costumes + import warnings (#18). */
  importCharacter(params: CharacterImportParams): Promise<CharacterImportResult>;
  /** Lists the imported characters (feeds the costume switcher + the reserved M5 roster). */
  listCharacters(): Promise<CharacterListResult>;
  /** Reads one character's costumes + per-costume settings filenames (the renderer composes the asset URL from these). */
  characterCostumes(characterId: string): Promise<CharacterCostumesResult>;
  /** Reads one costume's external-ref resolution map (feeds settings pruning + resolve before a switch, #18). */
  costumeResolution(characterId: string, costume: string): Promise<CharacterCostumeResolutionResult>;
  /** Registers the fire-and-forget avatar command sink (core -> operator push). Replaces any prior handler. */
  onAvatarCommand(handler: (command: AvatarCommand) => void): void;
  /** Registers the optional live-timeline sink (shared with the chat window server-side). */
  onTimelineAppended(handler: (entry: TimelineEntry) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

interface Turn {
  handlers: ChatHandlers;
  finish: () => void;
}

interface PushSlots {
  avatar: ((command: AvatarCommand) => void) | null;
  timeline: ((entry: TimelineEntry) => void) | null;
}

interface Routes {
  current: Turn | null;
  push: PushSlots;
}

/** Routes the Core's notifications (chat stream + avatar/timeline pushes) to their handlers; each is zod-validated. */
function installRoutes(rpc: JSONRPCServerAndClient, state: Routes): void {
  const endTurn = (act: (turn: Turn) => void): void => {
    const turn = state.current;
    state.current = null;
    if (turn) act(turn);
  };
  rpc.addMethod(CHAT_METHODS.delta, (params: unknown) => {
    const { delta, messageId } = ChatDeltaSchema.parse(params);
    state.current?.handlers.onDelta(delta, messageId);
  });
  rpc.addMethod(CHAT_METHODS.complete, (params: unknown) => {
    ChatCompleteSchema.parse(params);
    endTurn((turn) => {
      turn.handlers.onComplete?.();
      turn.finish();
    });
  });
  rpc.addMethod(CHAT_METHODS.error, (params: unknown) => {
    const { code, message } = ChatErrorSchema.parse(params);
    endTurn((turn) => {
      turn.handlers.onError?.(code, message);
      turn.finish();
    });
  });
  // Fire-and-forget pushes: a missing handler is harmless (closing the Pet UI must not break a turn, invariant 4).
  rpc.addMethod(AVATAR_METHODS.command, (params: unknown) => {
    state.push.avatar?.(AvatarCommandSchema.parse(params));
  });
  rpc.addMethod(TIMELINE_METHODS.appended, (params: unknown) => {
    state.push.timeline?.(TimelineAppendedSchema.parse(params));
  });
}

/** null = not a valid client frame; the caller drops it (never a silent swallow that corrupts routing). */
function parseFrame(text: string): JsonRpcClientFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const frame = JsonRpcClientFrameSchema.safeParse(parsed);
  return frame.success ? frame.data : null;
}

async function handshake(rpc: JSONRPCServerAndClient, params: ConnectParams): Promise<ConnectOutcome> {
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

function appErrorCode(data: unknown): ErrorCode | null {
  if (typeof data !== "object" || data === null || !("code" in data)) return null;
  const parsed = ErrorCodeSchema.safeParse(data.code);
  return parsed.success ? parsed.data : null;
}

// The plain request/response methods (no turn/handshake state) — split out to keep createWsClient within the size cap.
// Each parses its result through a @taki/shared schema: the zod boundary holds for every inbound frame.
function requestMethods(rpc: JSONRPCServerAndClient) {
  return {
    subscribeAvatar: async (characterId: string) => void (await rpc.request(AVATAR_METHODS.subscribe, { characterId })),
    reportAvatar: async (params: AvatarReportParams) => void (await rpc.request(AVATAR_METHODS.report, params)),
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
  };
}

export function createWsClient(deps: { transport: WsTransport }): WsClient {
  const { transport } = deps;
  const rpc = new JSONRPCServerAndClient(
    new JSONRPCServer(),
    new JSONRPCClient((payload) => transport.send(JSON.stringify(payload))),
  );
  const state: Routes = { current: null, push: { avatar: null, timeline: null } };
  installRoutes(rpc, state);

  let opened = false;
  const openWaiters: Array<() => void> = [];
  transport.onOpen(() => {
    opened = true;
    for (const wake of openWaiters.splice(0)) wake();
  });
  transport.onMessage((data) => {
    const frame = parseFrame(data);
    if (frame) void rpc.receiveAndSend(frame);
  });
  transport.onClose(() => rpc.rejectAllPendingRequests("connection closed"));
  const whenOpen = (): Promise<void> =>
    opened ? Promise.resolve() : new Promise<void>((resolve) => openWaiters.push(resolve));

  return {
    async connect(params) {
      await whenOpen();
      return handshake(rpc, params);
    },
    async chat(params, handlers) {
      const done = new Promise<void>((resolve) => {
        state.current = { handlers, finish: resolve };
      });
      try {
        await rpc.request(CHAT_METHODS.send, params);
      } catch (error) {
        state.current = null; // the turn never started — drop the stale handlers
        throw error;
      }
      await done;
    },
    ...requestMethods(rpc),
    onAvatarCommand: (handler) => (state.push.avatar = handler),
    onTimelineAppended: (handler) => (state.push.timeline = handler),
    onClose: (handler) => transport.onClose(handler),
    close: () => transport.close(),
  };
}
