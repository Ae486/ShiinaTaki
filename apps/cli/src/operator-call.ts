/**
 * INPUT: operator `/call` text or argv parts plus an RPC caller
 * OUTPUT: parsed generic calls; dispatch results; pre-dispatch refusal for stdin-only secret.set
 * POS: cli operator-method seam; otherwise method-agnostic with server-owned role/schema validation
 */
import { JSONRPCErrorException } from "json-rpc-2.0";

const PREFIX = "/call";
const STDIN_ONLY_METHODS = new Set(["secret.set"]);
// One string for both entries: the REPL types the `/call` form, scripts pass the argv form.
export const OPERATOR_CALL_USAGE =
  `usage: ${PREFIX} <method> [json-params]   argv: --call <method> [--params <json>]\n` +
  `  e.g. ${PREFIX} memory.tidy {"characterId":"taki"}`;

export interface OperatorCall {
  method: string;
  params: unknown;
}

/** A line that IS a `/call`: either a runnable call or a human-readable usage complaint. */
export type OperatorCallResult = { kind: "call"; call: OperatorCall } | { kind: "usage"; message: string };

/** `chat` = not a `/call` line at all, so the caller sends it to the agent as a normal message. */
export type OperatorCallParse = OperatorCallResult | { kind: "chat" };

/** Never throws: every malformed input comes back as a usage result the REPL can print and keep going. */
export function parseOperatorCall(line: string): OperatorCallParse {
  const trimmed = line.trim();
  if (trimmed !== PREFIX && !trimmed.startsWith(`${PREFIX} `)) return { kind: "chat" };

  const rest = trimmed.slice(PREFIX.length).trim();
  const split = rest.search(/\s/);
  const method = split === -1 ? rest : rest.slice(0, split);
  const paramsText = split === -1 ? "" : rest.slice(split + 1);
  return buildOperatorCall(method, paramsText);
}

/** The argv one-shot entry (`--call` + `--params`); the JSON-params parse lives here only. */
export function buildOperatorCall(method: string, paramsText: string): OperatorCallResult {
  if (method.length === 0) return { kind: "usage", message: OPERATOR_CALL_USAGE };
  if (STDIN_ONLY_METHODS.has(method)) return stdinOnlyUsage(method);
  const text = paramsText.trim();
  if (text.length === 0) return { kind: "call", call: { method, params: {} } };
  try {
    return { kind: "call", call: { method, params: JSON.parse(text) } };
  } catch (error) {
    return { kind: "usage", message: `invalid JSON params: ${reason(error)}\n${OPERATOR_CALL_USAGE}` };
  }
}

export interface OperatorCaller {
  call(method: string, params: unknown): Promise<unknown>;
}

/** Returns false on any failure (never throws) so the REPL survives and the one-shot mode can exit non-zero. */
export async function runOperatorCall(
  caller: OperatorCaller,
  call: OperatorCall,
  output: NodeJS.WritableStream,
): Promise<boolean> {
  if (STDIN_ONLY_METHODS.has(call.method)) {
    output.write(`${stdinOnlyUsage(call.method).message}\n`);
    return false;
  }
  try {
    const result = await caller.call(call.method, call.params);
    output.write(`${result === undefined ? "ok" : JSON.stringify(result, null, 2)}\n`);
    return true;
  } catch (error) {
    output.write(`[${errorLabel(error)}] ${reason(error)}\n`);
    return false;
  }
}

function stdinOnlyUsage(method: string): Extract<OperatorCallResult, { kind: "usage" }> {
  return {
    kind: "usage",
    message: `${method} accepts secret values only through \`taki secret set\` stdin`,
  };
}

// App refusals ride -32000 with the machine-readable ErrorCode in error.data.code, so prefer that over the
// envelope number; anything that is not a JSON-RPC error is a transport/local failure.
function errorLabel(error: unknown): string {
  if (!(error instanceof JSONRPCErrorException)) return "request failed";
  const data: unknown = error.data;
  if (typeof data === "object" && data !== null && "code" in data) {
    const code = (data as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return String(error.code);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
