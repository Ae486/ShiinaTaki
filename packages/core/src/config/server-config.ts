/**
 * INPUT:  process env (TAKI_WS_HOST / _PORT / TAKI_LOG_LEVEL / TAKI_DATA_DIR)
 * OUTPUT: loadServerConfig(env) -> { host, port, logLevel, dataDir } with defaults from ws-defaults + homedir
 * POS:    core/config — boot-time WS + logging + data-root config (OS-neutral paths, invariant 8)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from "@taki/shared";

/** pino log levels, high to low severity. */
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

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
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type LogLevel = ServerConfig["logLevel"];

export function loadServerConfig(env: Record<string, string | undefined>): ServerConfig {
  return ServerConfigSchema.parse({
    host: env.TAKI_WS_HOST,
    port: env.TAKI_WS_PORT,
    logLevel: env.TAKI_LOG_LEVEL,
    dataDir: env.TAKI_DATA_DIR,
  });
}
