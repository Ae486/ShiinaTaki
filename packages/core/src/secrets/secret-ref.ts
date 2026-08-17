/**
 * INPUT:  MCP server config values (marker-prefixed strings) + a catalog resolver; serverKey/kind/field names
 * OUTPUT: stable opaque ref derivation/enumeration + resolveMcpConfigSecrets (just-in-time value resolution)
 * POS:    core/secrets — the only place refs are derived and the only place the `secret-ref:` marker is parsed;
 *         refs are opaque and log-safe, resolved values never leave this seam except into the transport config
 */
import type { McpServerConfig } from "../mcp/mcp-config.ts";
import { MCP_SECRET_REF_MARKER } from "@taki/shared";

/** Marker prefix in mcp-servers.json env/header values naming a catalog ref instead of a plaintext value. */
export const SECRET_REF_MARKER = MCP_SECRET_REF_MARKER;

/** Same charset fold as the mcp-manager tool-key sanitizer — collision is guarded by the migration, not assumed. */
export function sanitizeRefSegment(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function mcpEnvRef(serverKey: string, envName: string): string {
  return `mcp.${sanitizeRefSegment(serverKey)}.env.${sanitizeRefSegment(envName)}`;
}

export function mcpHeaderRef(serverKey: string, headerName: string): string {
  return `mcp.${sanitizeRefSegment(serverKey)}.header.${sanitizeRefSegment(headerName)}`;
}

/** The ref when the value is a marker, else null (a plain value stays a plain value). */
export function parseSecretRefValue(value: string): string | null {
  return value.startsWith(SECRET_REF_MARKER) ? value.slice(SECRET_REF_MARKER.length) : null;
}

/** Capture refs at candidate time so later desired edits cannot hide a credential used by a live generation. */
export function mcpConfigSecretRefs(config: McpServerConfig): ReadonlySet<string> {
  const map = "command" in config ? config.env : config.headers;
  const refs = new Set<string>();
  for (const value of Object.values(map ?? {})) {
    const ref = parseSecretRefValue(value);
    if (ref !== null) refs.add(ref);
  }
  return refs;
}

/**
 * Resolve every marker in a server config just before connect/spawn. A ref the catalog cannot resolve (locked or
 * absent) throws with the OPAQUE ref only — the caller fails that one server; no value, partial env, or fallback
 * plaintext is ever produced.
 */
export function resolveMcpConfigSecrets(config: McpServerConfig, resolve: (ref: string) => string | null): McpServerConfig {
  if ("command" in config) {
    return { ...config, env: resolveMap(config.env, resolve) };
  }
  return { ...config, headers: resolveMap(config.headers, resolve) };
}

function resolveMap(map: Record<string, string> | undefined, resolve: (ref: string) => string | null): Record<string, string> | undefined {
  if (map === undefined) return undefined;
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(map)) {
    const ref = parseSecretRefValue(value);
    if (ref === null) {
      resolved[name] = value;
      continue;
    }
    const secret = resolve(ref);
    if (secret === null) throw new Error(`secret ${ref} is not resolvable (catalog locked or missing)`);
    resolved[name] = secret;
  }
  return resolved;
}
