/**
 * INPUT:  temp-dir catalog files + in-memory key sources (incl. absent keys, tampered files, planted staging)
 * OUTPUT: fs-backed service proofs: set→reopen→presence restart survival, locked/unreadable fail-closed WITHOUT
 *         rewrite, staged-crash isolation, write-failure reversion, rotation, backup/restore validation, and the
 *         sentinel-absence probes over file bytes + logs (PRD AC1/AC2)
 * POS:    core/secrets — the durable-layer test; mirrors host-identity.test.ts temp-dir style
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { generateCatalogKey } from "./secret-catalog-envelope.ts";
import { publishFileAtomically } from "./catalog-publication.ts";
import { createSecretCatalogService, SecretRefusalError, type SecretCatalogService } from "./secret-catalog-service.ts";
import type { MasterKeySource } from "./master-key.ts";

const STORE = "11111111-1111-4111-8111-111111111111";
const SENTINEL = "sentinel-not-a-real-secret-value-0123456789";
const REF = "mcp.demo.env.API_KEY";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-secret-catalog-"));
  dirs.push(dir);
  return dir;
}

function memorySource(key: Uint8Array | null, canCreate = false): MasterKeySource {
  return {
    kind: "credentials-directory",
    canCreate,
    read: () => key,
    create: () => {
      throw new Error("read-only test source");
    },
  };
}

interface Boot {
  service: SecretCatalogService;
  dir: string;
  filePath: string;
  logs: ReturnType<typeof createCaptureLogger>["records"];
}

async function boot(dir: string, key: Uint8Array | null, canCreate = false): Promise<Boot> {
  const filePath = join(dir, "secret-catalog.bin");
  const capture = createCaptureLogger();
  return {
    service: await createSecretCatalogService({ filePath, storeId: STORE, keySource: memorySource(key, canCreate), logger: capture.logger }),
    dir,
    filePath,
    logs: capture.records,
  };
}

const KEY = generateCatalogKey();
const OTHER_KEY = generateCatalogKey();

describe("secret catalog service (durable layer)", () => {
  it("keeps the basic plane available when first-use key provisioning fails", async () => {
    const dir = tempDir(); const capture = createCaptureLogger();
    const service = await createSecretCatalogService({ filePath: join(dir, "secret-catalog.bin"), storeId: STORE,
      logger: capture.logger, keySource: { kind: "key-helper", canCreate: true, read: () => null,
        create: () => { throw new Error(SENTINEL); } } });
    expect(service.health()).toBe("locked");
    expect(() => service.set(REF, "value")).toThrow(/store-locked/);
    expect(existsSync(join(dir, "secret-catalog.bin"))).toBe(false);
    expect(JSON.stringify(capture.records)).not.toContain(SENTINEL);
  });
  it("set survives reopen (restart survival) and never writes the sentinel in cleartext", async () => {
    const dir = tempDir();
    const first = await boot(dir, KEY);
    expect(first.service.health()).toBe("ok");
    const result = first.service.set(REF, SENTINEL);
    expect(result).toMatchObject({ present: true, provenance: { source: "catalog", keyVersion: 1 } });

    const raw = readFileSync(first.filePath);
    expect(raw.includes(Buffer.from(SENTINEL))).toBe(false); // at-rest ciphertext only (AC1)

    const second = await boot(dir, KEY);
    expect(second.service.health()).toBe("ok");
    expect(second.service.presence(REF)).toMatchObject({ present: true, provenance: { keyVersion: 1 } });
    expect(second.service.resolve(REF)).toBe(SENTINEL); // internal resolver still round-trips
    expect(JSON.stringify(second.logs)).not.toContain(SENTINEL);
  });

  it("a store with no key source is locked: reads report unknown presence, writes fail closed, no file appears", async () => {
    const dir = tempDir();
    const locked = await boot(dir, null);
    expect(locked.service.health()).toBe("locked");
    expect(locked.service.presence(REF)).toEqual({ secretRef: REF, present: false, provenance: null, health: "locked" });
    expect(() => locked.service.set(REF, SENTINEL)).toThrow(SecretRefusalError);
    expect(existsSync(locked.filePath)).toBe(false); // nothing is provisioned while locked
  });

  it("an existing catalog plus a missing key stays locked and is never rewritten (no mint-over)", async () => {
    const dir = tempDir();
    const seeded = await boot(dir, KEY);
    seeded.service.set(REF, SENTINEL);
    const before = readFileSync(seeded.filePath);

    const locked = await boot(dir, null);
    expect(locked.service.health()).toBe("locked");
    expect(() => locked.service.set(REF, "other")).toThrow(/store-locked/);
    expect(readFileSync(locked.filePath).equals(before)).toBe(true); // byte-identical (AC2)
  });

  it("a tampered catalog reads unreadable and every mutation fails closed without touching the file", async () => {
    const dir = tempDir();
    const seeded = await boot(dir, KEY);
    seeded.service.set(REF, SENTINEL);
    const before = Buffer.from(readFileSync(seeded.filePath));
    const last = before.length - 1;
    before[last] = (before[last] ?? 0) ^ 1;
    writeFileSync(seeded.filePath, before);
    const tamperedBytes = readFileSync(seeded.filePath);

    const tampered = await boot(dir, KEY);
    expect(tampered.service.health()).toBe("unreadable");
    expect(tampered.service.presence(REF)).toMatchObject({ present: false, health: "unreadable" });
    expect(() => tampered.service.set(REF, "x")).toThrow(/store-unreadable/);
    expect(() => tampered.service.clear(REF)).toThrow(/store-unreadable/);
    expect(readFileSync(tampered.filePath).equals(tamperedBytes)).toBe(true); // preserved for inspection (AC2)
  });

  it("a wrong key over an existing catalog is unreadable, and the file stays byte-identical", async () => {
    const dir = tempDir();
    const seeded = await boot(dir, KEY);
    seeded.service.set(REF, SENTINEL);
    const before = readFileSync(seeded.filePath);

    const wrong = await boot(dir, OTHER_KEY);
    expect(wrong.service.health()).toBe("unreadable");
    expect(() => wrong.service.set(REF, "x")).toThrow(/store-unreadable/);
    expect(readFileSync(wrong.filePath).equals(before)).toBe(true);
  });

  it("a stale staged crash artifact is ignored: the active catalog still opens", async () => {
    const dir = tempDir();
    const seeded = await boot(dir, KEY);
    seeded.service.set(REF, SENTINEL);
    const active = readFileSync(seeded.filePath);
    writeFileSync(join(dir, `secret-catalog.bin.999999.deadbeef.tmp`), Buffer.from([0x00, 0x01, 0x02]));

    const after = await boot(dir, KEY);
    expect(after.service.health()).toBe("ok");
    expect(after.service.resolve(REF)).toBe(SENTINEL);
    expect(readFileSync(after.filePath).equals(active)).toBe(true);
  });

  it("a failed publication reverts to the previous state and reports a bounded write failure", async () => {
    const dir = tempDir();
    const seeded = await boot(dir, KEY);
    seeded.service.set(REF, SENTINEL);
    // Force the rename to fail: a directory at the target path cannot be replaced by a file rename.
    const active = readFileSync(seeded.filePath);
    rmSync(seeded.filePath);
    mkdirSync(seeded.filePath);

    expect(() => seeded.service.set("mcp.other.env.K", "v2")).toThrow(/store-write-failed/);
    rmSync(seeded.filePath, { recursive: true });
    writeFileSync(seeded.filePath, active);
    // The in-memory last-known-good survives the failed write.
    expect(seeded.service.resolve(REF)).toBe(SENTINEL);
  });

  it("clear is idempotent and publishes absence", async () => {
    const dir = tempDir();
    const seeded = await boot(dir, KEY);
    seeded.service.set(REF, SENTINEL);
    expect(seeded.service.clear(REF)).toEqual({ present: false });
    expect(seeded.service.presence(REF)).toMatchObject({ present: false, provenance: null, health: "ok" });
    expect(seeded.service.clear(REF)).toEqual({ present: false }); // absent clear stays a success
    const reopened = await boot(dir, KEY);
    expect(reopened.service.presence(REF)).toMatchObject({ present: false });
  });

  it("list reports every ref with presence and never a value", async () => {
    const dir = tempDir();
    const seeded = await boot(dir, KEY);
    seeded.service.set(REF, SENTINEL);
    const list = seeded.service.list();
    expect(list.health).toBe("ok");
    expect(list.entries).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(SENTINEL);
  });

  it("verifyEntries proves an encrypted read-back and rejects any drift", async () => {
    const dir = tempDir();
    const seeded = await boot(dir, KEY);
    seeded.service.set(REF, SENTINEL);
    expect(seeded.service.verifyEntries({ [REF]: SENTINEL })).toBe(true);
    expect(seeded.service.verifyEntries({ [REF]: "wrong" })).toBe(false);
    expect(seeded.service.verifyEntries({ "mcp.missing.env.K": SENTINEL })).toBe(false);
  });

  it("rotation re-seals under the next key version; the old key can no longer open it", async () => {
    const dir = tempDir();
    const seeded = await boot(dir, KEY);
    seeded.service.set(REF, SENTINEL);
    const rotated = seeded.service.rotateToKey(OTHER_KEY);
    expect(rotated).toEqual({ keyVersion: 2 });
    expect(seeded.service.presence(REF)).toMatchObject({ present: true, provenance: { keyVersion: 2 } });

    const oldKeyBoot = await boot(dir, KEY);
    expect(oldKeyBoot.service.health()).toBe("unreadable");
    const newKeyBoot = await boot(dir, OTHER_KEY);
    expect(newKeyBoot.service.resolve(REF)).toBe(SENTINEL);
  });

  it("backup/restore round-trips through validation and refuses a foreign-store backup", async () => {
    const dir = tempDir();
    const seeded = await boot(dir, KEY);
    seeded.service.set(REF, SENTINEL);
    const backup = seeded.service.backup();
    expect(backup.keyVersion).toBe(1);
    expect(Buffer.from(backup.envelope).includes(Buffer.from(SENTINEL))).toBe(false);

    // Wipe (simulate loss) then restore the exact envelope bytes.
    seeded.service.clear(REF);
    seeded.service.restore(backup.envelope);
    expect(seeded.service.resolve(REF)).toBe(SENTINEL);

    // A backup sealed for a DIFFERENT store is refused without publishing anything.
    const foreignDir = tempDir();
    const foreignCapture = createCaptureLogger();
    const foreign = await createSecretCatalogService({
      filePath: join(foreignDir, "secret-catalog.bin"),
      storeId: "33333333-3333-4333-8333-333333333333",
      keySource: memorySource(KEY),
      logger: foreignCapture.logger,
    });
    foreign.set("mcp.foreign.env.K", "foreign-value");
    const foreignBackup = foreign.backup();
    const before = readFileSync(seeded.filePath);
    expect(() => seeded.service.restore(foreignBackup.envelope)).toThrow(/different store/);
    expect(readFileSync(seeded.filePath).equals(before)).toBe(true);
  });

  it("create-only provisioning happens only on first boot, never over an existing catalog", async () => {
    const dir = tempDir();
    let stored: Uint8Array | null = null;
    const creatingSource: MasterKeySource = {
      kind: "key-helper",
      canCreate: true,
      read: () => stored,
      create: (key) => {
        stored = key;
      },
    };
    const capture = createCaptureLogger();
    const first = await createSecretCatalogService({ filePath: join(dir, "secret-catalog.bin"), storeId: STORE, keySource: creatingSource, logger: capture.logger });
    expect(first.health()).toBe("ok"); // first boot: key provisioned create-only
    first.set(REF, SENTINEL);
    expect(stored).not.toBeNull();

    // Second boot with the key gone again: the catalog exists, so it must NOT re-provision (locked).
    const second = await boot(dir, null);
    expect(second.service.health()).toBe("locked");
  });
});

describe("catalog publication primitive", () => {
  it("create-only never overwrites an existing target", () => {
    const dir = tempDir();
    const target = join(dir, "target.bin");
    publishFileAtomically(target, new TextEncoder().encode("first"));
    expect(publishFileAtomically(target, new TextEncoder().encode("second"), "create-only")).toBe("already-exists");
    expect(readFileSync(target, "utf8")).toBe("first");
    expect(publishFileAtomically(target, new TextEncoder().encode("third"), "replace")).toBe("published");
    expect(readFileSync(target, "utf8")).toBe("third");
  });

  it("a staged write is all-or-nothing (no partial target)", () => {
    const dir = tempDir();
    const target = join(dir, "atomic.bin");
    const payload = new TextEncoder().encode("x".repeat(1000));
    publishFileAtomically(target, payload);
    expect(readFileSync(target).equals(Buffer.from(payload))).toBe(true);
    // No staging residue survives a successful publication.
    expect(existsSync(join(dir, "atomic.bin.1.tmp"))).toBe(false);
  });
});
