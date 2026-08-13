import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createLegacyMcpDenyReader } from "./legacy-mcp-deny.ts";

const dirs: string[] = [];

function pathWith(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-legacy-mcp-"));
  dirs.push(dir);
  const filePath = join(dir, "mcp-approvals.json");
  if (contents !== undefined) writeFileSync(filePath, contents);
  return filePath;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmTempDir(dir);
});

function reader(contents?: string) {
  const { logger, records } = createCaptureLogger();
  return { reader: createLegacyMcpDenyReader({ filePath: pathWith(contents), logger }), records };
}

const decision = (serverName: string, toolName: string, value: "always" | "never") => ({
  serverName, toolName, decision: value, decidedAt: "2026-08-13T00:00:00.000Z",
});

describe("createLegacyMcpDenyReader", () => {
  it("treats a missing file as no compatibility constraint", () => {
    expect(reader().reader.denies("files", "read")).toBe(false);
  });

  it("applies exact never records and ignores legacy allows", () => {
    const contents = JSON.stringify({ approvals: [
      decision("files", "read", "always"),
      decision("files", "delete", "never"),
    ] });
    const loaded = reader(contents).reader;
    expect(loaded.denies("files", "read")).toBe(false);
    expect(loaded.denies("files", "delete")).toBe(true);
    expect(loaded.denies("other", "delete")).toBe(false);
  });

  it.each(["{ broken", JSON.stringify({ approvals: [{ decision: "never" }] })])(
    "fails every MCP lookup closed for corrupt state",
    (contents) => {
      const { reader: loaded, records } = reader(contents);
      expect(loaded.denies("files", "read")).toBe(true);
      expect(loaded.denies("other", "echo")).toBe(true);
      expect(records.some((record) => record.level === "warn")).toBe(true);
      expect(JSON.stringify(records)).not.toContain(contents);
    },
  );

  it("fails only a duplicated exact binding closed", () => {
    const contents = JSON.stringify({ approvals: [
      decision("files", "read", "always"),
      decision("files", "read", "never"),
      decision("other", "echo", "always"),
    ] });
    const { reader: loaded, records } = reader(contents);
    expect(loaded.denies("files", "read")).toBe(true);
    expect(loaded.denies("other", "echo")).toBe(false);
    expect(records).toMatchObject([{ level: "warn" }]);
  });
});
