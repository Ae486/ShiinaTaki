import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createWorkspacePaths } from "./workspace-paths.ts";
import { createWriteFileTool } from "./write-file-tool.ts";

const EXEC_OPTS = { toolCallId: "c1", messages: [] } as never;
const root = realpathSync(mkdtempSync(join(tmpdir(), "taki-write-")));
const { logger } = createCaptureLogger();
const tools = createWriteFileTool({ paths: createWorkspacePaths({ root }), logger });

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("createWriteFileTool (T10/T11)", () => {
  it("writes a file and echoes a RELATIVE path + byte count", async () => {
    const result = await tools.write_file?.execute?.({ path: "note.md", content: "hi" }, EXEC_OPTS);
    expect(result).toEqual({ ok: true, path: "note.md", bytes: 2 });
    expect(readFileSync(join(root, "note.md"), "utf8")).toBe("hi");
  });

  it("creates missing parent folders within the Workspace (mkdir OK)", async () => {
    const result = await tools.write_file?.execute?.({ path: "a/b/deep.txt", content: "x" }, EXEC_OPTS);
    expect(result).toEqual({ ok: true, path: join("a", "b", "deep.txt"), bytes: 1 });
    expect(existsSync(join(root, "a", "b", "deep.txt"))).toBe(true);
  });

  it("refuses content over the 1 MiB cap with TOO_LARGE (before touching disk)", async () => {
    const big = "a".repeat(1024 * 1024 + 1);
    expect(await tools.write_file?.execute?.({ path: "big.txt", content: big }, EXEC_OPTS)).toMatchObject({
      ok: false,
      code: "TOO_LARGE",
    });
    expect(existsSync(join(root, "big.txt"))).toBe(false);
  });

  it("rejects a path that escapes the Workspace and writes nothing", async () => {
    expect(await tools.write_file?.execute?.({ path: "C:\\Windows\\evil.txt", content: "x" }, EXEC_OPTS)).toMatchObject({
      ok: false,
      code: "INVALID_PATH",
    });
  });
});
