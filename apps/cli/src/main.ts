/**
 * INPUT:  CLI args (--url, --character, --call/--params) + a device identity file + stdin lines
 * OUTPUT: authenticates (pairing on first run, token reuse after), then either a chat REPL or one operator call
 * POS:    cli — the process entry; thin glue over device-identity + chat-client + repl + operator-call (manual smoke)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT, ErrorCodeSchema } from "@taki/shared";
import { parseApprovalAnswer, renderApprovalAsk } from "./approval-prompt.ts";
import { connectChatClient, type ChatClient } from "./chat-client.ts";
import { loadOrCreateIdentity, saveToken } from "./device-identity.ts";
import { buildOperatorCall, parseOperatorCall, runOperatorCall, OPERATOR_CALL_USAGE } from "./operator-call.ts";
import { showRecentHistory } from "./recent-history.ts";
import { askOnce, runRepl } from "./repl.ts";

const DEFAULT_URL = `ws://${DEFAULT_WS_HOST}:${DEFAULT_WS_PORT}`;
const DEVICE_NAME = "taki-cli";

const { values } = parseCliArgs();

const url = values.url ?? DEFAULT_URL;
const characterId = values.character ?? "taki";
// Both argv mistakes fail fast at the entry: --params without --call would otherwise be a silent swallow,
// and a malformed one-shot call must not cost a socket. The authenticated paths never see either.
if (values.call === undefined && values.params !== undefined) {
  process.stderr.write(`--params requires --call\n${OPERATOR_CALL_USAGE}\n`);
  process.exit(1);
}
const oneShot = values.call === undefined ? null : buildOperatorCall(values.call, values.params ?? "");
if (oneShot?.kind === "usage") {
  process.stderr.write(`${oneShot.message}\n`);
  process.exit(1);
}

// parseArgs throws on a missing option value or an unknown flag — a scripted typo gets the usage text, not a stack.
function parseCliArgs() {
  try {
    return parseArgs({
      options: {
        url: { type: "string", default: DEFAULT_URL },
        character: { type: "string", default: "taki" },
        // One-shot scriptable mode: run a single operator WS method instead of the REPL.
        call: { type: "string" },
        params: { type: "string" },
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${reason}\n${OPERATOR_CALL_USAGE}\n`);
    process.exit(1);
  }
}

// Same data root as the core default; TAKI_DATA_DIR points both at a shared test root for manual smoke.
const dataDir = process.env.TAKI_DATA_DIR ?? join(homedir(), ".takiagent");
const identityPath = join(dataDir, "cli-device.json");
const identity = loadOrCreateIdentity(identityPath);
const baseParams = { deviceId: identity.deviceId, deviceName: DEVICE_NAME, role: "operator" as const, capabilities: [] };

// A dead core must read as one friendly line, not a top-level-await unhandled rejection stack.
const client = await connectChatClient(url).catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[connect failed] no agent core at ${url}: ${reason}\n`);
  process.exit(1);
});

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

if (oneShot === null) {
  await runRepl(
    { input: process.stdin, output: process.stdout },
    { authenticate: startChatSession, onLine: handleLine, bindAsk: (ask) => (askLine = ask) },
  );
  client.close();
  process.exit(0);
}

// One-shot mode: no REPL, no history replay — authenticate, run exactly one call, exit with its outcome.
await authenticate(client, (query) => askOnce({ input: process.stdin, output: process.stdout }, query));
const succeeded = await runOperatorCall(client, oneShot.call, process.stdout);
client.close();
process.exit(succeeded ? 0 : 1);

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
}

async function startChatSession(ask: (query: string) => Promise<string>): Promise<void> {
  await authenticate(client, ask);
  // AC-2 demo: replay the tail of the persisted timeline so a reconnect shows prior turns.
  // A history-fetch failure must not block chatting, so degrade to a warning.
  try {
    await showRecentHistory({ reader: client, characterId, output: process.stdout });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n[history unavailable] ${reason}\n`);
  }
}

async function handleLine(line: string): Promise<void> {
  const parsed = parseOperatorCall(line);
  if (parsed.kind === "chat") return chatTurn(line);
  if (parsed.kind === "usage") {
    process.stderr.write(`${parsed.message}\n`);
    return;
  }
  await runOperatorCall(client, parsed.call, process.stdout);
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
