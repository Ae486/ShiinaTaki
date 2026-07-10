/**
 * INPUT:  process env (server + provider config) and OS signals
 * OUTPUT: a running headless Agent Core — WS server bound to loopback; exits 0 on SIGINT/SIGTERM
 * POS:    core — the process entry/composition root; wires config → logger → model → db/store/subscriptions → ws-server
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createChatAgent } from "./agents/chat-agent.ts";
import { createConversationStore } from "./agents/conversation-store.ts";
import { loadProviderConfig } from "./config/provider-config.ts";
import { loadServerConfig } from "./config/server-config.ts";
import { MIGRATIONS } from "./db/migrations/index-list.ts";
import { openDatabase } from "./db/sqlite.ts";
import { createTimelineRepo } from "./db/timeline-repo.ts";
import { createDeviceRegistry } from "./devices/device-registry.ts";
import { createPairedDeviceStore } from "./devices/paired-device-store.ts";
import { createLogger } from "./logging/logger.ts";
import { createMemoryEngine } from "./memory/memory-engine.ts";
import { createConnectionRegistry } from "./server/connection-registry.ts";
import { createMethodRegistry } from "./server/method-registry.ts";
import { chatSendMethod } from "./server/methods/chat-send.ts";
import { connectMethod } from "./server/methods/connect.ts";
import { timelineHistoryMethod } from "./server/methods/timeline-history.ts";
import { timelineSubscribeMethod } from "./server/methods/timeline-subscribe.ts";
import { createTimelineSubscriptions } from "./server/timeline-subscriptions.ts";
import { startWsServer } from "./server/ws-server.ts";

// Config parse is fatal-fast at boot; env is supplied by the run script's
// --env-file flag, never read from disk by code (invariant 1).
const serverConfig = loadServerConfig(process.env);
const providerConfig = loadProviderConfig(process.env);

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

const deviceRegistry = createDeviceRegistry({
  store: createPairedDeviceStore(join(serverConfig.dataDir, "devices.json")),
});
const connectionRegistry = createConnectionRegistry();

const registry = createMethodRegistry();
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
registry.register(chatSendMethod(createChatAgent({ model, store: conversationStore, memory }), logger));
registry.register(timelineHistoryMethod(timelineRepo));
registry.register(timelineSubscribeMethod(timelineSubscriptions));

const server = await startWsServer({
  host: serverConfig.host,
  port: serverConfig.port,
  registry,
  connectionRegistry,
  logger,
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  void server.close().then(() => {
    db.close(); // release the sqlite file handle (and checkpoint the WAL) before exit
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
