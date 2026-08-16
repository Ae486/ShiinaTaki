/**
 * INPUT:  Core Database wrapper plus validated desired-state MCP server mutations (config carries opaque
 *         `secret-ref:` markers ONLY — never values) and the legacy mcp-servers.json seed path
 * OUTPUT: createMcpDesiredRepo(db, { ownerHostId, now? }) — plane-1 CRUD with transactional per-row
 *         optimistic configRevision writes; seedFromLegacyFile imports ONLY when the table is empty AND the
 *         secret migration has already rewritten every plaintext value to markers (governance-repo exemplar)
 * POS:    core/mcp — the sole durable desired-state writer; runtime generations are NEVER persisted here
 */
import {
  McpDesiredServerSchema,
  McpServerConfigSchema,
  McpServerIdSchema,
  type McpDesiredServer,
  type McpServerConfig,
} from "@taki/shared";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Database, SqlStatement } from "../db/sqlite.ts";
import type { Logger } from "../logging/logger.ts";
import { parseMcpServers } from "./mcp-config.ts";
import { MCP_SECRET_REF_MARKER } from "@taki/shared";

/** Mirrors PolicyConflictError: the row's revision moved on; the error carries the current one for refetch+retry. */
export class McpConfigConflictError extends Error {
  readonly currentConfigRevision: number;
  constructor(currentConfigRevision: number) {
    super(`mcp desired config revision conflict; current revision is ${currentConfigRevision}`);
    this.name = "McpConfigConflictError";
    this.currentConfigRevision = currentConfigRevision;
  }
}

export type McpLegacySeedOutcome =
  | { status: "seeded"; servers: number }
  | { status: "skipped"; reason: "table-not-empty" | "no-config" | "not-migrated" };

export interface McpDesiredWrite {
  serverId: string;
  config: McpServerConfig;
  selectedTools: string[];
}

export interface McpDesiredRepo {
  list(): McpDesiredServer[];
  get(serverId: string): McpDesiredServer | null;
  add(input: McpDesiredWrite & { enabled: boolean }): McpDesiredServer;
  edit(input: McpDesiredWrite & { expectedConfigRevision: number }): McpDesiredServer;
  setEnabled(input: { serverId: string; enabled: boolean; expectedConfigRevision: number }): McpDesiredServer;
  remove(input: { serverId: string; expectedConfigRevision: number }): void;
  /** Legacy seed: reads mcp-servers.json ONCE when the table is empty, after the secret migration rewrote it. */
  seedFromLegacyFile(filePath: string, log: Logger): McpLegacySeedOutcome;
}

const RowSchema = z.object({
  server_id: z.string(),
  owner_host_id: z.string(),
  config: z.string(),
  enabled: z.number(),
  selected_tools: z.string(),
  config_revision: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

interface RepoStatements {
  list: SqlStatement;
  get: SqlStatement;
  count: SqlStatement;
  insert: SqlStatement;
  updateConfig: SqlStatement;
  updateEnabled: SqlStatement;
  delete: SqlStatement;
  readRevision: SqlStatement;
}

export function createMcpDesiredRepo(db: Database, deps: { ownerHostId: string; now?: () => string }): McpDesiredRepo {
  const statements: RepoStatements = {
    list: db.prepare(`${SELECT_ALL}${ORDER_BY}`),
    get: db.prepare(`${SELECT_ALL} WHERE server_id = :serverId${ORDER_BY}`),
    count: db.prepare("SELECT COUNT(*) AS n FROM mcp_desired_servers"),
    insert: db.prepare(
      "INSERT INTO mcp_desired_servers (server_id, owner_host_id, config, enabled, selected_tools, config_revision, created_at, updated_at) VALUES (:serverId, :ownerHostId, :config, :enabled, :selectedTools, 1, :at, :at)",
    ),
    updateConfig: db.prepare(
      "UPDATE mcp_desired_servers SET config = :config, selected_tools = :selectedTools, config_revision = config_revision + 1, updated_at = :at WHERE server_id = :serverId",
    ),
    updateEnabled: db.prepare(
      "UPDATE mcp_desired_servers SET enabled = :enabled, config_revision = config_revision + 1, updated_at = :at WHERE server_id = :serverId",
    ),
    delete: db.prepare("DELETE FROM mcp_desired_servers WHERE server_id = :serverId"),
    readRevision: db.prepare("SELECT config_revision FROM mcp_desired_servers WHERE server_id = :serverId"),
  };
  const context = { db, statements, ownerHostId: deps.ownerHostId, now: deps.now ?? (() => new Date().toISOString()) };
  return {
    list: () => statements.list.all().map(readRow),
    get: (serverId) => readOne(statements, serverId),
    add: (input) => addServer(context, input),
    edit: (input) => editServer(context, input),
    setEnabled: (input) => setServerEnabled(context, input),
    remove: (input) => removeServer(context, input),
    seedFromLegacyFile: (filePath, log) => seedLegacy(db, statements, { filePath, ownerHostId: context.ownerHostId, now: context.now, log }),
  };
}

const SELECT_ALL = "SELECT server_id, owner_host_id, config, enabled, selected_tools, config_revision, created_at, updated_at FROM mcp_desired_servers";
const ORDER_BY = " ORDER BY server_id";

interface RepoContext {
  db: Database;
  statements: RepoStatements;
  ownerHostId: string;
  now: () => string;
}

/** zod-parse rows at the boundary where shape matters (db guideline): corrupt rows fail visibly. */
function readRow(raw: unknown): McpDesiredServer {
  const row = RowSchema.parse(raw);
  return McpDesiredServerSchema.parse({
    serverId: row.server_id,
    ownerHostId: row.owner_host_id,
    config: McpServerConfigSchema.parse(JSON.parse(row.config)),
    enabled: row.enabled === 1,
    selectedTools: JSON.parse(row.selected_tools) as string[],
    configRevision: row.config_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function readOne(statements: RepoStatements, serverId: string): McpDesiredServer | null {
  const raw = statements.get.get({ serverId });
  return raw === undefined ? null : readRow(raw);
}

function addServer(context: RepoContext, input: McpDesiredWrite & { enabled: boolean }): McpDesiredServer {
  context.db.transaction(() =>
    context.statements.insert.run({ ...configRow(input, context.now()), ownerHostId: context.ownerHostId, enabled: input.enabled ? 1 : 0 }));
  return readOne(context.statements, input.serverId) ?? unreachable(input.serverId);
}

function editServer(context: RepoContext, input: McpDesiredWrite & { expectedConfigRevision: number }): McpDesiredServer {
  mutateRow(context, input, () => context.statements.updateConfig.run(configRow(input, context.now())));
  return readOne(context.statements, input.serverId) ?? unreachable(input.serverId);
}

function setServerEnabled(context: RepoContext, input: { serverId: string; enabled: boolean; expectedConfigRevision: number }): McpDesiredServer {
  mutateRow(context, input, () =>
    context.statements.updateEnabled.run({ serverId: input.serverId, enabled: input.enabled ? 1 : 0, at: context.now() }));
  return readOne(context.statements, input.serverId) ?? unreachable(input.serverId);
}

function removeServer(context: RepoContext, input: { serverId: string; expectedConfigRevision: number }): void {
  mutateRow(context, input, () => context.statements.delete.run({ serverId: input.serverId }));
}

// node:sqlite rejects named params the statement does not bind, so each statement gets exactly its own object.
function configRow(input: McpDesiredWrite, at: string) {
  return { serverId: input.serverId, config: JSON.stringify(input.config), selectedTools: JSON.stringify(input.selectedTools), at };
}

/** One synchronous transaction: compare expected revision → write → increment (the POLICY_CONFLICT exemplar). */
function mutateRow(context: RepoContext, input: { serverId: string; expectedConfigRevision: number }, change: () => void): void {
  context.db.transaction(() => {
    const row = context.statements.readRevision.get({ serverId: input.serverId });
    if (row === undefined) throw new McpConfigConflictError(0); // removed concurrently: revision 0 cannot be retried
    const current = z.number().int().positive().parse(row.config_revision);
    if (current !== input.expectedConfigRevision) throw new McpConfigConflictError(current);
    change();
  });
}

function unreachable(serverId: string): never {
  throw new Error(`mcp desired row ${serverId} vanished after its own write`);
}

/**
 * The legacy file is a seed-only input: imported exactly once, only while the table is empty, only AFTER the
 * secret migration rewrote every plaintext env/header value to opaque refs. A still-plaintext file (typically a
 * locked catalog at this boot) aborts the WHOLE import so a later successful migration can retry it; an entry
 * whose key cannot be a stable server id is skipped permanently with a warn naming the key.
 */
function seedLegacy(
  db: Database,
  statements: Pick<RepoStatements, "count" | "insert">,
  deps: { filePath: string; ownerHostId: string; now: () => string; log: Logger },
): McpLegacySeedOutcome {
  if (Number(statements.count.get()?.n ?? 0) > 0) return { status: "skipped", reason: "table-not-empty" };
  const raw = readFile(deps.filePath, deps.log);
  if (raw === null) return { status: "skipped", reason: "no-config" };
  const parsed = parseMcpServers(raw);
  if (!parsed.ok) return { status: "skipped", reason: "no-config" };

  const rows: Array<Record<string, string | number>> = [];
  for (const [key, config] of Object.entries(parsed.servers)) {
    if (!McpServerIdSchema.safeParse(key).success) {
      deps.log.warn({ key }, "legacy mcp server key is not a stable server id; not seeded (rename the key to import it)");
      continue;
    }
    if (carriesPlaintext(config)) {
      deps.log.warn("legacy mcp config still carries unmigrated plaintext values; seed deferred to the next boot");
      return { status: "skipped", reason: "not-migrated" };
    }
    rows.push({ ...configRow({ serverId: key, config, selectedTools: [] }, deps.now()), ownerHostId: deps.ownerHostId, enabled: 1 });
  }
  if (rows.length === 0) return { status: "skipped", reason: "no-config" };
  db.transaction(() => {
    for (const row of rows) statements.insert.run(row);
  });
  deps.log.info({ servers: rows.length }, "legacy mcp-servers.json seeded into desired state (seed-only; the file is no longer authoritative)");
  return { status: "seeded", servers: rows.length };
}

function carriesPlaintext(config: McpServerConfig): boolean {
  const map = "command" in config ? config.env : config.headers;
  return map !== undefined && Object.values(map).some((value) => !value.startsWith(MCP_SECRET_REF_MARKER));
}

function readFile(filePath: string, log: Logger): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    log.info("no legacy mcp-servers.json to seed"); // a missing file is a normal empty state, never fatal
    return null;
  }
}
