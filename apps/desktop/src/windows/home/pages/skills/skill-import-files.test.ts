import { describe, expect, it, vi } from "vitest";
import { SKILL_FILE_COUNT_MAX, SKILL_IMPORT_MAX_BYTES } from "@taki/shared";
import { readDirectorySource, readZipSource } from "./skill-import-files.ts";
function file(name: string, size: number, path = name): File { const value = new File([new Uint8Array(size)], name); Object.defineProperty(value, "webkitRelativePath", { value: path }); return value; }
describe("Skill browser import preflight", () => {
  it("reads a bounded directory sequentially into relative entries", async () => { const source = await readDirectorySource([file("SKILL.md", 4, "demo/SKILL.md"), file("a.txt", 2, "demo/references/a.txt")]); expect(source).toMatchObject({ kind: "directory", files: [{ path: "demo/SKILL.md" }, { path: "demo/references/a.txt" }] }); });
  it("rejects count and ZIP size before reading bytes", async () => { await expect(readDirectorySource(Array.from({ length: SKILL_FILE_COUNT_MAX + 1 }, (_, index) => file(`${index}.txt`, 0)))).rejects.toThrow(/文件数/u); const zip = file("large.zip", SKILL_IMPORT_MAX_BYTES + 1); const read = vi.spyOn(zip, "arrayBuffer"); await expect(readZipSource(zip)).rejects.toThrow(/20 MB/u); expect(read).not.toHaveBeenCalled(); });
});
