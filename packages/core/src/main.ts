/**
 * INPUT:  process env (server + provider + optional vision/attachment config) and OS signals
 * OUTPUT: a running headless Agent Core — WS server bound to loopback; exits 0 on SIGINT/SIGTERM
 * POS:    core — the process entry/composition root; wires config → logger → model(s) → db/store/media/subscriptions → ws-server
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createChatAgent } from "./agents/chat-agent.ts";
import { createConversationStore } from "./agents/conversation-store.ts";
import { createTurnQueue } from "./agents/turn-queue.ts";
import { createTurnRegistry } from "./agents/turn-registry.ts";
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
import { loadAgentConfig } from "./config/agent-config.ts";
import { loadAmbientScreenshotConfig } from "./config/ambient-screenshot-config.ts";
import { loadAttachmentConfig } from "./config/attachment-config.ts";
import { loadProviderConfig } from "./config/provider-config.ts";
import { loadServerConfig } from "./config/server-config.ts";
import { loadVisionConfig } from "./config/vision-config.ts";
import { createMemoryAutoRepo } from "./db/memory-auto-repo.ts";
import { MIGRATIONS } from "./db/migrations/index-list.ts";
import { createPrivacyPauseRepo } from "./db/privacy-pause-repo.ts";
import { openDatabase } from "./db/sqlite.ts";
import { createTimelineRepo } from "./db/timeline-repo.ts";
import { createDeviceRegistry } from "./devices/device-registry.ts";
import { createPairedDeviceStore } from "./devices/paired-device-store.ts";
import { createLogger } from "./logging/logger.ts";
import { loadMcpConfig } from "./mcp/mcp-config.ts";
import { createMcpManager } from "./mcp/mcp-manager.ts";
import { createCharacterImporter } from "./characters/character-import.ts";
import { createCharacterStore } from "./characters/character-store.ts";
import { startAttachmentGc } from "./media/attachment-gc.ts";
import { createAttachmentStore } from "./media/attachment-store.ts";
import { directoryByteSize } from "./media/directory-size.ts";
import { createAutoMemory } from "./memory/auto-memory.ts";
import { createEpisodicWriter } from "./memory/episodic-writer.ts";
import { createFlushWriter } from "./memory/flush-writer.ts";
import { createImageDescriptionWriter } from "./memory/image-description-writer.ts";
import { createMemoryEngine } from "./memory/memory-engine.ts";
import { createPersonaProvider } from "./memory/persona-provider.ts";
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
import { connectMethod } from "./server/methods/connect.ts";
import { mediaClearMethod } from "./server/methods/media-clear.ts";
import { mediaGetMethod } from "./server/methods/media-get.ts";
import { mediaUsageMethod } from "./server/methods/media-usage.ts";
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

// Config parse is fatal-fast at boot; env is supplied by the run script's
// --env-file flag, never read from disk by code (invariant 1).
const serverConfig = loadServerConfig(process.env);
const providerConfig = loadProviderConfig(process.env);
const agentConfig = loadAgentConfig(process.env);
// Two user-adjustable model slots (#17 decision 5): the required text slot (above) + an OPTIONAL vision slot. Both are
// fatal-fast — a partial TAKI_VLM_* set or a garbage TTL fails the boot, never silently degrades.
const visionConfig = loadVisionConfig(process.env);
const attachmentConfig = loadAttachmentConfig(process.env);
// Ambient screen sampling (#20 T3b): OFF unless explicitly enabled, raw frames dropped right after describe.
const ambientConfig = loadAmbientScreenshotConfig(process.env);

const logger = createLogger(serverConfig.logLevel);

const provider = createOpenAICompatible({
  name: "taki-provider",
  baseURL: providerConfig.baseUrl,
  apiKey: providerConfig.apiKey,
});
const model = provider.languageModel(providerConfig.model);
// The vision slot mirrors the text-slot block; absent config = no vision model (image turns are then rejected upstream).
const visionModel = visionConfig
  ? createOpenAICompatible({ name: "taki-vision", baseURL: visionConfig.baseUrl, apiKey: visionConfig.apiKey }).languageModel(
      visionConfig.model,
    )
  : undefined;

// The composition root ensures the app data root exists before opening the db (first-boot);
// the db layer itself stays fs-free (invariant). Mirrors the paired-device-store sanctioned site.
mkdirSync(serverConfig.dataDir, { recursive: true });
const dbLog = logger.child({ mod: "db" });
const db = openDatabase({
  path: join(serverConfig.dataDir, "taki.db"),
  migrations: MIGRATIONS,
  onMigrated: (applied) =>
    dbLog.info({ applied }, applied.length > 0 ? "migrations applied" : "schema already up to date"),
});
const timelineRepo = createTimelineRepo(db);
const timelineSubscriptions = createTimelineSubscriptions();
const conversationStore = createConversationStore({
  repo: timelineRepo,
  onAppend: (entry) => timelineSubscriptions.publish(entry),
  onRemove: (ref) => timelineSubscriptions.publishRemoved(ref),
});

// Avatar channel (#16): LLM-driven expression/motion commands fan out to subscribed Pet UI operators (mirrors the
// timeline fan-out); the vocabulary store holds each character's reported manifest names, injected into turn prompts.
const avatarSubscriptions = createAvatarSubscriptions();
const avatarVocabulary = createAvatarVocabulary();

// The memory engine's Workspace: markdown files under the app data root (beside the db, NOT in it — invariant 1).
// Startup reconciliation rebuilds the derived index from those files (files are truth).
const memoryLog = logger.child({ mod: "memory" });
// Persona cards (#16): the global assistant layer + per-character persona, read from prompt/ at boot and injected
// FIRST in the assembled turn context (prompt/README.md order). A missing card degrades to a built-in fallback.
const personaProvider = createPersonaProvider({ promptDir: serverConfig.promptDir, logger });
const memoryRoot = join(serverConfig.dataDir, "workspace", "memory");
const memory = createMemoryEngine({
  db,
  memoryRoot,
  persona: personaProvider,
});
const reconciled = memory.reconcile();
memoryLog.info(reconciled, "memory index reconciled from workspace");
if (reconciled.invalid.length > 0)
  memoryLog.warn({ invalid: reconciled.invalid }, "invalid memory files skipped (fix or remove them)");

// Automatic memory writes (#7): episodic summaries + pre-compaction flush, fired detached after each chat turn.
// Both writers share the chat model; all writes ride the memory engine's store API (never raw fs).
const autoMemory = createAutoMemory({
  timeline: timelineRepo,
  autoState: createMemoryAutoRepo(db),
  episodic: createEpisodicWriter({
    model,
    writeEpisode: (input) => memory.writeEntry({ ...input, type: "episodes" }),
  }),
  flush: createFlushWriter({ model, createTools: (id) => memory.createTools(id) }),
  logger: logger.child({ mod: "memory-auto" }),
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
      writeEpisode: (input) => memory.writeEntry({ ...input, type: "episodes" }),
      logger: logger.child({ mod: "image-memory" }),
    })
  : undefined;

const deviceRegistry = createDeviceRegistry({
  store: createPairedDeviceStore(join(serverConfig.dataDir, "devices.json")),
});
const connectionRegistry = createConnectionRegistry();

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
connectionRegistry.onRemove((connection) => {
  if (connection.state.status === "authenticated" && connection.state.role === "node") {
    capabilityBroker.denyAll("node disconnected");
  }
});
// Screenshot→VLM bridge: reuses the OPTIONAL vision slot; without it a result stays path+dims (no pixels to the text
// model) and ambient sampling never starts. ONE bridge, shared by the on-demand tool and the ambient sampler.
const describeScreenshot = visionModel ? createScreenshotDescriber({ model: visionModel, logger }).describe : undefined;
const screenshotTool = createScreenshotTool({
  registry: connectionRegistry,
  broker: capabilityBroker,
  // The core is the single sanctioned Workspace writer (invariant 2); the Shell only returns base64 over the wire.
  store: createScreenshotStore({ screenshotsDir: join(serverConfig.dataDir, "workspace", "screenshots") }),
  describe: describeScreenshot,
  logger,
});
// The other Shell-backed capabilities (#11, and exec #12) share the route→broker path; each is gate-authorized on
// the Shell, which parses, governs, spawns and audits.
const shellCapabilityDeps = { registry: connectionRegistry, broker: capabilityBroker, logger };

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
  route: (capability, input) => routeCapability(shellCapabilityDeps, capability, input),
  hasNode: (capability) => connectionRegistry.findNodeForCapability(capability) !== undefined,
  describe: describeScreenshot,
  ambient: ambientConfig,
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
      maxSteps: agentConfig.maxSteps,
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
      // Skills list + the active character's reported avatar vocabulary + the fenced perception context (T3a activity
      // + T3b screen; ruling 10 — non-memory sections enter HERE, never via the memory assembler); blanks contribute nothing.
      instructionsExtra: (characterId) =>
        [skillsLoader.renderList(), avatarVocabulary.render(characterId), perception.renderContext(Date.now())]
          .filter((section) => section.length > 0)
          .join("\n\n"),
      costumeChanged: (characterId) => avatarVocabulary.consumeCostumeChanged(characterId),
      approval: approvalGate,
    }),
    logger,
    turnControls,
  ),
);
registry.register(chatCancelMethod(turnControls.turns));
registry.register(approvalRespondMethod(approvalBroker));
registry.register(capabilityRespondMethod(capabilityBroker));
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

// Attachment GC (#17): a boot sweep + a 6h interval; only raw bytes expire, the description-memory is permanent.
startAttachmentGc({ store: attachmentStore, ttlMs: attachmentConfig.ttlMs, logger });

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
