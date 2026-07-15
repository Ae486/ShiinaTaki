import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { JSONRPCErrorException } from "json-rpc-2.0";
import { CHARACTER_METHODS, JSON_RPC_APP_ERROR } from "@taki/shared";
import { createCharacterImporter, type CharacterImporter } from "../../characters/character-import.ts";
import { createCharacterStore } from "../../characters/character-store.ts";
import type { Connection } from "../connection-registry.ts";
import type { MethodContext } from "../method-registry.ts";
import { characterImportMethod } from "./character-import.ts";

const roots: string[] = [];
function freshImporter(): CharacterImporter {
  const root = mkdtempSync(join(tmpdir(), "taki-m-import-"));
  roots.push(root);
  const store = createCharacterStore({ charactersDir: join(root, "characters") });
  return createCharacterImporter({ store, now: () => new Date("2026-07-15T00:00:00.000Z") });
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function ctx(): MethodContext {
  const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role: "operator", capabilities: [] } };
  return { notify: () => undefined, connection, close: () => undefined, onClose: () => undefined };
}

const C2 = JSON.stringify({ model: "data/model.moc", textures: ["data/t.png"] });
function zip(entries: Record<string, string>): string {
  const record: Record<string, Uint8Array> = {};
  for (const [path, body] of Object.entries(entries)) record[path] = strToU8(body);
  return Buffer.from(zipSync(record)).toString("base64");
}
const validArchive = () => zip({ "casual/model.json": C2, "casual/data/model.moc": "MOC", "casual/data/t.png": "PNG" });

describe("characterImportMethod (T7)", () => {
  it("is operator-only and named character.import", () => {
    const def = characterImportMethod(freshImporter());
    expect(def.method).toBe(CHARACTER_METHODS.import);
    expect(def.roles).toEqual(["operator"]);
  });

  it("imports a valid archive and returns the character summary", async () => {
    const def = characterImportMethod(freshImporter());
    const result = await def.handler({ sourceKind: "zip", archiveBase64: validArchive(), fileName: "taki.zip" }, ctx());
    expect(result).toMatchObject({ characterId: "taki", costumes: ["casual"], defaultCostume: "casual", settingsFilesByCostume: { casual: "model.json" } });
  });

  it("maps an import failure onto the app-error envelope with the clean-room reason in error.data", async () => {
    const def = characterImportMethod(freshImporter());
    const bad = zip({ "casual/model.json": C2, "../evil.txt": "pwned" });
    try {
      await def.handler({ sourceKind: "zip", archiveBase64: bad, fileName: "taki.zip" }, ctx());
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(JSONRPCErrorException);
      expect((error as JSONRPCErrorException).code).toBe(JSON_RPC_APP_ERROR);
      const data = (error as JSONRPCErrorException).data as { code: string; reason: string };
      expect(data.code).toBe("FORBIDDEN");
      expect(data.reason).toBe("unsafe_resource_path");
    }
  });
});
