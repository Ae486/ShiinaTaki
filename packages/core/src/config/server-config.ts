/**
 * INPUT:  process env (TAKI_WS_HOST / _PORT / TAKI_LOG_LEVEL / TAKI_DATA_DIR / TAKI_PROMPT_DIR)
 * OUTPUT: loadServerConfig(env) -> { host, port, logLevel, dataDir, promptDir } with defaults from ws-defaults + homedir
 * POS:    core/config — boot-time WS + logging + data-root + prompt-dir config (OS-neutral paths, invariant 8)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from "@taki/shared";

/** pino log levels, high to low severity. */
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

// The prompt/ library lives at the repo root (prompt/README.md); resolve it relative to this file so the dev default
// is OS-neutral (no hardcoded separators / %USERPROFILE%, invariant 8). Production overrides via TAKI_PROMPT_DIR
// (the Workspace-seeded, user-editable copy). config/ -> src -> core -> packages -> repo root -> prompt/.
const DEFAULT_PROMPT_DIR = fileURLToPath(new URL("../../../../prompt/", import.meta.url));

export const ServerConfigSchema = z.object({
  host: z
    .string()
    .min(1)
    // No remote auth story yet: never a wildcard bind (PRD: loopback only until TLS/WSS, ADR 0004).
    .refine((host) => host !== "0.0.0.0" && host !== "::", { message: "wildcard binds are not allowed" })
    .default(DEFAULT_WS_HOST),
  port: z.coerce.number().int().min(1).max(65535).default(DEFAULT_WS_PORT),
  logLevel: z.enum(LOG_LEVELS).default("info"),
  // App data root for core-owned state (device store, later db/); OS-neutral default under the home dir.
  dataDir: z.string().min(1).default(join(homedir(), ".takiagent")),
  // Prompt-card library root: <promptDir>/system/assistant-layer.md + <promptDir>/characters/<id>/persona.md (#16).
  promptDir: z.string().min(1).default(DEFAULT_PROMPT_DIR),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type LogLevel = ServerConfig["logLevel"];

export function loadServerConfig(env: Record<string, string | undefined>): ServerConfig {
  return ServerConfigSchema.parse({
    host: env.TAKI_WS_HOST,
    port: env.TAKI_WS_PORT,
    logLevel: env.TAKI_LOG_LEVEL,
    dataDir: env.TAKI_DATA_DIR,
    promptDir: env.TAKI_PROMPT_DIR,
  });
}
