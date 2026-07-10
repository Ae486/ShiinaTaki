/**
 * INPUT:  the mcp-approvals.json path under the app data root + an ApprovalOutcome to remember
 * OUTPUT: createDecisionStore(deps) -> { get, remember } — persisted always/never + in-memory session decisions
 * POS:    core/approval — decision memory for the MCP gate; deny+always == never (ruling 4). Malformed file -> warn+empty
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Logger } from "../logging/logger.ts";
import type { ApprovalOutcome } from "./approval-broker.ts";

/** A remembered verdict: skip the ask and auto-approve (always) or auto-deny (never). */
export type Decision = "always" | "never";

const PersistedDecisionSchema = z.object({
  serverName: z.string().min(1),
  toolName: z.string().min(1),
  decision: z.enum(["always", "never"]),
  decidedAt: z.string().min(1),
});
const DecisionFileSchema = z.object({ approvals: z.array(PersistedDecisionSchema) });
type PersistedDecision = z.infer<typeof PersistedDecisionSchema>;

export interface DecisionStore {
  /** A remembered decision for this server+tool (persisted `always`/`never`, else session), or undefined. */
  get(serverName: string, toolName: string): Decision | undefined;
  /** Records the outcome per scope: once -> nothing, session -> memory, always -> persisted (approve->always, deny->never). */
  remember(serverName: string, toolName: string, outcome: ApprovalOutcome): void;
}

export function createDecisionStore(deps: { filePath: string; logger: Logger }): DecisionStore {
  const log = deps.logger.child({ mod: "approval" });
  const persisted = loadPersisted(deps.filePath, log); // key -> PersistedDecision
  const session = new Map<string, Decision>();

  return {
    get(serverName, toolName) {
      const k = key(serverName, toolName);
      return persisted.get(k)?.decision ?? session.get(k);
    },
    remember(serverName, toolName, outcome) {
      if (outcome.scope === "once") return; // deliberately not remembered
      const decision: Decision = outcome.approved ? "always" : "never"; // deny+persist == never (ruling 4)
      const k = key(serverName, toolName);
      if (outcome.scope === "session") {
        session.set(k, decision);
        return;
      }
      persisted.set(k, { serverName, toolName, decision, decidedAt: new Date().toISOString() });
      persist(deps.filePath, persisted);
    },
  };
}

function key(serverName: string, toolName: string): string {
  // Tuple-encoded so a server-controlled toolName can never collide across servers (e.g. ("a","b/c") vs ("a/b","c")).
  return JSON.stringify([serverName, toolName]);
}

// Approvals are re-askable, not auth state: a missing file is empty, and a corrupt file is a WARNING + empty
// (contrast the paired-device store, which is fatal on corruption). Worst case the operator is asked again.
function loadPersisted(filePath: string, log: Logger): Map<string, PersistedDecision> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    log.warn({ filePath, err: readable(error) }, "approvals file unreadable; starting with no remembered decisions");
    return new Map();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn({ filePath }, "approvals file is not valid JSON; starting with no remembered decisions");
    return new Map();
  }
  const result = DecisionFileSchema.safeParse(parsed);
  if (!result.success) {
    log.warn({ filePath }, "approvals file is malformed; starting with no remembered decisions");
    return new Map();
  }
  return new Map(result.data.approvals.map((entry) => [key(entry.serverName, entry.toolName), entry]));
}

function persist(filePath: string, decisions: Map<string, PersistedDecision>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const approvals = [...decisions.values()];
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify({ approvals } satisfies z.infer<typeof DecisionFileSchema>, null, 2));
  renameSync(tempPath, filePath);
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
