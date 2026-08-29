import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { triggerCapability } from "./fixture/operator-drivers.ts";
import { seedCanonicalLocal } from "./fixture/seed-canonical-memory.ts";
import { withStack } from "./fixture/with-stack.ts";

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
