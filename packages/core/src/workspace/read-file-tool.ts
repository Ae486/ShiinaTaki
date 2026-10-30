/**
 * INPUT:  an LLM file-read call ({ path }) + a WorkspacePaths confiner
 * OUTPUT: createReadFileTool(deps) -> ToolSet { read_file }; returns { ok, path, content, bytes, truncated } or { ok:false, code }
 * POS:    core/workspace — a CORE-side tool (no broker/gate); reads only inside the Workspace (ruling 1/8/9); never throws
 */
import { readFile } from "node:fs/promises";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Logger } from "../logging/logger.ts";
import { fsErrorCode } from "./fs-error.ts";
import type { WorkspacePaths } from "./workspace-paths.ts";
import { withToolSourceMaterials } from "../agents/tool-source-materials.ts";

// 256 KiB read cap (ruling 9); beyond it the model gets the first slice + truncated:true.
const READ_CAP = 256 * 1024;

export interface ReadFileToolDeps {
  paths: WorkspacePaths;
  logger: Logger;
}

// Back the cut off any UTF-8 continuation byte so a truncated slice never splits a multi-byte char (ruling 9).
function utf8SafeEnd(buffer: Buffer, cap: number): number {
  let end = Math.min(cap, buffer.length);
  for (let i = 0; i < 3 && end > 0 && (buffer[end] ?? 0) >= 0x80 && (buffer[end] ?? 0) < 0xc0; i += 1) end -= 1;
  return end;
}

export function createReadFileTool(deps: ReadFileToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "workspace" });
  return {
    read_file: tool({
      description:
        "Read a UTF-8 text file from your Workspace (your own scratch directory). The path is relative to the " +
        "Workspace root; paths outside it are rejected. Large files are truncated to the first 256 KiB.",
      inputSchema: z.object({ path: z.string().min(1) }),
      execute: async ({ path }) => {
        try {
          const resolved = deps.paths.resolve(path);
          if (!resolved.ok) return { ok: false as const, code: resolved.code, message: `path rejected: ${resolved.code}` };

          let buffer: Buffer;
          try {
            buffer = await readFile(resolved.real);
          } catch (error) {
            // The raw fs message embeds the ABSOLUTE path — return only the errno name (no absolute-prefix leak, ruling 9).
            return { ok: false as const, code: "IO_ERROR", message: `read failed (${fsErrorCode(error)})` };
          }

          const truncated = buffer.length > READ_CAP;
          const slice = truncated ? buffer.subarray(0, utf8SafeEnd(buffer, READ_CAP)) : buffer;
          let content: string;
          try {
            content = new TextDecoder("utf-8", { fatal: true }).decode(slice);
          } catch {
            return { ok: false as const, code: "NOT_TEXT", message: "file is not valid UTF-8 text" };
          }
          // The path (relative) and byte count are safe to log; the file content is NOT.
          log.info({ path: resolved.relative, bytes: slice.length, truncated }, "workspace file read");
          return withToolSourceMaterials({ ok: true as const, path: resolved.relative, content, bytes: slice.length, truncated },
            [{ key: "result", source: { label: "Workspace file", reference: resolved.relative } }]);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "read-file tool failed");
          return { ok: false as const, code: "IO_ERROR", message };
        }
      },
    }),
  };
}
