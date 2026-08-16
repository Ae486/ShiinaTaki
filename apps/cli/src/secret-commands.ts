/**
 * INPUT:  argv positionals (`secret set|clear|presence|list [secretRef]`) + stdin (the value for `set`)
 * OUTPUT: parseSecretCommand/readSecretValue/runSecretCommand + SECRET_COMMAND_USAGE; results parse through the
 *         shared write-only schemas before printing
 * POS:    cli — the secret surface: the value arrives ONLY via stdin (never argv — no shell history, no process
 *         list), and every printed result is presence/provenance/health (the wire shape cannot carry a value)
 */
import { createInterface } from "node:readline";
import { SECRET_METHODS, SecretRefSchema } from "@taki/shared";
import type { OperatorCaller } from "./operator-call.ts";

export const SECRET_COMMAND_USAGE =
  "usage: taki secret set <secretRef>   # value from stdin (pipe it or type one line); never as an argument\n" +
  "       taki secret clear <secretRef>\n" +
  "       taki secret presence <secretRef>\n" +
  "       taki secret list";

export type SecretCommand =
  | { kind: "set"; secretRef: string }
  | { kind: "clear"; secretRef: string }
  | { kind: "presence"; secretRef: string }
  | { kind: "list" };

/** Never throws: malformed input is a usage result the caller prints and exits non-zero with. */
export function parseSecretCommand(positionals: string[]): SecretCommand | { kind: "usage"; message: string } {
  const [verb, ref] = positionals;
  if (verb === undefined) return { kind: "usage", message: SECRET_COMMAND_USAGE };
  if (verb === "list") {
    if (ref !== undefined) return { kind: "usage", message: `list takes no arguments\n${SECRET_COMMAND_USAGE}` };
    return { kind: "list" };
  }
  if (verb !== "set" && verb !== "clear" && verb !== "presence") {
    return { kind: "usage", message: `unknown secret command: ${verb}\n${SECRET_COMMAND_USAGE}` };
  }
  if (ref === undefined || !SecretRefSchema.safeParse(ref).success) {
    return { kind: "usage", message: `${verb} requires a valid secretRef (e.g. mcp.github-mcp.env.GITHUB_TOKEN)\n${SECRET_COMMAND_USAGE}` };
  }
  return { kind: verb, secretRef: ref };
}

/**
 * Piped stdin: the whole stream minus ONE trailing newline (echo/cat/file all work; a value that genuinely ends
 * in a newline is preserved by keeping every earlier one). Interactive stdin: a single prompted line.
 */
export async function readSecretValue(io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream }): Promise<string | null> {
  if (!isTty(io.input)) {
    const chunks: Buffer[] = [];
    for await (const chunk of io.input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    let value = Buffer.concat(chunks).toString("utf8");
    if (value.endsWith("\r\n")) value = value.slice(0, -2);
    else if (value.endsWith("\n")) value = value.slice(0, -1);
    return value;
  }
  const rl = createInterface({ input: io.input, output: io.output });
  try {
    return await new Promise<string | null>((resolve) => {
      rl.question("value: ", (answer) => resolve(answer));
      rl.on("close", () => resolve(null));
    });
  } finally {
    rl.close();
  }
}

function isTty(input: NodeJS.ReadableStream): boolean {
  return (input as { isTTY?: boolean }).isTTY === true;
}

/** Returns false on any failure (never throws) so the entry can exit non-zero. */
export async function runSecretCommand(input: {
  caller: OperatorCaller;
  io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream };
  positionals: string[];
}): Promise<boolean> {
  const command = parseSecretCommand(input.positionals);
  if (command.kind === "usage") {
    input.io.output.write(`${command.message}\n`);
    return false;
  }
  if (command.kind === "list") {
    return printCall(input, SECRET_METHODS.list, {});
  }
  if (command.kind === "presence") {
    return printCall(input, SECRET_METHODS.presence, { secretRef: command.secretRef });
  }
  if (command.kind === "clear") {
    return printCall(input, SECRET_METHODS.clear, { secretRef: command.secretRef });
  }
  const value = await readSecretValue(input.io);
  if (value === null || value.length === 0) {
    input.io.output.write("no value provided on stdin; refusing to send an empty secret\n");
    return false;
  }
  return printCall(input, SECRET_METHODS.set, { secretRef: command.secretRef, value });
}

// The server result shapes are value-free by schema, so printing them verbatim is safe; errors print the bounded
// app-error code + message (SECRET_REFUSED reasons), never a value.
async function printCall(
  input: { caller: OperatorCaller; io: { output: NodeJS.WritableStream } },
  method: string,
  params: unknown,
): Promise<boolean> {
  try {
    const result = await input.caller.call(method, params);
    input.io.output.write(`${JSON.stringify(result, null, 2)}\n`);
    return true;
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    const label = typeof data === "object" && data !== null && "code" in data && typeof (data as { code: unknown }).code === "string"
      ? (data as { code: string }).code
      : "request failed";
    const reason = error instanceof Error ? error.message : String(error);
    input.io.output.write(`[${label}] ${reason}\n`);
    return false;
  }
}
