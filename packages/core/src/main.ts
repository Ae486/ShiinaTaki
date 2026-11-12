/* eslint-disable max-lines */
/**
 * INPUT:  process env (bootstrap) + the config store's resolved knobs, and OS signals
 * OUTPUT: a running headless Agent Core — WS server bound to loopback; exits 0 on SIGINT/SIGTERM
 * POS:    core — the process entry/composition root; wires boot (config store → logger → model(s) → db) →
 *         Timeline/activity delivery, Perception/extension invalidation, ephemeral Co-Watching chat context,
 *         cooperative media preparation, Skill-disclosed recommendation controls, bounded Run-event backfill, and MCP names → WS
 */
import { join } from "node:path";
import { createModelProfileService } from "./config/model-profile-service.ts";
import { observeModelProfileApplication } from "./config/model-profile-application.ts";
import { createAgentRuntimeConfig } from "./config/agent-runtime-config.ts";
import { loadAttachmentConfig } from "./config/attachment-config.ts";
import { loadAmbientScreenshotConfig } from "./config/ambient-screenshot-config.ts";
import { ServerConfigSchema } from "./config/server-config.ts";
import { AMBIENT_CONFIG_KEYS, CONTEXT_CONFIG_KEYS } from "./boot/feature-configuration.ts";
import { registerModelProfileMethods } from "./server/methods/model-profile-methods.ts";
import { createLocalConnectionAuth } from "./devices/local-connection-auth.ts";
import { randomUUID } from "node:crypto";
import type { ToolSet } from "ai";
import { BROWSER_PLAYBACK_ENABLED_KEY, CO_WATCHING_SKILL, MONITOR_MODE_CONFIG_KEY, MonitorModeSchema } from "@taki/shared";
import { CANONICAL_MEMORY_SYSTEM_PROMPT, createChatAgent } from "./agents/chat-agent.ts";
import { BASE_SYSTEM_PROMPT } from "./agents/base-prompt.ts";
import { createConversationStore } from "./agents/conversation-store.ts";
import { createScreenshotStore } from "./capabilities/screenshot-store.ts";
import { projectAmbientScreenshotRoute, projectScreenshotRoute } from "./capabilities/native-screenshot-result.ts";
import { createChatActivityProjection } from "./agents/chat-activity-projection.ts";
import { createPrimaryPersistence } from "./agents/primary-persistence.ts";
import type { MemoryOnboardingChanged, MemoryReplicaChanged, TimelineEntry } from "@taki/shared";
import { mergeToolSets } from "./agents/tool-set-assembly.ts";
import { createTurnQueue } from "./agents/turn-queue.ts";
import { createTurnRegistry } from "./agents/turn-registry.ts";
import { createSubagentTools } from "./agents/subagent-tools.ts";
import { createSubagentRepo } from "./db/subagent-repo.ts";
import { createSubagentInputRepo } from "./db/subagent-input-repo.ts";
import { createSubagentExecutionRepo } from "./db/subagent-execution-repo.ts";
import { createRunMessageRepo } from "./db/run-message-repo.ts";
import { createPrimaryConversationSourceRepo } from "./db/primary-conversation-source-repo.ts";
import { composeSubagents } from "./harness/subagent-composition.ts";
import { readSubagentCheckInPolicy } from "./config/subagent-config.ts";
import { isSubagentLane } from "./agents/work-scope.ts";
import { createWindowCalibrator } from "./agents/window-calibrator.ts";
import type { RequestMeasurement } from "./agents/request-measurement.ts";
import { reduceMessages } from "./agents/context-reduction.ts";
import { reductionTargetTokens } from "./agents/request-preparation.ts";
import { createAvatarOutcomes } from "./avatar/avatar-outcomes.ts";
import { createAvatarSubscriptions } from "./avatar/avatar-subscriptions.ts";
import { createAvatarTools } from "./avatar/avatar-tools.ts";
import { createAvatarVocabulary } from "./avatar/avatar-vocabulary.ts";
import { presentationTailStop } from "./avatar/presentation-stop.ts";
import { createCapabilityBroker } from "./capabilities/capability-broker.ts";
import { composeHindsightCustody } from "./boot/hindsight-custody-boot.ts";
import { composeHindsightDeployment } from "./boot/hindsight-deployment-boot.ts";
import { createCapabilityTools } from "./capabilities/capability-tools.ts";
import { routeCapability } from "./capabilities/route-capability.ts";
import { bootstrapCore } from "./boot/core-bootstrap.ts";
import { composeHindsightActivation } from "./boot/hindsight-activation-boot.ts";
import { composeHindsightBackup } from "./boot/hindsight-backup-boot.ts";
import { composeHindsightLifecycle } from "./boot/hindsight-lifecycle-boot.ts";
import { avatarOutcomeDeadlineMs } from "./config/avatar-config.ts";
import { composeHindsightSetup } from "./boot/hindsight-setup-boot.ts";
import { composeHindsightConfiguration } from "./boot/hindsight-configuration-boot.ts";
import { composeHindsightTemplates } from "./boot/hindsight-template-boot.ts";
import { createPrivacyPauseRepo } from "./db/privacy-pause-repo.ts";
import { composeApprovalRuntime } from "./approval/approval-runtime.ts";
import type { ApprovalLabelResolver } from "./approval/approval-labels.ts";
import { createMcpApprovalLabelResolver } from "./mcp/mcp-approval-labels.ts";
import { createGovernancePolicyRepo } from "./governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "./governance/governance-policy-service.ts";
import { createMemoryAutoRepo } from "./db/memory-auto-repo.ts";
import { createSummaryRepo } from "./db/summary-repo.ts";
import { createTimelineRepo } from "./db/timeline-repo.ts";
import { createWindowStateRepo } from "./db/window-state-repo.ts";
import { createRunRepo } from "./db/run-repo.ts";
import { createRunEventLiveBus } from "./db/run-event-live.ts";
import { createRunEventRepo } from "./db/run-event-repo.ts";
import { createEffectRepo } from "./db/effect-repo.ts";
import { createEffectLifecycleService } from "./harness/effect-lifecycle-service.ts";
import { createRunService } from "./harness/run-service.ts";
import { createRunSnapshotCapture } from "./harness/run-snapshot-capture.ts";
import { createDeviceRegistry } from "./devices/device-registry.ts";
import { createPairedDeviceStore } from "./devices/paired-device-store.ts";
import { createExtensionComposition } from "./extensions/extension-composition.ts";
import { createExtensionSubscriptions } from "./extensions/extension-subscriptions.ts";
import { createHostCatalogStore } from "./hosts/host-catalog.ts";
import { bindHostGenerationRetirement } from "./hosts/host-generation-retirement.ts";
import { loadOrCreateHostIdentity } from "./hosts/host-identity.ts";
import { bootMcpLifecycle } from "./mcp/mcp-boot.ts";
import { projectMcpImageResult } from "./mcp/mcp-image-result.ts";
import { createMcpLifecycleService } from "./mcp/mcp-lifecycle-service.ts";
import { createCharacterImporter } from "./characters/character-import.ts";
import { createCharacterStore } from "./characters/character-store.ts";
import { startAttachmentGc } from "./media/attachment-gc.ts";
import { createAttachmentStore } from "./media/attachment-store.ts";
import { directoryByteSize } from "./media/directory-size.ts";
import { composeMemoryRuntime } from "./memory/runtime-composition.ts";
import { createLocalOnboardingService } from "./memory/local-onboarding/local-onboarding-service.ts";
import { readLocalOnboardingStatus } from "./memory/local-onboarding/local-onboarding-status.ts";
import { localRuntimeAvailability } from "./memory/local-onboarding/local-onboarding-reads.ts";
import { readHindsightActivationStatus } from "./memory/hindsight-activation/hindsight-activation-status.ts";
import { readHindsightActivationPlan } from "./memory/hindsight-activation/hindsight-activation-reads.ts";
import { hindsightRuntimeAvailability } from "./memory/hindsight-runtime-binding.ts";
import { readMemoryAuthorityStatus } from "./memory/operations/memory-authority-status.ts";
import { createMemoryStatusObserver } from "./memory/operations/memory-status-observer.ts";
import { readHindsightLiveConnection } from "./memory/hindsight/hindsight-runtime-connection.ts";
import { createHindsightLifecycleTrigger } from "./memory/hindsight-lifecycle/hindsight-lifecycle-trigger.ts";
import { createMemoryOperationService } from "./memory/operations/memory-operation-service.ts";
import { composeMemoryTransitions } from "./boot/memory-transition-boot.ts";
import { registerMemoryTransitionMethods } from "./server/methods/memory-transition-methods.ts";
import { createIndexOperationAdapter } from "./memory/operations/index-operation-adapter.ts";
import { createTidyOperationAdapter } from "./memory/operations/tidy-operation-adapter.ts";
import { createPerceptionLayer } from "./perception/perception-layer.ts";
import { createBrowserPlaybackSources } from "./perception/browser-playback-sources.ts";
import { registerBrowserPlaybackMethods } from "./server/methods/browser-playback-methods.ts";
import { createCoWatchingCatalog } from "./co-watching/analysis-catalog.ts";
import { createCoWatchingAnalysisReader } from "./co-watching/read-analysis.ts";
import { createCoWatchingRuntime, type CoWatchingRuntime } from "./co-watching/runtime.ts";
import { createManageCoWatchingTool } from "./co-watching/manage-co-watching-tool.ts";
import { createManageMediaRecommendationsTool, MEDIA_RECOMMENDATIONS_SKILL } from "./co-watching/manage-media-recommendations-tool.ts";
import { selectCoWatchingAnalysisTools } from "./co-watching/mcp-analysis-tools.ts";
import { createCoWatchingSubscriptions, registerCoWatchingMethods } from "./server/methods/co-watching-methods.ts";
import { migrateMcpPlaintextSecrets } from "./secrets/mcp-secret-migration.ts";
import { resolveMasterKeySource } from "./secrets/master-key.ts";
import { createSecretCatalogService } from "./secrets/secret-catalog-service.ts";
import { createConnectionRegistry } from "./server/connection-registry.ts";
import { createMethodRegistry } from "./server/method-registry.ts";
import { avatarOutcomeMethod } from "./server/methods/avatar-outcome.ts";
import { avatarReportMethod } from "./server/methods/avatar-report.ts";
import { avatarSubscribeMethod } from "./server/methods/avatar-subscribe.ts";
import { chatCancelMethod } from "./server/methods/chat-cancel.ts";
import { chatSendMethod } from "./server/methods/chat-send.ts";
import { chatActivityReadMethod } from "./server/methods/chat-activity-read.ts";
import { capabilityChallengeMethod } from "./server/methods/capability-challenge.ts";
import { capabilityRespondMethod } from "./server/methods/capability-respond.ts";
import { capabilityTriggerMethod, devTriggerEnabled } from "./server/methods/capability-trigger.ts";
import { characterCostumeResolutionMethod } from "./server/methods/character-costume-resolution.ts";
import { characterCostumesMethod } from "./server/methods/character-costumes.ts";
import { characterImportMethod } from "./server/methods/character-import.ts";
import { characterListMethod } from "./server/methods/character-list.ts";
import { registerConfigMethods } from "./server/methods/config-methods.ts";
import { connectMethod } from "./server/methods/connect.ts";
import { extensionStatusMethod } from "./server/methods/extension-status.ts";
import { extensionSubscribeMethod } from "./server/methods/extension-subscribe.ts";
import { hostCatalogPublishMethod } from "./server/methods/host-catalog-publish.ts";
import { mediaClearMethod } from "./server/methods/media-clear.ts";
import { mediaGetMethod } from "./server/methods/media-get.ts";
import { mediaUsageMethod } from "./server/methods/media-usage.ts";
import { memoryAuthorityStatusMethod } from "./server/methods/memory-authority-status.ts";
import { registerMemoryActivationMethods } from "./server/methods/memory-activation-methods.ts";
import { registerMemoryOnboardingMethods } from "./server/methods/memory-onboarding-methods.ts";
import { registerMemoryOperationMethods } from "./server/methods/memory-operation-methods.ts";
import { registerMemoryReplicaMethods } from "./server/methods/memory-replica-methods.ts";
import { createMemoryOperationRepo } from "./db/memory-operation-repo.ts";
import { memoryTidyMethod } from "./server/methods/memory-tidy.ts";
import { memoryStatusMethod } from "./server/methods/memory-status.ts";
import { runStatusMethod } from "./server/methods/run-status.ts";
import { runQueueMethod } from "./server/methods/run-queue.ts";
import { createRecoveryCoordinator } from "./harness/recovery-coordinator.ts";
import { createMemoryMigrationMethods } from "./server/methods/memory-migration.ts";
import { registerPerceptionMethods } from "./server/methods/perception-methods.ts";
import { registerSecretMethods } from "./server/methods/secret-methods.ts";
import { registerMcpMethods } from "./server/methods/mcp-methods.ts";
import { registerSkillMethods } from "./server/methods/skill-methods.ts";
import { timelineHistoryMethod } from "./server/methods/timeline-history.ts";
import { timelineSubscribeMethod } from "./server/methods/timeline-subscribe.ts";
import { bootSkillLifecycle } from "./skills/skill-boot.ts";
import { createCurrentTimeTool } from "./time/current-time-tool.ts";
import { createTimelineSubscriptions } from "./server/timeline-subscriptions.ts";
import { createConnectionSubscriptions, createMemoryOperationSubscriptions } from "./server/memory-operation-subscriptions.ts";
import { startWsListener, wsEndpoint } from "./server/ws-listener.ts";
import { createReadFileTool } from "./workspace/read-file-tool.ts";
import { createWorkspacePaths } from "./workspace/workspace-paths.ts";
import { createWriteFileTool } from "./workspace/write-file-tool.ts";
import { createScheduledTaskRepo } from "./db/scheduled-task-repo.ts";
import { createSchedulePatternAdapter } from "./scheduler/schedule-pattern.ts";
import { createScheduledTaskService } from "./scheduler/scheduled-task-service.ts";
import { createScheduleTaskTool } from "./scheduler/schedule-task-tool.ts";
import { createScheduledRunAdapter } from "./scheduler/scheduled-run-adapter.ts";
import { createScheduleEngine } from "./scheduler/schedule-engine.ts";
import { registerScheduledTaskMethods } from "./server/methods/scheduled-task-methods.ts";
import { createObservabilityQueryService } from "./observability/observability-query-service.ts";
import { createAuxiliaryUsageRepo } from "./db/auxiliary-usage-repo.ts";
import { createMaintenanceMonitorRepo } from "./db/maintenance-monitor-repo.ts";
import { createMaintenanceMonitorService } from "./observability/maintenance-monitor-service.ts";
import { registerMaintenanceMonitorMethods } from "./server/methods/maintenance-monitor-methods.ts";
import { createAuxiliaryUsageMeter } from "./observability/auxiliary-usage-meter.ts";
import { registerAuxiliaryUsageMethod } from "./server/methods/auxiliary-usage-method.ts";
import { registerObservabilityMethods } from "./server/methods/observability-methods.ts";
import { registerCacheUsageMethods } from "./server/methods/cache-usage-methods.ts";
import { createCacheUsageRepo } from "./db/cache-usage-repo.ts";
import { createRequestAttributionRepo } from "./db/request-attribution-repo.ts";
import { createCacheUsageService } from "./observability/cache-usage-service.ts";
import { attributedRenderer, contextText, joinContextText, renderedContextText, retainContentOrigin } from "./agents/context-attribution.ts";
import { composeInitiativeRuntime } from "./initiative/initiative-composition.ts";
import { composePresenceRuntime } from "./initiative/presence-composition.ts";
import { registerPresenceMethods } from "./server/methods/presence-methods.ts";
import { createUserTimezoneRepo } from "./db/user-timezone-repo.ts";
import { createUserTimezoneService } from "./time/user-timezone-service.ts";
import { registerUserTimezoneMethods } from "./server/methods/user-timezone-methods.ts";
import { createInteractionPatternService } from "./initiative/patterns/pattern-service.ts";
import { createManagePatternTool } from "./initiative/manage-pattern-tool.ts";
import { composePatternRuntime } from "./initiative/pattern-composition.ts";
import { createIntentionService } from "./initiative/intentions/intention-service.ts";
import { createPlanFollowUpTool } from "./initiative/plan-follow-up-tool.ts";
import { readIntentionMaximumWindow } from "./config/initiative-intention-config.ts";
import { readViewingInvitationPolicy } from "./config/viewing-invitation-config.ts";
import { createViewingInvitationSource, type ViewingInvitationSource } from "./co-watching/viewing-invitation-source.ts";
import { createViewingInvitationEvidence } from "./co-watching/viewing-invitation-evidence.ts";
import { createAmbientShotStore } from "./perception/ambient-shot-store.ts";
import { createMediaAnalysisRuntime, type MediaAnalysisRuntime } from "./co-watching/media-analysis-runtime.ts";
import { validatePatternActor } from "./initiative/patterns/pattern-source.ts";

// Boot phase (batch-1 #26): the data root comes from env alone, the DB opens on it, and every other knob is then
// resolved as application > environment > built-in default; runtime owners publish their application outcomes.
const modelConfigLifecycle: { changed?: (key: string) => void } = {};
const listenerLifecycle: { current?: Awaited<ReturnType<typeof startWsListener>> } = {};
const patternLifecycle: { current?: ReturnType<typeof composePatternRuntime> } = {};
const browserPlaybackLifecycle: { current?: { refresh(): void; close(): void } } = {};
const coWatchingLifecycle: { current?: CoWatchingRuntime } = {};
const viewingLifecycle: { current?: ViewingInvitationSource } = {};
const mediaAnalysisLifecycle: { current?: MediaAnalysisRuntime } = {};
const subagentLifecycle: { current?: ReturnType<typeof composeSubagents> } = {};
const cacheUsageLifecycle: { current?: ReturnType<typeof createCacheUsageService> } = {};
const maintenanceMonitorLifecycle: { current?: ReturnType<typeof createMaintenanceMonitorService> } = {};
const coWatchingSubscriptions = createCoWatchingSubscriptions();
const boot = bootstrapCore(process.env, { onConfigChanged: (key) => {
  modelConfigLifecycle.changed?.(key);
  if (key.startsWith("TAKI_INITIATIVE_")) patternLifecycle.current?.policyChanged();
  if (key === BROWSER_PLAYBACK_ENABLED_KEY) browserPlaybackLifecycle.current?.refresh();
  if (key === MONITOR_MODE_CONFIG_KEY) cacheUsageLifecycle.current?.changed();
  if (key === MONITOR_MODE_CONFIG_KEY) maintenanceMonitorLifecycle.current?.changed();
} });
const { logger, db, serverConfig, contextConfig } = boot;
const livePolicies = { attachment: boot.attachmentConfig, ambient: boot.ambientConfig, trustLoopback: serverConfig.trustLoopbackOperator };
const requestAttribution = createRequestAttributionRepo(db);
const cacheUsage = createCacheUsageService({ read: createCacheUsageRepo(db).read,
  readLatestPrimaryRequest: (characterId) => requestAttribution.read(characterId),
  mode: () => MonitorModeSchema.parse(boot.config.source.resolve(MONITOR_MODE_CONFIG_KEY)?.value ?? "DISABLED"), logger });
cacheUsageLifecycle.current = cacheUsage;
const maintenanceMonitor = createMaintenanceMonitorService({ read: createMaintenanceMonitorRepo(db).read,
  mode: () => MonitorModeSchema.parse(boot.config.source.resolve(MONITOR_MODE_CONFIG_KEY)?.value ?? "DISABLED") });
maintenanceMonitorLifecycle.current = maintenanceMonitor;
const auxiliaryUsage = createAuxiliaryUsageRepo(db, { onSettled: cacheUsage.changed, onChanged: maintenanceMonitor.changed });
try { auxiliaryUsage.reconcileInterrupted(); }
catch { logger.warn({ code: "AUXILIARY_USAGE_RECOVERY_FAILED" }, "auxiliary usage observation unavailable"); }
const auxiliaryUsageMeter = createAuxiliaryUsageMeter({ repo: auxiliaryUsage, logger });
const coreHostId = loadOrCreateHostIdentity(join(serverConfig.dataDir, "host-identity.json"));
const bootId = randomUUID();
logger.info("Core Host identity loaded");
// The selected memory runtime and inactive B3 setup share the same just-in-time
// connection secret source. Opening the catalog itself performs no model/network work.
const secretLog = logger.child({ mod: "secrets" });
const secretCatalog = await createSecretCatalogService({
  filePath: join(serverConfig.dataDir, "secret-catalog.bin"), storeId: coreHostId,
  keySource: resolveMasterKeySource(process.env), logger: secretLog, coreBootId: bootId,
});
const models = createModelProfileService({ db, source: boot.config.source, env: process.env, secrets: secretCatalog });
const model = models.binding("main")?.model;
const localAuth = createLocalConnectionAuth({ env: process.env, dataDir: serverConfig.dataDir, coreId: coreHostId,
  endpoint: wsEndpoint(serverConfig), logger });
const governance = createGovernancePolicyService(createGovernancePolicyRepo(db));
const runEventRepo = createRunEventRepo(db);
const runEventLive = createRunEventLiveBus((runId, afterSeq, limit) => runEventRepo.page({ runId, afterSeq, limit }),
  (events) => {
    if (events.some((event) => event.kind === "usage.settled"
      || (event.payload.kind === "effect.settled" && event.payload.effectKind === "model"))) cacheUsage.changed();
    patternLifecycle.current?.committed(events); viewingLifecycle.current?.changed();
  });
const subagentExecutions = createSubagentExecutionRepo(db);
const runRepo = createRunRepo(db, runEventRepo, { liveBus: runEventLive, linkedState: subagentExecutions.linkedState });
const observability = createObservabilityQueryService({ db, events: runEventRepo, mode: () => MonitorModeSchema.parse(boot.config.source.resolve(MONITOR_MODE_CONFIG_KEY)?.value ?? "DISABLED") });
const effectLifecycle = createEffectLifecycleService(
  createEffectRepo(db, runEventRepo, runEventLive),
  (runId, attemptId) => runRepo.guardDispatch(runId, attemptId),
  { eventRepo: runEventRepo, liveBus: runEventLive },
);
const timelineRepo = createTimelineRepo(db);
const primarySources = createPrimaryConversationSourceRepo({ db, timeline: timelineRepo });
// Main request calibration owns the real input cap and its separate estimator budget. Utility remains uncalibrated.
const windowStateRepo = createWindowStateRepo(db);
const agentRuntime = createAgentRuntimeConfig({ models, source: boot.config.source, windows: windowStateRepo });
modelConfigLifecycle.changed = (key) => {
  const application = boot.config.application;
  if (/^TAKI_(PROVIDER|UTILITY)_(BASE_URL|MODEL)$/.test(key)) {
    application.apply([key], () => { models.legacyChanged(key); });
    observeModelProfileApplication(models, application);
  } else if (CONTEXT_CONFIG_KEYS.includes(key) || key === "TAKI_MAX_STEPS") {
    void application.apply([key], () => {
      if (key === "TAKI_UTILITY_CONTEXT_TOKENS" || key === "TAKI_COMPACT_KEEP_MESSAGES") return memoryRuntime.reconfigure(key);
      if (key === "TAKI_PROVIDER_INCLUDE_USAGE") models.refresh();
      agentRuntime.refresh();
      if (agentRuntime.issue()) throw new Error(agentRuntime.issue());
      return memoryRuntime.reconfigure(key);
    });
  } else if (/^TAKI_(MEMORY_|PROMPT_DIR$)/.test(key)) {
    void application.apply([key], () => memoryRuntime.reconfigure(key));
  } else if (["TAKI_HINDSIGHT_ENDPOINT", "TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS"].includes(key)) {
    application.mark([key], selectedMemory.canonical && memoryRuntime.snapshot().providerId === "hindsight" ? "restart-required" : "applied",
      "Setup reads the saved setting. Selected Hindsight connection replacement remains owned by its dedicated task.");
  } else if (key.startsWith("TAKI_ATTACHMENT_")) {
    application.apply([key], () => { livePolicies.attachment = loadAttachmentConfig(boot.config.source.env()); });
  } else if (key.startsWith("TAKI_AMBIENT_")) application.apply(AMBIENT_CONFIG_KEYS, () => {
    livePolicies.ambient = loadAmbientScreenshotConfig(boot.config.source.env());
    perception.reconfigureAmbient(livePolicies.ambient);
    viewingLifecycle.current?.changed();
  });
  else if (key === "TAKI_LOG_LEVEL") application.apply([key], () => {
    logger.level = ServerConfigSchema.shape.logLevel.parse(boot.config.source.resolve(key)?.value);
  });
  else if (key === "TAKI_TRUST_LOOPBACK_OPERATOR") application.apply([key], () => {
    livePolicies.trustLoopback = ServerConfigSchema.shape.trustLoopbackOperator.parse(boot.config.source.resolve(key)?.value);
  });
  else if (key === "TAKI_WS_HOST" || key === "TAKI_WS_PORT") void application.apply(["TAKI_WS_HOST", "TAKI_WS_PORT"], () => {
    if (!listenerLifecycle.current) throw new Error("LISTENER_UNAVAILABLE");
    return listenerLifecycle.current.replace({ host: ServerConfigSchema.shape.host.parse(boot.config.source.resolve("TAKI_WS_HOST")?.value),
      port: ServerConfigSchema.shape.port.parse(boot.config.source.resolve("TAKI_WS_PORT")?.value) });
  });
};
observeModelProfileApplication(models, boot.config.application);
models.subscribe(() => {
  observeModelProfileApplication(models, boot.config.application);
  agentRuntime.refresh(); scheduleLifecycle.engine?.rearm(); patternLifecycle.current?.sourceChanged();
});
const windowCalibrator = createWindowCalibrator({ repo: windowStateRepo, slot: "main", declared: contextConfig.contextTokens.main });
const timelineSubscriptions = createTimelineSubscriptions();
const chatActivity = createChatActivityProjection();
const chatLog = logger.child({ mod: "chat" });
// Replay View admission uses historyRatio × the calibrated window. Proactive compaction separately measures the
// complete assembled request against effectiveWindow × compact.triggerRatio.
const historyBudget = () => agentRuntime.capture()?.historyBudget() ?? Math.floor(windowCalibrator.effectiveWindow() * contextConfig.historyRatio);
const summaryRepo = createSummaryRepo(db);
// Both user attachments and captured tool images use this retained native replay store.
const attachmentStore = createAttachmentStore({ attachmentsDir: join(serverConfig.dataDir, "workspace", "attachments"),
  ttlMs: () => {
    if (boot.config.application.read("TAKI_ATTACHMENT_TTL_DAYS")?.state === "unavailable") throw new Error("ATTACHMENT_POLICY_UNAVAILABLE");
    return livePolicies.attachment.ttlMs;
  } });
const screenshotStore = createScreenshotStore({ screenshotsDir: join(serverConfig.dataDir, "workspace", "screenshots") });
const latestRequestMeasurements = new Map<string, RequestMeasurement>();
const presenceLifecycle: { current?: ReturnType<typeof composePresenceRuntime> } = {};
const timelineFanout = {
  onAppend: (entry: TimelineEntry) => {
    timelineSubscriptions.publish(entry); presenceLifecycle.current?.observeEntry(entry);
    if (entry.role === "user") patternLifecycle.current?.primaryObserved(entry.characterId);
  },
  onRemove: (ref: { characterId: string; seq: number }) => { timelineSubscriptions.publishRemoved(ref); patternLifecycle.current?.sourceChanged(); },
};
const conversationStore = createConversationStore({
  repo: timelineRepo, attachments: attachmentStore, ...timelineFanout,
  primarySources: { repo: primarySources, afterCommit: (callback) => db.afterCommit(callback),
    forTimeline: (timeline) => createPrimaryConversationSourceRepo({ db, timeline }) },
  onCommit: (batch) => timelineSubscriptions.publishCommitted(batch),
  window: { budget: historyBudget },
  // R3: the rolling summary substitutes as the replay head; the wall-hit warn means the compactor is being outrun.
  summaries: summaryRepo,
  onWallHit: (hit) => chatLog.warn(hit, "context wall hit — live rows truncated past the summary boundary"),
  onSourceBackstopHit: (hit) => chatLog.warn(hit, "replay source backstop hit — token selection used a bounded partial source"),
});

// Avatar channel (#16): LLM-driven expression/motion commands fan out to subscribed Pet UI operators (mirrors the
// timeline fan-out); the vocabulary store holds each character's reported manifest names, injected into turn prompts.
// The outcomes registry (D80) lets each tool await the Pet UI's Presentation Outcome, bounded by the live deadline knob.
const avatarSubscriptions = createAvatarSubscriptions();
const avatarVocabulary = createAvatarVocabulary();
const avatarOutcomes = createAvatarOutcomes({ deadlineMs: avatarOutcomeDeadlineMs(boot.config.source) });

// One per-process boot id tells rows this boot owns apart from rows an earlier boot left open (operations, custody).
// Automatic lifecycle submits (R8) are late-bound: degraded Runs may report before the operation owner exists.
const hindsightLifecycleTrigger = createHindsightLifecycleTrigger({ db, logger: logger.child({ mod: "hindsight-lifecycle" }) });
// Marker-first composition owns every legacy/canonical reader, writer, prompt, scheduler, and migration cutover seam.
const turnControls = { queue: createTurnQueue({ onPrimaryReserved: (characterId) => {
  if (isSubagentLane(characterId)) return;
  coWatchingLifecycle.current?.yieldToPrimary(characterId); mediaAnalysisLifecycle.current?.yieldToPrimary(characterId);
  subagentLifecycle.current?.service.yieldInbox(characterId);
}, onAvailable: (key) => {
  if (isSubagentLane(key)) return;
  subagentLifecycle.current?.released();
  patternLifecycle.current?.released(); coWatchingLifecycle.current?.released(); mediaAnalysisLifecycle.current?.released();
} }), turns: createTurnRegistry(),
  live: { activity: chatActivity, subscriptions: timelineSubscriptions } };
const memoryReplicaSubscriptions = createConnectionSubscriptions<MemoryReplicaChanged>();
const memoryRuntime = composeMemoryRuntime({ db, dataDir: serverConfig.dataDir, promptDir: serverConfig.promptDir, model, bootId,
  reviewActivity: turnControls.turns, configChanges: boot.config.subscriptions,
  onPolicyReviewChanged: (bankId) => memoryReplicaSubscriptions.publish({ bankId }),
  configuration: boot.config.source, application: boot.config.application,
  resolveUtilityModel: () => models.binding("utility")?.model,
  utilityContextSlot: () => models.binding("utility")?.source === "inherited" ? "main" : "utility",
  timeline: timelineRepo, primarySources, windowStart: conversationStore.windowStart, summaries: summaryRepo,
  estimatedTokens: conversationStore.estimatedTokens, budget: historyBudget,
  measureRequest: (characterId) => latestRequestMeasurements.get(characterId),
  effectiveWindowTokens: () => agentRuntime.capture()?.contextWindowTokens() ?? windowCalibrator.effectiveWindow(),
  compact: contextConfig.compact, env: boot.env, logger, usageMeter: auxiliaryUsageMeter,
  onSummaryCommitted: cacheUsage.changed,
  onMaintenanceChanged: maintenanceMonitor.changed,
  hindsight: { source: boot.config.source, secrets: secretCatalog },
  onHindsightUnavailable: hindsightLifecycleTrigger.onUnavailable });
const { selected: selectedMemory, memory, autoMemory, tidy, memoryRoot } = memoryRuntime;

// Character store + importer (#18): the characterId-addressable model layer. Extraction is operator-driven Core-fs into
// the Workspace `characters/` subtree (ADR 0007 v1, invariant 2 single writer) — same family as the attachment store,
// not an agent OS action. Serving the extracted files to the renderer is the host-side Tauri asset: protocol (Phase B).
const charactersDir = join(serverConfig.dataDir, "workspace", "characters");
const characterStore = createCharacterStore({ charactersDir });
const characterImporter = createCharacterImporter({ store: characterStore });

const pairedDeviceStore = createPairedDeviceStore(join(serverConfig.dataDir, "devices.json"));
const deviceRegistry = createDeviceRegistry({ store: pairedDeviceStore });
const connectionRegistry = createConnectionRegistry();
const extensionSubscriptions = createExtensionSubscriptions();
const hostCatalogs = createHostCatalogStore({ onChange: (change) => {
  extensionSubscriptions.publish(change);
  browserPlaybackLifecycle.current?.refresh();
} });
const registry = createMethodRegistry({ logger });
// Approval boots first; its read-only MCP name source is attached only after the manager exists.
let resolveApprovalLabels: ApprovalLabelResolver = () => new Map();
const { approval, coreToolGovernance } = composeApprovalRuntime({
  db, governance, coreHostId, registry, connections: connectionRegistry, logger,
  recordRunEvent: effectLifecycle.record,
  resolveLabels: (decisions) => resolveApprovalLabels(decisions),
});

// Skills: durable lifecycle rows plus an immutable runtime catalog. Legacy files are read once as a seed and never written.
const skillBoot = await bootSkillLifecycle({ db, dataDir: serverConfig.dataDir, ownerHostId: coreHostId, logger, onChange: (change) => {
  extensionSubscriptions.publish(change); patternLifecycle.current?.sourceChanged();
} });
const { loader: skillsLoader, service: skillLifecycle, log: skillsLog } = skillBoot;

// AC4 ordering: copy env/headers into the catalog, verify the encrypted read-back, only then rewrite the source
// to opaque refs (every failure leaves the source untouched); refs resolve just-in-time at connect below.
migrateMcpPlaintextSecrets({ catalog: secretCatalog, configPath: join(serverConfig.dataDir, "mcp-servers.json"), logger: secretLog });

// MCP lifecycle (#8 → secure-mcp-lifecycle): desired state persists in SQLite (migration 018); mcp-servers.json is
// a SEED-ONLY legacy input; the runtime manager owns in-memory generations (candidate → publish → lease → drain).
// Boot reconcile is non-blocking so the WS server starts while candidates connect; a locked catalog skips only
// the servers whose refs it cannot resolve, truthfully — one bad server never disables its siblings.
const mcpBoot = bootMcpLifecycle({ db, dataDir: serverConfig.dataDir, coreHostId, secretCatalog, governance, approval, logger,
  onChange: extensionSubscriptions.publish, projectImageResult: (result) => projectMcpImageResult(result, attachmentStore) });
resolveApprovalLabels = createMcpApprovalLabelResolver(() => mcpBoot.manager.snapshot());
void mcpBoot.manager.reconcile(mcpBoot.desired.list()).then(() => undefined, () => undefined); // desired → candidates → publish
registerSecretMethods(registry, { service: mcpBoot.catalog, logger: secretLog });
registerMcpMethods(registry, { service: createMcpLifecycleService({ repo: mcpBoot.desired, manager: mcpBoot.manager, onChange: extensionSubscriptions.publish }), logger: mcpBoot.log });
registerSkillMethods(registry, { service: skillLifecycle, logger: skillsLog });
// Hindsight B3 setup is an operator-only inactive control plane. Composition registers methods and SQLite state only;
// it makes no boot request, performs no LLM health probe, and has no Memory Authority writer/provider registration.
const hindsightSetup = composeHindsightSetup({ db, config: boot.config.source, secrets: secretCatalog, registry, logger });
const memoryStatusObserver = createMemoryStatusObserver({ db, runtime: memoryRuntime });
const hindsightConfiguration = composeHindsightConfiguration({ db, config: boot.config.source, secrets: secretCatalog, registry,
  configurationRevision: boot.config.subscriptions.revision, statusSelection: () => memoryStatusObserver.read().selection });
// Durable memory operations (Stage 1): one Core-owned owner over the B3 setup service and the B5 scheduler. Construction
// reconciles rows another boot left open (outcome_unknown); the per-process boot id is what tells those rows apart.
// Local onboarding (Stage 2a) is the only caller of the B2 producer; its kinds observe their own receipts at boot first.
const memoryOperationSubscriptions = createMemoryOperationSubscriptions();
const memoryOnboardingSubscriptions = createConnectionSubscriptions<MemoryOnboardingChanged>();
const localOnboarding = createLocalOnboardingService({
  db, workspaceRoot: join(serverConfig.dataDir, "workspace"), runner: memoryRuntime.migrationRunner, runtime: memoryRuntime, owner: bootId,
  onChanged: (reason) => memoryOnboardingSubscriptions.publish({ reason }),
});
// Hindsight activation (Stage 2b) is the only caller of the B4/D78 mutation primitives; it rebinds the runtime after COMMIT.
const hindsightActivation = composeHindsightActivation({ db, config: boot.config.source, secrets: secretCatalog, setup: hindsightSetup, runtime: memoryRuntime, logger });
// Hindsight lifecycle (Stage 2c): Bank provisioning and connection revalidation under a committed Hindsight authority.
const hindsightTemplates = composeHindsightTemplates({ db, config: boot.config.source, secrets: secretCatalog,
  registry, bootId, runtime: memoryRuntime.templates, statusObservation: () => memoryStatusObserver.readRuntime() });
const hindsightLifecycle = composeHindsightLifecycle({ db, config: boot.config.source, secrets: secretCatalog, runtime: memoryRuntime, logger, templates: hindsightTemplates });
// Hindsight backup (Stage 3): capture pauses Hindsight writers and copies Core, then pairs it with the native half from the
// opt-in native endpoint (W5) or, via backup.admit, from the operator's native CLI ZIP; verify re-checks a sealed pair.
const hindsightBackup = composeHindsightBackup({ db, dataDir: serverConfig.dataDir, config: boot.config.source, secrets: { catalog: secretCatalog, storeId: coreHostId }, logger });
const memoryTransitions = composeMemoryTransitions({ db, config: boot.config.source, secrets: secretCatalog,
  runtime: memoryRuntime, ownerId: bootId, actorId: coreHostId, logger, backup: hindsightBackup, lifecycle: hindsightLifecycle });
const memoryOperations = createMemoryOperationService({
  db, live: memoryRuntime.operations, tidy: memoryRuntime.tidyOperations, searchIndex: memoryRuntime.searchIndex,
  setup: hindsightSetup, local: localOnboarding, hindsight: hindsightActivation, lifecycle: hindsightLifecycle,
  backup: hindsightBackup, templates: hindsightTemplates, transition: memoryTransitions, bootId, logger, onChanged: (operation) => {
    memoryOperationSubscriptions.publish(operation); if (operation.kind === "tidy") maintenanceMonitor.changed();
  },
});
const tidyOperations = createTidyOperationAdapter(memoryOperations, () => memoryRuntime.tidyOperations().authorityEpochId);
memoryRuntime.installTidySubmit(async (characterId) => { await tidyOperations.runNow(characterId); });
memoryRuntime.installIndexSubmit(createIndexOperationAdapter(memoryOperations, memoryRuntime.searchIndex));
registerMemoryTransitionMethods(registry, memoryTransitions);
hindsightLifecycleTrigger.bind({ lifecycle: hindsightLifecycle, operations: memoryOperations });
registerMemoryOperationMethods(registry, { service: memoryOperations, subscriptions: memoryOperationSubscriptions, replicaSubscriptions: memoryReplicaSubscriptions, logger });
registerMemoryReplicaMethods(registry, { logger, subscriptions: memoryReplicaSubscriptions,
  context: { live: memoryRuntime.operations, activeInFamily: createMemoryOperationRepo(db).activeInFamily } });
registerMemoryOnboardingMethods(registry, { local: localOnboarding, subscriptions: memoryOnboardingSubscriptions, logger,
  status: () => {
    const view = memoryStatusObserver.read();
    return readLocalOnboardingStatus({ local: { ...localOnboarding, authority: () => view.selection, binding: () => view.localBinding },
      operations: memoryOperations });
  } });
registerMemoryActivationMethods(registry, { logger, status: () => {
  const view = memoryStatusObserver.read();
  return readHindsightActivationStatus({ service: { status: hindsightActivation.status,
    plan: () => readHindsightActivationPlan(db, { setup: hindsightSetup,
      fingerprint: () => readHindsightLiveConnection({ config: boot.config.source, secrets: secretCatalog }).fingerprint }, view.selection),
    runtime: () => view.selection.mode === "hindsight" ? hindsightRuntimeAvailability(view.hindsightBinding) : localRuntimeAvailability(view.localBinding) },
  operations: memoryOperations });
} });
registry.register(memoryAuthorityStatusMethod({ logger,
  read: () => {
    const view = memoryStatusObserver.readRuntime();
    return readMemoryAuthorityStatus({ db, live: memoryRuntime.operations, binding: () => view.localBinding,
      hindsightBinding: () => view.hindsightBinding, setup: hindsightSetup, operations: memoryOperations,
      liveConnection: () => readHindsightLiveConnection({ config: boot.config.source, secrets: secretCatalog }), lifecycle: hindsightLifecycle,
      backup: hindsightBackup }, view.selection, view);
  } }));

// Capability channel (#10): the screenshot tool routes to a connected node via the broker, which pushes a
// capability.request notification and awaits the node's capability.respond. A node disconnect denies its pending
// requests immediately (fail-closed); the 90s backstop covers a node that never answers. An ask-classified request
// comes back as capability.challenge and the SAME canonical Approval service that governs Core/MCP tools owns the
// operator prompt; the broker mints the single-use resume authorization after the operator answers.
const capabilityBroker = createCapabilityBroker({ logger, approval, effects: effectLifecycle });
bindHostGenerationRetirement({ connections: connectionRegistry, catalogs: hostCatalogs, broker: capabilityBroker });
registry.register(capabilityChallengeMethod(capabilityBroker, connectionRegistry));
// The six Shell-routed capability tools as one factory (invariant 7): per-call construction binds the initiating
// operator socket (the challenge prompt targets exactly that connection); the no-argument bag stays for unattended
// turns. The chat agent's turnTools, the unattended fallback, and the dev trigger all reuse this exact factory.
const capabilityTools = createCapabilityTools({
  registry: connectionRegistry,
  catalogs: hostCatalogs,
  broker: capabilityBroker,
  logger,
  governance,
  approval,
  effects: effectLifecycle,
  screenshotsDir: join(serverConfig.dataDir, "workspace", "screenshots"),
  attachments: attachmentStore,
});

// Ambient/system-initiated routing carries NO operator by design: an unattended ask fails closed at the broker
// with a truthful reason instead of prompting (the perception layer never owns an Approval dialog).
const ambientCapabilityDeps = {
  registry: connectionRegistry,
  catalogs: hostCatalogs,
  broker: capabilityBroker,
  logger,
  governance,
  approval,
};
const hindsightCustody = composeHindsightCustody({
  dataDir: serverConfig.dataDir, coreHostId, secrets: secretCatalog, config: boot.config.source,
  methods: registry, route: ambientCapabilityDeps,
});

// Perception (#19 T3a + #20 T3b): SYSTEM-initiated polls of the foreground window (always-on, low sensitivity) and of
// the screen itself (DEFAULT OFF, its own `screenshot-ambient` grant) feed an OS-neutral, bounded state (invariant 8)
// that T4's reason-gate will read, composed with the perception-WIDE privacy controls — Privacy Pause + the
// sensitive-process skip + the PII scrub — that gate every ambient sampler. On-demand chat captures stay ungated
// (explicit consent through the Gate); the pause/skip/retention operator surfaces land with the settings panel (#26).
const perception = createPerceptionLayer({
  route: (capability, input, targetHostId) => routeCapability(ambientCapabilityDeps, { capabilityId: capability, input, targetHostId }),
  hasNode: (capability) => hostCatalogs.hostsForCapability(capability).length > 0,
  ambient: boot.ambientConfig,
  ambientShotsDir: join(serverConfig.dataDir, "workspace", "ambient-screenshots"),
  // A pause is a withdrawal of consent, so it lives in the DB (single writer, invariant 2) and is restored at boot —
  // a crash/upgrade/reboot must never silently resume observation.
  pauseStore: createPrivacyPauseRepo(db),
  onChanged: () => { patternLifecycle.current?.sourceChanged(); browserPlaybackLifecycle.current?.refresh(); },
  logger,
});
perception.start();
const browserPlayback = createBrowserPlaybackSources({ connections: connectionRegistry, catalogs: hostCatalogs,
  enabled: () => boot.config.source.resolve(BROWSER_PLAYBACK_ENABLED_KEY)?.value === true && !perception.pause.isPaused(),
  onChanged: () => { coWatchingLifecycle.current?.playbackChanged(); viewingLifecycle.current?.changed(); patternLifecycle.current?.sourceChanged(); } });
const browserPlaybackMethods = registerBrowserPlaybackMethods(registry, { sources: browserPlayback, connections: connectionRegistry, catalogs: hostCatalogs });
browserPlaybackLifecycle.current = {
  refresh() { browserPlayback.refresh(); browserPlaybackMethods.refresh(); },
  close() { browserPlayback.close(); browserPlaybackMethods.close(); },
};
const presenceRuntime = composePresenceRuntime({ db, events: runEventRepo, live: runEventLive,
  connections: connectionRegistry, evidence: perception.evidence, logger: logger.child({ mod: "presence" }),
  onSourceChanged: () => patternLifecycle.current?.sourceChanged() });
presenceLifecycle.current = presenceRuntime;
registerPresenceMethods(registry, { service: presenceRuntime.service, connections: connectionRegistry });

// Workspace file RW (#11): CORE-side tools (no broker/gate) confined to the Workspace root — the agent's own scratch
// space, the same subtree memory/ and screenshots/ live under. read+write are auto-allowed within it (ruling 1/8).
const workspacePaths = createWorkspacePaths({
  root: join(serverConfig.dataDir, "workspace"),
  // Migration snapshots are immutable operator evidence, never model-facing Workspace files. Canonical activation
  // additionally retires the mutable Markdown roots so no normal tool can reintroduce a dual-write path.
  forbiddenPrefixes: () => selectedMemory.canonical ? ["memory", "blocks", "memory-migration"] : ["memory-migration"],
});
const readFileTool = createReadFileTool({ paths: workspacePaths, logger });
const writeFileTool = createWriteFileTool({ paths: createWorkspacePaths({
  root: join(serverConfig.dataDir, "workspace"),
  // Native input/current-plan views are Core-published evidence. Models may write proposals, never these inputs.
  forbiddenPrefixes: () => selectedMemory.canonical
    ? ["memory", "blocks", "memory-migration", "co-watching-inputs", "media-analysis-inputs"]
    : ["memory-migration", "co-watching-inputs", "media-analysis-inputs"],
}), logger });
const staticCoreTools: ToolSet = { ...createCurrentTimeTool({ userTimezone: () => userTimezoneService.timezone() }), ...readFileTool, ...writeFileTool };
const extensions = createExtensionComposition({
  coreHostId, catalogs: hostCatalogs,
  projectScreenshot: (result) => projectScreenshotRoute({ store: screenshotStore, attachments: attachmentStore }, result),
  projectAmbientScreenshot: (result) => {
    const epoch = perception.evidence.generation();
    const generation = perception.ambientGeneration();
    return projectAmbientScreenshotRoute(result, () => perception.ambientEnabled()
      && perception.ambientGeneration() === generation && perception.evidence.isCurrent(epoch));
  },
  skills: { catalog: skillBoot.catalog, loader: skillsLoader, governance },
  mcp: mcpBoot.manager,
  route: (request, interactive) => routeCapability({ ...ambientCapabilityDeps, effects: effectLifecycle, interactive }, {
    ...request, runId: request.runId ?? interactive?.runId, attemptId: request.attemptId ?? interactive?.attemptId,
  }),
});
const modelProvider = "openai-compatible";
const modelId = boot.env.TAKI_PROVIDER_MODEL ?? "configured-main-model";
const runService = createRunService({
  repo: runRepo,
  provider: modelProvider,
  modelId,
  snapshot: createRunSnapshotCapture({
    runtime: agentRuntime.capture,
    extensions,
    governance,
    approval,
    memory: { captureRun: memoryRuntime.captureRun },
    provider: modelProvider,
    modelId,
    effects: effectLifecycle,
  }),
});
// Recovery is a boot barrier: classify durable orphan work before registering/accepting trigger dispatch.
const recovery = createRecoveryCoordinator({ db, runs: runRepo, effects: effectLifecycle });
await recovery.scan();
const hindsightDeployment = composeHindsightDeployment({ dataDir: serverConfig.dataDir, coreHostId,
  runs: runService, custody: hindsightCustody, route: { ...ambientCapabilityDeps, effects: effectLifecycle }, methods: registry });

// Turn lifecycle (D1 #3/#4): per-character serialization + the cancellable-turn registry shared by send/cancel.
const sourceRecovery = primarySources.recoverOpen();
if (sourceRecovery.unresolvedSourceIds.length > 0) {
  logger.warn({ code: "PRIMARY_SOURCE_UNPROVEN", count: sourceRecovery.unresolvedSourceIds.length }, "Interrupted primary sources need review");
}

const scheduleRepo = createScheduledTaskRepo(db);
const userTimezoneRepo = createUserTimezoneRepo(db);
const schedulePatterns = createSchedulePatternAdapter();
const scheduleLifecycle: { engine?: ReturnType<typeof createScheduleEngine> } = {};
const scheduleService = createScheduledTaskService({ repo: scheduleRepo, patterns: schedulePatterns,
  userTimezone: () => userTimezoneRepo.read().timezone, rearm: () => scheduleLifecycle.engine?.rearm() });
const userTimezoneService = createUserTimezoneService({ db, repo: userTimezoneRepo, schedules: scheduleService,
  isOperatorDevice: (id) => pairedDeviceStore.find(id)?.role === "operator", logger,
  onEffectiveZoneChange: () => scheduleLifecycle.engine?.rearm(),
  onChanged: () => patternLifecycle.current?.policyChanged() });
registerUserTimezoneMethods(registry, { service: userTimezoneService, connections: connectionRegistry });
// The pairing code is the one sanctioned secret-ish value in a log: short-lived, single-purpose,
// and the operator console is the trust anchor for first pairing (prd §4). Tokens are never logged.
const pairingLog = logger.child({ mod: "pairing" });
registry.register(
  connectMethod({
    localAuth,
    deviceRegistry,
    connectionRegistry,
    // Localhost auto-trust (P3): default-on config so the local Pet UI connects without pairing; off for a public Core.
    trustLoopbackOperator: () => livePolicies.trustLoopback,
    onPairingCode: ({ deviceId, deviceName, code }) =>
      pairingLog.info({ deviceId, deviceName, code }, "pairing code issued"),
    // A credential minted with no human in the loop must leave an audit trail (the token itself is never logged).
    onAutoTrust: ({ deviceId, deviceName, remoteAddress }) =>
      pairingLog.info({ deviceId, deviceName, remoteAddress }, "loopback operator auto-trusted"),
  }),
);
const interactionPatterns = createInteractionPatternService({ db,
  onChanged: (change) => patternLifecycle.current?.patternChanged(change) });
const intentions = createIntentionService({ db, sourceState: memoryRuntime.sourceState,
  maximumWindowMs: () => readIntentionMaximumWindow(boot.config.source),
  onChanged: () => patternLifecycle.current?.sourceChanged() });
const chatAgent = createChatAgent({
      userTimezone: userTimezoneService.timezone,
      model,
      effectLifecycle,
      store: conversationStore,
      memory,
       memoryPrompt: () => selectedMemory.canonical ? CANONICAL_MEMORY_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT,
      autoMemory,
      onPrimaryCommitted: memoryRuntime.recordPrimaryCommitted,
      // Trusted primary custody: every primary turn's rows are members of one durable group finalized when the turn ends.
      primaryPersistence: createPrimaryPersistence({ custody: memoryRuntime.custody, repo: timelineRepo, atomic: db.transaction, ...timelineFanout }),
      foregroundInbox: (input) => subagentLifecycle.current?.service.prepareInbox(input),
      contextWindowTokens: () => windowCalibrator.effectiveWindow(),
      requestWindowSnapshot: () => windowCalibrator.snapshot(),
      maxSteps: boot.agentConfig.maxSteps,
      // Presentation tools return bounded outcomes; a spoken presentation-only step needs no filler generation.
      // Invalid inputs retain one correction chance. See presentation-stop.ts.
      stopConditions: [presentationTailStop],
      // The primary model receives native image parts; durable rows retain only attachment references.
      attachments: attachmentStore,
      acquireNativeImageContext: () => perception.acquireScreenInput(),
      // Compatibility tools remain available when no interactive socket exists. The same Skill tools are reused in
      // the interactive bag below; MCP and progressive discovery are captured by runContext once per Run.
      extraTools: builtinToolDefinitions({
        ...extensions.skillTools,
        ...capabilityTools(),
      }),
      // Per-turn compatibility bag: Skill reads remain present and capabilities bind the initiating operator socket.
      turnTools: (turn) => builtinToolDefinitions({
        ...extensions.skillTools,
        ...capabilityTools({ connection: turn.connection, signal: turn.signal, runId: turn.runId, attemptId: turn.attemptId }),
      }),
      // Admission supplies the immutable Host/Skill/MCP projection; compatibility callers may still omit it.
      // Stable Core-local tools join per-turn memory/avatar tools behind the explicit Core binding table.
      coreTools: (primary, characterId) => primary ? mergeToolSets(staticCoreTools, createScheduleTaskTool(scheduleService, characterId)) : staticCoreTools,
      coreToolGovernance,
      primaryTools: ({ characterId, userEntry, turn }) => mergeToolSets(
        ...(subagents && turn ? [createSubagentTools({ service: subagents.service, characterId, userEntry, turn,
          captureReply: subagents.reports.capturePrimary })] : []),
        createManagePatternTool({ service: interactionPatterns, characterId, userEntry, turn }),
        createPlanFollowUpTool({ service: intentions, characterId, userEntry, turn })),
      skillTools: ({ characterId, userEntry, turn }) => [
        ...(coWatchingLifecycle.current && userEntry
          ? [{ skillName: CO_WATCHING_SKILL, tools: createManageCoWatchingTool({ runtime: coWatchingLifecycle.current, characterId, userEntry, turn,
          analysisRuntime: mediaAnalysisLifecycle.current,
          readAnalysis: createCoWatchingAnalysisReader({ catalog: coWatchingCatalog, ownerHostId: coreHostId }) }) }] : []),
        ...(mediaAnalysisLifecycle.current && userEntry
          ? [{ skillName: MEDIA_RECOMMENDATIONS_SKILL, tools: createManageMediaRecommendationsTool({ runtime: mediaAnalysisLifecycle.current,
            characterId, userEntry, turn }) }] : []),
      ],
      // Per-character avatar tools bind their publish target (the turn's characterId) here — same lifetime as memory tools.
      // vocab makes `name` a dynamic enum of the worn costume's live names (1e), so a costume swap rejects stale names.
      characterTools: (characterId) =>
        createAvatarTools({ subscriptions: avatarSubscriptions, outcomes: avatarOutcomes, characterId, logger, vocab: avatarVocabulary.get(characterId) }),
      // Skills list + the active character's reported avatar vocabulary (ruling 10 — non-memory sections enter HERE,
      // never via the memory assembler); blanks contribute nothing. Boot/costume-stable → the instructions stay
      // day-stable (T5 Q4).
      instructionsExtra: attributedRenderer((characterId: string) => {
        const skills = skillsLoader.renderList();
        return joinContextText([
          renderedContextText(skillsLoader.renderList, skills) ?? contextText(skills, "instructions", "unknown"),
          contextText(avatarVocabulary.render(characterId), "runtime_context"),
          contextText(coWatchingLifecycle.current?.context(characterId) ?? "", "runtime_context"),
          contextText(mediaAnalysisLifecycle.current?.context(characterId) ?? "", "runtime_context"),
        ]);
      }),
      // The fenced perception context (T3a activity + T3b screen) is minute-volatile, so it rides the <turn-context>
      // tail on the outgoing user message (T5 Q4/ADR 0008) — ruling 10 still holds: it never enters via the memory
      // assembler; only the sanctioned entry point moved from the instructions to the tail.
      volatileContext: (now) => perception.renderContext(now),
      costumeChanged: (characterId) => avatarVocabulary.consumeCostumeChanged(characterId),
      // Batch-6 usage seam: each committed turn's real usage calibrates the main slot's window (the calibrator
      // ignores the 0 that stands in for an absent inputTokens field).
      onUsage: (report) => windowCalibrator.onUsage(report.inputTokens ?? 0, report.estimatedInput),
      useProviderUsage: true,
      onRequestMeasured: (characterId, measurement) => latestRequestMeasurements.set(characterId, measurement),
      requestReduction: ({ outgoing, measurement }) => {
        if (measurement.projectedInputTokens < windowCalibrator.effectiveWindow() * contextConfig.compact.triggerRatio) return undefined;
        const threshold = windowCalibrator.effectiveWindow() * contextConfig.compact.triggerRatio;
        const reduced = reduceMessages({ messages: outgoing,
          targetTokens: reductionTargetTokens({ thresholdTokens: threshold,
            projectedInputTokens: measurement.projectedInputTokens, requestMessageTokens: measurement.requestMessageTokens }), recentMessages: 4,
          summaryHead: measurement.summaryTokens > 0 });
        return reduced.tokensSaved > 0 ? reduced.messages : undefined;
      },
      requestEnvelopeReserve: () => Math.max(0, windowCalibrator.effectiveWindow() - historyBudget()),
      // R2 (batch 6): a classified overflow shrinks the persisted window — the retry then re-windows through the
      // store's budget closure above. Counts-only warn: sizes and the new window, never content (logging-guidelines).
      onOverflow: (observedInput) =>
        chatLog.warn(
          { observedInput, effectiveWindow: windowCalibrator.onOverflow(observedInput) },
          "provider context overflow — window recalibrated, retrying once",
        ),
    });
registry.register(
  chatSendMethod(
    chatAgent,
    logger,
    turnControls,
    runService,
  ),
);
registry.register(chatCancelMethod(turnControls.turns, runService));
registry.register(chatActivityReadMethod(chatActivity));
registry.register(hostCatalogPublishMethod(hostCatalogs, connectionRegistry));
registry.register(extensionStatusMethod({ coreHostId, snapshot: () => extensions.runContext().snapshot }));
registry.register(extensionSubscribeMethod(extensionSubscriptions));
registry.register(capabilityRespondMethod(capabilityBroker, connectionRegistry));
registry.register(timelineHistoryMethod(timelineRepo));
registry.register(timelineSubscribeMethod(timelineSubscriptions));
registry.register(avatarSubscribeMethod(avatarSubscriptions));
registry.register(avatarReportMethod(avatarVocabulary));
registry.register(avatarOutcomeMethod({ subscriptions: avatarSubscriptions, outcomes: avatarOutcomes, logger }));
// Media methods (#17): serve attachment bytes for scroll-back, purge on demand, and report cache usage (usage RESERVED
// for the M5 settings UI, D27). Operator-only, NO Rust mirror — the ref confinement is single-sourced in attachment-store.
registry.register(mediaGetMethod(attachmentStore));
registry.register(mediaClearMethod(attachmentStore));
registry.register(mediaUsageMethod(attachmentStore, () => selectedMemory.canonical ? 0 : directoryByteSize(memoryRoot)));
// Character methods (#18): import a generic-Cubism / BanG-Dream `.zst` model into the Workspace, list imported
// characters, and read a character's costumes. Operator-only (like media.*), NO Rust mirror — traversal confinement is
// single-sourced in characters/member-path. Costume switching is client-side (renderer reloads + re-reports vocabulary).
registry.register(characterImportMethod(characterImporter));
registry.register(characterListMethod(characterStore));
registry.register(characterCostumesMethod({ store: characterStore, charactersDir }));
registry.register(characterCostumeResolutionMethod({ store: characterStore, charactersDir }));
// Perception and memory maintenance remain operator-only.
registerPerceptionMethods(registry, perception);
if (tidy) registry.register(memoryTidyMethod(tidyOperations));
for (const method of createMemoryMigrationMethods({ runner: memoryRuntime.migrationRunner, workspaceRoot: join(serverConfig.dataDir, "workspace") })) registry.register(method);
registry.register(
  memoryStatusMethod({ windowState: windowStateRepo, summaries: summaryRepo, autoState: createMemoryAutoRepo(db) }),
);
registry.register(runStatusMethod(runService));
registry.register(runQueueMethod(runService));
// Settings store (#26 batch 1): read every knob with its provenance, store operator values, push config.changed.
// Operator-only, NO Rust mirror; secrets are reported as set/not-set and refused on write (invariant 5).
registerModelProfileMethods(registry, models);
registerConfigMethods(registry, { ...boot.config, logger, activeModel: () => models.binding("main") });
registerObservabilityMethods(registry, { service: observability, live: runEventLive });
registerCacheUsageMethods(registry, cacheUsage);
registerMaintenanceMonitorMethods(registry, maintenanceMonitor);
registerAuxiliaryUsageMethod(registry, { repo: auxiliaryUsage, mode: observability.mode });
registerScheduledTaskMethods(registry, scheduleService);

const { runtime: initiativeRuntime, finishScheduled, delivery: sharedDelivery, deliveries: sharedDeliveries } = composeInitiativeRuntime({ db, events: runEventRepo, live: runEventLive,
  runs: runService, effects: effectLifecycle, agent: chatAgent, queue: turnControls.queue, turns: turnControls.turns,
  store: conversationStore, subscriptions: timelineSubscriptions, timezone: userTimezoneService, config: boot.config.source,
  avatar: { vocabulary: avatarVocabulary, subscriptions: avatarSubscriptions,
    outcomes: avatarOutcomes, logger, governance: coreToolGovernance } });
const subagents = composeSubagents({ db, runRepo, runs: runService, effects: effectLifecycle, agent: chatAgent,
  children: createSubagentRepo(db), inputs: createSubagentInputRepo(db), executions: subagentExecutions, messages: createRunMessageRepo(db),
  queue: turnControls.queue, turns: turnControls.turns, store: conversationStore, attachments: attachmentStore, historyBudget, timeline: timelineRepo,
  utility: memoryRuntime.utility,
  checkInPolicy: () => readSubagentCheckInPolicy(boot.config.source),
  deliveries: sharedDeliveries, delivery: sharedDelivery, registry, connections: connectionRegistry,
  reportError: (code) => logger.error({ code }, "Delegation operation failed") });
subagentLifecycle.current = subagents;
const coWatchingCatalog = createCoWatchingCatalog(join(serverConfig.dataDir, "co-watching", "analyses.json"));
const coWatchingRuntime = createCoWatchingRuntime({ catalog: coWatchingCatalog, sources: browserPlayback,
  subagents: subagents.service,
  analysisTools: () => selectCoWatchingAnalysisTools(mcpBoot.manager.snapshot()),
  runs: runService, agent: chatAgent, queue: turnControls.queue, turns: turnControls.turns,
  delivery: sharedDelivery, deliveries: sharedDeliveries, workspaceRoot: join(serverConfig.dataDir, "workspace"),
  skills: skillsLoader, logger: logger.child({ mod: "co-watching" }),
  resultTool(serverId) {
    const tool = mcpBoot.manager.snapshot().find((entry) => entry.serverId === serverId && entry.ref.toolName === "bilinote_read_result");
    return tool ? { toolKey: tool.toolKey, isCurrent: tool.isCurrent } : undefined;
  },
  targetReady: (id) => agentRuntime.available() && (id === "taki" || characterStore.list().some((character) => character.characterId === id)),
  onChanged: coWatchingSubscriptions.publish });
coWatchingLifecycle.current = coWatchingRuntime;
const mediaAnalysisRuntime = createMediaAnalysisRuntime({ catalog: coWatchingCatalog, ownerHostId: coreHostId,
  analysisTools: () => selectCoWatchingAnalysisTools(mcpBoot.manager.snapshot()),
  runs: runService, agent: chatAgent, queue: turnControls.queue, turns: turnControls.turns,
  delivery: sharedDelivery, deliveries: sharedDeliveries, workspaceRoot: join(serverConfig.dataDir, "workspace"),
  primarySource: {
    register: interactionPatterns.registerPrimarySource,
    isCurrent: (source) => validatePatternActor(db, source.characterId, { kind: "agent", runId: source.runId,
      attemptId: source.attemptId, toolCallId: "media-recommendation-preparation" }) === null,
  },
  targetReady: (id) => agentRuntime.available() && (id === "taki" || characterStore.list().some((character) => character.characterId === id)),
  onChanged: coWatchingSubscriptions.publish, logger: logger.child({ mod: "media-analysis" }) });
mediaAnalysisLifecycle.current = mediaAnalysisRuntime;
const viewing = createViewingInvitationSource({ db, sources: browserPlayback,
  policy: () => readViewingInvitationPolicy(boot.config.source),
  ready: () => perception.ambientEnabled()
    && skillsLoader.describe(CO_WATCHING_SKILL) !== undefined
    && selectCoWatchingAnalysisTools(mcpBoot.manager.snapshot()).length === 1
    && mcpBoot.manager.snapshot().some((entry) => entry.ref.toolName === "bilinote_probe_media" && entry.isCurrent())
    && hostCatalogs.hostsForCapability("screenshot-ambient").length > 0,
  presence: () => presenceRuntime.service.snapshot().state === "present" ? "present" : "unknown",
  acceptedSource: (id) => coWatchingRuntime.read(id).session?.sourceRef,
  activeSession: (id) => {
    const session = coWatchingRuntime.read(id).session;
    return session !== null && !["stopped", "expired", "failed"].includes(session.status);
  },
  prepareEvidence: createViewingInvitationEvidence({ ownerHostId: coreHostId,
    nativeTarget: () => {
      const targets = selectCoWatchingAnalysisTools(mcpBoot.manager.snapshot());
      return targets.length === 1 ? targets[0] : undefined;
    },
    enabled: () => perception.ambientEnabled(),
    perception, store: createAmbientShotStore({ ambientDir: join(serverConfig.dataDir, "workspace", "ambient-screenshots") }),
    dropRawAfterConsumption: () => livePolicies.ambient.retention.mode === "drop-after-consumption",
  }),
  startAccepted: (input, interactive) => coWatchingRuntime.invite({ ...input, lifetimeMinutes: 120 }, interactive),
  onChanged: coWatchingSubscriptions.publish });
viewingLifecycle.current = viewing;
registerCoWatchingMethods(registry, { runtime: coWatchingRuntime, catalog: coWatchingCatalog,
  connections: connectionRegistry, subscriptions: coWatchingSubscriptions, invitations: viewing });
const patternRuntime = composePatternRuntime({ db, config: boot.config.source, timezone: userTimezoneService,
  perception, presence: presenceRuntime.service, patterns: interactionPatterns, intentions, skills: skillLifecycle,
  connections: connectionRegistry, registry, queue: turnControls.queue, turns: turnControls.turns,
  runtime: initiativeRuntime, logger, captureMemory: memoryRuntime.captureRun, avatarContext: avatarVocabulary.render, viewing,
  // The bundled single-Character frontend has a real built-in target. Other explicit targets require
  // a valid imported Character marker; neither imports nor avatar reports select the speaker.
  targetReady: (id) => agentRuntime.available() && (id === "taki" || characterStore.list().some((character) => character.characterId === id)),
  monitorEnabled: () => boot.config.source.resolve(MONITOR_MODE_CONFIG_KEY)?.value !== "DISABLED" });
patternLifecycle.current = patternRuntime;
const scheduledRuns = createScheduledRunAdapter({ repo: scheduleRepo, runs: runService, agent: chatAgent,
  queue: turnControls.queue, turns: turnControls.turns, logger: logger.child({ mod: "scheduled-run" }), deliver: finishScheduled });
const scheduleEngine = createScheduleEngine({ repo: scheduleRepo, patterns: schedulePatterns, runs: scheduledRuns,
  available: agentRuntime.available,
  userTimezone: userTimezoneService.timezone, logger: logger.child({ mod: "scheduler" }) });
scheduleLifecycle.engine = scheduleEngine;


// Attachment GC (#17): a boot sweep + a 6h interval; only raw bytes expire, the description-memory is permanent.
const attachmentGc = startAttachmentGc({ store: attachmentStore, ttlMs: () => livePolicies.attachment.ttlMs, logger });

// Dev-only L1 drive: env-gated, no LLM, and still uses the Agent's tools plus node-side authorization.
if (devTriggerEnabled(process.env)) {
  logger.warn("TAKI_DEV_TRIGGER=1 — registering the DEV capability.trigger method (L1 drive; node-side gate still authorizes)");
  registry.register(
    capabilityTriggerMethod({
      // The current Run snapshot tools join the dev L1 drive so e2e calls the same sealed Extension closures as chat.
      tools: (interactive) => mergeToolSets(
        coreToolGovernance.wrap(
          interactive?.runId ? runService.context(interactive.runId)?.memoryTools ?? memory.createTools("taki") : memory.createTools("taki"),
          interactive,
        ),
        capabilityTools(interactive),
        coreToolGovernance.wrap({ ...readFileTool, ...writeFileTool }, interactive),
        extensions.runContext(interactive).tools,
      ),
      runs: runService,
      logger,
    }),
  );
}

const server = await startWsListener({
  host: serverConfig.host,
  port: serverConfig.port,
  registry,
  connectionRegistry,
  logger,
  publishEndpoint: localAuth.publishEndpoint,
});
listenerLifecycle.current = server;
boot.config.application.mark(["TAKI_WS_HOST", "TAKI_WS_PORT"], "applied");
void scheduleEngine.start();
memoryRuntime.start();
patternRuntime.start();

let shuttingDown = false;
function shutdown(signal: string): void {
  hindsightCustody.dispose();
  hindsightDeployment.dispose();
  hindsightConfiguration.dispose();
  if (shuttingDown) return;
  shuttingDown = true;
  hindsightTemplates.stop();
  logger.info({ signal }, "shutting down");
  const patternStopped = patternRuntime.close();
  const coWatchingStopped = coWatchingRuntime.close();
  const mediaAnalysisStopped = mediaAnalysisRuntime.close();
  const subagentsStopped = subagents?.close();
  viewing.close();
  browserPlaybackLifecycle.current?.close();
  attachmentGc.stop();
  perception.dispose();
  presenceRuntime.close();
  const schedulerStopped = scheduleEngine.stop();
  runService.seal();
  const initiativeStopped = initiativeRuntime.close();
  recovery.close();
  cancelDurableWorkForShutdown();
  // Local onboarding and Hindsight activation first refuse new claims and let the active producer checkpoint (conversion stops
  // between sources, activation at a Bank boundary, never inside COMMIT); only then does the memory runtime stop. That stop
  // settles the B5 scheduler (and any manual tick a replica operation awaits), so the operation owner has nothing left in
  // flight afterwards except setup calls bounded by their own deadlines. A backup capture is aborted and awaited first too:
  // its release restarts the B5 scheduler, which must happen before the runtime stops it for good.
  const memoryStopped = Promise.all([localOnboarding.stop(), hindsightActivation.stop(), hindsightLifecycle.stop(), hindsightBackup.stop(), memoryTransitions.stop()])
    .then(() => memoryRuntime.stop());
  void turnControls.turns.drain(5_000).then(() => patternStopped).then(() => coWatchingStopped).then(() => mediaAnalysisStopped).then(() => subagentsStopped).then(() => schedulerStopped).then(() => initiativeStopped).then(() => memoryStopped).then(() => memoryOperations.stop()).then(() => server.close()).then(async () => {
    chatActivity.dispose();
    extensionSubscriptions.dispose();
    cacheUsage.dispose();
    maintenanceMonitor.dispose();
    coWatchingSubscriptions.close();
    skillBoot.catalog.close();
    // Stop MCP publication → cancel candidates → drain under one budget → force-close remaining clients
    // (each exactly once), before the db handle and process go away.
    await mcpBoot.manager.close();
    memoryStatusObserver.close();
    localAuth.close();
    db.close(); // release the sqlite file handle (and checkpoint the WAL) before exit
    // Let pending native I/O retire after application teardown. Forced exit after fetch can abort Windows libuv
    // while its async handles are closing; natural exit also lets buffered diagnostics finish writing.
    process.exitCode = 0;
  }).catch(() => {
    logger.error({ code: "CORE_SHUTDOWN_FAILED" }, "Core shutdown could not settle all owned work");
    process.exitCode = 1;
  });
}

function cancelDurableWorkForShutdown(): void {
  let cursor: string | undefined;
  do {
    const page = runService.queue({ limit: 100, ...(cursor ? { cursor } : {}) });
    for (const entry of page.entries) runService.requestCancel(entry.runId, "core shutdown");
    cursor = page.nextCursor;
  } while (cursor);
}
// These factories are Core-owned; generic external tool bags keep their own captured/unknown origin.
function builtinToolDefinitions(tools: ToolSet): ToolSet {
  for (const tool of Object.values(tools)) retainContentOrigin(tool, "builtin");
  return tools;
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
