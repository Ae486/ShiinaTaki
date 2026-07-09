/**
 * INPUT:  process env (TAKI_WS_HOST / _PORT / TAKI_LOG_LEVEL)
 * OUTPUT: loadServerConfig(env) -> { host, port, logLevel } with defaults from ws-defaults
 * POS:    core/config — boot-time WS + logging config
 */
import { z } from "zod";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from "@taki/shared";

/** pino log levels, high to low severity. */
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

export const ServerConfigSchema = z.object({
  host: z
    .string()
    .min(1)
    // No auth exists yet (pairing = #4): never a wildcard bind (PRD: loopback only).
    .refine((host) => host !== "0.0.0.0" && host !== "::", { message: "wildcard binds are not allowed" })
    .default(DEFAULT_WS_HOST),
  port: z.coerce.number().int().min(1).max(65535).default(DEFAULT_WS_PORT),
  logLevel: z.enum(LOG_LEVELS).default("info"),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type LogLevel = ServerConfig["logLevel"];

export function loadServerConfig(env: Record<string, string | undefined>): ServerConfig {
  return ServerConfigSchema.parse({
    host: env.TAKI_WS_HOST,
    port: env.TAKI_WS_PORT,
    logLevel: env.TAKI_LOG_LEVEL,
  });
}
