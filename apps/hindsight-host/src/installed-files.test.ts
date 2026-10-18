import { linkSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { digestInstalledFile, fileIdentity, readInstalledFile, sha256 } from "./installed-files.ts";

const mutation = vi.hoisted(() => ({ afterRead: undefined as (() => void) | undefined }));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, readSync: (...args: Parameters<typeof original.readSync>) => {
    const count: number = Reflect.apply(original.readSync, original, args);
    const callback = mutation.afterRead;
    mutation.afterRead = undefined;
    callback?.();
    return count;
  } };
});
const directories: string[] = [];
afterEach(() => {
  mutation.afterRead = undefined;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "taki-c1-file-snapshot-"));
  directories.push(directory);
  const path = join(directory, "owned-artifact.js");
  writeFileSync(path, "C1A_FAKE_ARTIFACT".repeat(8192));
  return { directory, path };
}

describe("opened installed artifact identity", () => {
  it("binds the actual read bytes and digest to one current file identity", () => {
    const { path } = fixture();
    const source = readInstalledFile(path, 256 * 1024);
    expect(digestInstalledFile(path)).toEqual({ sha256: sha256(source.bytes), identity: source.identity });
    expect(fileIdentity(path)).toBe(source.identity);
    expect(() => readInstalledFile(path, 1)).toThrow();
  });

  it.each(["read", "digest"])("refuses same-byte path replacement during %s before recording an identity", (kind) => {
    const { directory, path } = fixture();
    const bytes = readFileSync(path);
    mutation.afterRead = () => {
      renameSync(path, join(directory, "retired-artifact.js"));
      writeFileSync(path, bytes);
    };
    expect(() => kind === "read" ? readInstalledFile(path, 256 * 1024) : digestInstalledFile(path)).toThrow();
  });

  it("refuses an additional hard link even when bytes and timestamps match", () => {
    const { directory, path } = fixture();
    linkSync(path, join(directory, "alias.js"));
    expect(() => digestInstalledFile(path)).toThrow();
    expect(() => fileIdentity(path)).toThrow();
  });
});
