/**
 * INPUT: browser-picked ZIP or directory File objects
 * OUTPUT: bounded Shared Skill import source payloads encoded without unbounded parallel reads
 * POS:    Home Skills preflight boundary; Core remains authoritative and revalidates every byte/path
 */
import { SKILL_FILE_COUNT_MAX, SKILL_FILE_MAX_BYTES, SKILL_IMPORT_MAX_BYTES, SKILL_TOTAL_MAX_BYTES, type SkillImportSource } from "@taki/shared";
export function snapshotFileList(list: FileList | null): File[] { return list ? Array.from(list) : []; }
export async function readZipSource(file: File): Promise<SkillImportSource> { if (file.size > SKILL_IMPORT_MAX_BYTES) throw new Error("ZIP 超过 20 MB 导入上限"); return { kind: "zip", fileName: file.name, archiveBase64: encode(await file.arrayBuffer()) }; }
export async function readDirectorySource(list: FileList | File[]): Promise<SkillImportSource> {
  const files = Array.from(list); if (files.length === 0 || files.length > SKILL_FILE_COUNT_MAX) throw new Error(`目录文件数必须在 1-${SKILL_FILE_COUNT_MAX} 之间`);
  let total = 0; for (const file of files) { if (file.size > SKILL_FILE_MAX_BYTES) throw new Error(`文件 ${file.name} 超过单文件上限`); total += file.size; if (total > SKILL_TOTAL_MAX_BYTES) throw new Error("目录总大小超过 64 MiB 上限"); }
  const entries: { path: string; contentBase64: string }[] = [];
  for (const file of files) entries.push({ path: file.webkitRelativePath || file.name, contentBase64: encode(await file.arrayBuffer()) });
  return { kind: "directory", files: entries };
}
function encode(buffer: ArrayBuffer): string { const bytes = new Uint8Array(buffer); let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); }
