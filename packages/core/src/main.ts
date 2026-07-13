/**
 * INPUT:  process env (server + provider config) and OS signals
 * OUTPUT: a running headless Agent Core — WS server bound to loopback; exits 0 on SIGINT/SIGTERM
 * POS:    core — the process entry/composition root; wires config → logger → model → db/store/subscriptions → ws-server
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
import { createCapabilityBroker } from "./capabilities/capability-broker.ts";
import { createClipboardReadTool } from "./capabilities/clipboard-read-tool.ts";
import { createClipboardWriteTool } from "./capabilities/clipboard-write-tool.ts";
import { createExecTool } from "./capabilities/exec-tool.ts";
import { createProcessListTool } from "./capabilities/process-list-tool.ts";
import { createScreenshotStore } from "./capabilities/screenshot-store.ts";
import { createScreenshotTool } from "./capabilities/screenshot-tool.ts";
import { createShellOpenTool } from "./capabilities/shell-open-tool.ts";
import { loadAgentConfig } from "./config/agent-config.ts";
import { loadProviderConfig } from "./config/provider-config.ts";
import { loadServerConfig } from "./config/server-config.ts";
import { createMemoryAutoRepo } from "./db/memory-auto-repo.ts";
import { MIGRATIONS } from "./db/migrations/index-list.ts";
import { openDatabase } from "./db/sqlite.ts";
import { createTimelineRepo } from "./db/timeline-repo.ts";
import { createDeviceRegistry } from "./devices/device-registry.ts";
import { createPairedDeviceStore } from "./devices/paired-device-store.ts";
import { createLogger } from "./logging/logger.ts";
import { loadMcpConfig } from "./mcp/mcp-config.ts";
import { createMcpManager } from "./mcp/mcp-manager.ts";
import { createAutoMemory } from "./memory/auto-memory.ts";
import { createEpisodicWriter } from "./memory/episodic-writer.ts";
import { createFlushWriter } from "./memory/flush-writer.ts";
import { createMemoryEngine } from "./memory/memory-engine.ts";
import { createConnectionRegistry } from "./server/connection-registry.ts";
import { createMethodRegistry } from "./server/method-registry.ts";
import { approvalRespondMethod } from "./server/methods/approval-respond.ts";
import { chatCancelMethod } from "./server/methods/chat-cancel.ts";
import { chatSendMethod } from "./server/methods/chat-send.ts";
import { capabilityRespondMethod } from "./server/methods/capability-respond.ts";
import { capabilityTriggerMethod, devTriggerEnabled } from "./server/methods/capability-trigger.ts";
import { connectMethod } from "./server/methods/connect.ts";
import { timelineHistoryMethod } from "./server/methods/timeline-history.ts";
import { timelineSubscribeMethod } from "./server/methods/timeline-subscribe.ts";
import { createLoadSkillTool } from "./skills/load-skill-tool.ts";
import { createSkillsLoader } from "./skills/skills-loader.ts";
import { createSkillsState } from "./skills/skills-state.ts";
import { scanSkills } from "./skills/skill-scanner.ts";
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

const logger = createLogger(serverConfig.logLevel);

const provider = createOpenAICompatible({
  name: "taki-provider",
  baseURL: providerConfig.baseUrl,
  apiKey: providerConfig.apiKey,
});
const model = provider.languageModel(providerConfig.model);

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
});

// The memory engine's Workspace: markdown files under the app data root (beside the db, NOT in it — invariant 1).
// Startup reconciliation rebuilds the derived index from those files (files are truth).
const memoryLog = logger.child({ mod: "memory" });
const memory = createMemoryEngine({ db, memoryRoot: join(serverConfig.dataDir, "workspace", "memory") });
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
const screenshotTool = createScreenshotTool({
  registry: connectionRegistry,
  broker: capabilityBroker,
  // The core is the single sanctioned Workspace writer (invariant 2); the Shell only returns base64 over the wire.
  store: createScreenshotStore({ screenshotsDir: join(serverConfig.dataDir, "workspace", "screenshots") }),
  logger,
});
// The other three Shell-backed capabilities (#11) share the route→broker path; each is gate-authorized on the Shell.
const shellCapabilityDeps = { registry: connectionRegistry, broker: capabilityBroker, logger };
const processListTool = createProcessListTool(shellCapabilityDeps);
const clipboardReadTool = createClipboardReadTool(shellCapabilityDeps);
const clipboardWriteTool = createClipboardWriteTool(shellCapabilityDeps);
const shellOpenTool = createShellOpenTool(shellCapabilityDeps);
// exec (#12): the general-purpose shell tool on the same route→broker path; the Shell parses, governs, spawns, audits.
const execTool = createExecTool(shellCapabilityDeps);

// The six Shell-routed capability tools as one bag (invariant 7): the chat agent's extraTools spreads it AND the
// dev capability.trigger reuses these exact objects — never a second execute path to the same capabilities.
const capabilityTools: ToolSet = {
  ...screenshotTool,
  ...processListTool,
  ...clipboardReadTool,
  ...clipboardWriteTool,
  ...shellOpenTool,
  ...execTool,
};

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
    onPairingCode: ({ deviceId, deviceName, code }) =>
      pairingLog.info({ deviceId, deviceName, code }, "pairing code issued"),
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
      // Extra tools = the skills meta-tool + every capability tool (Shell-gated + core-side Workspace files) + MCP tools.
      extraTools: {
        ...createLoadSkillTool(skillsLoader),
        ...capabilityTools,
        ...readFileTool,
        ...writeFileTool,
        ...mcpManager.tools(),
      },
      instructionsExtra: () => skillsLoader.renderList(),
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
