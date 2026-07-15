import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zstdCompressSync } from "node:zlib";
import tarStream from "tar-stream";
import { describe, expect, it } from "vitest";
import { CharacterImportError } from "./import-error.ts";
import { readZstArchive } from "./zst-archive.ts";

// Build a synthetic zstd+tar the same way the reference packer does: an index member first, then real files.
async function synthArchive(entries: { name: string; body?: string; type?: "directory" }[]): Promise<Buffer> {
  const pack = tarStream.pack();
  for (const e of entries) {
    if (e.type === "directory") pack.entry({ name: e.name, type: "directory" });
    else pack.entry({ name: e.name }, e.body ?? "");
  }
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const chunk of pack) chunks.push(chunk as Buffer);
  return zstdCompressSync(Buffer.concat(chunks));
}

// The real dev asset is git-ignored + copyrighted — read it ONLY when present (env override or the default location) so
// CI without it still passes green. NEVER copy its bytes into the repo.
function realFixture(): string | undefined {
  const candidates = [
    process.env.TAKI_ZST_FIXTURE,
    fileURLToPath(new URL("../../../../models/asuka.zst", import.meta.url)),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  return candidates.find((p) => existsSync(p));
}

describe("readZstArchive (T1)", () => {
  it("decompresses + enumerates a synthetic archive, dropping directory entries", async () => {
    const archive = await synthArchive([
      { name: ".bandori_zst_index.json", body: JSON.stringify({ files: ["casual/model.json", "casual/data/model.moc"] }) },
      { name: "casual/model.json", body: JSON.stringify({ model: "data/model.moc", textures: ["t.png"] }) },
      { name: "casual/data/model.moc", body: "MOCBYTES" },
      { name: "casual/", type: "directory" },
    ]);
    const { files, index } = await readZstArchive(archive);
    expect([...files.keys()].sort()).toEqual([".bandori_zst_index.json", "casual/data/model.moc", "casual/model.json"]);
    expect(files.get("casual/data/model.moc")?.toString()).toBe("MOCBYTES");
    expect(index).toEqual(["casual/model.json", "casual/data/model.moc"]);
  });

  it("rejects a traversal member with unsafe_resource_path", async () => {
    const archive = await synthArchive([{ name: "../escape.txt", body: "x" }]);
    await expect(readZstArchive(archive)).rejects.toMatchObject({ code: "unsafe_resource_path" });
  });

  it("rejects a non-zstd payload with bad_zst", async () => {
    await expect(readZstArchive(Buffer.from([1, 2, 3, 4, 5]))).rejects.toBeInstanceOf(CharacterImportError);
    await expect(readZstArchive(Buffer.from([1, 2, 3, 4, 5]))).rejects.toMatchObject({ code: "bad_zst" });
  });

  it.skipIf(!realFixture())("reads a REAL archive without surfacing PAX pseudo-members (env-gated)", async () => {
    const { files, index } = await readZstArchive(readFileSync(realFixture() as string));
    // A naive ustar walker would surface `././@PaxHeader` members as bogus files; tar-stream must not.
    expect([...files.keys()].some((name) => name.includes("@PaxHeader"))).toBe(false);
    const manifests = [...files.keys()].filter((name) => name.toLowerCase().endsWith("/model.json") || name.toLowerCase().endsWith(".model3.json"));
    expect(manifests.length).toBeGreaterThan(0);
    // The index-member enumeration lists every real file; each listed member must be present in the parsed map.
    if (index) for (const listed of index) expect(files.has(listed)).toBe(true);
  });
});
