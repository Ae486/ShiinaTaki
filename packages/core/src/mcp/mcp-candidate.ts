/**
 * INPUT: sanitized desired server, selected tools, connect/resolve seams, and one bounded deadline
 * OUTPUT: JIT-resolved, paginated, schema-prepared candidate with namespaced closures and close-on-failure
 * POS: core/mcp candidate body; never publishes itself and test mode returns diagnostics only
 */
import type { Tool, ToolSet } from "ai";
import type {
  McpCandidateFailureReason,
  McpServerConfig,
  McpToolKeyCollision,
  McpToolSkipIssue,
} from "@taki/shared";
import { MAX_MCP_TOOL_COUNT, McpToolNameSchema } from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import type { McpServerEntry } from "./mcp-config.ts";
import type { McpClient, McpConnect } from "./mcp-connect.ts";
import { closeMcpClient } from "./mcp-client-close.ts";
import { prepareMcpToolDefinitions } from "./mcp-schema-compat.ts";
import { resolveMcpConfigSecrets } from "../secrets/secret-ref.ts";
import { publicConfigFingerprint, sanitizeKey, stableSubjectId, wrapExecute, type McpToolRef } from "./mcp-tool-identity.ts";

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
  configRevision?: number;
  connect: McpConnect;
  /** Catalog resolution for `secret-ref:` markers (just-in-time, connect-time only). */
  resolveSecret?: (ref: string) => string | null;
  log: Logger;
  /** One bounded deadline covering connect + every listing page (the SDK does not paginate or bound this itself). */
  signal?: AbortSignal;
  deadlineMs: number;
  /** Manager shutdown tracks cleanup for work that ignores abort and settles after the public deadline. */
  onLateCleanup?: (cleanup: Promise<void>) => void;
}

/**
 * The SDK's listTools issues ONE tools/list request and never follows nextCursor (verified against
 * @ai-sdk/mcp@2.0.10 dist). This loop paginates locally under the single candidate deadline.
 */
async function listAllTools(client: McpClient, signal: AbortSignal | undefined): Promise<{ tools: unknown[]; pages: number }> {
  const tools: unknown[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await client.listTools({ params: cursor === undefined ? undefined : { cursor }, options: signal ? { signal } : undefined });
    pages += 1;
    tools.push(...page.tools);
    cursor = page.nextCursor;
    if (tools.length > MAX_MCP_TOOL_COUNT || pages > MAX_MCP_TOOL_COUNT) {
      throw new McpCandidateError("tools-list-failed", "server exceeded the bounded MCP tool listing limit");
    }
    if (cursor !== undefined && cursors.has(cursor)) {
      throw new McpCandidateError("tools-list-failed", "server repeated an MCP pagination cursor");
    }
    if (cursor !== undefined) cursors.add(cursor);
  } while (cursor !== undefined);
  return { tools, pages };
}

export async function prepareCandidate(deps: PrepareCandidateDeps): Promise<PreparedCandidate> {
  const startedAt = Date.now();
  const entry: McpServerEntry = { key: deps.serverId, config: deps.config };
  const controller = new AbortController();
  let rejectDeadline: (error: McpCandidateError) => void = () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
    timer = setTimeout(() => {
      controller.abort();
      reject(new McpCandidateError("deadline-exceeded", "MCP candidate deadline exceeded"));
    }, deps.deadlineMs);
  });
  const onAbort = (): void => {
    controller.abort();
    rejectDeadline(new McpCandidateError("deadline-exceeded", "MCP candidate was cancelled"));
  };
  deps.signal?.addEventListener("abort", onAbort, { once: true });
  if (deps.signal?.aborted) onAbort();
  const work = candidateSteps({ ...deps, signal: controller.signal }, entry, startedAt);
  let accepted = false;
  try {
    if (controller.signal.aborted) throw new McpCandidateError("deadline-exceeded", "MCP candidate was cancelled");
    const prepared = await Promise.race([work, deadline]);
    accepted = true;
    return prepared;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onAbort);
    if (!accepted) {
      controller.abort();
      const cleanup = work.then((prepared) => closeMcpClient(prepared.client), () => undefined);
      deps.onLateCleanup?.(cleanup);
      void cleanup;
    }
  }
}

/** The candidate body without its deadline wrapper: resolve -> connect -> list -> prepare -> closures. */
async function candidateSteps(deps: PrepareCandidateDeps, entry: McpServerEntry, startedAt: number): Promise<PreparedCandidate> {
  const resolved = resolveEntry(deps, entry);
  const client = await connectEntry(deps, resolved);
  try {
    if (deps.signal?.aborted) throw new McpCandidateError("deadline-exceeded", "MCP candidate was cancelled");
    const listed = await listEntryTools(deps, client);
    return buildFromListing({ deps, client, listed, startedAt });
  } catch (error) {
    await closeMcpClient(client); // no zombie transport if preparation fails post-connect
    throw error;
  }
}

/** Secrets resolve ONLY here — immediately before connect/spawn, never into config, logs, or cached state. */
function resolveEntry(deps: PrepareCandidateDeps, entry: McpServerEntry): McpServerEntry {
  if (!deps.resolveSecret) return entry;
  try {
    return { key: entry.key, config: resolveMcpConfigSecrets(entry.config, deps.resolveSecret) };
  } catch {
    throw new McpCandidateError("secret-unresolvable", "a referenced MCP secret is unavailable");
  }
}

async function connectEntry(deps: PrepareCandidateDeps, entry: McpServerEntry): Promise<McpClient> {
  try {
    return await deps.connect(entry);
  } catch {
    throw new McpCandidateError("connect-failed", "MCP server connection failed");
  }
}

async function listEntryTools(deps: PrepareCandidateDeps, client: McpClient): Promise<{ tools: unknown[]; pages: number }> {
  try {
    return await listAllTools(client, deps.signal);
  } catch (error) {
    if (error instanceof McpCandidateError) throw error;
    throw new McpCandidateError("tools-list-failed", "MCP tool discovery failed");
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
    configRevision: deps.configRevision,
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
  const filtered = definitions.filter((definition) => selected.has(definition.name));
  const found = new Set(filtered.map((definition) => definition.name));
  if (selectedTools.some((name) => !found.has(name))) {
    throw new McpCandidateError("tools-list-failed", "one or more selected MCP tools are unavailable");
  }
  return { definitions: filtered };
}

// Namespace each tool as `${sanitizedKey}_${toolName}` (renaming the key is safe — execute closes over the raw
// name). A duplicate key inside ONE candidate means the server listed colliding raw names: fail the whole
// candidate closed rather than binding one presentation key to ambiguous authority.
function buildClosures(input: {
  serverId: string;
  config: McpServerConfig;
  configRevision?: number;
  client: McpClient;
  definitions: Parameters<McpClient["toolsFromDefinitions"]>[0];
  skipped: McpToolSkipIssue[];
  pages: number;
  durationMs: number;
}): PreparedCandidate {
  const revision = input.configRevision === undefined
    ? publicConfigFingerprint(input.config)
    : `${publicConfigFingerprint(input.config)}.r${input.configRevision}`;
  const built = input.client.toolsFromDefinitions(input.definitions) as unknown as Record<string, Tool>;
  const tools: ToolSet = {};
  const refs = new Map<string, McpToolRef>();
  for (const [toolName, tool] of Object.entries(built)) {
    if (!McpToolNameSchema.safeParse(toolName).success) {
      throw new McpCandidateError("tools-list-failed", "server returned an invalid MCP tool name");
    }
    const key = sanitizeKey(`${input.serverId}_${toolName}`);
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
  const message = error instanceof McpCandidateError ? error.message : "MCP candidate failed";
  return { reason, message, boundedMessage: message.length <= 512 ? message : `${message.slice(0, 509)}...` };
}
