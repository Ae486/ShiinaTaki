/**
 * INPUT:  CLI args (--url, --character, --call/--params) + a device identity file + stdin lines
 * OUTPUT: authenticates (pairing on first run, token reuse after), then either a chat REPL or one operator call
 * POS:    cli — the process entry; thin glue over device-identity + chat-client + repl + operator-call (manual smoke)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT, ErrorCodeSchema } from "@taki/shared";
import { createCliApprovalController } from "./approval-controller.ts";
import { connectChatClient, type ChatClient } from "./chat-client.ts";
import { loadOrCreateIdentity, saveToken } from "./device-identity.ts";
import { buildOperatorCall, parseOperatorCall, runOperatorCall, OPERATOR_CALL_USAGE } from "./operator-call.ts";
import { runSecretCommand, SECRET_COMMAND_USAGE } from "./secret-commands.ts";
import { showRecentHistory } from "./recent-history.ts";
import { askOnce, runRepl } from "./repl.ts";

const DEFAULT_URL = `ws://${DEFAULT_WS_HOST}:${DEFAULT_WS_PORT}`;
const DEVICE_NAME = "taki-cli";

const { values, positionals } = parseCliArgs();

const url = values.url ?? DEFAULT_URL;
const characterId = values.character ?? "taki";
// The ONLY positional surface is the `secret` family (its value deliberately arrives via stdin, never argv).
const secretPositionals = positionals.length > 0 ? positionals : null;
if (secretPositionals !== null && secretPositionals[0] !== "secret") {
  process.stderr.write(`unexpected argument: ${secretPositionals[0]}\n${SECRET_COMMAND_USAGE}\n`);
  process.exit(1);
}
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
      allowPositionals: true,
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

// Approval is one socket-local FIFO owner. Its ask function is rebound to the shared line queue once the REPL exists;
// an unbound or closed input fails closed without leaving a pending stdin waiter behind.
let askLine: ((query: string, signal?: AbortSignal) => Promise<string | null>) | null = null;
const approvalController = createCliApprovalController({
  ask: (query, signal) => askLine?.(query, signal) ?? Promise.resolve(null),
  write: (message) => process.stdout.write(message),
});
approvalController.replace(client);
const stopApproval = client.onApproval((event) => approvalController.receive(event));
client.onClose(() => approvalController.replace(null));

// Secret subcommand mode: authenticate, run exactly one stdin-fed secret command, exit with its outcome. The
// value never enters argv (shell-history/process-list leak), so it is read from stdin right here.
if (secretPositionals !== null) {
  const secretIo = { input: process.stdin, output: process.stdout };
  askLine = (query, signal) => askOnce(secretIo, query, signal);
  await authenticate(client, (query, signal) => askOnce(secretIo, query, signal));
  const succeeded = await runSecretCommand({ caller: client, io: secretIo, positionals: secretPositionals.slice(1) });
  stopApproval();
  approvalController.dispose();
  client.close();
  process.exit(succeeded ? 0 : 1);
}

if (oneShot === null) {
  await runRepl(
    { input: process.stdin, output: process.stdout },
    { authenticate: startChatSession, onLine: handleLine, bindAsk: (ask) => (askLine = ask) },
  );
  stopApproval();
  approvalController.dispose();
  client.close();
  process.exit(0);
}

// One-shot mode: no REPL, no history replay — authenticate, run exactly one call, exit with its outcome.
askLine = (query, signal) => askOnce({ input: process.stdin, output: process.stdout }, query, signal);
await authenticate(client, (query, signal) => askOnce({ input: process.stdin, output: process.stdout }, query, signal));
const succeeded = await runOperatorCall(client, oneShot.call, process.stdout);
stopApproval();
approvalController.dispose();
client.close();
process.exit(succeeded ? 0 : 1);

// Reconnect with the stored token; on first run the core demands a pairing code (shown on its console).
async function authenticate(chatClient: ChatClient, ask: (query: string, signal?: AbortSignal) => Promise<string | null>): Promise<void> {
  let outcome = await chatClient.connect({ ...baseParams, token: identity.token });
  if (!outcome.ok && outcome.code === ErrorCodeSchema.enum.PAIRING_REQUIRED) {
    const code = (await ask("pairing code (shown in the core console): ")) ?? "";
    outcome = await chatClient.connect({ ...baseParams, pairingCode: code.trim() });
    if (outcome.ok && outcome.token) saveToken(identityPath, outcome.token);
  }
  if (!outcome.ok) {
    process.stderr.write(`\n[connect failed] ${outcome.code ?? "ERROR"}: ${outcome.message}\n`);
    chatClient.close();
    process.exit(1);
  }
}

async function startChatSession(ask: (query: string, signal?: AbortSignal) => Promise<string | null>): Promise<void> {
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
