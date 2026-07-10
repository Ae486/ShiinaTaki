/**
 * INPUT:  CLI args (--url, --character) + a device identity file + stdin lines
 * OUTPUT: authenticates (pairing on first run, token reuse after), then streams a chat REPL to stdout
 * POS:    cli — the process entry; thin glue over device-identity + chat-client + repl (manual smoke, not unit tests)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT, ErrorCodeSchema } from "@taki/shared";
import { parseApprovalAnswer, renderApprovalAsk } from "./approval-prompt.ts";
import { connectChatClient, type ChatClient } from "./chat-client.ts";
import { loadOrCreateIdentity, saveToken } from "./device-identity.ts";
import { showRecentHistory } from "./recent-history.ts";
import { runRepl } from "./repl.ts";

const DEFAULT_URL = `ws://${DEFAULT_WS_HOST}:${DEFAULT_WS_PORT}`;
const DEVICE_NAME = "taki-cli";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: DEFAULT_URL },
    character: { type: "string", default: "taki" },
  },
});

const url = values.url ?? DEFAULT_URL;
const characterId = values.character ?? "taki";

// Same data root as the core default; TAKI_DATA_DIR points both at a shared test root for manual smoke.
const dataDir = process.env.TAKI_DATA_DIR ?? join(homedir(), ".takiagent");
const identityPath = join(dataDir, "cli-device.json");
const identity = loadOrCreateIdentity(identityPath);
const baseParams = { deviceId: identity.deviceId, deviceName: DEVICE_NAME, role: "operator" as const, capabilities: [] };

const client = await connectChatClient(url);

// The approval prompt reads the same stdin queue as the REPL (bound below); an ask arrives only mid-turn,
// while the main loop is parked awaiting client.chat, so pulling a line here doesn't race the prompt loop.
let askLine: ((query: string) => Promise<string>) | null = null;
client.onApprovalRequest(async (request) => {
  if (!askLine) return { approved: false, scope: "once" }; // no console bound yet -> fail-closed
  for (;;) {
    const parsed = parseApprovalAnswer(await askLine(renderApprovalAsk(request)));
    if (parsed) return parsed;
    process.stdout.write("Please answer y / s / a / d / n.\n");
  }
});

await runRepl(
  { input: process.stdin, output: process.stdout },
  { authenticate: (ask) => authenticate(client, ask), onLine: chatTurn, bindAsk: (ask) => (askLine = ask) },
);

client.close();
process.exit(0);

// Reconnect with the stored token; on first run the core demands a pairing code (shown on its console).
async function authenticate(chatClient: ChatClient, ask: (query: string) => Promise<string>): Promise<void> {
  let outcome = await chatClient.connect({ ...baseParams, token: identity.token });
  if (!outcome.ok && outcome.code === ErrorCodeSchema.enum.PAIRING_REQUIRED) {
    const code = await ask("pairing code (shown in the core console): ");
    outcome = await chatClient.connect({ ...baseParams, pairingCode: code.trim() });
    if (outcome.ok && outcome.token) saveToken(identityPath, outcome.token);
  }
  if (!outcome.ok) {
    process.stderr.write(`\n[connect failed] ${outcome.code ?? "ERROR"}: ${outcome.message}\n`);
    chatClient.close();
    process.exit(1);
  }
  // AC-2 demo: replay the tail of the persisted timeline so a reconnect shows prior turns.
  // A history-fetch failure must not block chatting, so degrade to a warning.
  try {
    await showRecentHistory({ reader: chatClient, characterId, output: process.stdout });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n[history unavailable] ${reason}\n`);
  }
}

async function chatTurn(line: string): Promise<void> {
  const message = line.trim();
  if (message.length === 0) return;
  try {
    await client.chat(
      { characterId, message },
      {
        onDelta: (delta) => process.stdout.write(delta),
        onComplete: () => process.stdout.write("\n"),
        onError: (code, reason) => process.stderr.write(`\n[${code}] ${reason}\n`),
      },
    );
  } catch (error) {
    // Envelope-level failures (JSON-RPC error, lost connection) must not kill the REPL.
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n[request failed] ${reason}\n`);
  }
}
