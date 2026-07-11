/**
 * INPUT:  an LLM file-write call ({ path, content }) + a WorkspacePaths confiner
 * OUTPUT: createWriteFileTool(deps) -> ToolSet { write_file }; returns { ok:true, path, bytes } or { ok:false, code }
 * POS:    core/workspace — a CORE-side tool (no broker/gate); the ONLY new Workspace writer, confined (ruling 1/8/9); never throws
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Logger } from "../logging/logger.ts";
import { fsErrorCode } from "./fs-error.ts";
import type { WorkspacePaths } from "./workspace-paths.ts";

// 1 MiB write cap (ruling 9); beyond it the write is refused rather than truncated.
const WRITE_CAP = 1024 * 1024;

export interface WriteFileToolDeps {
  paths: WorkspacePaths;
  logger: Logger;
}

export function createWriteFileTool(deps: WriteFileToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "workspace" });
  return {
    write_file: tool({
      description:
        "Write a UTF-8 text file into your Workspace (your own scratch directory), creating parent folders as needed. " +
        "The path is relative to the Workspace root; paths outside it are rejected. Max 1 MiB.",
      inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
      execute: async ({ path, content }) => {
        try {
          const bytes = Buffer.byteLength(content, "utf8");
          if (bytes > WRITE_CAP) {
            return { ok: false as const, code: "TOO_LARGE", message: `content exceeds ${WRITE_CAP} bytes` };
          }
          const resolved = deps.paths.resolve(path);
          if (!resolved.ok) return { ok: false as const, code: resolved.code, message: `path rejected: ${resolved.code}` };

          try {
            await mkdir(dirname(resolved.real), { recursive: true }); // mkdir within the Workspace is allowed (ruling 8)
            await writeFile(resolved.real, content, "utf8");
          } catch (error) {
            // The raw fs message embeds the ABSOLUTE path — return only the errno name (no absolute-prefix leak, ruling 9).
            return { ok: false as const, code: "IO_ERROR", message: `write failed (${fsErrorCode(error)})` };
          }
          // The path (relative) and byte count are safe to log; the written content is NOT.
          log.info({ path: resolved.relative, bytes }, "workspace file written");
          return { ok: true as const, path: resolved.relative, bytes };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "write-file tool failed");
          return { ok: false as const, code: "IO_ERROR", message };
        }
      },
    }),
  };
}
