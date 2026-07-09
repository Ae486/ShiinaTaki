/**
 * INPUT:  process env (server + provider config) and OS signals
 * OUTPUT: a running headless Agent Core — WS server bound to loopback; exits 0 on SIGINT/SIGTERM
 * POS:    core — the process entry/composition root; wires config → logger → model → registry → ws-server
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createChatAgent } from "./agents/chat-agent.ts";
import { loadProviderConfig } from "./config/provider-config.ts";
import { loadServerConfig } from "./config/server-config.ts";
import { createLogger } from "./logging/logger.ts";
import { createMethodRegistry } from "./server/method-registry.ts";
import { chatSendMethod } from "./server/methods/chat-send.ts";
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

const registry = createMethodRegistry();
registry.register(chatSendMethod(createChatAgent({ model }), logger));

const server = await startWsServer({
  host: serverConfig.host,
  port: serverConfig.port,
  registry,
  logger,
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  void server.close().then(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
