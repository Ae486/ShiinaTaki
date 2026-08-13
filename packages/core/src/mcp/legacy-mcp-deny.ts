/**
 * INPUT:  the legacy mcp-approvals.json path plus a logger
 * OUTPUT: createLegacyMcpDenyReader(...).denies(serverName, toolName) — read-only deny compatibility
 * POS:    core/mcp — Slice-3 migration adapter; missing is empty, allows are inert, corrupt/ambiguous state fails closed
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Logger } from "../logging/logger.ts";

const LegacyDecisionSchema = z.strictObject({
  serverName: z.string().min(1),
  toolName: z.string().min(1),
  decision: z.enum(["always", "never"]),
  decidedAt: z.string().min(1),
});
const LegacyDecisionFileSchema = z.strictObject({ approvals: z.array(LegacyDecisionSchema) });

type LegacyConstraint = "never" | "ambiguous";

export interface LegacyMcpDenyReader {
  /** Exact raw server/tool lookup. `true` only tightens governance and never authorizes execution. */
  denies(serverName: string, toolName: string): boolean;
}

export function createLegacyMcpDenyReader(deps: { filePath: string; logger: Logger }): LegacyMcpDenyReader {
  const loaded = loadLegacyConstraints(deps.filePath, deps.logger.child({ mod: "mcp-legacy-deny" }));
  return {
    denies(serverName, toolName) {
      if (loaded.closed) return true;
      return loaded.constraints.has(key(serverName, toolName));
    },
  };
}

type LoadedConstraints =
  | { closed: true; constraints: ReadonlyMap<string, LegacyConstraint> }
  | { closed: false; constraints: ReadonlyMap<string, LegacyConstraint> };

function loadLegacyConstraints(filePath: string, log: Logger): LoadedConstraints {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { closed: false, constraints: new Map() };
    log.warn({ code: "LEGACY_MCP_DECISIONS_UNREADABLE" }, "legacy MCP decisions unavailable; MCP calls fail closed");
    return { closed: true, constraints: new Map() };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn({ code: "LEGACY_MCP_DECISIONS_INVALID_JSON" }, "legacy MCP decisions invalid; MCP calls fail closed");
    return { closed: true, constraints: new Map() };
  }
  const result = LegacyDecisionFileSchema.safeParse(parsed);
  if (!result.success) {
    log.warn(
      { code: "LEGACY_MCP_DECISIONS_MALFORMED", issues: result.error.issues.length },
      "legacy MCP decisions malformed; MCP calls fail closed",
    );
    return { closed: true, constraints: new Map() };
  }

  const constraints = new Map<string, LegacyConstraint>();
  const seen = new Set<string>();
  let ambiguous = 0;
  for (const entry of result.data.approvals) {
    const decisionKey = key(entry.serverName, entry.toolName);
    if (seen.has(decisionKey)) {
      constraints.set(decisionKey, "ambiguous");
      ambiguous += 1;
      continue;
    }
    seen.add(decisionKey);
    if (entry.decision === "never") constraints.set(decisionKey, "never");
  }
  if (ambiguous > 0) {
    log.warn(
      { code: "LEGACY_MCP_DECISIONS_AMBIGUOUS", count: ambiguous },
      "ambiguous legacy MCP decisions fail closed for affected tools",
    );
  }
  return { closed: false, constraints };
}

function key(serverName: string, toolName: string): string {
  return JSON.stringify([serverName, toolName]);
}
