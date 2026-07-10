/**
 * INPUT:  a base64-encoded PNG (a node's screenshot capability output)
 * OUTPUT: createScreenshotStore({ screenshotsDir }) -> { save } — writes screenshots/<ts>.png, returns { path, bytes }
 * POS:    core/capabilities — the SANCTIONED Workspace write site for screenshots (invariant 2: the Shell never writes it)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SavedScreenshot {
  path: string;
  bytes: number;
}

export interface ScreenshotStore {
  /** Decodes the base64 PNG and persists it under the Workspace; returns the absolute path + byte count. */
  save(dataBase64: string): SavedScreenshot;
}

export function createScreenshotStore(deps: { screenshotsDir: string }): ScreenshotStore {
  return {
    save(dataBase64) {
      // First-write lazily creates the dir; the core owns the Workspace (the memory engine created its subtree the same way).
      mkdirSync(deps.screenshotsDir, { recursive: true });
      const buffer = Buffer.from(dataBase64, "base64");
      // ISO-8601 with ':' replaced: colons are illegal in Windows filenames, and the Workspace must stay OS-neutral.
      const stamp = new Date().toISOString().replaceAll(":", "-");
      const path = join(deps.screenshotsDir, `${stamp}.png`);
      writeFileSync(path, buffer);
      return { path, bytes: buffer.byteLength };
    },
  };
}
