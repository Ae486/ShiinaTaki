/**
 * INPUT: legacy mcp-servers.json plaintext fields and the secret catalog
 * OUTPUT: reserve identities, copy and verify values, then atomically rewrite opaque secret-ref markers
 * POS: core/secrets AC4 ordering owner; failures preserve source bytes and .env.local is never touched
 */
import { readFileSync } from "node:fs";
import type { Logger } from "../logging/logger.ts";
import { parseMcpServers, type McpServerConfig } from "../mcp/mcp-config.ts";
import { publishFileAtomically } from "./catalog-publication.ts";
import { SECRET_REF_MARKER, mcpEnvRef, mcpHeaderRef, parseSecretRefValue } from "./secret-ref.ts";
import type { SecretCatalogHealth } from "./secret-catalog-service.ts";

/** The catalog surface the migration needs — structural, so tests can drive failure orderings with a stub. */
export interface MigrationCatalogView {
  health(): SecretCatalogHealth;
  set(secretRef: string, value: string): unknown;
  verifyEntries(expected: Record<string, string>): boolean;
}

export type McpSkipReason =
  | "no-config"
  | "nothing-to-migrate"
  | `store-${"locked" | "unreadable" | "unsupported"}`
  | "collision"
  | "verify-failed"
  | "write-failed";

export type McpSecretMigrationOutcome = { status: "migrated"; secrets: number; servers: number } | { status: "skipped"; reason: McpSkipReason };

export function migrateMcpPlaintextSecrets(deps: {
  catalog: MigrationCatalogView;
  configPath: string;
  logger: Logger;
}): McpSecretMigrationOutcome {
  const health = deps.catalog.health();
  if (health !== "ok") {
    // Locked/unreadable store: values stay where they are — plaintext degradation is preserved, never destroyed.
    deps.logger.warn({ health }, "secret migration skipped: catalog not readable; plaintext source untouched");
    return { status: "skipped", reason: `store-${health}` };
  }

  let raw: string;
  try {
    raw = readFileSync(deps.configPath, "utf8");
  } catch {
    return { status: "skipped", reason: "no-config" };
  }
  const parsed = parseMcpServers(raw);
  if (!parsed.ok) {
    deps.logger.warn("secret migration skipped: mcp config unparsable; source untouched");
    return { status: "skipped", reason: "no-config" };
  }

  const plan = planMigration(parsed.servers);
  if (plan.kind === "collision") {
    deps.logger.warn("secret migration skipped: sanitized ref collision; rename the conflicting server key");
    return { status: "skipped", reason: "collision" };
  }
  if (plan.entries.length === 0) return { status: "skipped", reason: "nothing-to-migrate" };

  // Steps 1+2 — COPY into the catalog, then VERIFY the encrypted read-back, BEFORE any source rewrite (PRD AC4).
  const copied = copyAndVerify(deps, plan.entries);
  if (copied !== null) return { status: "skipped", reason: copied };

  // Step 3 — rewrite the source to opaque references (staged + fsync + rename; same discipline as the catalog).
  const rewritten = applyPlan(parsed.servers, plan.entries);
  try {
    publishFileAtomically(deps.configPath, new TextEncoder().encode(`${JSON.stringify(rewritten, null, 2)}\n`), "replace");
  } catch {
    deps.logger.warn("secret migration source rewrite failed; source untouched");
    return { status: "skipped", reason: "write-failed" };
  }
  const servers = new Set(plan.entries.map((entry) => entry.serverKey)).size;
  deps.logger.info({ secrets: plan.entries.length, servers }, "mcp plaintext secrets migrated to catalog");
  return { status: "migrated", secrets: plan.entries.length, servers };
}

/** Copy every planned value, then prove the encrypted read-back; a non-null return is the skip reason. */
function copyAndVerify(deps: { catalog: MigrationCatalogView; logger: Logger }, entries: PlannedEntry[]): McpSkipReason | null {
  const expected: Record<string, string> = {};
  for (const entry of entries) {
    try {
      deps.catalog.set(entry.ref, entry.value);
      expected[entry.ref] = entry.value;
    } catch (error) {
      deps.logger.warn({ err: error instanceof Error ? error.name : "unknown" }, "secret migration copy failed; source untouched");
      return "write-failed";
    }
  }
  if (!deps.catalog.verifyEntries(expected)) {
    deps.logger.warn("secret migration read-back verification failed; source untouched");
    return "verify-failed";
  }
  return null;
}

interface PlannedEntry {
  serverKey: string;
  kind: "env" | "headers";
  field: string;
  ref: string;
  value: string;
}

function planMigration(servers: Record<string, McpServerConfig>):
  | { kind: "plan"; entries: PlannedEntry[] }
  | { kind: "collision" } {
  const entries: PlannedEntry[] = [];
  const seen = new Map<string, string>(); // ref -> raw identity ("serverKey\u0000kind\u0000field")
  for (const [serverKey, config] of Object.entries(servers)) {
    const maps: Array<{ kind: "env" | "headers"; map: Record<string, string> | undefined }> = [
      { kind: "env", map: "command" in config ? config.env : undefined },
      { kind: "headers", map: "command" in config ? undefined : config.headers },
    ];
    for (const { kind, map } of maps) {
      if (map === undefined) continue;
      for (const [field, value] of Object.entries(map)) {
        const ref = kind === "env" ? mcpEnvRef(serverKey, field) : mcpHeaderRef(serverKey, field);
        const identity = `${serverKey}\u0000${kind}\u0000${field}`;
        const prior = seen.get(ref);
        if (prior !== undefined && prior !== identity) return { kind: "collision" };
        seen.set(ref, identity);
        const markerRef = parseSecretRefValue(value);
        if (markerRef !== null) {
          // An incremental rerun must not let a later plaintext identity claim a ref already owned by this marker.
          if (markerRef !== ref) return { kind: "collision" };
          continue;
        }
        entries.push({ serverKey, kind, field, ref, value });
      }
    }
  }
  return { kind: "plan", entries };
}

function applyPlan(
  servers: Record<string, McpServerConfig>,
  entries: PlannedEntry[],
): Record<string, McpServerConfig> {
  const byRef = new Map(entries.map((entry) => [entry.ref, entry]));
  const rewrite = (map: Record<string, string> | undefined, kind: "env" | "headers", serverKey: string): Record<string, string> | undefined => {
    if (map === undefined) return undefined;
    const next: Record<string, string> = {};
    for (const [field, value] of Object.entries(map)) {
      const ref = kind === "env" ? mcpEnvRef(serverKey, field) : mcpHeaderRef(serverKey, field);
      next[field] = byRef.has(ref) && !value.startsWith(SECRET_REF_MARKER) ? `${SECRET_REF_MARKER}${ref}` : value;
    }
    return next;
  };
  const result: Record<string, McpServerConfig> = {};
  for (const [serverKey, config] of Object.entries(servers)) {
    if ("command" in config) {
      result[serverKey] = { ...config, env: rewrite(config.env, "env", serverKey) };
    } else {
      result[serverKey] = { ...config, headers: rewrite(config.headers, "headers", serverKey) };
    }
  }
  return result;
}
