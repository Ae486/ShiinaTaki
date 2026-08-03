/**
 * INPUT:  a WsTransport (browser WebSocket by default) + inbound JSON-RPC frames from the Core (parsed in ws-client-routes).
 * OUTPUT: createWsClient({transport}) -> WsClient: connect()/chat()/subscribeAvatar()/reportAvatar() +
 *         timelineHistory()/subscribeTimeline()/mediaGet() (chat page) + importCharacter()/listCharacters()/
 *         characterCostumes()/costumeResolution() (#18) + configList()/configSet()/subscribeConfig() + push handlers.
 * POS:    ui/lib — the Pet UI's operator transport to the Agent Core (mirrors apps/cli chat-client, browser WS). The
 *         composition root over ws-client-routes (inbound) and ws-client-methods (outbound). No React/Tauri imports.
 */

import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import { CHAT_METHODS } from "@taki/shared";
import type {
  AvatarCommand,
  AvatarReportParams,
  CharacterCostumeResolutionResult,
  CharacterCostumesResult,
  CharacterImportParams,
  CharacterImportResult,
  CharacterListResult,
  ChatSendParams,
  ConfigChanged,
  ConfigListResult,
  ConfigSetParams,
  ConfigSetResult,
  ConnectParams,
  MediaGetResult,
  TimelineEntry,
  TimelineHistoryParams,
  TimelineHistoryResult,
  TimelineRemoved,
} from "@taki/shared";
import { handshake, requestMethods, type ConnectOutcome } from "./ws-client-methods.ts";
import { bindTransport, createRoutes, installRoutes, CONNECTION_LOST_MESSAGE, type ChatHandlers } from "./ws-client-routes.ts";
import type { WsTransport } from "./ws-transport.ts";

export type { ChatHandlers, ConnectOutcome };

export interface WsClient {
  connect(params: ConnectParams): Promise<ConnectOutcome>;
  chat(params: ChatSendParams, handlers: ChatHandlers): Promise<void>;
  /** Cancels the character's in-flight turn (idempotent; false = nothing was running). The composer's abort entry. */
  chatCancel(characterId: string): Promise<boolean>;
  subscribeAvatar(characterId: string): Promise<void>;
  reportAvatar(params: AvatarReportParams): Promise<void>;
  /** Fetches one newest-first page of a character's timeline (the chat page's history paging). */
  timelineHistory(params: TimelineHistoryParams): Promise<TimelineHistoryResult>;
  /** Subscribes this socket to a character's live timeline.appended pushes (chat page backlog + live). */
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
  /** Reads every config knob with its effective value + provenance (the settings pages' source of truth). */
  configList(): Promise<ConfigListResult>;
  /** Stores a knob value (null resets to env/default); refusals arrive as a CONFIG_REFUSED rejection. */
  configSet(params: ConfigSetParams): Promise<ConfigSetResult>;
  /** Subscribes this socket to config.changed pushes (another operator surface edited a knob). */
  subscribeConfig(): Promise<void>;
  /** Registers the fire-and-forget avatar command sink (core -> operator push). Replaces any prior handler. */
  onAvatarCommand(handler: (command: AvatarCommand) => void): void;
  /** Registers the optional live-timeline sink (shared with the chat page server-side). */
  onTimelineAppended(handler: (entry: TimelineEntry) => void): void;
  /** Registers the optional retract sink: a row was deleted (cancel-before-reply); the store drops it by seq. */
  onTimelineRemoved(handler: (ref: TimelineRemoved) => void): void;
  /** Registers the optional config.changed sink (the settings pages re-render the knob). */
  onConfigChanged(handler: (changed: ConfigChanged) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

export function createWsClient(deps: { transport: WsTransport }): WsClient {
  const { transport } = deps;
  const rpc = new JSONRPCServerAndClient(
    new JSONRPCServer(),
    new JSONRPCClient((payload) => transport.send(JSON.stringify(payload))),
  );
  const state = createRoutes();
  installRoutes(rpc, state);
  const { whenOpen, isClosed } = bindTransport(transport, rpc, state);

  return {
    async connect(params) {
      await whenOpen();
      return handshake(rpc, params);
    },
    async chat(params, handlers) {
      // A turn started on a dead socket can never be answered — reject now instead of leaving the caller pending (D29).
      if (isClosed()) throw new Error(CONNECTION_LOST_MESSAGE);
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
    onTimelineRemoved: (handler) => (state.push.timelineRemoved = handler),
    onConfigChanged: (handler) => (state.push.config = handler),
    onClose: (handler) => transport.onClose(handler),
    close: () => transport.close(),
  };
}
