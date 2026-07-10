/**
 * INPUT:  a temp directory path (after any db handles are closed)
 * OUTPUT: rmTempDir(dir) — best-effort recursive removal that tolerates the Windows handle-release quirk
 * POS:    core/testing — test-only teardown helper (never imported by production code)
 */
import { rmSync } from "node:fs";

// On Windows, node:sqlite (with an FTS5 vtable) can hold the db file handle until the vitest worker exits, so a
// temp-dir remove can't win even with retries. Teardown of an OS temp dir is inherently best-effort: retry, and if
// the handle is still held, leave it for the OS to reclaim rather than fail an otherwise-passing test. On Linux
// (the CI/VPS target) the handle releases immediately and the dir is always removed.
export function rmTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY") throw error;
  }
}
