/**
 * INPUT:  CLI args (--url, --character) + interactive stdin lines
 * OUTPUT: a REPL that streams assistant tokens to stdout live; errors to stderr
 * POS:    cli — the process entry; thin glue over chat-client (covered by manual smoke, not unit tests)
 */
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from "@taki/shared";
import { connectChatClient } from "./chat-client.ts";

const DEFAULT_URL = `ws://${DEFAULT_WS_HOST}:${DEFAULT_WS_PORT}`;

const { values } = parseArgs({
  options: {
    url: { type: "string", default: DEFAULT_URL },
    character: { type: "string", default: "taki" },
  },
});

const url = values.url ?? DEFAULT_URL;
const characterId = values.character ?? "taki";

const client = await connectChatClient(url);
const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("SIGINT", () => rl.close());

process.stdout.write("> ");
for await (const line of rl) {
  const message = line.trim();
  if (message.length > 0) {
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
  process.stdout.write("> ");
}

client.close();
process.exit(0);
