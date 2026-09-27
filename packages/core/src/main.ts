/* eslint-disable max-lines */
/**
 * INPUT:  process env (bootstrap) + the config store's resolved knobs, and OS signals
 * OUTPUT: a running headless Agent Core — WS server bound to loopback; exits 0 on SIGINT/SIGTERM
 * POS:    core — the process entry/composition root; wires boot (config store → logger → model(s) → db) →
 *         store/media/subscriptions → ws-server
 */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolSet } from "ai";
import { MONITOR_MODE_CONFIG_KEY, MonitorModeSchema, type MemoryOnboardingChanged, type TimelineEntry } from "@taki/shared";
import { CANONICAL_MEMORY_SYSTEM_PROMPT, createChatAgent } from "./agents/chat-agent.ts";
import { BASE_SYSTEM_PROMPT } from "./agents/base-prompt.ts";
import { createConversationStore } from "./agents/conversation-store.ts";
import { createPrimaryPersistence } from "./agents/primary-persistence.ts";
import { mergeToolSets } from "./agents/tool-set-assembly.ts";
import { createTurnQueue } from "./agents/turn-queue.ts";
import { createTurnRegistry } from "./agents/turn-registry.ts";
import { createWindowCalibrator } from "./agents/window-calibrator.ts";
import type { RequestMeasurement } from "./agents/request-measurement.ts";
import { reduceMessages } from "./agents/context-reduction.ts";
import { reductionTargetTokens } from "./agents/request-preparation.ts";
import { createAvatarSubscriptions } from "./avatar/avatar-subscriptions.ts";
import { createAvatarTools } from "./avatar/avatar-tools.ts";
import { createAvatarVocabulary } from "./avatar/avatar-vocabulary.ts";
import { presentationTailStop } from "./avatar/presentation-stop.ts";
import { createCapabilityBroker } from "./capabilities/capability-broker.ts";
import { createCapabilityTools } from "./capabilities/capability-tools.ts";
import { routeCapability } from "./capabilities/route-capability.ts";
import { createScreenshotDescriber } from "./capabilities/screenshot-describe.ts";
import { bootstrapCore } from "./boot/core-bootstrap.ts";
import { composeHindsightActivation } from "./boot/hindsight-activation-boot.ts";
import { composeHindsightBackup } from "./boot/hindsight-backup-boot.ts";
import { composeHindsightLifecycle } from "./boot/hindsight-lifecycle-boot.ts";
import { composeHindsightSetup } from "./boot/hindsight-setup-boot.ts";
import { createPrivacyPauseRepo } from "./db/privacy-pause-repo.ts";
import { composeApprovalRuntime } from "./approval/approval-runtime.ts";
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
import { createHostCatalogStore } from "./hosts/host-catalog.ts";
import { bindHostGenerationRetirement } from "./hosts/host-generation-retirement.ts";
import { loadOrCreateHostIdentity } from "./hosts/host-identity.ts";
import { bootMcpLifecycle } from "./mcp/mcp-boot.ts";
import { createMcpLifecycleService } from "./mcp/mcp-lifecycle-service.ts";
import { createCharacterImporter } from "./characters/character-import.ts";
import { createCharacterStore } from "./characters/character-store.ts";
import { startAttachmentGc } from "./media/attachment-gc.ts";
import { createAttachmentStore } from "./media/attachment-store.ts";
import { directoryByteSize } from "./media/directory-size.ts";
import { composeMemoryRuntime } from "./memory/runtime-composition.ts";
import { createImageDescriptionWriter } from "./memory/image-description-writer.ts";
import { createLocalOnboardingService } from "./memory/local-onboarding/local-onboarding-service.ts";
import { readLocalOnboardingStatus } from "./memory/local-onboarding/local-onboarding-status.ts";
import { readHindsightActivationStatus } from "./memory/hindsight-activation/hindsight-activation-status.ts";
import { readMemoryAuthorityStatus } from "./memory/operations/memory-authority-status.ts";
import { readHindsightLiveConnection } from "./memory/hindsight/hindsight-runtime-connection.ts";
import { createHindsightLifecycleTrigger } from "./memory/hindsight-lifecycle/hindsight-lifecycle-trigger.ts";
import { createMemoryOperationService } from "./memory/operations/memory-operation-service.ts";
import { createPerceptionLayer } from "./perception/perception-layer.ts";
import { migrateMcpPlaintextSecrets } from "./secrets/mcp-secret-migration.ts";
import { resolveMasterKeySource } from "./secrets/master-key.ts";
import { createSecretCatalogService } from "./secrets/secret-catalog-service.ts";
import { createConnectionRegistry } from "./server/connection-registry.ts";
import { createMethodRegistry } from "./server/method-registry.ts";
import { avatarReportMethod } from "./server/methods/avatar-report.ts";
import { avatarSubscribeMethod } from "./server/methods/avatar-subscribe.ts";
import { chatCancelMethod } from "./server/methods/chat-cancel.ts";
import { chatSendMethod } from "./server/methods/chat-send.ts";
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
import { hostCatalogPublishMethod } from "./server/methods/host-catalog-publish.ts";
import { mediaClearMethod } from "./server/methods/media-clear.ts";
import { mediaGetMethod } from "./server/methods/media-get.ts";
import { mediaUsageMethod } from "./server/methods/media-usage.ts";
import { memoryAuthorityStatusMethod } from "./server/methods/memory-authority-status.ts";
import { registerMemoryActivationMethods } from "./server/methods/memory-activation-methods.ts";
import { registerMemoryOnboardingMethods } from "./server/methods/memory-onboarding-methods.ts";
import { registerMemoryOperationMethods } from "./server/methods/memory-operation-methods.ts";
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
import { startWsServer } from "./server/ws-server.ts";
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
import { registerObservabilityMethods } from "./server/methods/observability-methods.ts";

// Boot phase (batch-1 #26): the data root comes from env alone, the DB opens on it, and every other knob is then
// resolved as env > stored > built-in default — so a value the settings panel stored takes effect at THIS boot.
const boot = bootstrapCore(process.env);
const { logger, db, serverConfig, contextConfig, model, visionModel } = boot;
const coreHostId = loadOrCreateHostIdentity(join(serverConfig.dataDir, "host-identity.json"));
logger.info("Core Host identity loaded");
// The selected memory runtime and inactive B3 setup share the same just-in-time
// connection secret source. Opening the catalog itself performs no model/network work.
const secretLog = logger.child({ mod: "secrets" });
const secretCatalog = await createSecretCatalogService({
  filePath: join(serverConfig.dataDir, "secret-catalog.bin"), storeId: coreHostId,
  keySource: resolveMasterKeySource(process.env), logger: secretLog,
});
const governance = createGovernancePolicyService(createGovernancePolicyRepo(db));
const runEventRepo = createRunEventRepo(db);
const runEventLive = createRunEventLiveBus((runId, afterSeq) => runEventRepo.list(runId, afterSeq));
const runRepo = createRunRepo(db, runEventRepo, runEventLive);
const observability = createObservabilityQueryService({ db, events: runEventRepo, mode: () => MonitorModeSchema.parse(boot.config.source.resolve(MONITOR_MODE_CONFIG_KEY)?.value ?? "DISABLED") });
const effectLifecycle = createEffectLifecycleService(
  createEffectRepo(db, runEventRepo, runEventLive),
  (runId, attemptId) => runRepo.guardDispatch(runId, attemptId),
  { eventRepo: runEventRepo, liveBus: runEventLive },
);
const timelineRepo = createTimelineRepo(db);
// R1 tier 2: the MAIN slot's window calibrator (vision/utility declare windows but stay uncalibrated in v1 —
// their traffic is rare and their windows generous; batch-6 design §2.5 records the gap).
const windowStateRepo = createWindowStateRepo(db);
const windowCalibrator = createWindowCalibrator({ repo: windowStateRepo, slot: "main", declared: contextConfig.contextTokens.main });
const timelineSubscriptions = createTimelineSubscriptions();
const chatLog = logger.child({ mod: "chat" });
// Replay View admission uses historyRatio × the calibrated window. Proactive compaction separately measures the
// complete assembled request against effectiveWindow × compact.triggerRatio.
const historyBudget = () => Math.floor(windowCalibrator.effectiveWindow() * contextConfig.historyRatio);
const summaryRepo = createSummaryRepo(db);
const latestRequestMeasurements = new Map<string, RequestMeasurement>();
const timelineFanout = { onAppend: (entry: TimelineEntry) => timelineSubscriptions.publish(entry),
  onRemove: (ref: { characterId: string; seq: number }) => timelineSubscriptions.publishRemoved(ref) };
const conversationStore = createConversationStore({
  repo: timelineRepo,
  ...timelineFanout,
  window: { budget: historyBudget },
  // R3: the rolling summary substitutes as the replay head; the wall-hit warn means the compactor is being outrun.
  summaries: summaryRepo,
  onWallHit: (hit) => chatLog.warn(hit, "context wall hit — live rows truncated past the summary boundary"),
  onSourceBackstopHit: (hit) => chatLog.warn(hit, "replay source backstop hit — token selection used a bounded partial source"),
});

// Avatar channel (#16): LLM-driven expression/motion commands fan out to subscribed Pet UI operators (mirrors the
// timeline fan-out); the vocabulary store holds each character's reported manifest names, injected into turn prompts.
const avatarSubscriptions = createAvatarSubscriptions();
const avatarVocabulary = createAvatarVocabulary();

// One per-process boot id tells rows this boot owns apart from rows an earlier boot left open (operations, custody).
const bootId = randomUUID();
// Automatic lifecycle submits (R8) are late-bound: degraded Runs may report before the operation owner exists.
const hindsightLifecycleTrigger = createHindsightLifecycleTrigger({ db, logger: logger.child({ mod: "hindsight-lifecycle" }) });
// Marker-first composition owns every legacy/canonical reader, writer, prompt, scheduler, and migration cutover seam.
const memoryRuntime = composeMemoryRuntime({ db, dataDir: serverConfig.dataDir, promptDir: serverConfig.promptDir, model, bootId,
  timeline: timelineRepo, windowStart: conversationStore.windowStart, summaries: summaryRepo,
  estimatedTokens: conversationStore.estimatedTokens, budget: historyBudget,
  measureRequest: (characterId) => latestRequestMeasurements.get(characterId),
  effectiveWindowTokens: () => windowCalibrator.effectiveWindow(),
  compact: contextConfig.compact, env: boot.env, logger,
  hindsight: { source: boot.config.source, secrets: secretCatalog }, onHindsightUnavailable: hindsightLifecycleTrigger.onUnavailable });
const { selected: selectedMemory, memory, autoMemory, tidy, memoryRoot, writeMemory } = memoryRuntime;

// Attachment store (#17): the sanctioned content-addressed Workspace R/W site for chat image attachments — the DB never
// holds bytes (invariant 2). Retained under a user-editable TTL and GC-swept below; the description-memory is permanent.
const attachmentStore = createAttachmentStore({ attachmentsDir: join(serverConfig.dataDir, "workspace", "attachments") });
// Character store + importer (#18): the characterId-addressable model layer. Extraction is operator-driven Core-fs into
// the Workspace `characters/` subtree (ADR 0007 v1, invariant 2 single writer) — same family as the attachment store,
// not an agent OS action. Serving the extracted files to the renderer is the host-side Tauri asset: protocol (Phase B).
const charactersDir = join(serverConfig.dataDir, "workspace", "characters");
const characterStore = createCharacterStore({ charactersDir });
const characterImporter = createCharacterImporter({ store: characterStore });
// Image→text bridge (#17 decision 6, D28): ONLY when a vision slot exists — an image turn's authoritative cross-turn
// record is the VLM's text description, written via the EXISTING episodic path (same bound op the episodic writer uses).
// A thin, deletable writer riding its own detached hook; the memory engine itself is untouched.
const imageDescriptionWriter = visionModel && writeMemory
  ? createImageDescriptionWriter({
      model: visionModel,
      attachments: attachmentStore,
      writeEpisode: writeMemory,
      logger: logger.child({ mod: "image-memory" }),
    })
  : undefined;

const deviceRegistry = createDeviceRegistry({
  store: createPairedDeviceStore(join(serverConfig.dataDir, "devices.json")),
});
const connectionRegistry = createConnectionRegistry();
const hostCatalogs = createHostCatalogStore();
const registry = createMethodRegistry({ logger });
const { approval, coreToolGovernance } = composeApprovalRuntime({
  db, governance, coreHostId, registry, connections: connectionRegistry, logger,
  recordRunEvent: effectLifecycle.record,
});

// Skills: durable lifecycle rows plus an immutable runtime catalog. Legacy files are read once as a seed and never written.
const skillBoot = await bootSkillLifecycle({ db, dataDir: serverConfig.dataDir, ownerHostId: coreHostId, logger });
const { loader: skillsLoader, service: skillLifecycle, log: skillsLog } = skillBoot;

// AC4 ordering: copy env/headers into the catalog, verify the encrypted read-back, only then rewrite the source
// to opaque refs (every failure leaves the source untouched); refs resolve just-in-time at connect below.
migrateMcpPlaintextSecrets({ catalog: secretCatalog, configPath: join(serverConfig.dataDir, "mcp-servers.json"), logger: secretLog });

// MCP lifecycle (#8 → secure-mcp-lifecycle): desired state persists in SQLite (migration 018); mcp-servers.json is
// a SEED-ONLY legacy input; the runtime manager owns in-memory generations (candidate → publish → lease → drain).
// Boot reconcile is non-blocking so the WS server starts while candidates connect; a locked catalog skips only
// the servers whose refs it cannot resolve, truthfully — one bad server never disables its siblings.
const mcpBoot = bootMcpLifecycle({ db, dataDir: serverConfig.dataDir, coreHostId, secretCatalog, governance, approval, logger });
void mcpBoot.manager.reconcile(mcpBoot.desired.list()).then(() => undefined, () => undefined); // desired → candidates → publish
registerSecretMethods(registry, { service: mcpBoot.catalog, logger: secretLog });
registerMcpMethods(registry, { service: createMcpLifecycleService({ repo: mcpBoot.desired, manager: mcpBoot.manager }), logger: mcpBoot.log });
registerSkillMethods(registry, { service: skillLifecycle, logger: skillsLog });
// Hindsight B3 setup is an operator-only inactive control plane. Composition registers methods and SQLite state only;
// it makes no boot request, performs no LLM health probe, and has no Memory Authority writer/provider registration.
const hindsightSetup = composeHindsightSetup({ db, config: boot.config.source, secrets: secretCatalog, registry, logger });
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
const hindsightLifecycle = composeHindsightLifecycle({ db, config: boot.config.source, secrets: secretCatalog, runtime: memoryRuntime, logger });
// Hindsight backup (Stage 3): capture pauses Hindsight writers and copies Core, then pairs it with the native half from the
// opt-in native endpoint (W5) or, via backup.admit, from the operator's native CLI ZIP; verify re-checks a sealed pair.
const hindsightBackup = composeHindsightBackup({ db, dataDir: serverConfig.dataDir, config: boot.config.source, secrets: { catalog: secretCatalog, storeId: coreHostId }, logger });
const memoryOperations = createMemoryOperationService({
  db, live: memoryRuntime.operations, setup: hindsightSetup, local: localOnboarding, hindsight: hindsightActivation, lifecycle: hindsightLifecycle,
  backup: hindsightBackup, bootId, logger, onChanged: memoryOperationSubscriptions.publish,
});
hindsightLifecycleTrigger.bind({ lifecycle: hindsightLifecycle, operations: memoryOperations });
registerMemoryOperationMethods(registry, { service: memoryOperations, subscriptions: memoryOperationSubscriptions, logger });
registerMemoryOnboardingMethods(registry, { local: localOnboarding, subscriptions: memoryOnboardingSubscriptions, logger,
  status: () => readLocalOnboardingStatus({ local: localOnboarding, operations: memoryOperations }) });
registerMemoryActivationMethods(registry, { logger, status: () => readHindsightActivationStatus({ service: hindsightActivation, operations: memoryOperations }) });
registry.register(memoryAuthorityStatusMethod({ logger,
  read: () => readMemoryAuthorityStatus({ db, live: memoryRuntime.operations, binding: memoryRuntime.bindingSnapshot,
    hindsightBinding: memoryRuntime.hindsightBindingSnapshot, setup: hindsightSetup, operations: memoryOperations,
    liveConnection: () => readHindsightLiveConnection({ config: boot.config.source, secrets: secretCatalog }), lifecycle: hindsightLifecycle,
    backup: hindsightBackup }) }));

// Capability channel (#10): the screenshot tool routes to a connected node via the broker, which pushes a
// capability.request notification and awaits the node's capability.respond. A node disconnect denies its pending
// requests immediately (fail-closed); the 90s backstop covers a node that never answers. An ask-classified request
// comes back as capability.challenge and the SAME canonical Approval service that governs Core/MCP tools owns the
// operator prompt; the broker mints the single-use resume authorization after the operator answers.
const capabilityBroker = createCapabilityBroker({ logger, approval, effects: effectLifecycle });
bindHostGenerationRetirement({ connections: connectionRegistry, catalogs: hostCatalogs, broker: capabilityBroker });
registry.register(capabilityChallengeMethod(capabilityBroker, connectionRegistry));
// Screenshot→VLM bridge: reuses the OPTIONAL vision slot; without it a result stays path+dims (no pixels to the text
// model) and ambient sampling never starts. ONE bridge, shared by the on-demand tool and the ambient sampler.
const describeScreenshot = visionModel ? createScreenshotDescriber({ model: visionModel, logger }).describe : undefined;
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
  describe: describeScreenshot,
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

// Perception (#19 T3a + #20 T3b): SYSTEM-initiated polls of the foreground window (always-on, low sensitivity) and of
// the screen itself (DEFAULT OFF, its own `screenshot-ambient` grant) feed an OS-neutral, bounded state (invariant 8)
// that T4's reason-gate will read, composed with the perception-WIDE privacy controls — Privacy Pause + the
// sensitive-process skip + the PII scrub — that gate every ambient sampler. On-demand chat captures stay ungated
// (explicit consent through the Gate); the pause/skip/retention operator surfaces land with the settings panel (#26).
const perception = createPerceptionLayer({
  route: (capability, input) => routeCapability(ambientCapabilityDeps, { capabilityId: capability, input }),
  hasNode: (capability) => hostCatalogs.hostsForCapability(capability).length > 0,
  describe: describeScreenshot,
  ambient: boot.ambientConfig,
  ambientShotsDir: join(serverConfig.dataDir, "workspace", "ambient-screenshots"),
  // A pause is a withdrawal of consent, so it lives in the DB (single writer, invariant 2) and is restored at boot —
  // a crash/upgrade/reboot must never silently resume observation.
  pauseStore: createPrivacyPauseRepo(db),
  logger,
});
perception.start();

// Workspace file RW (#11): CORE-side tools (no broker/gate) confined to the Workspace root — the agent's own scratch
// space, the same subtree memory/ and screenshots/ live under. read+write are auto-allowed within it (ruling 1/8).
const workspacePaths = createWorkspacePaths({
  root: join(serverConfig.dataDir, "workspace"),
  // Migration snapshots are immutable operator evidence, never model-facing Workspace files. Canonical activation
  // additionally retires the mutable Markdown roots so no normal tool can reintroduce a dual-write path.
  forbiddenPrefixes: () => selectedMemory.canonical ? ["memory", "blocks", "memory-migration"] : ["memory-migration"],
});
const readFileTool = createReadFileTool({ paths: workspacePaths, logger });
const writeFileTool = createWriteFileTool({ paths: workspacePaths, logger });
const staticCoreTools: ToolSet = { ...createCurrentTimeTool(), ...readFileTool, ...writeFileTool };
const extensions = createExtensionComposition({
  coreHostId, catalogs: hostCatalogs,
  skills: { catalog: skillBoot.catalog, loader: skillsLoader, governance },
  mcp: mcpBoot.manager,
  route: (request, interactive) => routeCapability({ ...ambientCapabilityDeps, interactive }, { ...request, runId: interactive?.runId, attemptId: interactive?.attemptId }),
});
const modelProvider = "openai-compatible";
const modelId = boot.env.TAKI_PROVIDER_MODEL ?? "configured-main-model";
const runService = createRunService({
  repo: runRepo,
  provider: modelProvider,
  modelId,
  snapshot: createRunSnapshotCapture({
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

// Turn lifecycle (D1 #3/#4): per-character serialization + the cancellable-turn registry shared by send/cancel.
const turnControls = { queue: createTurnQueue(), turns: createTurnRegistry() };
const scheduleRepo = createScheduledTaskRepo(db);
const schedulePatterns = createSchedulePatternAdapter();
const scheduleLifecycle: { engine?: ReturnType<typeof createScheduleEngine> } = {};
const scheduleService = createScheduledTaskService({ repo: scheduleRepo, patterns: schedulePatterns,
  userTimezone: scheduleRepo.userTimezone, rearm: () => scheduleLifecycle.engine?.rearm() });
// The pairing code is the one sanctioned secret-ish value in a log: short-lived, single-purpose,
// and the operator console is the trust anchor for first pairing (prd §4). Tokens are never logged.
const pairingLog = logger.child({ mod: "pairing" });
registry.register(
  connectMethod({
    deviceRegistry,
    connectionRegistry,
    // Localhost auto-trust (P3): default-on config so the local Pet UI connects without pairing; off for a public Core.
    trustLoopbackOperator: serverConfig.trustLoopbackOperator,
    onPairingCode: ({ deviceId, deviceName, code }) =>
      pairingLog.info({ deviceId, deviceName, code }, "pairing code issued"),
    // A credential minted with no human in the loop must leave an audit trail (the token itself is never logged).
    onAutoTrust: ({ deviceId, deviceName, remoteAddress }) =>
      pairingLog.info({ deviceId, deviceName, remoteAddress }, "loopback operator auto-trusted"),
  }),
);
const chatAgent = createChatAgent({
      model,
      effectLifecycle,
      store: conversationStore,
      memory,
       memoryPrompt: () => selectedMemory.canonical ? CANONICAL_MEMORY_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT,
      autoMemory,
      onPrimaryCommitted: memoryRuntime.recordPrimaryCommitted,
      // Trusted primary custody: every primary turn's rows are members of one durable group finalized when the turn ends.
      primaryPersistence: createPrimaryPersistence({ custody: memoryRuntime.custody, repo: timelineRepo, ...timelineFanout }),
      maxSteps: boot.agentConfig.maxSteps,
      // Presentation tools (avatar expression/motion) return nothing to read; stop the loop after a spoken,
      // presentation-only step so the SDK does not force a padded filler generation (1c). See presentation-stop.ts.
      stopConditions: [presentationTailStop],
      // Vision slot + attachment store (#17): an image turn routes to visionModel and its bytes ride in-flight only; with
      // no vision slot an image turn is rejected upstream (the text model never receives an image).
      visionModel,
      attachments: attachmentStore,
      // Detached, fire-and-forget (mirrors autoMemory) — present only when a vision slot is configured.
      imageMemory: imageDescriptionWriter
        ? { onImageTurn: (input) => { void imageDescriptionWriter.onImageTurn(input); } }
        : undefined,
      // Compatibility tools remain available when no interactive socket exists. The same Skill tools are reused in
      // the interactive bag below; MCP and progressive discovery are captured by runContext once per Run.
      extraTools: {
        ...extensions.skillTools,
        ...capabilityTools(),
      },
      // Per-turn compatibility bag: Skill reads remain present and capabilities bind the initiating operator socket.
      turnTools: (turn) => ({
        ...extensions.skillTools,
        ...capabilityTools({ connection: turn.connection, signal: turn.signal, runId: turn.runId, attemptId: turn.attemptId }),
      }),
      // Admission supplies the immutable Host/Skill/MCP projection; compatibility callers may still omit it.
      // Stable Core-local tools join per-turn memory/avatar tools behind the explicit Core binding table.
      coreTools: (primary, characterId) => primary ? mergeToolSets(staticCoreTools, createScheduleTaskTool(scheduleService, characterId)) : staticCoreTools,
      coreToolGovernance,
      // Per-character avatar tools bind their publish target (the turn's characterId) here — same lifetime as memory tools.
      // vocab makes `name` a dynamic enum of the worn costume's live names (1e), so a costume swap rejects stale names.
      characterTools: (characterId) =>
        createAvatarTools({ subscriptions: avatarSubscriptions, characterId, logger, vocab: avatarVocabulary.get(characterId) }),
      // Skills list + the active character's reported avatar vocabulary (ruling 10 — non-memory sections enter HERE,
      // never via the memory assembler); blanks contribute nothing. Boot/costume-stable → the instructions stay
      // day-stable (T5 Q4).
      instructionsExtra: (characterId) =>
        [skillsLoader.renderList(), avatarVocabulary.render(characterId)]
          .filter((section) => section.length > 0)
          .join("\n\n"),
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
registry.register(hostCatalogPublishMethod(hostCatalogs, connectionRegistry));
registry.register(extensionStatusMethod({ coreHostId, snapshot: () => extensions.runContext().snapshot }));
registry.register(capabilityRespondMethod(capabilityBroker, connectionRegistry));
registry.register(timelineHistoryMethod(timelineRepo));
registry.register(timelineSubscribeMethod(timelineSubscriptions));
registry.register(avatarSubscribeMethod(avatarSubscriptions));
registry.register(avatarReportMethod(avatarVocabulary));
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
if (tidy) registry.register(memoryTidyMethod(tidy));
for (const method of createMemoryMigrationMethods({ runner: memoryRuntime.migrationRunner, workspaceRoot: join(serverConfig.dataDir, "workspace") })) registry.register(method);
registry.register(
  memoryStatusMethod({ windowState: windowStateRepo, summaries: summaryRepo, autoState: createMemoryAutoRepo(db) }),
);
registry.register(runStatusMethod(runService));
registry.register(runQueueMethod(runService));
// Settings store (#26 batch 1): read every knob with its provenance, store operator values, push config.changed.
// Operator-only, NO Rust mirror; secrets are reported as set/not-set and refused on write (invariant 5).
registerConfigMethods(registry, { ...boot.config, logger });
registerObservabilityMethods(registry, { service: observability, live: runEventLive });
registerScheduledTaskMethods(registry, scheduleService);

const scheduledRuns = createScheduledRunAdapter({ repo: scheduleRepo, runs: runService, agent: chatAgent,
  queue: turnControls.queue, turns: turnControls.turns, logger: logger.child({ mod: "scheduled-run" }) });
const scheduleEngine = createScheduleEngine({ repo: scheduleRepo, patterns: schedulePatterns, runs: scheduledRuns,
  userTimezone: scheduleRepo.userTimezone, logger: logger.child({ mod: "scheduler" }) });
scheduleLifecycle.engine = scheduleEngine;
await scheduleEngine.start();

// Attachment GC (#17): a boot sweep + a 6h interval; only raw bytes expire, the description-memory is permanent.
startAttachmentGc({ store: attachmentStore, ttlMs: boot.attachmentConfig.ttlMs, logger });

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

const server = await startWsServer({
  host: serverConfig.host,
  port: serverConfig.port,
  registry,
  connectionRegistry,
  logger,
});
memoryRuntime.start();

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  const schedulerStopped = scheduleEngine.stop();
  runService.seal();
  recovery.close();
  cancelDurableWorkForShutdown();
  // Local onboarding and Hindsight activation first refuse new claims and let the active producer checkpoint (conversion stops
  // between sources, activation at a Bank boundary, never inside COMMIT); only then does the memory runtime stop. That stop
  // settles the B5 scheduler (and any manual tick a replica operation awaits), so the operation owner has nothing left in
  // flight afterwards except setup calls bounded by their own deadlines. A backup capture is aborted and awaited first too:
  // its release restarts the B5 scheduler, which must happen before the runtime stops it for good.
  const memoryStopped = Promise.all([localOnboarding.stop(), hindsightActivation.stop(), hindsightLifecycle.stop(), hindsightBackup.stop()])
    .then(() => memoryRuntime.stop());
  void turnControls.turns.drain(5_000).then(() => schedulerStopped).then(() => memoryStopped).then(() => memoryOperations.stop()).then(() => server.close()).then(async () => {
    skillBoot.catalog.close();
    // Stop MCP publication → cancel candidates → drain under one budget → force-close remaining clients
    // (each exactly once), before the db handle and process go away.
    await mcpBoot.manager.close();
    db.close(); // release the sqlite file handle (and checkpoint the WAL) before exit
    process.exit(0);
  }).catch(() => {
    logger.error({ code: "CORE_SHUTDOWN_FAILED" }, "Core shutdown could not settle all owned work");
    process.exit(1);
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
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
