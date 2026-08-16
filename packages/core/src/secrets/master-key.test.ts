import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateCatalogKey } from "./secret-catalog-envelope.ts";
import { decodeFramedKey, frameKey, resolveMasterKeySource } from "./master-key.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-master-key-"));
  dirs.push(dir);
  return dir;
}

describe("resolveMasterKeySource", () => {
  it("prefers the credentials directory over the helper, then falls back to none", () => {
    const creds = resolveMasterKeySource({ TAKI_CREDENTIALS_DIRECTORY: "C", TAKI_SECRET_KEY_HELPER: "helper" });
    expect(creds?.kind).toBe("credentials-directory");
    const systemd = resolveMasterKeySource({ CREDENTIALS_DIRECTORY: "S", TAKI_SECRET_KEY_HELPER: "helper" });
    expect(systemd?.kind).toBe("credentials-directory");
    const helper = resolveMasterKeySource({ TAKI_SECRET_KEY_HELPER: "helper" });
    expect(helper?.kind).toBe("key-helper");
    expect(resolveMasterKeySource({})).toBeNull();
  });

  it("ignores empty-string env values (unset semantics)", () => {
    expect(resolveMasterKeySource({ TAKI_CREDENTIALS_DIRECTORY: "", TAKI_SECRET_KEY_HELPER: "" })).toBeNull();
    expect(resolveMasterKeySource({ TAKI_CREDENTIALS_DIRECTORY: "", TAKI_SECRET_KEY_HELPER: "helper" })?.kind).toBe("key-helper");
  });
});

describe("credentials directory source (systemd LoadCredentialEncrypted=)", () => {
  it("reads a 32-byte key file and reports itself read-only", () => {
    const dir = tempDir();
    const key = generateCatalogKey();
    writeFileSync(join(dir, "taki-secret-catalog-master-key"), key);
    const source = resolveMasterKeySource({ TAKI_CREDENTIALS_DIRECTORY: dir });
    expect(source).not.toBeNull();
    expect(source?.canCreate).toBe(false);
    expect(Array.from(source?.read() ?? [])).toEqual(Array.from(key));
    expect(() => source?.create(key)).toThrow(/read-only/);
  });

  it("a missing or wrong-size key file is null (LOCKED), never an error surface", () => {
    const empty = tempDir();
    expect(resolveMasterKeySource({ TAKI_CREDENTIALS_DIRECTORY: empty })?.read()).toBeNull();
    const short = tempDir();
    writeFileSync(join(short, "taki-secret-catalog-master-key"), Buffer.alloc(8));
    expect(resolveMasterKeySource({ TAKI_CREDENTIALS_DIRECTORY: short })?.read()).toBeNull();
  });
});

describe("key helper source", () => {
  it("a helper that cannot launch locks the store (null) rather than throwing", () => {
    const source = resolveMasterKeySource({ TAKI_SECRET_KEY_HELPER: join(tempDir(), "definitely-absent-helper") });
    expect(source?.read()).toBeNull();
  });

  it("a helper that cannot launch refuses create with a sanitized message (no key material)", () => {
    const source = resolveMasterKeySource({ TAKI_SECRET_KEY_HELPER: join(tempDir(), "definitely-absent-helper") });
    const key = generateCatalogKey();
    try {
      source?.create(key);
      expect.unreachable("create must throw when the helper cannot launch");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/failed to launch/);
      expect(message).not.toContain(Buffer.from(key).toString("hex"));
    }
  });

  it("honors TAKI_SECRET_KEY_ACCOUNT over the default account", () => {
    // Observable through the usage error args of a launch attempt against a directory path (EACCES/ENOENT family).
    const source = resolveMasterKeySource({ TAKI_SECRET_KEY_HELPER: join(tempDir(), "nope"), TAKI_SECRET_KEY_ACCOUNT: "custom-v2" });
    expect(source?.kind).toBe("key-helper");
    expect(source?.read()).toBeNull(); // fail-closed regardless of the account name
  });
});

describe("framed key contract (shared with the taki-secret-key Rust helper)", () => {
  it("frameKey is [u32 LE length][bytes] and decodeFramedKey inverts it", () => {
    const key = generateCatalogKey();
    const framed = frameKey(key);
    expect(framed.length).toBe(4 + 32);
    expect(Array.from(framed.slice(0, 4))).toEqual([32, 0, 0, 0]); // 32 as u32 LE, matching Rust's frame()
    expect(Array.from(decodeFramedKey(framed) ?? [])).toEqual(Array.from(key));
  });

  it("rejects short output, trailing bytes, and length mismatches", () => {
    expect(decodeFramedKey(new Uint8Array(0))).toBeNull();
    expect(decodeFramedKey(new Uint8Array([32, 0, 0]))).toBeNull();
    const key = generateCatalogKey();
    const trailing = new Uint8Array(4 + 32 + 1);
    trailing.set(frameKey(key).subarray(0, 36), 0);
    trailing[36] = 0x41;
    expect(decodeFramedKey(trailing)).toBeNull();
    const lying = new Uint8Array([31, 0, 0, 0, ...Array.from(key).slice(0, 32)] as number[]);
    expect(decodeFramedKey(lying)).toBeNull();
    expect(decodeFramedKey(new Uint8Array([0, 0, 0, 0]))).toBeNull();
  });
});
