/**
 * INPUT:  n/a
 * OUTPUT: createCaptureLogger() -> { logger, records } — a pino-shaped stub that records log calls
 * POS:    core/testing — test-only logger for asserting warn/info emissions; never imported by production code
 */
import type { Logger } from "../logging/logger.ts";

export interface CapturedLog {
  level: string;
  obj: unknown;
  msg: string | undefined;
}

export interface CaptureLogger {
  logger: Logger;
  records: CapturedLog[];
}

/** A minimal stand-in for pino: records (level, obj, msg) per call; child() reuses the same record sink. */
export function createCaptureLogger(): CaptureLogger {
  const records: CapturedLog[] = [];
  const at =
    (level: string) =>
    (obj?: unknown, msg?: string): void => {
      if (typeof obj === "string") records.push({ level, obj: undefined, msg: obj });
      else records.push({ level, obj, msg });
    };
  const stub = {
    fatal: at("fatal"),
    error: at("error"),
    warn: at("warn"),
    info: at("info"),
    debug: at("debug"),
    trace: at("trace"),
    child: () => stub,
  };
  return { logger: stub as unknown as Logger, records };
}
