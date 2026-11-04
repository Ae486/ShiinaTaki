import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfigRepo } from "../db/config-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { bootstrapCore, type CoreBootstrap } from "./core-bootstrap.ts";

// The provider slot is required at boot; these are construction-time values only (no request is ever made).
const PROVIDER_ENV = {
  TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:1/v1",
  TAKI_PROVIDER_API_KEY: "test-key",
  TAKI_PROVIDER_MODEL: "test-model",
  TAKI_LOG_LEVEL: "fatal", // keep test output clean
};

const dirs: string[] = [];
const booted: CoreBootstrap[] = [];

afterEach(() => {
  for (const boot of booted.splice(0)) boot.db.close();
  for (const dir of dirs.splice(0)) rmTempDir(dir);
});

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-boot-"));
  dirs.push(dir);
  return dir;
}

/** Pre-seed the store the way the settings panel would have, then boot against it. */
function storeKnob(dataDir: string, key: string, value: string | number | boolean): void {
  const db = openDatabase({ path: join(dataDir, "taki.db"), migrations: MIGRATIONS });
  createConfigRepo(db).upsert(key, value);
  db.close();
}

function boot(env: Record<string, string | undefined>): CoreBootstrap {
  const result = bootstrapCore({ ...PROVIDER_ENV, ...env });
  booted.push(result);
  return result;
}

describe("bootstrapCore", () => {
  it("ignores retired vision settings while keeping their historical stored values", () => {
    const dataDir = tempDataDir();
    storeKnob(dataDir, "TAKI_VLM_MODEL", "old-vision");
    const result = boot({ TAKI_DATA_DIR: dataDir, TAKI_VLM_BASE_URL: "partial-old-config", TAKI_VLM_CONTEXT_TOKENS: "obsolete" });
    expect(result.model).toMatchObject({ modelId: PROVIDER_ENV.TAKI_PROVIDER_MODEL });
    expect(result).not.toHaveProperty("visionModel");
    expect(result.config.source.resolve("TAKI_VLM_MODEL")).toBeUndefined();
    expect(result.config.repo.get("TAKI_VLM_MODEL")).toBe("old-vision");
    expect(result.contextConfig.contextTokens).not.toHaveProperty("vision");
  });
  it("reports committed callback failures with a bounded code and preserves later cleanup", () => {
    const result = boot({ TAKI_DATA_DIR: tempDataDir() });
    const warning = vi.spyOn(result.logger, "warn").mockImplementation(() => {});
    let cleaned = false;
    expect(() => result.db.transaction(() => {
      result.db.afterCommit(() => { throw new Error("private callback text must not enter logs"); });
      result.db.afterCommit(() => { cleaned = true; });
    })).not.toThrow();
    expect(cleaned).toBe(true);
    expect(warning).toHaveBeenCalledExactlyOnceWith({ code: "SQLITE_AFTER_COMMIT_FAILED" }, "Committed database callback failed");
    warning.mockRestore();
  });
  it("notifies local policy after commit despite a failed socket or local observer", () => {
    const seen: unknown[] = [];
    const result = bootstrapCore({ ...PROVIDER_ENV, TAKI_DATA_DIR: tempDataDir() }, { onConfigChanged(key) {
      seen.push(result.config.source.resolve(key)?.value); throw new Error("local observer failed");
    } });
    booted.push(result);
    result.config.subscriptions.subscribe({ state: { status: "awaiting" } }, () => { throw new Error("socket failed"); });
    expect(result.config.writer.set({ key: "TAKI_INITIATIVE_ENABLED", value: true })).toMatchObject({ ok: true });
    expect(seen).toEqual([true]);
    expect(result.config.repo.get("TAKI_INITIATIVE_ENABLED")).toBe(true);
  });

  it("boots on defaults when neither env nor store says otherwise", () => {
    const result = boot({ TAKI_DATA_DIR: tempDataDir() });

    expect(result.agentConfig.maxSteps).toBe(10);
    expect(result.contextConfig.compact.keepMessages).toBe(40);
  });

  it("a STORED value takes effect at boot when the env var is absent (this is what restart-to-apply means)", () => {
    const dataDir = tempDataDir();
    storeKnob(dataDir, "TAKI_MAX_STEPS", 27);
    storeKnob(dataDir, "TAKI_ATTACHMENT_TTL_DAYS", 3);

    const result = boot({ TAKI_DATA_DIR: dataDir });

    expect(result.agentConfig.maxSteps).toBe(27);
    expect(result.attachmentConfig.ttlDays).toBe(3);
    expect(result.env.TAKI_MAX_STEPS).toBe("27");
  });

  it("an env var still outranks the stored value", () => {
    const dataDir = tempDataDir();
    storeKnob(dataDir, "TAKI_MAX_STEPS", 27);

    expect(boot({ TAKI_DATA_DIR: dataDir, TAKI_MAX_STEPS: "5" }).agentConfig.maxSteps).toBe(5);
  });

  it("the data root itself is never taken from the store (env-only bootstrap knob)", () => {
    const dataDir = tempDataDir();
    storeKnob(dataDir, "TAKI_DATA_DIR", join(tmpdir(), "taki-should-not-be-used"));

    expect(boot({ TAKI_DATA_DIR: dataDir }).serverConfig.dataDir).toBe(dataDir);
  });

  it("a stored value the loader rejects is fatal at boot, never silently defaulted", () => {
    const dataDir = tempDataDir();
    // Bypasses the writer's validation the way a hand-edited db would.
    storeKnob(dataDir, "TAKI_WS_PORT", 70000);

    expect(() => boot({ TAKI_DATA_DIR: dataDir })).toThrow();
  });

  it("exposes a config plane whose writer and source agree with the store", () => {
    const dataDir = tempDataDir();
    const result = boot({ TAKI_DATA_DIR: dataDir });

    expect(result.config.writer.set({ key: "TAKI_MAX_STEPS", value: 33 }).ok).toBe(true);
    expect(result.config.source.resolve("TAKI_MAX_STEPS")).toEqual({ value: 33, origin: "stored" });
    // The already-composed agent config keeps its value — that is exactly what "restart to apply" means.
    expect(result.agentConfig.maxSteps).toBe(10);
  });
});
