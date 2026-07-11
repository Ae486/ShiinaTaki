/**
 * INPUT:  a pino log level (+ NODE_ENV / stdout TTY to pick the dev transport)
 * OUTPUT: createLogger(level) -> root pino Logger (modules derive child loggers)
 * POS:    core/logging — structured logging; pretty in a dev TTY only, raw JSON otherwise; never logs secrets/prompts/bodies (logging-guidelines)
 */
import pino from "pino";
import type { LogLevel } from "../config/server-config.ts";

export type Logger = pino.Logger;

// pino-pretty is a devDependency: the guard must be false anywhere it is not installed. Production (the Ubuntu VPS)
// ingests raw JSON (invariant 8), and piped/non-TTY output stays machine-readable even in dev.
function usePrettyTransport(): boolean {
  return process.env.NODE_ENV !== "production" && Boolean(process.stdout.isTTY);
}

export function createLogger(level: LogLevel): Logger {
  if (!usePrettyTransport()) return pino({ level });
  return pino({
    level,
    transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" } },
  });
}
