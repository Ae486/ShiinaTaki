/**
 * INPUT:  process env (bootstrap) + the config store's resolved knobs, and OS signals
 * OUTPUT: a running headless Agent Core — WS server bound to loopback; exits 0 on SIGINT/SIGTERM
 * POS:    core — the process entry/composition root; wires boot (config store → logger → model(s) → db) →
 *         store/media/subscriptions → ws-server
 */
import { join } from "node:path";
import type { ToolSet } from "ai";
import { createChatAgent } from "./agents/chat-agent.ts";
import { createConversationStore } from "./agents/conversation-store.ts";
import { createTurnQueue } from "./agents/turn-queue.ts";
import { createTurnRegistry } from "./agents/turn-registry.ts";
import { createWindowCalibrator } from "./agents/window-calibrator.ts";
import { createApprovalBroker } from "./approval/approval-broker.ts";
import { createApprovalGate } from "./approval/approval-gate.ts";
import { createDecisionStore } from "./approval/decision-store.ts";
import { createAvatarSubscriptions } from "./avatar/avatar-subscriptions.ts";
import { createAvatarTools } from "./avatar/avatar-tools.ts";
import { createAvatarVocabulary } from "./avatar/avatar-vocabulary.ts";
import { presentationTailStop } from "./avatar/presentation-stop.ts";
import { createCapabilityBroker } from "./capabilities/capability-broker.ts";
import { createClipboardReadTool } from "./capabilities/clipboard-read-tool.ts";
import { createClipboardWriteTool } from "./capabilities/clipboard-write-tool.ts";
import { createExecTool } from "./capabilities/exec-tool.ts";
import { createProcessListTool } from "./capabilities/process-list-tool.ts";
import { routeCapability } from "./capabilities/route-capability.ts";
import { createScreenshotDescriber } from "./capabilities/screenshot-describe.ts";
import { createScreenshotStore } from "./capabilities/screenshot-store.ts";
import { createScreenshotTool } from "./capabilities/screenshot-tool.ts";
import { createShellOpenTool } from "./capabilities/shell-open-tool.ts";
import { bootstrapCore } from "./boot/core-bootstrap.ts";
import { createPrivacyPauseRepo } from "./db/privacy-pause-repo.ts";
import { createMemoryAutoRepo } from "./db/memory-auto-repo.ts";
import { createSummaryRepo } from "./db/summary-repo.ts";
import { createTimelineRepo } from "./db/timeline-repo.ts";
import { createWindowStateRepo } from "./db/window-state-repo.ts";
import { createDeviceRegistry } from "./devices/device-registry.ts";
import { createPairedDeviceStore } from "./devices/paired-device-store.ts";
import { createHostCatalogStore } from "./hosts/host-catalog.ts";
import { bindHostGenerationRetirement } from "./hosts/host-generation-retirement.ts";
import { loadOrCreateHostIdentity } from "./hosts/host-identity.ts";
import { loadMcpConfig } from "./mcp/mcp-config.ts";
import { createMcpManager } from "./mcp/mcp-manager.ts";
import { createCharacterImporter } from "./characters/character-import.ts";
import { createCharacterStore } from "./characters/character-store.ts";
import { startAttachmentGc } from "./media/attachment-gc.ts";
import { createAttachmentStore } from "./media/attachment-store.ts";
import { directoryByteSize } from "./media/directory-size.ts";
import { createMemorySubsystem } from "./memory/bootstrap.ts";
import { createImageDescriptionWriter } from "./memory/image-description-writer.ts";
import { createPerceptionLayer } from "./perception/perception-layer.ts";
import { createConnectionRegistry } from "./server/connection-registry.ts";
import { createMethodRegistry } from "./server/method-registry.ts";
import { approvalRespondMethod } from "./server/methods/approval-respond.ts";
import { avatarReportMethod } from "./server/methods/avatar-report.ts";
import { avatarSubscribeMethod } from "./server/methods/avatar-subscribe.ts";
import { chatCancelMethod } from "./server/methods/chat-cancel.ts";
import { chatSendMethod } from "./server/methods/chat-send.ts";
import { capabilityRespondMethod } from "./server/methods/capability-respond.ts";
import { capabilityTriggerMethod, devTriggerEnabled } from "./server/methods/capability-trigger.ts";
import { characterCostumeResolutionMethod } from "./server/methods/character-costume-resolution.ts";
import { characterCostumesMethod } from "./server/methods/character-costumes.ts";
import { characterImportMethod } from "./server/methods/character-import.ts";
import { characterListMethod } from "./server/methods/character-list.ts";
import { registerConfigMethods } from "./server/methods/config-methods.ts";
import { connectMethod } from "./server/methods/connect.ts";
import { hostCatalogPublishMethod } from "./server/methods/host-catalog-publish.ts";
import { mediaClearMethod } from "./server/methods/media-clear.ts";
import { mediaGetMethod } from "./server/methods/media-get.ts";
import { mediaUsageMethod } from "./server/methods/media-usage.ts";
import { memoryTidyMethod } from "./server/methods/memory-tidy.ts";
import { memoryStatusMethod } from "./server/methods/memory-status.ts";
import { registerPerceptionMethods } from "./server/methods/perception-methods.ts";
import { timelineHistoryMethod } from "./server/methods/timeline-history.ts";
import { timelineSubscribeMethod } from "./server/methods/timeline-subscribe.ts";
import { createLoadSkillTool } from "./skills/load-skill-tool.ts";
import { createSkillsLoader } from "./skills/skills-loader.ts";
import { createSkillsState } from "./skills/skills-state.ts";
import { scanSkills } from "./skills/skill-scanner.ts";
import { createCurrentTimeTool } from "./time/current-time-tool.ts";
import { createTimelineSubscriptions } from "./server/timeline-subscriptions.ts";
import { startWsServer } from "./server/ws-server.ts";
import { createReadFileTool } from "./workspace/read-file-tool.ts";
import { createWorkspacePaths } from "./workspace/workspace-paths.ts";
import { createWriteFileTool } from "./workspace/write-file-tool.ts";

// Boot phase (batch-1 #26): the data root comes from env alone, the DB opens on it, and every other knob is then
// resolved as env > stored > built-in default — so a value the settings panel stored takes effect at THIS boot.
const boot = bootstrapCore(process.env);
const { logger, db, serverConfig, contextConfig, model, visionModel } = boot;
loadOrCreateHostIdentity(join(serverConfig.dataDir, "host-identity.json"));
logger.info("Core Host identity loaded");
const timelineRepo = createTimelineRepo(db);
// R1 tier 2: the MAIN slot's window calibrator (vision/utility declare windows but stay uncalibrated in v1 —
// their traffic is rare and their windows generous; batch-6 design §2.5 records the gap).
const windowStateRepo = createWindowStateRepo(db);
const windowCalibrator = createWindowCalibrator({ repo: windowStateRepo, slot: "main", declared: contextConfig.contextTokens.main });
const timelineSubscriptions = createTimelineSubscriptions();
const chatLog = logger.child({ mod: "chat" });
// History replays historyRatio × the calibrated window; the remainder covers instructions + tools + the response.
// The compaction trigger measures against this SAME wall (batch 7 — the replay view can never exceed it).
const historyBudget = () => Math.floor(windowCalibrator.effectiveWindow() * contextConfig.historyRatio);
const summaryRepo = createSummaryRepo(db);
const conversationStore = createConversationStore({
  repo: timelineRepo,
  onAppend: (entry) => timelineSubscriptions.publish(entry),
  onRemove: (ref) => timelineSubscriptions.publishRemoved(ref),
  window: { budget: historyBudget },
  // R3: the rolling summary substitutes as the replay head; the wall-hit warn means the compactor is being outrun.
  summaries: summaryRepo,
  onWallHit: (hit) => chatLog.warn(hit, "context wall hit — live rows truncated past the summary boundary"),
});

// Avatar channel (#16): LLM-driven expression/motion commands fan out to subscribed Pet UI operators (mirrors the
// timeline fan-out); the vocabulary store holds each character's reported manifest names, injected into turn prompts.
const avatarSubscriptions = createAvatarSubscriptions();
const avatarVocabulary = createAvatarVocabulary();

// The memory engine's Workspace: markdown files under the app data root (beside the db, NOT in it — invariant 1).
// One call wires persona cards + block store + engine + startup reconcile + the utility slot every background pass
// runs on + the auto-write orchestrator + the tidy pass + the retention sweeper (memory/bootstrap.ts).
const { engine: memory, autoMemory, tidy, memoryRoot, writeMemory } = createMemorySubsystem({
  db,
  dataDir: serverConfig.dataDir,
  promptDir: serverConfig.promptDir,
  model,
  timeline: timelineRepo,
  // The flush boundary IS the store's replay boundary (batch 6 coupling point 2 — same slice, no drift window).
  windowStart: conversationStore.windowStart,
  // Batch 7: the compactor retires all-but-tail into the rolling summary once the view crosses the trigger ratio.
  compaction: {
    summaries: summaryRepo,
    view: { estimatedTokens: conversationStore.estimatedTokens, budget: historyBudget },
    config: contextConfig.compact,
  },
  // The memory + utility knobs come from the RESOLVED env too, so the panel governs them like every other knob.
  env: boot.env,
  logger,
});

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
const imageDescriptionWriter = visionModel
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

// Skills (#9): discover SKILL.md folders, honor persisted enable/disable, expose the list + the load_skill tool.
const skillsLog = logger.child({ mod: "skills" });
const skillsScan = scanSkills(join(serverConfig.dataDir, "skills"));
skillsLog.info({ count: skillsScan.skills.length }, "skills discovered");
if (skillsScan.invalid.length > 0) skillsLog.warn({ invalid: skillsScan.invalid }, "invalid skills skipped");
const skillsLoader = createSkillsLoader({
  skills: skillsScan.skills,
  state: createSkillsState({ filePath: join(serverConfig.dataDir, "skills-state.json"), logger }),
});

// MCP (#8): connect operator-configured servers at boot; a missing/malformed config or a failing server degrades
// gracefully (never fatal — MCP is an extension). Their tools join the per-turn ToolSet behind the approval gate.
const mcpLog = logger.child({ mod: "mcp" });
const mcpManager = await createMcpManager({
  entries: loadMcpConfig(join(serverConfig.dataDir, "mcp-servers.json"), mcpLog),
  logger,
});

// Approval gate: MCP tool calls await the operator's decision over WS; always/never persist, session/once do not.
const approvalBroker = createApprovalBroker({ logger });
const approvalGate = createApprovalGate({
  mcp: mcpManager,
  broker: approvalBroker,
  decisions: createDecisionStore({ filePath: join(serverConfig.dataDir, "mcp-approvals.json"), logger }),
});

// Capability channel (#10): the screenshot tool routes to a connected node via the broker, which pushes a
// capability.request notification and awaits the node's capability.respond. A node disconnect denies its pending
// requests immediately (fail-closed); the 90s backstop covers a node that never answers. The Shell gate authorizes.
const capabilityBroker = createCapabilityBroker({ logger });
bindHostGenerationRetirement({ connections: connectionRegistry, catalogs: hostCatalogs, broker: capabilityBroker });
// Screenshot→VLM bridge: reuses the OPTIONAL vision slot; without it a result stays path+dims (no pixels to the text
// model) and ambient sampling never starts. ONE bridge, shared by the on-demand tool and the ambient sampler.
const describeScreenshot = visionModel ? createScreenshotDescriber({ model: visionModel, logger }).describe : undefined;
const screenshotTool = createScreenshotTool({
  registry: connectionRegistry,
  catalogs: hostCatalogs,
  broker: capabilityBroker,
  // The core is the single sanctioned Workspace writer (invariant 2); the Shell only returns base64 over the wire.
  store: createScreenshotStore({ screenshotsDir: join(serverConfig.dataDir, "workspace", "screenshots") }),
  describe: describeScreenshot,
  logger,
});
// The other Shell-backed capabilities (#11, and exec #12) share the route→broker path; each is gate-authorized on
// the Shell, which parses, governs, spawns and audits.
const shellCapabilityDeps = {
  registry: connectionRegistry,
  catalogs: hostCatalogs,
  broker: capabilityBroker,
  logger,
};

// The six Shell-routed capability tools as one bag (invariant 7): the chat agent's extraTools spreads it AND the
// dev capability.trigger reuses these exact objects — never a second execute path to the same capabilities.
const capabilityTools: ToolSet = {
  ...screenshotTool,
  ...createProcessListTool(shellCapabilityDeps),
  ...createClipboardReadTool(shellCapabilityDeps),
  ...createClipboardWriteTool(shellCapabilityDeps),
  ...createShellOpenTool(shellCapabilityDeps),
  ...createExecTool(shellCapabilityDeps),
};

// Perception (#19 T3a + #20 T3b): SYSTEM-initiated polls of the foreground window (always-on, low sensitivity) and of
// the screen itself (DEFAULT OFF, its own `screenshot-ambient` grant) feed an OS-neutral, bounded state (invariant 8)
// that T4's reason-gate will read, composed with the perception-WIDE privacy controls — Privacy Pause + the
// sensitive-process skip + the PII scrub — that gate every ambient sampler. On-demand chat captures stay ungated
// (explicit consent through the Gate); the pause/skip/retention operator surfaces land with the settings panel (#26).
const perception = createPerceptionLayer({
  route: (capability, input) => routeCapability(shellCapabilityDeps, { capabilityId: capability, input }),
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
const workspacePaths = createWorkspacePaths({ root: join(serverConfig.dataDir, "workspace") });
const readFileTool = createReadFileTool({ paths: workspacePaths, logger });
const writeFileTool = createWriteFileTool({ paths: workspacePaths, logger });

const registry = createMethodRegistry();
// Turn lifecycle (D1 #3/#4): per-character serialization + the cancellable-turn registry shared by send/cancel.
const turnControls = { queue: createTurnQueue(), turns: createTurnRegistry() };
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
registry.register(
  chatSendMethod(
    createChatAgent({
      model,
      store: conversationStore,
      memory,
      autoMemory,
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
        ? { onImageTurn: (input) => void imageDescriptionWriter.onImageTurn(input) }
        : undefined,
      // Extra tools = the skills meta-tool + every capability tool (Shell-gated + core-side Workspace files) + MCP tools
      // + the pure get_current_time tool (no Gate/broker — reads new Date(); the precision pull for the ambient time lines).
      extraTools: {
        ...createLoadSkillTool(skillsLoader),
        ...createCurrentTimeTool(),
        ...capabilityTools,
        ...readFileTool,
        ...writeFileTool,
        ...mcpManager.tools(),
      },
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
      approval: approvalGate,
      // Batch-6 usage seam: each committed turn's real usage calibrates the main slot's window (the calibrator
      // ignores the 0 that stands in for an absent inputTokens field).
      onUsage: (report) => windowCalibrator.onUsage(report.inputTokens ?? 0, report.estimatedInput),
      // R2 (batch 6): a classified overflow shrinks the persisted window — the retry then re-windows through the
      // store's budget closure above. Counts-only warn: sizes and the new window, never content (logging-guidelines).
      onOverflow: (observedInput) =>
        chatLog.warn(
          { observedInput, effectiveWindow: windowCalibrator.onOverflow(observedInput) },
          "provider context overflow — window recalibrated, retrying once",
        ),
    }),
    logger,
    turnControls,
  ),
);
registry.register(chatCancelMethod(turnControls.turns));
registry.register(approvalRespondMethod(approvalBroker));
registry.register(hostCatalogPublishMethod(hostCatalogs, connectionRegistry));
registry.register(capabilityRespondMethod(capabilityBroker, connectionRegistry));
registry.register(timelineHistoryMethod(timelineRepo));
registry.register(timelineSubscribeMethod(timelineSubscriptions));
registry.register(avatarSubscribeMethod(avatarSubscriptions));
registry.register(avatarReportMethod(avatarVocabulary));
// Media methods (#17): serve attachment bytes for scroll-back, purge on demand, and report cache usage (usage RESERVED
// for the M5 settings UI, D27). Operator-only, NO Rust mirror — the ref confinement is single-sourced in attachment-store.
registry.register(mediaGetMethod(attachmentStore));
registry.register(mediaClearMethod(attachmentStore));
registry.register(mediaUsageMethod(attachmentStore, () => directoryByteSize(memoryRoot)));
// Character methods (#18): import a generic-Cubism / BanG-Dream `.zst` model into the Workspace, list imported
// characters, and read a character's costumes. Operator-only (like media.*), NO Rust mirror — traversal confinement is
// single-sourced in characters/member-path. Costume switching is client-side (renderer reloads + re-reports vocabulary).
registry.register(characterImportMethod(characterImporter));
registry.register(characterListMethod(characterStore));
registry.register(characterCostumesMethod({ store: characterStore, charactersDir }));
registry.register(characterCostumeResolutionMethod({ store: characterStore, charactersDir }));
// Perception methods (T3b): Privacy Pause read/write + the activity card. Operator-only — the agent has no path to
// un-pause its own observation (pinned by privacy-pause-writer.test.ts); the panel lands with #26.
registerPerceptionMethods(registry, perception);
// Memory maintenance (T5 batch 4b): run the tidy pass on demand. Operator-only, NO Rust mirror; the write-count
// trigger rides autoMemory internally — this surface exists for the settings panel/CLI (#26).
registry.register(memoryTidyMethod(tidy));
// The panel's operations page reads the maintenance counters (calibration / compaction / auto-write watermarks).
// Counts only — the rolling summary's LENGTH crosses, never its text.
registry.register(
  memoryStatusMethod({ windowState: windowStateRepo, summaries: summaryRepo, autoState: createMemoryAutoRepo(db) }),
);
// Settings store (#26 batch 1): read every knob with its provenance, store operator values, push config.changed.
// Operator-only, NO Rust mirror; secrets are reported as set/not-set and refused on write (invariant 5).
registerConfigMethods(registry, { ...boot.config, logger });

// Attachment GC (#17): a boot sweep + a 6h interval; only raw bytes expire, the description-memory is permanent.
startAttachmentGc({ store: attachmentStore, ttlMs: boot.attachmentConfig.ttlMs, logger });

// Dev-only L1 drive (env double-gate, mirror of the Shell's ScriptedApprover): registered ONLY with TAKI_DEV_TRIGGER=1
// so it has zero production surface. It drives the same capability tools the agent does — the node-side gate still
// authorizes every call (NOT a bypass); it only removes the LLM so headless e2e can drive governance deterministically.
if (devTriggerEnabled(process.env)) {
  logger.warn("TAKI_DEV_TRIGGER=1 — registering the DEV capability.trigger method (L1 drive; node-side gate still authorizes)");
  registry.register(
    capabilityTriggerMethod({ tools: { ...capabilityTools, ...readFileTool, ...writeFileTool }, logger }),
  );
}

const server = await startWsServer({
  host: serverConfig.host,
  port: serverConfig.port,
  registry,
  connectionRegistry,
  logger,
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  void server.close().then(async () => {
    await mcpManager.close(); // close every MCP client (kills stdio children / aborts http) before exit
    db.close(); // release the sqlite file handle (and checkpoint the WAL) before exit
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
