import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { triggerCapability } from "./fixture/operator-drivers.ts";
import { withStack } from "./fixture/with-stack.ts";
import { CORE_DIR } from "./fixture/paths.ts";

const CONTENT_SENTINEL = "e2e-canonical-memory-content-sentinel";

/**
 * Process-level Slice 3C proof: the persisted authority marker is present before the first Core boot, so the real
 * composition selects canonical Local, exposes canonical tools through the dev-only real-tool drive, and never
 * constructs the retired Markdown runtime. The DB is temporary and all content assertions stay out of logs/events.
 */
describe("canonical Local Memory production composition", () => {
  it("boots canonical-local, executes one governed Memory Effect, and retires legacy surfaces", async () => {
    await withStack({
      provider: "dummy",
      startNode: false,
      devTrigger: true,
      prepareCoreData: seedCanonicalLocal,
    }, async (stack) => {
      const operator = await stack.operator();
      const driven = await triggerCapability(operator, {
        capability: "retain",
        input: { content: CONTENT_SENTINEL, layer: "profile", context: null },
        lifecycle: true,
        timeoutMs: 60_000,
      }) as { runId: string; attemptId: string; result: { ok: boolean } };
      expect(driven.result.ok).toBe(true);

      const db = new DatabaseSync(join(stack.coreDataDir, "taki.db"), { readOnly: true });
      try {
        const marker = db.prepare("SELECT mode,active_epoch_id,verified_snapshot_id,activation_transaction_id FROM memory_authority_selection WHERE singleton=1").get() as Record<string, unknown>;
        expect(marker).toMatchObject({ mode: "canonical-local", active_epoch_id: expect.any(String), verified_snapshot_id: "e2e-snapshot", activation_transaction_id: "e2e-activation" });

        const effects = db.prepare("SELECT effect_id,kind,state,outcome,source_ref_json,executor_ref_json FROM run_effects WHERE run_id=:run ORDER BY created_at").all({ run: driven.runId }) as Array<Record<string, unknown>>;
        expect(effects).toHaveLength(1);
        expect(effects[0]).toMatchObject({ kind: "memory", state: "terminal", outcome: "completed" });
        expect(String(effects[0]?.source_ref_json)).toMatch(/"type":"memory"/);
        expect(String(effects[0]?.source_ref_json)).toContain(String(marker.active_epoch_id));
        expect(String(effects[0]?.source_ref_json)).toContain("local");
        expect(String(effects[0]?.source_ref_json)).not.toContain(CONTENT_SENTINEL);
        expect(String(effects[0]?.executor_ref_json)).not.toContain(CONTENT_SENTINEL);

        const effectEvents = db.prepare("SELECT kind,payload_json FROM run_events WHERE run_id=:run AND kind LIKE 'effect.%' ORDER BY seq").all({ run: driven.runId }) as Array<{ kind: string; payload_json: string }>;
        expect(effectEvents.map((event) => event.kind)).toEqual(["effect.intent_committed", "effect.settled"]);
        expect(effectEvents.map((event) => event.payload_json).join("\n")).not.toContain(CONTENT_SENTINEL);

        const stored = db.prepare("SELECT count(*) AS n FROM canonical_memory_units WHERE text=:text").get({ text: CONTENT_SENTINEL }) as { n: number };
        expect(stored.n).toBe(1);
      } finally {
        db.close();
      }

      // Canonical composition does not construct the legacy Markdown root or fire its detached AutoMemory writer.
      expect(existsSync(join(stack.coreDataDir, "workspace", "memory"))).toBe(false);
      expect(stack.core.stdout.lines().join("\n")).not.toContain(CONTENT_SENTINEL);
    });
  }, 120_000);
});

function seedCanonicalLocal(dataDir: string): void {
  const sqliteUrl = pathToFileURL(join(CORE_DIR, "src", "db", "sqlite.ts")).href;
  const migrationsUrl = pathToFileURL(join(CORE_DIR, "src", "db", "migrations", "index-list.ts")).href;
  const authorityUrl = pathToFileURL(join(CORE_DIR, "src", "db", "canonical-memory-authority-repo.ts")).href;
  const script = `
    const { openDatabase } = await import(${JSON.stringify(sqliteUrl)});
    const { MIGRATIONS } = await import(${JSON.stringify(migrationsUrl)});
    const { createCanonicalMemoryAuthorityRepo } = await import(${JSON.stringify(authorityUrl)});
    const db = openDatabase({ path: process.argv[1], migrations: MIGRATIONS });
    const now = "2026-08-25T00:00:00.000Z";
    const authority = createCanonicalMemoryAuthorityRepo(db);
    const epoch = authority.initializeLocalAuthority(now);
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "e2e-global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "e2e", config: {}, createdAt: now, updatedAt: now });
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "e2e-character", scope: { kind: "character", characterId: "taki" }, name: "Taki", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "e2e", config: {}, createdAt: now, updatedAt: now });
    db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,verified_snapshot_id='e2e-snapshot',activation_transaction_id='e2e-activation',updated_at=:now WHERE singleton=1").run({ epoch: epoch.epochId, now });
    db.close();
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", script, join(dataDir, "taki.db")], { cwd: join(CORE_DIR, "..", ".."), stdio: "pipe" });
}
