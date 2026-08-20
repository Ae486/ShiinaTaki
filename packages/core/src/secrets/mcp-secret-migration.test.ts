/**
 * INPUT:  seeded mcp-servers.json files (plaintext env/headers) + real or stubbed catalog views
 * OUTPUT: AC4 ordering proofs: copy → verify → rewrite; every failure leaves the source byte-identical;
 *         idempotent re-runs; collision guard; locked-store skip; sentinel never lands in the rewritten source
 * POS:    core/secrets — the migration-order test; failure paths use stub catalogs to force each stage
 */
import { readFileSync, rmSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { generateCatalogKey } from "./secret-catalog-envelope.ts";
import { migrateMcpPlaintextSecrets, type MigrationCatalogView } from "./mcp-secret-migration.ts";
import { createSecretCatalogService, type SecretCatalogService } from "./secret-catalog-service.ts";
import type { MasterKeySource } from "./master-key.ts";

const STORE = "11111111-1111-4111-8111-111111111111";
const SENTINEL = "sentinel-not-a-real-secret-value-0123456789";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-secret-migration-"));
  dirs.push(dir);
  return dir;
}

const MASTER_KEY = generateCatalogKey();
const keySource = (key: Uint8Array): MasterKeySource => ({ kind: "credentials-directory", canCreate: false, read: () => key, create: () => undefined });

async function realCatalog(dir: string): Promise<SecretCatalogService> {
  return createSecretCatalogService({ filePath: join(dir, "secret-catalog.bin"), storeId: STORE, keySource: keySource(MASTER_KEY), logger: createCaptureLogger().logger });
}

function seedConfig(dir: string, servers: unknown): string {
  const path = join(dir, "mcp-servers.json");
  writeFileSync(path, JSON.stringify(servers, null, 2));
  return path;
}

const PLAINTEXT_CONFIG = {
  "github-mcp": { command: "node", args: ["server.js"], env: { GITHUB_TOKEN: SENTINEL, NODE_ENV: "production" } },
  "search-mcp": { url: "https://search.example/mcp", headers: { "X-Api-Key": SENTINEL, Accept: "application/json" } },
};

describe("mcp plaintext secret migration (AC4 ordering)", () => {
  it("copies, verifies, then rewrites — and the rewritten source carries markers, never values", async () => {
    const dir = tempDir();
    const configPath = seedConfig(dir, PLAINTEXT_CONFIG);
    const catalog = await realCatalog(dir);
    const logs = createCaptureLogger();

    const result = migrateMcpPlaintextSecrets({ catalog, configPath, logger: logs.logger });
    // Every env/header VALUE moves (the whole map is treated as credential material — ADR 0006); plain-looking
    // entries like NODE_ENV ride along rather than being classified here.
    expect(result).toEqual({ status: "migrated", secrets: 4, servers: 2 });

    const rewritten = readFileSync(configPath, "utf8");
    expect(rewritten).not.toContain(SENTINEL); // the only plaintext copy is gone AFTER verified encryption
    expect(rewritten).toContain("secret-ref:mcp.github-mcp.env.GITHUB_TOKEN");
    expect(rewritten).toContain("secret-ref:mcp.search-mcp.header.X-Api-Key");
    expect(rewritten).not.toContain("production"); // plain-looking env values moved too (whole-map policy)
    // Non-secret CONFIG fields (command/args/url) survive untouched; env/header field NAMES survive as marker keys.
    const parsed = JSON.parse(rewritten) as Record<string, { command?: string; args?: string[]; url?: string; env?: Record<string, string>; headers?: Record<string, string> }>;
    expect(parsed["github-mcp"]?.command).toBe("node");
    expect(parsed["github-mcp"]?.args).toEqual(["server.js"]);
    expect(parsed["github-mcp"]?.env?.NODE_ENV).toBe("secret-ref:mcp.github-mcp.env.NODE_ENV");
    expect(parsed["search-mcp"]?.url).toBe("https://search.example/mcp");
    expect(parsed["search-mcp"]?.headers?.Accept).toBe("secret-ref:mcp.search-mcp.header.Accept");
    // The catalog resolves every marker back (values live encrypted now).
    expect(catalog.resolve("mcp.github-mcp.env.GITHUB_TOKEN")).toBe(SENTINEL);
    expect(catalog.resolve("mcp.github-mcp.env.NODE_ENV")).toBe("production");
    expect(catalog.resolve("mcp.search-mcp.header.X-Api-Key")).toBe(SENTINEL);
    expect(JSON.stringify(logs.records)).not.toContain(SENTINEL);
  });

  it("is idempotent: a second run over markerized config migrates nothing", async () => {
    const dir = tempDir();
    const configPath = seedConfig(dir, PLAINTEXT_CONFIG);
    const catalog = await realCatalog(dir);
    migrateMcpPlaintextSecrets({ catalog, configPath, logger: createCaptureLogger().logger });
    const afterFirst = readFileSync(configPath, "utf8");
    const second = migrateMcpPlaintextSecrets({ catalog, configPath, logger: createCaptureLogger().logger });
    expect(second).toEqual({ status: "skipped", reason: "nothing-to-migrate" });
    expect(readFileSync(configPath, "utf8")).toBe(afterFirst);
  });

  it("a verification failure leaves the source byte-identical (never rewrite before proof)", async () => {
    const dir = tempDir();
    const configPath = seedConfig(dir, PLAINTEXT_CONFIG);
    const catalog = await realCatalog(dir);
    const before = readFileSync(configPath);
    const stub: MigrationCatalogView = {
      health: () => "ok",
      set: (ref, value) => catalog.set(ref, value),
      verifyEntries: () => false, // force stage-2 failure after a successful copy
    };
    expect(migrateMcpPlaintextSecrets({ catalog: stub, configPath, logger: createCaptureLogger().logger })).toEqual({
      status: "skipped",
      reason: "verify-failed",
    });
    expect(readFileSync(configPath).equals(before)).toBe(true);
  });

  it("a copy failure leaves the source byte-identical", async () => {
    const dir = tempDir();
    const configPath = seedConfig(dir, PLAINTEXT_CONFIG);
    const before = readFileSync(configPath);
    const stub: MigrationCatalogView = {
      health: () => "ok",
      set: () => {
        throw new Error("disk full");
      },
      verifyEntries: () => true,
    };
    expect(migrateMcpPlaintextSecrets({ catalog: stub, configPath, logger: createCaptureLogger().logger })).toEqual({
      status: "skipped",
      reason: "write-failed",
    });
    expect(readFileSync(configPath).equals(before)).toBe(true);
  });

  it("a locked catalog skips migration and leaves the source untouched", () => {
    const dir = tempDir();
    const configPath = seedConfig(dir, PLAINTEXT_CONFIG);
    const before = readFileSync(configPath);
    const stub: MigrationCatalogView = { health: () => "locked", set: () => undefined, verifyEntries: () => false };
    expect(migrateMcpPlaintextSecrets({ catalog: stub, configPath, logger: createCaptureLogger().logger })).toEqual({
      status: "skipped",
      reason: "store-locked",
    });
    expect(readFileSync(configPath).equals(before)).toBe(true);
  });

  it("a sanitized ref collision aborts without rewriting (distinct keys must not merge)", () => {
    const dir = tempDir();
    const configPath = seedConfig(dir, {
      "a.b": { command: "node", env: { TOKEN: SENTINEL } },
      a_b: { command: "node", env: { TOKEN: "another-value" } },
    });
    const before = readFileSync(configPath);
    const stub: MigrationCatalogView = { health: () => "ok", set: () => undefined, verifyEntries: () => false };
    expect(migrateMcpPlaintextSecrets({ catalog: stub, configPath, logger: createCaptureLogger().logger })).toEqual({
      status: "skipped",
      reason: "collision",
    });
    expect(readFileSync(configPath).equals(before)).toBe(true);
  });

  it("reserves an existing marker identity before planning an incremental plaintext write", () => {
    const dir = tempDir();
    const configPath = seedConfig(dir, {
      "a.b": { command: "node", env: { TOKEN: "secret-ref:mcp.a_b.env.TOKEN" } },
      a_b: { command: "node", env: { TOKEN: "must-not-overwrite-the-existing-owner" } },
    });
    const before = readFileSync(configPath);
    const setCalls: unknown[] = [];
    const stub: MigrationCatalogView = {
      health: () => "ok",
      set: (...args) => setCalls.push(args),
      verifyEntries: () => true,
    };

    expect(migrateMcpPlaintextSecrets({ catalog: stub, configPath, logger: createCaptureLogger().logger })).toEqual({
      status: "skipped",
      reason: "collision",
    });
    expect(setCalls).toEqual([]);
    expect(readFileSync(configPath).equals(before)).toBe(true);
  });

  it("rejects a marker whose opaque ref does not belong to its source identity", () => {
    const dir = tempDir();
    const configPath = seedConfig(dir, {
      server: { command: "node", env: { TOKEN: "secret-ref:mcp.other.env.TOKEN", NEXT: SENTINEL } },
    });
    const before = readFileSync(configPath);
    let setCount = 0;
    const stub: MigrationCatalogView = {
      health: () => "ok",
      set: () => { setCount += 1; },
      verifyEntries: () => true,
    };

    expect(migrateMcpPlaintextSecrets({ catalog: stub, configPath, logger: createCaptureLogger().logger })).toEqual({
      status: "skipped",
      reason: "collision",
    });
    expect(setCount).toBe(0);
    expect(readFileSync(configPath).equals(before)).toBe(true);
  });

  it("a missing or unparsable config is a clean skip", () => {
    const dir = tempDir();
    const stub: MigrationCatalogView = { health: () => "ok", set: () => undefined, verifyEntries: () => false };
    expect(migrateMcpPlaintextSecrets({ catalog: stub, configPath: join(dir, "absent.json"), logger: createCaptureLogger().logger })).toEqual({
      status: "skipped",
      reason: "no-config",
    });
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    expect(migrateMcpPlaintextSecrets({ catalog: stub, configPath: bad, logger: createCaptureLogger().logger })).toEqual({
      status: "skipped",
      reason: "no-config",
    });
  });

  it("an unreadable (tampered) catalog skips migration", async () => {
    const dir = tempDir();
    const configPath = seedConfig(dir, PLAINTEXT_CONFIG);
    const catalog = await realCatalog(dir);
    catalog.set("mcp.github-mcp.env.GITHUB_TOKEN", SENTINEL);
    const file = join(dir, "secret-catalog.bin");
    const bytes = Buffer.from(readFileSync(file));
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) ^ 1;
    writeFileSync(file, bytes);
    const reopened = await createSecretCatalogService({ filePath: file, storeId: STORE, keySource: keySource(MASTER_KEY), logger: createCaptureLogger().logger });
    expect(reopened.health()).toBe("unreadable");
    const before = readFileSync(configPath);
    expect(migrateMcpPlaintextSecrets({ catalog: reopened, configPath, logger: createCaptureLogger().logger })).toEqual({
      status: "skipped",
      reason: "store-unreadable",
    });
    expect(readFileSync(configPath).equals(before)).toBe(true);
    expect(existsSync(configPath)).toBe(true);
  });
});
