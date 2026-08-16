/**
 * INPUT:  one desired server (sanitized config with `secret-ref:` markers, selected tools) + connect/resolve
 *         seams + one bounded deadline (AbortSignal)
 * OUTPUT: prepareCandidate(deps) -> PreparedCandidate — the frozen candidate body: JIT secret resolution ->
 *         connect -> locally paginated tools/list under one deadline -> schema-compat preparation -> selected-tool
 *         filter -> namespaced closures; close-on-failure is guaranteed (the caller owns a successful client)
 * POS:    core/mcp — a candidate NEVER publishes by itself; `test` is this body with diagnostics-only output
 */
import type { Tool, ToolSet } from "ai";
import type {
  McpCandidateFailureReason,
  McpServerConfig,
  McpToolKeyCollision,
  McpToolSkipIssue,
} from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import type { McpServerEntry } from "./mcp-config.ts";
import type { McpClient, McpConnect } from "./mcp-connect.ts";
import { prepareMcpToolDefinitions } from "./mcp-schema-compat.ts";
import { resolveMcpConfigSecrets } from "../secrets/secret-ref.ts";
import { publicConfigFingerprint, readableError, sanitizeKey, stableSubjectId, wrapExecute, type McpToolRef } from "./mcp-tool-identity.ts";

export class McpCandidateError extends Error {
  readonly reason: McpCandidateFailureReason;
  readonly collisions?: McpToolKeyCollision[];
  constructor(reason: McpCandidateFailureReason, message: string, collisions?: McpToolKeyCollision[]) {
    super(message);
    this.name = "McpCandidateError";
    this.reason = reason;
    this.collisions = collisions;
  }
}

export interface PreparedCandidate {
  client: McpClient;
  tools: ToolSet;
  refs: Map<string, McpToolRef>;
  skipped: McpToolSkipIssue[];
  pages: number;
  durationMs: number;
}

export interface PrepareCandidateDeps {
  serverId: string;
  config: McpServerConfig;
  selectedTools: string[];
  connect: McpConnect;
  /** Catalog resolution for `secret-ref:` markers (just-in-time, connect-time only). */
  resolveSecret?: (ref: string) => string | null;
  log: Logger;
  /** One bounded deadline covering connect + every listing page (the SDK does not paginate or bound this itself). */
  signal?: AbortSignal;
  deadlineMs: number;
}

/**
 * The SDK's listTools issues ONE tools/list request and never follows nextCursor (verified against
 * @ai-sdk/mcp@2.0.10 dist). This loop paginates locally under the single candidate deadline.
 */
async function listAllTools(client: McpClient, signal: AbortSignal | undefined): Promise<{ tools: unknown[]; pages: number }> {
  const tools: unknown[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await client.listTools({ params: cursor === undefined ? undefined : { cursor }, options: signal ? { signal } : undefined });
    pages += 1;
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return { tools, pages };
}

export async function prepareCandidate(deps: PrepareCandidateDeps): Promise<PreparedCandidate> {
  const startedAt = Date.now();
  const entry: McpServerEntry = { key: deps.serverId, config: deps.config };
  let cancelDeadline: () => void = () => undefined;
  const deadline = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new McpCandidateError("deadline-exceeded", `candidate exceeded ${deps.deadlineMs}ms deadline`)),
      deps.deadlineMs,
    );
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new McpCandidateError("deadline-exceeded", "candidate aborted (manager shutdown)"));
    };
    deps.signal?.addEventListener("abort", onAbort, { once: true });
    cancelDeadline = (): void => {
      clearTimeout(timer);
      deps.signal?.removeEventListener("abort", onAbort);
    };
  });
  try {
    return await Promise.race([candidateSteps(deps, entry, startedAt), deadline]);
  } finally {
    cancelDeadline(); // the winner settled the race: stop the losing timer/watcher
  }
}

/** The candidate body without its deadline wrapper: resolve -> connect -> list -> prepare -> closures. */
async function candidateSteps(deps: PrepareCandidateDeps, entry: McpServerEntry, startedAt: number): Promise<PreparedCandidate> {
  const resolved = resolveEntry(deps, entry);
  const client = await connectEntry(deps, resolved);
  try {
    const listed = await listEntryTools(deps, client);
    return buildFromListing({ deps, client, listed, startedAt });
  } catch (error) {
    await client.close().catch(() => undefined); // no zombie transport if preparation fails post-connect
    throw error;
  }
}

/** Secrets resolve ONLY here — immediately before connect/spawn, never into config, logs, or cached state. */
function resolveEntry(deps: PrepareCandidateDeps, entry: McpServerEntry): McpServerEntry {
  if (!deps.resolveSecret) return entry;
  try {
    return { key: entry.key, config: resolveMcpConfigSecrets(entry.config, deps.resolveSecret) };
  } catch (error) {
    // resolveMcpConfigSecrets throws with the OPAQUE ref only; the message is safe by construction.
    throw new McpCandidateError("secret-unresolvable", error instanceof Error ? error.message : String(error));
  }
}

async function connectEntry(deps: PrepareCandidateDeps, entry: McpServerEntry): Promise<McpClient> {
  try {
    return await deps.connect(entry);
  } catch (error) {
    throw new McpCandidateError("connect-failed", error instanceof Error ? error.message : String(error));
  }
}

async function listEntryTools(deps: PrepareCandidateDeps, client: McpClient): Promise<{ tools: unknown[]; pages: number }> {
  try {
    return await listAllTools(client, deps.signal);
  } catch (error) {
    if (error instanceof McpCandidateError) throw error;
    throw new McpCandidateError("tools-list-failed", error instanceof Error ? error.message : String(error));
  }
}

function buildFromListing(input: {
  deps: PrepareCandidateDeps;
  client: McpClient;
  listed: { tools: unknown[]; pages: number };
  startedAt: number;
}): PreparedCandidate {
  const { deps } = input;
  const prepared = prepareMcpToolDefinitions({ tools: input.listed.tools as never });
  for (const skip of prepared.skipped) {
    // Only server/toolName/code/path — never schema bodies, descriptions, config, or secrets.
    deps.log.warn({ server: deps.serverId, ...skip }, "mcp tool schema incompatible; skipped");
  }
  const selected = applySelectedTools(prepared.definitions.tools as Array<{ name: string }>, deps.selectedTools);
  return buildClosures({
    serverId: deps.serverId,
    config: deps.config,
    client: input.client,
    definitions: { ...prepared.definitions, tools: selected.definitions as never },
    skipped: prepared.skipped,
    pages: input.listed.pages,
    durationMs: Date.now() - input.startedAt,
  });
}

function applySelectedTools(definitions: Array<{ name: string }>, selectedTools: string[]): { definitions: Array<{ name: string }> } {
  if (selectedTools.length === 0) return { definitions };
  const selected = new Set(selectedTools);
  return { definitions: definitions.filter((definition) => selected.has(definition.name)) };
}

// Namespace each tool as `${sanitizedKey}_${toolName}` (renaming the key is safe — execute closes over the raw
// name). A duplicate key inside ONE candidate means the server listed colliding raw names: fail the whole
// candidate closed rather than binding one presentation key to ambiguous authority.
function buildClosures(input: {
  serverId: string;
  config: McpServerConfig;
  client: McpClient;
  definitions: Parameters<McpClient["toolsFromDefinitions"]>[0];
  skipped: McpToolSkipIssue[];
  pages: number;
  durationMs: number;
}): PreparedCandidate {
  const prefix = sanitizeKey(input.serverId);
  const revision = publicConfigFingerprint(input.config);
  const built = input.client.toolsFromDefinitions(input.definitions) as unknown as Record<string, Tool>;
  const tools: ToolSet = {};
  const refs = new Map<string, McpToolRef>();
  for (const [toolName, tool] of Object.entries(built)) {
    const key = `${prefix}_${toolName}`;
    if (key in tools) {
      throw new McpCandidateError("tool-key-collision", `server ${input.serverId} lists colliding tool names for key ${key}`, [
        { key, existingServerId: input.serverId, existingToolName: refs.get(key)?.toolName ?? "", candidateToolName: toolName },
      ]);
    }
    refs.set(key, {
      serverName: input.serverId,
      toolName,
      subjectId: stableSubjectId(input.serverId, toolName),
      subjectRevision: revision,
    });
    tools[key] = wrapExecute(tool);
  }
  return { client: input.client, tools, refs, skipped: input.skipped, pages: input.pages, durationMs: input.durationMs };
}

/** Bounded sanitized failure facts for outcomes/logs: reason + message capped to the shared schema's 512. */
export function sanitizeCandidateFailure(error: unknown): { reason: McpCandidateFailureReason; message: string; boundedMessage: string } {
  const reason = error instanceof McpCandidateError ? error.reason : "connect-failed";
  const message = error instanceof McpCandidateError ? error.message : readableError(error);
  return { reason, message, boundedMessage: message.length <= 512 ? message : `${message.slice(0, 509)}...` };
}
