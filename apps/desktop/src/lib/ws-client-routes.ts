/**
 * INPUT:  inbound JSON-RPC notification frames from the Core (chat stream and typed operator pushes) and the
 *         captured connection-scoped push slots.
 * OUTPUT: Routes state (in-flight turn + push slots), installRoutes() and compatibility re-exports of connection binding helpers.
 * POS:    ui/lib — the inbound half of ws-client: THE zod boundary (past it, data is trusted typed data). No
 *         React/Tauri imports; node-testable through the injected transport.
 */

import type { JSONRPCServerAndClient } from "json-rpc-2.0";
import {
  AVATAR_METHODS,
  APPROVAL_METHODS,
  ApprovalClosedSchema,
  CanonicalApprovalRequestSchema,
  AvatarCommandSchema,
  CHAT_METHODS,
  INTERACTION_PATTERN_METHODS, INITIATIVE_SETUP_METHODS, INITIATIVE_WAKE_METHODS,
  InteractionPatternChangedSchema,
  INITIATIVE_BACKOFF_METHODS, InitiativeBackoffChangedSchema,
  CO_WATCHING_METHODS, CoWatchingChangedSchema, type CoWatchingChanged,
  CONFIG_METHODS,
  MEMORY_OPERATION_METHODS,
  MEMORY_REPLICA_METHODS, MemoryReplicaChangedSchema, type MemoryReplicaChanged,
  MEMORY_ONBOARDING_METHODS,
  MemoryOperationChangedSchema,
  MemoryOnboardingChangedSchema,
  MODEL_PROFILE_METHODS, ModelProfilesChangedSchema, type ModelProfilesChanged,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ChatActivitySchema,
  ConfigChangedSchema,
  EXTENSION_METHODS,
  ExtensionChangedSchema,
  PERCEPTION_METHODS,
  PerceptionChangedSchema,
  OBSERVABILITY_METHODS,
  CACHE_USAGE_METHODS, CacheUsageUpdateSchema, type CacheUsageUpdate,
  MAINTENANCE_MONITOR_METHODS, MaintenanceMonitorUpdateSchema, type MaintenanceMonitorUpdate,
  RunMonitorEventSchema,
  TIMELINE_METHODS,
  TimelineAppendedSchema,
  TimelineRemovedSchema,
  TimelineCommittedSchema,
  type ChatActivity,
  type InteractionPatternChanged,
  type InitiativeBackoffChanged,
  type AvatarCommand,
  type ApprovalClosed,
  type CanonicalApprovalRequest,
  type ConfigChanged,
  type MemoryOperation,
  type MemoryOnboardingChanged,
  type ExtensionChanged,
  type PerceptionChanged,
  type RunMonitorEvent,
  type TimelineEntry,
  type TimelineRemoved,
  type TimelineCommitted,
} from "@taki/shared";
import { SUBAGENT_METHODS, SubagentChangedSchema, SubagentActivitySchema, type SubagentChanged, type SubagentActivity } from "@taki/shared";
import { routeChatNotification, type PendingChatTurn } from "./ws-chat-turn.ts";

interface PushSlots {
  modelProfiles: Set<(change: ModelProfilesChanged) => void>;
  cacheUsage: Set<(update: CacheUsageUpdate) => void>;
  maintenanceMonitor: Set<(update: MaintenanceMonitorUpdate) => void>;
  subagentActivity: Set<(event: SubagentActivity) => void>;
  subagents: Set<(change: SubagentChanged) => void>;
  coWatching: Set<(change: CoWatchingChanged) => void>;
  initiativePatterns: Set<(change: InteractionPatternChanged) => void>;
  initiativeSetup: Set<(change: InteractionPatternChanged) => void>;
  initiativePolicy: Set<(change: InteractionPatternChanged) => void>;
  initiativeBackoff: Set<(change: InitiativeBackoffChanged) => void>;
  avatar: ((command: AvatarCommand) => void) | null;
  timeline: ((entry: TimelineEntry) => void) | null;
  timelineRemoved: ((ref: TimelineRemoved) => void) | null;
  config: Set<(changed: ConfigChanged) => void>;
  perception: Set<(changed: PerceptionChanged) => void>;
  extension: Set<(changed: ExtensionChanged) => void>;
  approval: Set<(event: ApprovalPushEvent) => void>;
  monitor: Set<(event: RunMonitorEvent) => void>;
  memoryOperation: Set<(operation: MemoryOperation) => void>;
  memoryReplica: Set<(changed: MemoryReplicaChanged) => void>;
  memoryOnboarding: Set<(changed: MemoryOnboardingChanged) => void>;
  activity: Set<(event: ChatActivity) => void>;
  committed: Set<(batch: TimelineCommitted) => void>;
}

export type ApprovalPushEvent =
  | { type: "request"; request: CanonicalApprovalRequest }
  | { type: "closed"; closed: ApprovalClosed };

export interface Routes {
  current: PendingChatTurn | null;
  push: PushSlots;
}

export function createRoutes(): Routes {
  return { current: null, push: { modelProfiles: new Set(), maintenanceMonitor: new Set(), cacheUsage: new Set(), subagentActivity: new Set(), subagents: new Set(), coWatching: new Set(), avatar: null, timeline: null, timelineRemoved: null, config: new Set(),
    initiativePatterns: new Set(), initiativeSetup: new Set(), initiativePolicy: new Set(), initiativeBackoff: new Set(),
    approval: new Set(), monitor: new Set(), memoryOperation: new Set(), memoryReplica: new Set(), memoryOnboarding: new Set(),
    activity: new Set(), committed: new Set(), perception: new Set(), extension: new Set() } };
}

export function addInitiativeChangedHandler(state: Routes,
  kind: "initiativePatterns" | "initiativeSetup" | "initiativePolicy" | "initiativeBackoff",
  handler: (change: InteractionPatternChanged) => void): () => void {
  state.push[kind].add(handler);
  return () => state.push[kind].delete(handler);
}

export function addChatActivityHandler(state: Routes, handler: (event: ChatActivity) => void): () => void {
  state.push.activity.add(handler);
  return () => state.push.activity.delete(handler);
}

export function addTimelineCommittedHandler(state: Routes, handler: (batch: TimelineCommitted) => void): () => void {
  state.push.committed.add(handler);
  return () => state.push.committed.delete(handler);
}

export function addConfigChangedHandler(state: Routes, handler: (changed: ConfigChanged) => void): () => void {
  state.push.config.add(handler);
  return () => state.push.config.delete(handler);
}

export function addCoWatchingChangedHandler(state: Routes, handler: (changed: CoWatchingChanged) => void): () => void {
  state.push.coWatching.add(handler);
  return () => state.push.coWatching.delete(handler);
}

export function addSubagentChangedHandler(state: Routes, handler: (changed: SubagentChanged) => void): () => void {
  state.push.subagents.add(handler);
  return () => state.push.subagents.delete(handler);
}

export function addSubagentActivityHandler(state: Routes, handler: (event: SubagentActivity) => void): () => void {
  state.push.subagentActivity.add(handler);
  return () => state.push.subagentActivity.delete(handler);
}

export function addPerceptionChangedHandler(state: Routes, handler: (changed: PerceptionChanged) => void): () => void {
  state.push.perception.add(handler);
  return () => state.push.perception.delete(handler);
}

export function addExtensionChangedHandler(state: Routes, handler: (changed: ExtensionChanged) => void): () => void {
  state.push.extension.add(handler);
  return () => state.push.extension.delete(handler);
}

export function addApprovalHandler(state: Routes, handler: (event: ApprovalPushEvent) => void): () => void {
  state.push.approval.add(handler);
  return () => state.push.approval.delete(handler);
}
export function addMonitorHandler(state: Routes, handler: (event: RunMonitorEvent) => void): () => void { state.push.monitor.add(handler); return () => state.push.monitor.delete(handler); }
export function addMemoryOperationHandler(state: Routes, handler: (operation: MemoryOperation) => void): () => void {
  state.push.memoryOperation.add(handler);
  return () => state.push.memoryOperation.delete(handler);
}

export function addMemoryReplicaHandler(state: Routes, handler: (changed: MemoryReplicaChanged) => void): () => void {
  state.push.memoryReplica.add(handler);
  return () => state.push.memoryReplica.delete(handler);
}

export function addMemoryOnboardingHandler(state: Routes, handler: (changed: MemoryOnboardingChanged) => void): () => void {
  state.push.memoryOnboarding.add(handler);
  return () => state.push.memoryOnboarding.delete(handler);
}

/** Routes the Core's notifications (chat stream + avatar/timeline/config pushes) to their handlers; each zod-validated. */
export function installRoutes(rpc: JSONRPCServerAndClient, state: Routes): void {
  rpc.addMethod(CHAT_METHODS.delta, (params: unknown) => {
    routeChatNotification(state, { kind: "delta", value: ChatDeltaSchema.parse(params) });
  });
  rpc.addMethod(CHAT_METHODS.complete, (params: unknown) => {
    routeChatNotification(state, { kind: "complete", value: ChatCompleteSchema.parse(params) });
  });
  rpc.addMethod(CHAT_METHODS.error, (params: unknown) => {
    routeChatNotification(state, { kind: "error", value: ChatErrorSchema.parse(params) });
  });
  rpc.addMethod(CHAT_METHODS.activity, (params: unknown) => {
    publishHandlers(state.push.activity, ChatActivitySchema.parse(params));
  });
  rpc.addMethod(TIMELINE_METHODS.committed, (params: unknown) => {
    publishHandlers(state.push.committed, TimelineCommittedSchema.parse(params));
  });
  // Fire-and-forget pushes: a missing handler is harmless (closing a client window must not break a turn, invariant 4).
  rpc.addMethod(AVATAR_METHODS.command, (params: unknown) => {
    state.push.avatar?.(AvatarCommandSchema.parse(params));
  });
  rpc.addMethod(TIMELINE_METHODS.appended, (params: unknown) => {
    state.push.timeline?.(TimelineAppendedSchema.parse(params));
  });
  rpc.addMethod(TIMELINE_METHODS.removed, (params: unknown) => {
    state.push.timelineRemoved?.(TimelineRemovedSchema.parse(params));
  });
  installFanOutRoutes(rpc, state);
  installApprovalRoutes(rpc, state);
  installInitiativeRoutes(rpc, state);
}

function installInitiativeRoutes(rpc: JSONRPCServerAndClient, state: Routes): void {
  rpc.addMethod(INITIATIVE_BACKOFF_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.initiativeBackoff, InitiativeBackoffChangedSchema.parse(params));
  });
  for (const [method, kind] of [
    [INTERACTION_PATTERN_METHODS.changed, "initiativePatterns"],
    [INITIATIVE_SETUP_METHODS.changed, "initiativeSetup"],
    [INITIATIVE_WAKE_METHODS.changed, "initiativePolicy"],
  ] as const) {
    rpc.addMethod(method, (params: unknown) => {
      publishHandlers(state.push[kind], InteractionPatternChangedSchema.parse(params));
    });
  }
}

function publishHandlers<T>(handlers: Set<(value: T) => void>, value: T): void {
  for (const handler of [...handlers]) {
    try { handler(value); } catch { console.warn("[ws-client] push handler failed"); }
  }
}

/** Multi-handler pushes: one throwing handler never starves its siblings. */
function installFanOutRoutes(rpc: JSONRPCServerAndClient, state: Routes): void {
  rpc.addMethod(MODEL_PROFILE_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.modelProfiles, ModelProfilesChangedSchema.parse(params));
  });
  rpc.addMethod(CACHE_USAGE_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.cacheUsage, CacheUsageUpdateSchema.parse(params));
  });
  rpc.addMethod(MAINTENANCE_MONITOR_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.maintenanceMonitor, MaintenanceMonitorUpdateSchema.parse(params));
  });
  rpc.addMethod(SUBAGENT_METHODS.activity, (params: unknown) => {
    publishHandlers(state.push.subagentActivity, SubagentActivitySchema.parse(params));
  });
  rpc.addMethod(SUBAGENT_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.subagents, SubagentChangedSchema.parse(params));
  });
  rpc.addMethod(CO_WATCHING_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.coWatching, CoWatchingChangedSchema.parse(params));
  });
  rpc.addMethod(CONFIG_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.config, ConfigChangedSchema.parse(params));
  });
  rpc.addMethod(OBSERVABILITY_METHODS.event, (params: unknown) => {
    publishHandlers(state.push.monitor, RunMonitorEventSchema.parse(params));
  });
  rpc.addMethod(PERCEPTION_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.perception, PerceptionChangedSchema.parse(params));
  });
  rpc.addMethod(EXTENSION_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.extension, ExtensionChangedSchema.parse(params));
  });
  rpc.addMethod(MEMORY_OPERATION_METHODS.changed, (params: unknown) => {
    const { operation } = MemoryOperationChangedSchema.parse(params);
    publishHandlers(state.push.memoryOperation, operation);
  });
  rpc.addMethod(MEMORY_ONBOARDING_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.memoryOnboarding, MemoryOnboardingChangedSchema.parse(params));
  });
  rpc.addMethod(MEMORY_REPLICA_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.memoryReplica, MemoryReplicaChangedSchema.parse(params));
  });
}

function installApprovalRoutes(rpc: JSONRPCServerAndClient, state: Routes): void {
  rpc.addMethod(APPROVAL_METHODS.request, (params: unknown) => {
    const request = CanonicalApprovalRequestSchema.parse(params);
    notifyApprovalHandlers(state, { type: "request", request });
  });
  rpc.addMethod(APPROVAL_METHODS.closed, (params: unknown) => {
    const closed = ApprovalClosedSchema.parse(params);
    notifyApprovalHandlers(state, { type: "closed", closed });
  });
}

function notifyApprovalHandlers(state: Routes, event: ApprovalPushEvent): void {
  publishHandlers(state.push.approval, event);
}

export { bindTransport, parseFrame, abortTurn, WsOpenDeadlineExceededError, CONNECTION_LOST_MESSAGE, type TransportBinding } from "./ws-client-binding.ts";
