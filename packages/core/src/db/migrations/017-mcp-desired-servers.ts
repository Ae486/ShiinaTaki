/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: mcpDesiredServersMigration017 — the Core-authoritative desired MCP server rows (plane 1)
 * POS:    core/db/migrations — migration 17; sanitized desired state only: transport config JSON may carry opaque
 *         `secret-ref:` markers but NEVER a secret value (values live exclusively in the encrypted catalog)
 */
import type { Migration } from "../migration-runner.ts";

export const mcpDesiredServersMigration017: Migration = {
  version: 17,
  sql: `
    CREATE TABLE mcp_desired_servers (
      server_id       TEXT PRIMARY KEY,
      owner_host_id   TEXT NOT NULL,
      config          TEXT NOT NULL,
      enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      selected_tools  TEXT NOT NULL,
      config_revision INTEGER NOT NULL CHECK (config_revision > 0),
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    ) STRICT;
  `,
};
