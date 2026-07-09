/**
 * INPUT:  a pino log level
 * OUTPUT: createLogger(level) -> root pino Logger (modules derive child loggers)
 * POS:    core/logging — structured logging; never logs secrets/prompts/bodies (logging-guidelines)
 */
import pino from "pino";
import type { LogLevel } from "../config/server-config.ts";

export type Logger = pino.Logger;

export function createLogger(level: LogLevel): Logger {
  return pino({ level });
}
