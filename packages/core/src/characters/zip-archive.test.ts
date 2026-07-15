import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { CharacterImportError } from "./import-error.ts";
import { readZip } from "./zip-archive.ts";

describe("readZip (T2)", () => {
  it("unzips a synthetic zip into a normalized file map, dropping directory markers", () => {
    const zip = Buffer.from(
      zipSync({
        "arbeit/model.json": strToU8(JSON.stringify({ model: "x.moc", textures: ["t.png"] })),
        "arbeit/x.moc": new Uint8Array([9, 8, 7]),
        "arbeit/": new Uint8Array(0), // a directory marker
      }),
    );
    const files = readZip(zip);
    expect([...files.keys()].sort()).toEqual(["arbeit/model.json", "arbeit/x.moc"]);
    expect([...(files.get("arbeit/x.moc") ?? [])]).toEqual([9, 8, 7]);
  });

  it("rejects a Zip-Slip `../escape` member with unsafe_resource_path", () => {
    const zip = Buffer.from(zipSync({ "../escape.txt": strToU8("pwned") }));
    expect(() => readZip(zip)).toThrow(CharacterImportError);
    try {
      readZip(zip);
    } catch (error) {
      expect((error as CharacterImportError).code).toBe("unsafe_resource_path");
    }
  });

  it("rejects a non-zip payload with bad_zip", () => {
    try {
      readZip(Buffer.from([1, 2, 3, 4, 5]));
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CharacterImportError);
      expect((error as CharacterImportError).code).toBe("bad_zip");
    }
  });
});
