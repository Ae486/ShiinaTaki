/**
 * INPUT: WsTransport plus Core JSON-RPC frames parsed by ws-client-routes
 * OUTPUT: createWsClient() with typed operator requests, retryable subscriptions and producer invalidation observers
 * POS:    ui/lib operator transport composition root over inbound routes and typed outbound methods
 */

import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import { CHAT_METHODS, ChatSendResultSchema } from "@taki/shared";
import type { SubagentChanged } from "@taki/shared";
import type { SubagentMethods } from "./ws-client-subagents.ts";
import { addSubagentChangedHandler } from "./ws-client-routes.ts";
import type {
  CoWatchingChanged,
  BrowserPlaybackReadResult,
  AvatarCommand,
  ApprovalListResult,
  ApprovalRevokeParams,
  ApprovalRevokeResult,
  AvatarOutcomeParams,
  AvatarReportParams,
  CharacterCostumeResolutionResult,
  CharacterCostumesResult,
  CharacterImportParams,
  CharacterImportResult,
  CharacterListResult,
  ChatSendParams,
  ChatActivity,
  InteractionPatternChanged,
  InitiativeBackoffChanged,
  ChatActivityReadResult,
  CanonicalApprovalRespondParams,
  CanonicalApprovalRespondResult,
  ConfigChanged,
  ConfigListResult,
  MemoryOperation,
  ConfigSetParams,
  ConfigSetResult,
  ConnectParams,
  ExtensionConvergenceResult,
  ExtensionChanged,
  MediaClearResult,
  MediaGetResult,
  MediaUsageResult,
  MemoryStatusResult,
  MemoryTidyResult,
  McpAddParams,
  McpEditParams,
  McpEnableParams,
  McpGetResult,
  McpListResult,
  McpMutationResult,
  McpRemoveResult,
  McpStatusResult,
  McpTestParams,
  McpTestResult,
  SkillImportParams,
  SkillInspectResult,
  SkillListResult,
  SkillMutationParams,
  SkillMutationResult,
  SkillRemoveResult,
  SkillReconcileResult,
  SecretSetParams,
  SecretSetResult,
  PerceptionCard,
  PerceptionChanged,
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
  TimelineCommitted,
  TimingPolicy,
  MonitorStateResult,
  RunMonitorListParams,
  RunMonitorListResult,
  TrajectoryParams,
  TrajectoryResult,
  TrajectoryInspectParams,
  TrajectoryInspector,
  RunMonitorSubscribeParams,
  RunMonitorEvent,
} from "@taki/shared";
import { requestWithDeadline } from "./rpc-deadline.ts";
import type { ReadSubscriptionSupport } from "./ws-read-subscriptions.ts";
import { createTimingPolicyStore, type TimingPolicyStore } from "./timing-policy.ts";
import { createTimingPolicySync, type TimingPolicySync } from "./timing-policy-sync.ts";
import type { MemoryOperationMethods } from "./ws-client-memory-operations.ts";
import type { UserTimezoneMethods } from "./ws-client-user-timezone.ts";
import type { PresenceMethods } from "./ws-client-presence.ts";
import type { InitiativeMethods } from "./ws-client-initiative.ts";
import type { CoWatchingMethods } from "./ws-client-co-watching.ts";
import { handshake, requestMethods, type ConnectOutcome } from "./ws-client-methods.ts";
import {
  addConfigChangedHandler,
  addInitiativeChangedHandler,
  addPerceptionChangedHandler,
  addCoWatchingChangedHandler,
  addExtensionChangedHandler,
  addChatActivityHandler,
  addTimelineCommittedHandler,
  addApprovalHandler,
  addMemoryOperationHandler,
  addMonitorHandler,
  bindTransport,
  createRoutes,
  installRoutes,
  CONNECTION_LOST_MESSAGE,
  WsOpenDeadlineExceededError,
  type ApprovalPushEvent,
} from "./ws-client-routes.ts";
import type { WsTransport } from "./ws-transport.ts";
import { sendChatTurn, type ChatHandlers } from "./ws-chat-turn.ts";

export type { ChatHandlers, ConnectOutcome };

export interface WsClient extends MemoryOperationMethods, UserTimezoneMethods, PresenceMethods, InitiativeMethods, CoWatchingMethods, SubagentMethods {
  onSubagentChanged(handler: (change: SubagentChanged) => void): () => void;
  onCoWatchingChanged(handler: (change: CoWatchingChanged) => void): () => void;
  browserPlaybackRead(): Promise<BrowserPlaybackReadResult>;
  onInitiativePatternsChanged(handler: (change: InteractionPatternChanged) => void): () => void;
  onInitiativeSetupChanged(handler: (change: InteractionPatternChanged) => void): () => void;
  onInitiativeWakePolicyChanged(handler: (change: InteractionPatternChanged) => void): () => void;
  onInitiativeBackoffChanged(handler: (change: InitiativeBackoffChanged) => void): () => void;
  connect(params: ConnectParams): Promise<ConnectOutcome>;
  chat(params: ChatSendParams, handlers: ChatHandlers): Promise<void>;
  /** Cancels the character's in-flight turn (idempotent; false = nothing was running). The composer's abort entry. */
  chatCancel(characterId: string, runId?: string): Promise<boolean>;
  /** Disposable active-turn recovery; never replays a send or a tool. */
  chatActivityRead(characterId: string): Promise<ChatActivityReadResult>;
  onChatActivity(handler: (event: ChatActivity) => void): () => void;
  onTimelineCommitted(handler: (batch: TimelineCommitted) => void): () => void;
  subscribeAvatar(characterId: string): Promise<void>;
  reportAvatar(params: AvatarReportParams): Promise<void>;
  /** Reports one received Avatar Command's Presentation Outcome (interactive deadline; the caller never replays it). */
  reportAvatarOutcome(params: AvatarOutcomeParams): Promise<void>;
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
  /** Reads the effective Privacy Pause snapshot; deadline projection does not write persistence. */
  perceptionPauseGet(): Promise<PerceptionPauseState>;
  /** Pauses (optionally until an epoch-ms deadline) or resumes ambient sampling; echoes the resulting state. */
  perceptionPauseSet(params: PerceptionPauseSetParams): Promise<PerceptionPauseState>;
  /** Reads the activity card: current + recent foreground stretches, sampling status, pause state. */
  perceptionCard(): Promise<PerceptionCard>;
  /** One opt-in membership per physical socket; only an exact missing-method reply enables manual fallback. */
  subscribePerception(): Promise<ReadSubscriptionSupport>;
  onPerceptionChanged(handler: (changed: PerceptionChanged) => void): () => void;
  /** Reads the Core-authoritative global Permission Level and durable policy generation. */
  permissionLevelGet(): Promise<PermissionLevelState>;
  /** Mutates the global Level with optimistic generation matching; timed-out outcomes are never replayed. */
  permissionLevelSet(params: PermissionLevelSetParams): Promise<PermissionLevelState>;
  /** Reads the complete Core projection used by the advanced Settings cells view. */
  permissionCellsGet(): Promise<PermissionCellsState>;
  /** Stores or resets one Core cell override with optimistic generation matching. */
  permissionCellSet(params: PermissionCellSetParams): Promise<PermissionCellSetResult>;
  /** Reads current owner/generation convergence facts; this is not an executable Agent Run snapshot. */
  extensionStatus(): Promise<ExtensionConvergenceResult>;
  subscribeExtensions(): Promise<ReadSubscriptionSupport>;
  onExtensionChanged(handler: (changed: ExtensionChanged) => void): () => void;
  /** Reads the merged desired + runtime view of every configured MCP server (the MCP page's read). */
  mcpList(): Promise<McpListResult>;
  /** Reads one MCP server's desired row plus its live runtime status. */
  mcpGet(serverId: string): Promise<McpGetResult>;
  /** Adds a desired MCP server (config carries opaque secret-ref markers only) and awaits its candidate. */
  mcpAdd(params: McpAddParams): Promise<McpMutationResult>;
  /** Edits a desired server under its optimistic configRevision; conflicts reject with MCP_CONFIG_CONFLICT. */
  mcpEdit(params: McpEditParams): Promise<McpMutationResult>;
  /** Enables a disabled server (re-runs its candidate and publishes; no restart). */
  mcpEnable(params: McpEnableParams): Promise<McpMutationResult>;
  /** Disables a server: new leases block immediately, the generation drains and closes once. */
  mcpDisable(params: McpEnableParams): Promise<McpMutationResult>;
  /** Removes a server from desired state and drains its runtime generation. */
  mcpRemove(params: McpEnableParams): Promise<McpRemoveResult>;
  /** Runs an ephemeral candidate with diagnostics only — it never publishes tools. */
  mcpTest(params: McpTestParams): Promise<McpTestResult>;
  /** Re-runs a server's candidate and publishes the replacement generation. */
  mcpReconnect(serverId: string): Promise<McpMutationResult>;
  /** Reads the sanitized runtime status of every server the manager knows. */
  mcpStatus(): Promise<McpStatusResult>;
  skillList(): Promise<SkillListResult>;
  skillInspect(packageId: string): Promise<SkillInspectResult>;
  skillImport(params: SkillImportParams): Promise<SkillMutationResult>;
  skillEnable(params: SkillMutationParams): Promise<SkillMutationResult>;
  skillDisable(params: SkillMutationParams): Promise<SkillMutationResult>;
  skillRemove(params: SkillMutationParams): Promise<SkillRemoveResult>;
  skillReconcile(): Promise<SkillReconcileResult>;
  /** Stores one secret value through the sensitive write-only path (the MCP page's set-value flow). */
  secretSet(params: SecretSetParams): Promise<SecretSetResult>;
  approvalRespond(params: CanonicalApprovalRespondParams): Promise<CanonicalApprovalRespondResult>;
  approvalList(): Promise<ApprovalListResult>;
  approvalRevoke(params: ApprovalRevokeParams): Promise<ApprovalRevokeResult>;
  onApproval(handler: (event: ApprovalPushEvent) => void): () => void;
  monitorState(): Promise<MonitorStateResult>;
  monitorList(params: RunMonitorListParams): Promise<RunMonitorListResult>;
  monitorTrajectory(params: TrajectoryParams): Promise<TrajectoryResult>;
  monitorInspect(params: TrajectoryInspectParams): Promise<TrajectoryInspector>;
  subscribeMonitor(params: RunMonitorSubscribeParams): Promise<void>;
  unsubscribeMonitor(): Promise<void>;
  onMonitorEvent(handler: (event: RunMonitorEvent) => void): () => void;
  /** Registers a memory.operations.changed sink (the Operations page refetches the composite status on each push). */
  onMemoryOperationChanged(handler: (operation: MemoryOperation) => void): () => void;
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
  methods: Pick<ReturnType<typeof requestMethods>, "configList" | "subscribeConfig" | "onConfigSubscriptionRecovered">;
}

function createClientTimingSync(input: TimingSyncInput): TimingPolicySync | null {
  if (!input.deps.timingPolicy) return null;
  return createTimingPolicySync({
    store: input.store,
    list: input.methods.configList,
    subscribe: input.methods.subscribeConfig,
    onConfigChanged: (handler) => addConfigChangedHandler(input.state, handler),
    onSubscriptionRecovered: input.methods.onConfigSubscriptionRecovered,
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
  const { invalidateConfigList, ...methods } = requestMethods(rpc, timing);
  // Register before timing and page observers: a verified push retires stale list sharing before
  // any consumer can synchronously request its next baseline. Raw/malformed frames never reach it.
  addConfigChangedHandler(state, invalidateConfigList);
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
      await sendChatTurn({ slot: state, characterId: params.characterId, handlers,
        request: async () => ChatSendResultSchema.parse(await requestWithDeadline({ rpc, timing, method: CHAT_METHODS.send, params })) });
    },
    ...methods,
    ...pushRegistrations(state),
    currentTimingPolicy: timing,
    onClose: (handler) => transport.onClose(handler),
    close: () => closeClient(timingSync, retire, transport),
  };
}

function pushRegistrations(state: ReturnType<typeof createRoutes>) {
  return {
    onSubagentChanged: (handler: (change: SubagentChanged) => void) => addSubagentChangedHandler(state, handler),
    onCoWatchingChanged: (handler: (change: CoWatchingChanged) => void) => addCoWatchingChangedHandler(state, handler),
    onInitiativePatternsChanged: (handler: (change: InteractionPatternChanged) => void) => addInitiativeChangedHandler(state, "initiativePatterns", handler),
    onInitiativeSetupChanged: (handler: (change: InteractionPatternChanged) => void) => addInitiativeChangedHandler(state, "initiativeSetup", handler),
    onInitiativeWakePolicyChanged: (handler: (change: InteractionPatternChanged) => void) => addInitiativeChangedHandler(state, "initiativePolicy", handler),
    onInitiativeBackoffChanged: (handler: (change: InitiativeBackoffChanged) => void) => addInitiativeChangedHandler(state, "initiativeBackoff", handler),
    onChatActivity: (handler: (event: ChatActivity) => void) => addChatActivityHandler(state, handler),
    onTimelineCommitted: (handler: (batch: TimelineCommitted) => void) => addTimelineCommittedHandler(state, handler),
    onPerceptionChanged: (handler: (changed: PerceptionChanged) => void) => addPerceptionChangedHandler(state, handler),
    onExtensionChanged: (handler: (changed: ExtensionChanged) => void) => addExtensionChangedHandler(state, handler),
    onAvatarCommand: (handler: (command: AvatarCommand) => void) => void (state.push.avatar = handler),
    onTimelineAppended: (handler: (entry: TimelineEntry) => void) => void (state.push.timeline = handler),
    onTimelineRemoved: (handler: (ref: TimelineRemoved) => void) => void (state.push.timelineRemoved = handler),
    onConfigChanged: (handler: (changed: ConfigChanged) => void) => addConfigChangedHandler(state, handler),
    onApproval: (handler: (event: ApprovalPushEvent) => void) => addApprovalHandler(state, handler),
    onMonitorEvent: (handler: (event: RunMonitorEvent) => void) => addMonitorHandler(state, handler),
    onMemoryOperationChanged: (handler: (operation: MemoryOperation) => void) => addMemoryOperationHandler(state, handler),
  };
}
