import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { isStdioConfig, loadMcpConfig } from "./mcp-config.ts";

const dirs: string[] = [];
function tmpFile(name: string, contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-mcp-cfg-"));
  dirs.push(dir);
  const path = join(dir, name);
  if (contents !== undefined) writeFileSync(path, contents);
  return path;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmTempDir(dir);
});

describe("loadMcpConfig (T2)", () => {
  it("returns [] when the file is missing (normal boot)", () => {
    const { logger, records } = createCaptureLogger();
    expect(loadMcpConfig(tmpFile("absent.json"), logger)).toEqual([]);
    expect(records).toHaveLength(0); // absence is normal, not even a warning
  });

  it("warns and returns [] for invalid JSON", () => {
    const { logger, records } = createCaptureLogger();
    expect(loadMcpConfig(tmpFile("bad.json", "{ not json"), logger)).toEqual([]);
    expect(records.some((r) => r.level === "warn")).toBe(true);
  });

  it("warns and returns [] for a well-formed-but-wrong shape", () => {
    const { logger, records } = createCaptureLogger();
    const path = tmpFile("shape.json", JSON.stringify({ files: { nonsense: true } }));
    expect(loadMcpConfig(path, logger)).toEqual([]);
    expect(records.some((r) => r.level === "warn")).toBe(true);
  });

  it("parses a mix of stdio and http servers into keyed entries", () => {
    const { logger } = createCaptureLogger();
    const path = tmpFile(
      "ok.json",
      JSON.stringify({
        files: { command: "node", args: ["server.js"], env: { API_KEY: "x" } },
        remote: { url: "http://localhost:9000/mcp", headers: { Authorization: "Bearer y" } },
      }),
    );
    const entries = loadMcpConfig(path, logger);
    expect(entries.map((e) => e.key).sort()).toEqual(["files", "remote"]);
    const files = entries.find((e) => e.key === "files");
    const remote = entries.find((e) => e.key === "remote");
    expect(files && isStdioConfig(files.config)).toBe(true);
    expect(remote && isStdioConfig(remote.config)).toBe(false);
  });
});
