/**
 * INPUT:  process env (server + provider config) and OS signals
 * OUTPUT: a running headless Agent Core — WS server bound to loopback; exits 0 on SIGINT/SIGTERM
 * POS:    core — the process entry/composition root; wires config → logger → model → registries → ws-server
 */
import { join } from "node:path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createChatAgent } from "./agents/chat-agent.ts";
import { loadProviderConfig } from "./config/provider-config.ts";
import { loadServerConfig } from "./config/server-config.ts";
import { createDeviceRegistry } from "./devices/device-registry.ts";
import { createPairedDeviceStore } from "./devices/paired-device-store.ts";
import { createLogger } from "./logging/logger.ts";
import { createConnectionRegistry } from "./server/connection-registry.ts";
import { createMethodRegistry } from "./server/method-registry.ts";
import { chatSendMethod } from "./server/methods/chat-send.ts";
import { connectMethod } from "./server/methods/connect.ts";
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
registry.register(chatSendMethod(createChatAgent({ model }), logger));

const server = await startWsServer({
  host: serverConfig.host,
  port: serverConfig.port,
  registry,
  connectionRegistry,
  logger,
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  void server.close().then(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
