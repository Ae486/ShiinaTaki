import { afterEach, describe, expect, it } from "vitest";
import { RunEventV1Schema, RunEventV2Schema, TrajectoryInspectorSchema, TrajectoryResultSchema } from "@taki/shared";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import { createObservabilityQueryService } from "./observability-query-service.ts";

const fixtures: ReturnType<typeof initiativeFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.db.close(); });

describe("initiative mixed-version Monitor projection", () => {
  it("retains every v1/v2 sequence through legacy-valid forward/backward pages and durable reader reconstruction", async () => {
    const f = initiativeFixture(); fixtures.push(f); const identity = await f.admit();
    f.deliveries.stage({ ...identity, decision: { outcome: "silent", selectedCandidateIds: [] },
      expiresAt: new Date(Date.now() + 60_000).toISOString(), primaryVersion: 0, consideredCount: 1 });
    f.runs.settle(identity.runId, identity.attemptId, "completed");
    const canonical = f.events.list(identity.runId);
    for (const event of canonical) expect(() => (event.schemaVersion === "run-event.v1" ? RunEventV1Schema : RunEventV2Schema).parse(event)).not.toThrow();
    expect(new Set(canonical.map((event) => event.schemaVersion))).toEqual(new Set(["run-event.v1", "run-event.v2"]));
    const query = () => createObservabilityQueryService({ db: f.db, events: createRunEventRepo(f.db), mode: () => "FULL_LOCAL" });
    const rows = []; let cursor = 0;
    while (true) {
      // These existing client contracts keep their closed v1 eventKind enum. New business rows omit
      // that optional machine field while retaining the original durable sequence and semantic facts.
      const page = TrajectoryResultSchema.parse(query().trajectory({ characterId: "taki", runKey: identity.runId, afterSeq: cursor, limit: 2 }));
      rows.push(...page.rows);
      if (!page.hasMore) break;
      expect(page.cursor.seq).toBeGreaterThan(cursor); cursor = page.cursor.seq;
    }
    expect(rows.map((row) => row.seq)).toEqual(canonical.map((event) => event.seq));
    const business = canonical.find((event) => event.kind === "initiative.decision")!;
    expect(rows.find((row) => row.seq === business.seq)).toMatchObject({ kind: "lifecycle", label: "主动判断", summary: "保持安静" });
    expect(rows.find((row) => row.seq === business.seq)?.eventKind).toBeUndefined();
    const tail = query().trajectory({ characterId: "taki", runKey: identity.runId, afterSeq: 0, tail: true, limit: 2 });
    const older = query().trajectory({ characterId: "taki", runKey: identity.runId, afterSeq: 0, beforeSeq: tail.olderCursor!.seq, limit: 200 });
    expect([...older.rows, ...tail.rows].map((row) => row.seq)).toEqual(canonical.map((event) => event.seq));
    expect(TrajectoryInspectorSchema.parse(query().inspect({ characterId: "taki", runKey: identity.runId, rowKey: business.eventId })))
      .toMatchObject({ technical: [], detail: expect.arrayContaining([{ label: "决定", value: "保持安静" }]) });
    expect(query().list({ characterId: "taki", limit: 25 }).runs[0]).toMatchObject({ modelRequestCount: 0, toolCallCount: 0 });
  });
});
