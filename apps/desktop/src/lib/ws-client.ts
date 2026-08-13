/**
 * INPUT:  a WsTransport (browser WebSocket by default) + inbound JSON-RPC frames from the Core (parsed in ws-client-routes).
 * OUTPUT: createWsClient({transport}) -> WsClient: connect()/chat()/subscribeAvatar()/reportAvatar() +
 *         timelineHistory()/subscribeTimeline()/mediaGet() (chat page) + importCharacter()/listCharacters()/
 *         characterCostumes()/costumeResolution() (#18) + configList()/configSet()/subscribeConfig() +
 *         memoryTidy()/memoryStatus()/mediaUsage()/mediaClear() plus perception/permission methods and handlers.
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
  MediaClearResult,
  MediaGetResult,
  MediaUsageResult,
  MemoryStatusResult,
  MemoryTidyResult,
  PerceptionCard,
  PerceptionPauseSetParams,
  PerceptionPauseState,
  PermissionCellSetParams,
  PermissionCellSetResult,
  PermissionCellsState,
  PermissionLevelSetParams,
  PermissionLevelState,
  TimelineEntry,
  TimelineHistoryParams,
  TimelineHistoryResult,
  TimelineRemoved,
  TimingPolicy,
} from "@taki/shared";
import { requestWithDeadline } from "./rpc-deadline.ts";
import { createTimingPolicyStore, type TimingPolicyStore } from "./timing-policy.ts";
import { createTimingPolicySync, type TimingPolicySync } from "./timing-policy-sync.ts";
import { handshake, requestMethods, type ConnectOutcome } from "./ws-client-methods.ts";
import {
  addConfigChangedHandler,
  bindTransport,
  createRoutes,
  installRoutes,
  CONNECTION_LOST_MESSAGE,
  WsOpenDeadlineExceededError,
  type ChatHandlers,
} from "./ws-client-routes.ts";
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
  /** Runs the memory tidy pass NOW and reports its per-class defect counts (operations page). */
  memoryTidy(characterId: string): Promise<MemoryTidyResult>;
  /** Reads the memory maintenance counters (window calibration / summary coverage / watermarks); never content. */
  memoryStatus(characterId: string): Promise<MemoryStatusResult>;
  /** Reads retained attachment + memory-text byte usage (the storage card). */
  mediaUsage(): Promise<MediaUsageResult>;
  /** Purges every retained attachment byte — destructive, so the page confirms before calling it. */
  mediaClear(): Promise<MediaClearResult>;
  /** Reads the Privacy Pause snapshot (a lapsed deadline self-resumes on this read). */
  perceptionPauseGet(): Promise<PerceptionPauseState>;
  /** Pauses (optionally until an epoch-ms deadline) or resumes ambient sampling; echoes the resulting state. */
  perceptionPauseSet(params: PerceptionPauseSetParams): Promise<PerceptionPauseState>;
  /** Reads the activity card: current + recent foreground stretches, sampling status, pause state. */
  perceptionCard(): Promise<PerceptionCard>;
  /** Reads the Core-authoritative global Permission Level and durable policy generation. */
  permissionLevelGet(): Promise<PermissionLevelState>;
  /** Mutates the global Level with optimistic generation matching; timed-out outcomes are never replayed. */
  permissionLevelSet(params: PermissionLevelSetParams): Promise<PermissionLevelState>;
  /** Reads the complete Core projection used by the advanced Settings cells view. */
  permissionCellsGet(): Promise<PermissionCellsState>;
  /** Stores or resets one Core cell override with optimistic generation matching. */
  permissionCellSet(params: PermissionCellSetParams): Promise<PermissionCellSetResult>;
  /** Registers the fire-and-forget avatar command sink (core -> operator push). Replaces any prior handler. */
  onAvatarCommand(handler: (command: AvatarCommand) => void): void;
  /** Registers the optional live-timeline sink (shared with the chat page server-side). */
  onTimelineAppended(handler: (entry: TimelineEntry) => void): void;
  /** Registers the optional retract sink: a row was deleted (cancel-before-reply); the store drops it by seq. */
  onTimelineRemoved(handler: (ref: TimelineRemoved) => void): void;
  /** Registers the optional config.changed sink (the settings pages re-render the knob). */
  onConfigChanged(handler: (changed: ConfigChanged) => void): () => void;
  /** Current last-good policy; each operation captures the relevant duration when it begins. */
  currentTimingPolicy(): TimingPolicy;
  onClose(handler: () => void): void;
  close(): void;
}

export interface WsClientDeps {
  transport: WsTransport;
  /** Window-owned so a later connection generation can retain the last-good policy without localStorage. */
  timingPolicy?: TimingPolicyStore;
  onTimingPolicyDiagnostic?: (message: string) => void;
}

interface TimingSyncInput {
  deps: WsClientDeps;
  store: TimingPolicyStore;
  state: ReturnType<typeof createRoutes>;
  methods: ReturnType<typeof requestMethods>;
}

function createClientTimingSync(input: TimingSyncInput): TimingPolicySync | null {
  if (!input.deps.timingPolicy) return null;
  return createTimingPolicySync({
    store: input.store,
    list: input.methods.configList,
    subscribe: input.methods.subscribeConfig,
    onConfigChanged: (handler) => addConfigChangedHandler(input.state, handler),
    onDiagnostic: input.deps.onTimingPolicyDiagnostic ?? ((message) => console.warn(`[timing-policy] ${message}`)),
  });
}

function closeClient(sync: TimingPolicySync | null, retire: () => void, transport: WsTransport): void {
  sync?.dispose();
  retire();
  transport.close();
}

function remainingOpenAuthBudget(deadlineAt: number, totalMs: number): number {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw new WsOpenDeadlineExceededError(totalMs);
  return remainingMs;
}

export function createWsClient(deps: WsClientDeps): WsClient {
  const { transport } = deps;
  const timingPolicy = deps.timingPolicy ?? createTimingPolicyStore();
  const timing = () => timingPolicy.current();
  const rpc = new JSONRPCServerAndClient(
    new JSONRPCServer(),
    new JSONRPCClient((payload) => transport.send(JSON.stringify(payload))),
  );
  const state = createRoutes();
  installRoutes(rpc, state);
  const { whenOpen, isClosed, retire } = bindTransport(transport, rpc, state);
  const methods = requestMethods(rpc, timing);
  const timingSync = createClientTimingSync({ deps, store: timingPolicy, state, methods });
  transport.onClose(() => timingSync?.dispose());

  return {
    async connect(params) {
      const openAuthMs = timing().openAuthMs;
      const deadlineAt = Date.now() + openAuthMs;
      await whenOpen(openAuthMs);
      const handshakeOpenAuthMs = remainingOpenAuthBudget(deadlineAt, openAuthMs);
      const handshakeTiming = () => ({ ...timing(), openAuthMs: handshakeOpenAuthMs });
      const outcome = await handshake(rpc, handshakeTiming, params);
      if (outcome.ok) timingSync?.start();
      return outcome;
    },
    async chat(params, handlers) {
      // A turn started on a dead socket can never be answered — reject now instead of leaving the caller pending (D29).
      if (isClosed()) throw new Error(CONNECTION_LOST_MESSAGE);
      const done = new Promise<void>((resolve) => {
        state.current = { handlers, finish: resolve };
      });
      try {
        await requestWithDeadline({ rpc, timing, method: CHAT_METHODS.send, params });
      } catch (error) {
        state.current = null; // the turn never started — drop the stale handlers
        throw error;
      }
      await done;
    },
    ...methods,
    onAvatarCommand: (handler) => (state.push.avatar = handler),
    onTimelineAppended: (handler) => (state.push.timeline = handler),
    onTimelineRemoved: (handler) => (state.push.timelineRemoved = handler),
    onConfigChanged: (handler) => addConfigChangedHandler(state, handler),
    currentTimingPolicy: timing,
    onClose: (handler) => transport.onClose(handler),
    close: () => closeClient(timingSync, retire, transport),
  };
}
