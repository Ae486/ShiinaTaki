import { expect, it } from "vitest";
import { openDatabase } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createConfigSource } from "./config-source.ts";
import { createConfigWriter } from "./config-writer.ts";
import { createConfigSubscriptions } from "./config-subscriptions.ts";
import { loadHindsightPolicyReviewConfig } from "./hindsight-policy-config.ts";

// Failure modes: config.set accepts an unusable wall time or settings fail to reach the live source/notification chain.
it("validates review settings through the existing config owner and publishes after storage", () => {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const repo = createConfigRepo(db);
  const source = createConfigSource({ env: {}, repo }); const notifications = createConfigSubscriptions();
  const changes: string[] = [];
  const dispose = notifications.observe((change) => { expect(repo.get(change.key)).toEqual(change.value); changes.push(change.key); });
  const writer = createConfigWriter({ env: {}, repo, onChanged: notifications.publish });
  try {
    expect(loadHindsightPolicyReviewConfig(source.env())).toEqual({ mode: "daily", time: "03:00", intervalMs: 86_400_000, threshold: 100 });
    for (const [key, value] of [["MODE", "interval"], ["TIME", "04:30"], ["INTERVAL_MS", 3_600_000], ["THRESHOLD", 10]] as const) {
      expect(writer.set({ key: `TAKI_HINDSIGHT_POLICY_REVIEW_${key}`, value })).toMatchObject({ ok: true, apply: "live" });
    }
    expect(loadHindsightPolicyReviewConfig(source.env())).toEqual({ mode: "interval", time: "04:30", intervalMs: 3_600_000, threshold: 10 });
    expect(source.effectiveAll().filter((row) => row.key.startsWith("TAKI_HINDSIGHT_POLICY_REVIEW_")).every((row) => row.stored && !row.envLocked)).toBe(true);
    expect(writer.set({ key: "TAKI_HINDSIGHT_POLICY_REVIEW_TIME", value: "24:00" })).toMatchObject({ ok: false, reason: "invalid-value" });
    expect(changes).toHaveLength(4);
  } finally { dispose(); db.close(); }
});
