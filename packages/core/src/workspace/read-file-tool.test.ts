import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createWorkspacePaths } from "./workspace-paths.ts";
import { createReadFileTool } from "./read-file-tool.ts";

const EXEC_OPTS = { toolCallId: "c1", messages: [] } as never;
const root = realpathSync(mkdtempSync(join(tmpdir(), "taki-read-")));
writeFileSync(join(root, "hello.txt"), "hello world");
writeFileSync(join(root, "big.txt"), "a".repeat(300 * 1024)); // > 256 KiB read cap
writeFileSync(join(root, "binary.bin"), Buffer.from([0xff, 0xfe, 0x80, 0x00])); // invalid UTF-8

const { logger } = createCaptureLogger();
const tools = createReadFileTool({ paths: createWorkspacePaths({ root }), logger });

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("createReadFileTool (T9/T11)", () => {
  it("reads a UTF-8 file and echoes a RELATIVE path (no absolute leak)", async () => {
    const result = await tools.read_file?.execute?.({ path: "hello.txt" }, EXEC_OPTS);
    expect(result).toEqual({ ok: true, path: "hello.txt", content: "hello world", bytes: 11, truncated: false });
  });

  it("truncates a file larger than the 256 KiB cap", async () => {
    const result = (await tools.read_file?.execute?.({ path: "big.txt" }, EXEC_OPTS)) as {
      ok: true;
      bytes: number;
      truncated: boolean;
      content: string;
    };
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBe(256 * 1024);
    expect(result.content.length).toBe(256 * 1024);
  });

  it("returns NOT_TEXT for a non-UTF-8 (binary) file", async () => {
    expect(await tools.read_file?.execute?.({ path: "binary.bin" }, EXEC_OPTS)).toMatchObject({
      ok: false,
      code: "NOT_TEXT",
    });
  });

  it("returns IO_ERROR for a missing file inside the Workspace — errno only, no absolute-path leak", async () => {
    expect(await tools.read_file?.execute?.({ path: "nope.txt" }, EXEC_OPTS)).toEqual({
      ok: false,
      code: "IO_ERROR",
      message: "read failed (ENOENT)",
    });
  });

  it("rejects a path that escapes the Workspace before any IO", async () => {
    expect(await tools.read_file?.execute?.({ path: "../../etc/passwd" }, EXEC_OPTS)).toMatchObject({
      ok: false,
      code: "INVALID_PATH",
    });
  });
});
