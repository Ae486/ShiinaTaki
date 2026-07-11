/**
 * INPUT:  a child process Readable (stdout/stderr)
 * OUTPUT: captureLines(stream) -> LineBuffer { lines, count, waitFor } — line-buffered capture with async matchers
 * POS:    e2e/fixture — the process-output observation primitive shared by the core and node captures
 */
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export interface LineBuffer {
  lines(): readonly string[];
  count(pred: (line: string) => boolean): number;
  waitFor(pred: (line: string) => boolean, timeoutMs?: number): Promise<string>;
}

interface Waiter {
  pred: (line: string) => boolean;
  settle: (line: string) => void;
}

// tracing's fmt writer colorizes even when piped; strip ANSI SGR codes so substring matchers see plain text.
// Built via fromCharCode because eslint (no-control-regex) rejects a literal ESC in a regex.
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function captureLines(stream: Readable): LineBuffer {
  const lines: string[] = [];
  const waiters = new Set<Waiter>();
  createInterface({ input: stream }).on("line", (raw) => {
    const line = raw.replace(ANSI_SGR, "");
    lines.push(line);
    for (const waiter of waiters) {
      if (waiter.pred(line)) {
        waiters.delete(waiter);
        waiter.settle(line);
      }
    }
  });
  return {
    lines: () => lines,
    count: (pred) => lines.filter(pred).length,
    waitFor: (pred, timeoutMs = 20_000) => {
      const existing = lines.find(pred);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`waitFor timed out after ${timeoutMs}ms (${lines.length} lines captured)`));
        }, timeoutMs);
        const waiter: Waiter = {
          pred,
          settle: (line) => {
            clearTimeout(timer);
            resolve(line);
          },
        };
        waiters.add(waiter);
      });
    },
  };
}

/** Parses a line as a JSON object (pino log lines), or null for non-JSON output. */
export function jsonLine(line: string): Record<string, unknown> | null {
  if (!line.startsWith("{")) return null;
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}
