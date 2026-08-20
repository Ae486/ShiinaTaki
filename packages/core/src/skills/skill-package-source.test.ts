import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { SKILL_FILE_COUNT_MAX, SKILL_FILE_MAX_BYTES, SKILL_MD_MAX_BYTES } from "@taki/shared";
import { enumerateLegacyDirectory, enumerateSource } from "./skill-package-source.ts";
import { hashSkillFiles, parseSkillDocument, publishSkill, validateSkillFiles } from "./skill-package-store.ts";

const encoded = (text: string) => Buffer.from(text, "utf8").toString("base64");
describe("Skill package source", () => {
  it("accepts block-scalar metadata and strips one matching archive root", async () => {
    const files = await enumerateSource({ kind: "directory", files: [
      { path: "demo/SKILL.md", contentBase64: encoded("---\nname: demo\ndescription: |\n  A multiline description.\nlicense: MIT\nmetadata:\n  team: tools\n---\n\n# Demo\n") },
      { path: "demo/references/readme.txt", contentBase64: encoded("reference") },
    ] });
    expect(validateSkillFiles(files)).toMatchObject({ skillName: "demo", description: "A multiline description.\n" });
  });
  it("rejects traversal and case collisions before package validation", async () => {
    await expect(enumerateSource({ kind: "directory", files: [
      { path: "demo/SKILL.md", contentBase64: encoded("x") },
      { path: "demo/../escape.txt", contentBase64: encoded("x") },
    ] })).rejects.toMatchObject({ reason: "unsafe-package" });
    await expect(enumerateSource({ kind: "directory", files: [
      { path: "demo/SKILL.md", contentBase64: encoded("x") },
      { path: "demo/Readme.txt", contentBase64: encoded("x") },
      { path: "demo/readme.txt", contentBase64: encoded("x") },
    ] })).rejects.toMatchObject({ reason: "unsafe-package" });
  });
  it("folds source collisions with deterministic NFC plus ASCII case only", async () => {
    await expect(enumerateSource({ kind: "directory", files: [
      { path: "demo/SKILL.md", contentBase64: encoded("x") },
      { path: "demo/café.txt", contentBase64: encoded("x") },
      { path: "demo/cafe\u0301.txt", contentBase64: encoded("x") },
    ] })).rejects.toMatchObject({ reason: "unsafe-package" });
    await expect(enumerateSource({ kind: "directory", files: [
      { path: "demo/SKILL.md", contentBase64: encoded("x") },
      { path: "demo/Ä.txt", contentBase64: encoded("x") },
      { path: "demo/ä.txt", contentBase64: encoded("x") },
    ] })).resolves.toHaveLength(3);
  });
  it("stops directory decoding as soon as the aggregate limit is exceeded", async () => {
    const block = Buffer.alloc(SKILL_FILE_MAX_BYTES).toString("base64"); let touched = false;
    const neverRead = { path: "demo/never.txt", get contentBase64(): string { touched = true; throw new Error("decoded past total limit"); } };
    const files = ["a", "b", "c", "d"].map((name) => ({ path: `demo/${name}.bin`, contentBase64: block }));
    await expect(enumerateSource({ kind: "directory", files: [...files, { path: "demo/overflow.txt", contentBase64: encoded("x") }, neverRead] })).rejects.toMatchObject({ reason: "source-too-large" });
    expect(touched).toBe(false);
  });
  it("enforces standard metadata bounds and hyphen rules", () => {
    const skill = (name: string, description = "valid", compatibility?: string) => [{ path: "SKILL.md", bytes: Buffer.from(`---\nname: ${name}\ndescription: ${description}\n${compatibility === undefined ? "" : `compatibility: ${compatibility}\n`}---\nbody`) }];
    for (const name of ["-demo", "demo-", "demo--skill", "Demo", "a".repeat(65)]) expect(() => validateSkillFiles(skill(name))).toThrow();
    expect(validateSkillFiles(skill("1-demo"))).toMatchObject({ skillName: "1-demo" });
    expect(() => validateSkillFiles(skill("demo", "a".repeat(1_025)))).toThrow();
    expect(() => validateSkillFiles(skill("demo", "valid", "a".repeat(501)))).toThrow();
  });
  it("refuses a tampered content-addressed destination instead of reusing it", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-publish-"));
    try { const validated = validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: demo\n---\nbody") }]); const content = publishSkill(root, "11111111-1111-4111-8111-111111111111", validated); writeFileSync(join(content.root, "SKILL.md"), "tampered"); expect(() => publishSkill(root, "22222222-2222-4222-8222-222222222222", validated)).toThrow(); } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("hashes paths in locale-independent UTF-8 byte order", () => { const files = [{ path: "z.txt", bytes: Buffer.from("z") }, { path: "ä.txt", bytes: Buffer.from("u") }, { path: "A.txt", bytes: Buffer.from("a") }]; const hash = createHash("sha256"); for (const file of [files[2]!, files[0]!, files[1]!]) { const path = Buffer.from(file.path); const length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(path.length)); hash.update(length).update(path); length.writeBigUInt64BE(BigInt(file.bytes.length)); hash.update(length).update(file.bytes); } expect(hashSkillFiles(files)).toBe(`sha256.${hash.digest("hex")}`); });
  it("uses the dedicated 1 MiB SKILL.md bound", async () => { await expect(enumerateSource({ kind: "directory", files: [{ path: "demo/SKILL.md", contentBase64: Buffer.alloc(SKILL_MD_MAX_BYTES + 1).toString("base64") }] })).rejects.toMatchObject({ reason: "source-too-large" }); expect(() => validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.alloc(SKILL_MD_MAX_BYTES + 1) }])).toThrow(); });
  it("requires known package directories to match the standard name", () => { const files = [{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: demo\n---\nbody") }]; expect(() => validateSkillFiles(files, { requireWrapperRoot: true })).toThrow(); expect(() => validateSkillFiles(files, { expectedRootName: "other" })).toThrow(); expect(validateSkillFiles(files, { expectedRootName: "demo" })).toMatchObject({ skillName: "demo" }); });
  it("uses exact LF or CRLF frontmatter delimiter lines", () => { const crlf = "---\r\nname: demo\r\ndescription: demo\r\n---\r\nbody\r\n"; expect(validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from(crlf) }])).toMatchObject({ skillName: "demo" }); expect(parseSkillDocument(crlf).body).toBe("body\r\n"); for (const text of ["----\nname: demo\ndescription: demo\n---\nbody", "---\nname: demo\ndescription: demo\n----\nbody", "---\nname: demo\ndescription: demo\n---body"]) expect(() => validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from(text) }])).toThrow(); });
  it("rejects YAML aliases instead of relying on the parser default", () => { const aliased = "---\nname: demo\nvalue: &description demo\ndescription: *description\n---\nbody"; expect(() => validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from(aliased) }])).toThrow(); });
  it("flags scripts and executable extensions without flagging benign assets", () => { const validated = validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: demo\n---\nbody") }, { path: "assets/icon.png", bytes: Buffer.from("png") }, { path: "assets/run.exe", bytes: Buffer.from("exe") }, { path: "scripts/readme.txt", bytes: Buffer.from("script") }]); expect(validated.findings).toEqual([{ code: "executable-looking-file", path: "assets/run.exe" }, { code: "scripts-directory", path: "scripts/readme.txt" }]); });
  it("streams ZIP entries and refuses traversal, links, count overflow, and declared or actual size mismatches", async () => {
    const valid = zipSync({ "demo/SKILL.md": strToU8("---\nname: demo\ndescription: demo\n---\nbody") });
    await expect(enumerateSource(zipSource(valid))).resolves.toHaveLength(1);
    await expect(enumerateSource(zipSource(zipSync({ "../escape.txt": strToU8("x") })))).rejects.toMatchObject({ reason: "unsafe-package" });
    await expect(enumerateSource(zipSource(mutateCentral(valid, (zip, offset) => zip.writeUInt32LE((0o120777 << 16) >>> 0, offset + 38))))).rejects.toMatchObject({ reason: "unsafe-package" });
    await expect(enumerateSource(zipSource(mutateCentral(valid, (zip, offset) => zip.writeUInt32LE(SKILL_MD_MAX_BYTES + 1, offset + 24))))).rejects.toMatchObject({ reason: "source-too-large" });
    const actualMismatch = zipSync({ "demo/SKILL.md": strToU8("xx") });
    await expect(enumerateSource(zipSource(mutateCentral(actualMismatch, (zip, offset) => zip.writeUInt32LE(1, offset + 24))))).rejects.toMatchObject({ reason: "unsafe-package" });
    const excessive: Record<string, Uint8Array> = {}; for (let index = 0; index <= SKILL_FILE_COUNT_MAX; index += 1) excessive[`demo/${index}.txt`] = new Uint8Array();
    await expect(enumerateSource(zipSource(zipSync(excessive)))).rejects.toMatchObject({ reason: "source-too-large" });
  }, 15_000);
  it("applies absolute, device-name, case-collision, and reparse guards to ZIP members", async () => {
    const unsafeEntries: Record<string, Uint8Array>[] = [{ "/absolute.txt": strToU8("x") }, { "demo/CON.txt": strToU8("x") }, { "demo/a.txt": strToU8("a"), "demo/A.txt": strToU8("b") }];
    for (const entries of unsafeEntries) {
      await expect(enumerateSource(zipSource(zipSync(entries)))).rejects.toMatchObject({ reason: "unsafe-package" });
    }
    const valid = zipSync({ "demo/SKILL.md": strToU8("---\nname: demo\ndescription: demo\n---\nbody") });
    await expect(enumerateSource(zipSource(mutateCentral(valid, (zip, offset) => zip.writeUInt32LE(0x0400, offset + 38))))).rejects.toMatchObject({ reason: "unsafe-package" });
  });
  it("rejects exact duplicate ZIP members", async () => {
    const archive = zipSync({
      "demo/SKILL.md": strToU8("---\nname: demo\ndescription: demo\n---\nbody"),
      "demo/a.txt": strToU8("a"),
      "demo/b.txt": strToU8("b"),
    });
    await expect(enumerateSource(zipSource(renameZipMember(archive, "demo/b.txt", "demo/a.txt")))).rejects.toMatchObject({ reason: "unsafe-package" });
  });
  it("rejects hard-linked legacy content before reading it", () => { const root = mkdtempSync(join(tmpdir(), "skill-legacy-source-")); try { mkdirSync(join(root, "demo")); const skill = join(root, "demo", "SKILL.md"); writeFileSync(skill, "---\nname: demo\ndescription: demo\n---\nbody"); linkSync(skill, join(root, "demo", "alias.txt")); expect(() => enumerateLegacyDirectory(join(root, "demo"))).toThrow(); } finally { rmSync(root, { recursive: true, force: true }); } });
});

function zipSource(bytes: Uint8Array) { return { kind: "zip" as const, fileName: "demo.zip", archiveBase64: Buffer.from(bytes).toString("base64") }; }
function mutateCentral(bytes: Uint8Array, mutate: (zip: Buffer, offset: number) => void): Buffer { const zip = Buffer.from(bytes); let offset = 0; while (offset + 46 <= zip.length && zip.readUInt32LE(offset) !== 0x02014b50) offset += 1; if (offset + 46 > zip.length) throw new Error("central directory missing"); mutate(zip, offset); return zip; }
function renameZipMember(bytes: Uint8Array, from: string, to: string): Buffer {
  const archive = Buffer.from(bytes); const source = Buffer.from(from); const target = Buffer.from(to);
  if (source.length !== target.length) throw new Error("ZIP fixture names must have equal byte lengths");
  let offset = 0; let replacements = 0;
  while ((offset = archive.indexOf(source, offset)) !== -1) { target.copy(archive, offset); offset += source.length; replacements += 1; }
  if (replacements !== 2) throw new Error("ZIP fixture must contain one local and one central member name");
  return archive;
}
