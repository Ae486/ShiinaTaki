import { afterEach, describe, expect, it } from "vitest";
import { createHindsightIngestionSourceRepo } from "./hindsight-ingestion-source-repo.ts";
import { createHindsightActivationHarness, type HindsightActivationHarness } from "../memory/hindsight-activation/hindsight-activation-fixture.ts";
import { readMemoryAuthoritySelection } from "../memory/legacy-migration/legacy-activation-repo.ts";
import { scriptedGenerateModel } from "../testing/mock-language-model.ts";

const harnesses: HindsightActivationHarness[] = [];
afterEach(async () => { for (const harness of harnesses.splice(0)) await harness.close(); });
function harness(...args: Parameters<typeof createHindsightActivationHarness>) {
  const value = createHindsightActivationHarness(...args); harnesses.push(value); return value;
}
const text = (value: unknown) => ({ kind: "text" as const, deltas: [typeof value === "string" ? value : JSON.stringify(value)] });
const count = (h: HindsightActivationHarness, sql: string) => Number(h.db.prepare(sql).get()?.n ?? 0);

describe("PR03 custody carry inside the promotion transaction", () => {
  it("drains pre-activation witnesses, carries interval witnesses once, seeds cursors and reassigns open groups", async () => {
    const h = harness({ model: scriptedGenerateModel([text({ decision: "skip" })]) }); const before = h.primary();
    const session = h.custody.begin({ characterId: "taki", runId: "run-open", repo: h.timeline });
    session.repo.append({ characterId: "taki", role: "user", content: "still typing" });
    let interval: ReturnType<typeof h.primary> = [];
    h.transport.before(({ route }) => { if (route === "verification-page" && interval.length === 0) interval = h.primary("second question", "second answer"); });
    const receipt = await h.service.start(h.identity(), h.control());
    expect(receipt.carriedWitnessCount).toBe(2);
    expect(count(h, "SELECT count(*) AS n FROM canonical_memory_ingestion_spans WHERE state='complete'")).toBe(1);
    const rows = h.db.prepare("SELECT timeline_seq,ingestion_span_id FROM hindsight_ingestion_primary_commits WHERE authority_epoch_id='hindsight-epoch' ORDER BY timeline_seq").all();
    expect(rows).toEqual(interval.map((entry) => ({ timeline_seq: entry.seq, ingestion_span_id: null })));
    expect(count(h, "SELECT count(*) AS n FROM canonical_memory_primary_commits WHERE ingestion_span_id IS NULL")).toBe(2);
    expect(count(h, `SELECT count(*) AS n FROM canonical_memory_primary_commits WHERE timeline_seq IN (${before.map((entry) => entry.seq).join(",")}) AND ingestion_span_id IS NOT NULL`)).toBe(2);
    expect(h.db.prepare("SELECT assigned_epoch_id,state FROM primary_memory_groups WHERE group_id=:id").get({ id: session.groupId }))
      .toEqual({ assigned_epoch_id: "hindsight-epoch", state: "open" });
    expect(h.db.prepare("SELECT eligibility_start_seq,through_seq FROM hindsight_ingestion_cursors WHERE authority_epoch_id='hindsight-epoch' AND character_id='taki'").get())
      .toEqual({ eligibility_start_seq: interval[1]!.seq + 1, through_seq: 0 });
    session.finalize();
    expect(h.db.prepare("SELECT state FROM primary_memory_groups WHERE group_id=:id").get({ id: session.groupId })?.state).toBe("finalized");
    expect(count(h, "SELECT count(*) AS n FROM hindsight_ingestion_primary_commits WHERE authority_epoch_id='hindsight-epoch'")).toBe(3);
    expect(count(h, "SELECT count(*) AS n FROM canonical_memory_primary_commits")).toBe(4);
  });

  it("refuses promotion while a Local span is incomplete, keeps Local intact and completes once resume drains it", async () => {
    const h = harness({ model: scriptedGenerateModel([text("not a gate decision"), text({ decision: "skip" })]) });
    h.transport.before(async ({ route }) => {
      if (route !== "verification-page" || count(h, "SELECT count(*) AS n FROM canonical_memory_ingestion_spans") > 0) return;
      h.primary(); await h.subsystem.ingestion.run({ characterId: "taki" }).catch(() => undefined);
    });
    await expect(h.service.start(h.identity(), h.control())).rejects.toThrow("MEMORY_INGESTION_INCOMPLETE");
    expect(count(h, "SELECT count(*) AS n FROM canonical_memory_ingestion_spans WHERE state='pending'")).toBe(1);
    expect(readMemoryAuthoritySelection(h.db)).toMatchObject({ mode: "canonical-local", epochId: h.local.epochId });
    expect(count(h, "SELECT count(*) AS n FROM canonical_memory_authority_epochs WHERE epoch_id='hindsight-epoch'")).toBe(0);
    expect(count(h, "SELECT count(*) AS n FROM hindsight_ingestion_primary_commits")).toBe(0);
    expect(h.subsystem.fence.writable()).toBe(true);
    h.transport.before(null);
    const receipt = await h.service.resumeActivation(h.identity("op-2"), h.control());
    expect(receipt.carriedWitnessCount).toBe(0);
    expect(count(h, "SELECT count(*) AS n FROM canonical_memory_ingestion_spans WHERE state='complete'")).toBe(1);
  });

  it("lets Hindsight ingestion claim a carried witness exactly once and treats a re-record as the same commit", async () => {
    const h = harness(); let entries: ReturnType<typeof h.primary> = [];
    h.transport.before(({ route }) => { if (route === "verification-page" && entries.length === 0) entries = h.primary(); });
    await h.service.start(h.identity(), h.control());
    const witnesses = createHindsightIngestionSourceRepo(h.db); const scope = { epochId: "hindsight-epoch", characterId: "taki" };
    const pending = witnesses.pendingEntries({ ...scope, throughSeq: entries[1]!.seq });
    expect(pending.map((proof) => proof.entry.seq)).toEqual(entries.map((entry) => entry.seq));
    witnesses.recordPrimaryCommitted({ characterId: "taki", entries, epochId: "hindsight-epoch", now: "2026-09-23T00:01:00.000Z" });
    expect(witnesses.unprocessedCount(scope)).toBe(2);
    expect(() => witnesses.recordPrimaryCommitted({ characterId: "taki", entries, epochId: "hindsight-epoch", runId: "other-run", now: "2026-09-23T00:01:00.000Z" }))
      .toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
  });
});
