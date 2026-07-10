import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createScreenshotStore } from "./screenshot-store.ts";

// A 1x1 PNG (the smallest valid image) — round-tripping its exact bytes proves the base64 decode is byte-faithful.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("createScreenshotStore (T7)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "taki-shot-"));
  });
  afterEach(() => rmTempDir(dir));

  it("decodes the base64 PNG to bytes under screenshots/ and reports the path + size", () => {
    const store = createScreenshotStore({ screenshotsDir: join(dir, "screenshots") });
    const saved = store.save(PNG_BASE64);

    const expected = Buffer.from(PNG_BASE64, "base64");
    expect(saved.bytes).toBe(expected.byteLength);
    expect(saved.path.endsWith(".png")).toBe(true);
    expect(readFileSync(saved.path)).toEqual(expected);
  });

  it("produces Windows-safe filenames (no colons from the ISO timestamp)", () => {
    const store = createScreenshotStore({ screenshotsDir: join(dir, "screenshots") });
    const { path } = store.save(PNG_BASE64);
    // The drive-letter colon lives in the parent dir; the generated basename must carry none.
    expect(path.split(/[\\/]/).at(-1)).not.toContain(":");
  });
});
