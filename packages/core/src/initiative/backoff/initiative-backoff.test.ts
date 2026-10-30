import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { RunSnapshotSchema, type HeartbeatDecision } from "@taki/shared";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createRunRepo } from "../../db/run-repo.ts";
import { createRunEventRepo } from "../../db/run-event-repo.ts";
import { createRunDeliveryRepo } from "../../db/run-delivery-repo.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";
import { createRunService } from "../../harness/run-service.ts";
import { createConversationStore } from "../../agents/conversation-store.ts";
import { createRunServiceStub } from "../../testing/run-service-stub.ts";
import { createInitiativeFeedbackRepo } from "../../presence/initiative-feedback-repo.ts";
import { FEEDBACK_DEADLINE_MS, FEEDBACK_OPPORTUNITY_MS } from "../../presence/presence-policy.ts";
import { createInitiativeBackoff } from "./initiative-backoff.ts";
import { BACKOFF_WINDOW_MS } from "./backoff-repo.ts";

const BASE = Date.parse("2026-09-28T12:00:00.000Z");
const DAY = 86_400_000;
const dbs: Database[] = []; const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-backoff-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(options: { path?: string; observer?: () => void } = {}) {
  vi.useFakeTimers(); vi.setSystemTime(BASE);
  const db = openDatabase({ path: options.path ?? ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const config = { timezone: "UTC", modelIntervalMs: 900_000 };
  const events = createRunEventRepo(db); const repo = createRunRepo(db, events);
  const runs = createRunService({ repo, provider: "test", modelId: "test", snapshot: {
    async capture(request) {
      const old = await createRunServiceStub().admit(request);
      const snapshot = RunSnapshotSchema.omit({ snapshotId: true, runId: true, capturedAt: true, manifestDigest: true }).strip().parse(old.snapshot);
      return { snapshot, context: {} };
    },
  } });
  const deliveries = createRunDeliveryRepo({ db, events }); const timeline = createTimelineRepo(db);
  const store = createConversationStore({ repo: timeline });
  const feedback = createInitiativeFeedbackRepo({ db, commitFact(fact) {
    events.append({ runId: fact.runId, attemptId: fact.attemptId, schemaVersion: "run-event.v2", category: "lifecycle",
      kind: fact.kind, source: "core.delivery", occurredAt: fact.occurredAt,
      payload: { kind: fact.kind, deliveryId: fact.deliveryId, state: fact.kind === "delivery.presented" ? "presented" : "feedback_settled",
        opportunityMs: fact.opportunityMs, ...(fact.disposition ? { disposition: fact.disposition } : {}) } });
  }, publishFacts: options.observer });
  const backoff = createInitiativeBackoff({ db, timezone: () => config.timezone,
    modelIntervalMs: () => config.modelIntervalMs, onChanged: options.observer });
  return { db, runs, deliveries, timeline, store, feedback, backoff, config };
}
type Fixture = ReturnType<typeof fixture>;
async function admit(f: Fixture, options: { characterId?: string; deliveryClass?: "class_a" | "class_b"; capture?: boolean } = {}) {
  const id = randomUUID(); const characterId = options.characterId ?? "taki"; const deliveryClass = options.deliveryClass ?? "class_b";
  const admitted = await f.runs.admit({ triggerRequestId: id, idempotencyKey: id, characterId,
    initiator: deliveryClass === "class_b" ? "heartbeat" : "scheduled", provenance: { provider: "test" }, deliveryClass, contextMode: "autonomous" });
  f.runs.start(admitted.run.runId, admitted.attempt.attemptId);
  if (deliveryClass === "class_b" && options.capture !== false) f.backoff.recordAdmission(admitted.run.runId);
  return { runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, characterId, deliveryClass };
}
async function invitation(f: Fixture, options: { outcome?: "speak" | "silent" | "express"; expectation?: "invitation" | "none";
  publish?: boolean; qualified?: boolean; deliveryClass?: "class_a" | "class_b" } = {}) {
  const identity = await admit(f, options);
  const outcome = options.outcome ?? "speak";
  const decision: HeartbeatDecision = outcome === "speak"
    ? { outcome, selectedCandidateIds: ["candidate"], text: "A question", presentation: null, responseExpectation: options.expectation ?? "invitation" }
    : outcome === "express" ? { outcome, selectedCandidateIds: ["candidate"], presentation: { kind: "expression", name: "calm" } }
      : { outcome, selectedCandidateIds: [] };
  f.deliveries.stage({ ...identity, decision, expiresAt: new Date(Date.now() + 60_000).toISOString(), primaryVersion: 0, consideredCount: 1 });
  f.runs.settle(identity.runId, identity.attemptId, "completed");
  const entry = outcome === "speak" && options.publish !== false ? f.deliveries.commitPublication({ runId: identity.runId,
    policy: { hourLimit: 100, dayLimit: 100, gapMs: 0, dayStart: new Date(Date.now() - DAY).toISOString(), timezone: f.config.timezone }, append: f.store.appendDelivery }) : undefined;
  f.feedback.syncPublished();
  if (entry && options.qualified !== false) {
    const reference = { characterId: identity.characterId, timelineSeq: entry.seq };
    f.feedback.present(reference);
    const start = Date.now(); vi.setSystemTime(start + FEEDBACK_OPPORTUNITY_MS);
    f.feedback.observeInterval({ ...reference, start, end: Date.now() });
  }
  return { ...identity, timelineSeq: entry?.seq };
}
async function weak(f: Fixture, count: number) {
  for (let index = 0; index < count; index++) await invitation(f);
  vi.setSystemTime(Date.now() + FEEDBACK_DEADLINE_MS); f.feedback.settleDue();
}

describe("qualified feedback backoff", () => {
  it("uses real C2 dispositions at 3/6/9 and ignores replay without changing hard counters", async () => {
    const f = fixture(); vi.setSystemTime(BASE - 2 * DAY);
    for (const [added, count, stage, multiplier] of [[2, 2, "normal", 1], [1, 3, "double", 2], [3, 6, "quadruple", 4], [3, 9, "daily", 4]] as const) {
      await weak(f, added);
      expect(f.backoff.read("taki")).toMatchObject({ qualifiedWeakCount: count, stage, spacingMultiplier: multiplier });
      f.feedback.settleDue(); expect(f.backoff.read("taki").qualifiedWeakCount).toBe(count);
    }
    const before = f.db.prepare("SELECT count(*) AS n FROM run_deliveries WHERE charged_at IS NOT NULL").get();
    expect(before?.n).toBe(9); f.backoff.reset("taki");
    expect(f.backoff.read("taki")).toMatchObject({ stage: "normal", qualifiedWeakCount: 0, lastResetReason: "operator" });
    expect(f.db.prepare("SELECT count(*) AS n FROM run_deliveries WHERE charged_at IS NOT NULL").get()).toEqual(before);
  });

  it("excludes absent opportunity, no invitation, Class A, silent, express and unpresented held speech", async () => {
    const f = fixture();
    for (const options of [{ qualified: false }, { expectation: "none" }, { deliveryClass: "class_a" },
      { outcome: "silent" }, { outcome: "express" }, { publish: false }] as const) await invitation(f, options);
    vi.setSystemTime(Date.now() + FEEDBACK_DEADLINE_MS); f.feedback.settleDue();
    expect(f.feedback.list("taki").map((row) => row.disposition)).toEqual(["unknown"]);
    expect(f.backoff.read("taki")).toMatchObject({ qualifiedWeakCount: 0, stage: "normal" });
  });

  it("tightens the existing cadence, uses actual admissions and expires evidence at the rolling seven-day boundary", async () => {
    const f = fixture(); await weak(f, 6);
    await admit(f); const last = Date.now();
    expect(f.backoff.refusal("taki")).toBe("backoff-spacing");
    vi.setSystemTime(last + 4 * f.config.modelIntervalMs - 1);
    expect(f.backoff.refusal("taki")).toBe("backoff-spacing");
    vi.setSystemTime(last + 4 * f.config.modelIntervalMs);
    expect(f.backoff.refusal("taki")).toBeUndefined();
    const settledAt = Date.parse(f.feedback.list("taki")[0]!.settledAt!);
    vi.setSystemTime(settledAt + BACKOFF_WINDOW_MS);
    expect(f.backoff.read("taki").stage).toBe("quadruple");
    vi.setSystemTime(settledAt + BACKOFF_WINDOW_MS + 1);
    expect(f.backoff.read("taki").stage).toBe("normal");
  });

  it("fully resets only from persisted same-Character input and never revives older pending invitations", async () => {
    const f = fixture(); await weak(f, 3); const pending = await invitation(f);
    f.backoff.observeUserTurn("taki"); expect(f.backoff.read("taki").stage).toBe("double");
    f.store.appendUser("other", "Different conversation");
    f.backoff.observeUserTurn("other"); expect(f.backoff.read("taki").stage).toBe("double");
    // Same-millisecond sequence ordering establishes genuine later engagement.
    const reply = f.store.appendUser("taki", "New primary input");
    expect(reply.seq).toBeGreaterThan(pending.timelineSeq!);
    expect(f.backoff.read("taki")).toMatchObject({ stage: "normal", lastResetReason: "user-engagement" });
    vi.setSystemTime(Date.now() + FEEDBACK_DEADLINE_MS); f.feedback.settleDue();
    expect(f.backoff.read("taki").qualifiedWeakCount).toBe(0);
    f.timeline.deleteEntry("taki", reply.seq);
    expect(f.backoff.read("taki").qualifiedWeakCount).toBe(0);
  });

  it("counts all admitted Class B judgments for the daily stage, not just utterances", async () => {
    const f = fixture(); vi.setSystemTime(BASE - 2 * DAY); await weak(f, 9); vi.setSystemTime(BASE);
    expect(f.backoff.refusal("taki")).toBeUndefined();
    const admitted = await admit(f);
    f.runs.settle(admitted.runId, admitted.attemptId, "failed", { retryable: false });
    expect(f.backoff.read("taki")).toMatchObject({ stage: "daily", dailyJudgments: 1, refusal: "backoff-daily" });
    expect(f.db.prepare("SELECT count(*) AS n FROM run_deliveries WHERE charged_at>=:at").get({ at: new Date(BASE).toISOString() })?.n).toBe(0);
    await admit(f, { characterId: "other" }); await admit(f, { deliveryClass: "class_a" });
    expect(f.backoff.read("taki").dailyJudgments).toBe(1);
    vi.setSystemTime(Date.parse("2026-09-29T00:00:00.000Z"));
    expect(f.backoff.refusal("taki")).toBeUndefined();
  });

  it("preserves full operator reset across reopen and late qualified feedback without refunding admission history", async () => {
    const root = mkdtempSync(join(tmpdir(), "taki-backoff-")); roots.push(root); const path = join(root, "reset.db");
    const f = fixture({ path }); await weak(f, 3); const pending = await invitation(f);
    const resetAt = Date.now();
    expect(f.backoff.reset("taki")).toMatchObject({ stage: "normal", qualifiedWeakCount: 0, dailyJudgments: 4 });
    f.db.close(); const reopened = fixture({ path });
    vi.setSystemTime(resetAt + FEEDBACK_DEADLINE_MS); reopened.feedback.settleDue();
    expect(reopened.feedback.get({ characterId: "taki", timelineSeq: pending.timelineSeq! })?.disposition).toBe("weak_non_engagement");
    expect(reopened.backoff.read("taki")).toMatchObject({ stage: "normal", qualifiedWeakCount: 0,
      dailyJudgments: 4, lastResetAt: new Date(resetAt).toISOString(), lastResetReason: "operator" });
    await weak(reopened, 3);
    expect(reopened.backoff.read("taki")).toMatchObject({ stage: "double", qualifiedWeakCount: 3, dailyJudgments: 7 });
  });

  it.each([
    { timezone: "America/New_York", admission: "2026-03-08T05:30:00.000Z", nextDay: "2026-03-09T04:00:00.000Z" },
    { timezone: "America/New_York", admission: "2026-11-01T04:30:00.000Z", nextDay: "2026-11-02T05:00:00.000Z" },
    { timezone: "America/Santiago", admission: "2026-09-06T04:30:00.000Z", nextDay: "2026-09-07T03:00:00.000Z" },
  ])("releases the $timezone daily bound at the actual civil boundary after $admission", async ({ timezone, admission, nextDay }) => {
    const f = fixture(); const at = Date.parse(admission); const boundary = Date.parse(nextDay);
    vi.setSystemTime(at - 2 * DAY); await weak(f, 9); f.config.timezone = timezone; vi.setSystemTime(at);
    await invitation(f, { outcome: "silent" });
    expect(f.backoff.read("taki")).toMatchObject({ stage: "daily", dailyJudgments: 1,
      refusal: "backoff-daily", nextEligibleAt: nextDay });
    vi.setSystemTime(boundary - 1); expect(f.backoff.refusal("taki")).toBe("backoff-daily");
    vi.setSystemTime(boundary); expect(f.backoff.read("taki")).toMatchObject({ dailyJudgments: 0, refusal: null, nextEligibleAt: null });
  });

  it("does not mint daily capacity by moving across the date line or back to the original zone", async () => {
    const f = fixture(); vi.setSystemTime(BASE - 2 * DAY); await weak(f, 9);
    f.config.timezone = "Pacific/Honolulu"; vi.setSystemTime(BASE); await invitation(f, { outcome: "express" });
    vi.setSystemTime(BASE + 2 * 3_600_000); f.config.timezone = "Pacific/Kiritimati";
    expect(f.backoff.read("taki")).toMatchObject({ dailyJudgments: 1, refusal: "backoff-daily",
      nextEligibleAt: new Date(BASE + DAY).toISOString() });
    f.config.timezone = "Pacific/Honolulu"; expect(f.backoff.refusal("taki")).toBe("backoff-daily");
    f.config.timezone = "Pacific/Kiritimati"; vi.setSystemTime(BASE + DAY - 1);
    expect(f.backoff.refusal("taki")).toBe("backoff-daily");
    vi.setSystemTime(BASE + DAY); expect(f.backoff.refusal("taki")).toBeUndefined();
  });

  it("keeps missing original-zone history conservative for 48 hours without assigning today's timezone", async () => {
    const f = fixture(); vi.setSystemTime(BASE - 2 * DAY); await weak(f, 9); vi.setSystemTime(BASE);
    const admitted = await admit(f, { capture: false });
    f.config.timezone = "Pacific/Kiritimati"; vi.setSystemTime(BASE + DAY);
    expect(f.backoff.read("taki")).toMatchObject({ dailyJudgments: 1, refusal: "backoff-daily",
      nextEligibleAt: new Date(BASE + 2 * DAY).toISOString() });
    vi.setSystemTime(BASE + 2 * DAY - 1); expect(f.backoff.refusal("taki")).toBe("backoff-daily");
    vi.setSystemTime(BASE + 2 * DAY); expect(f.backoff.refusal("taki")).toBeUndefined();
    expect(f.db.prepare("SELECT initiative_timezone FROM runs WHERE run_id=:runId").get({ runId: admitted.runId })?.initiative_timezone).toBeNull();
  });

  it("keeps normal-stage jitter authoritative and refuses invalid or unrelated admission capture", async () => {
    const f = fixture(); const admitted = await admit(f);
    expect(f.backoff.read("taki")).toMatchObject({ stage: "normal", dailyJudgments: 1, refusal: null, nextEligibleAt: null });
    f.backoff.recordAdmission(admitted.runId, "UTC");
    expect(f.backoff.read("taki").dailyJudgments).toBe(1);
    expect(() => f.backoff.recordAdmission("missing", "UTC")).toThrow("BACKOFF_ADMISSION_REQUIRED");
    const scheduled = await admit(f, { deliveryClass: "class_a" });
    expect(() => f.backoff.recordAdmission(scheduled.runId, "UTC")).toThrow("BACKOFF_ADMISSION_REQUIRED");
    expect(() => f.backoff.recordAdmission(admitted.runId, "invalid-zone")).toThrow();
    expect(f.db.prepare("SELECT initiative_timezone FROM runs WHERE run_id=:runId").get({ runId: admitted.runId })?.initiative_timezone).toBe("UTC");
  });

  it("keeps feedback and reset evidence unchanged when a reset transaction fails", async () => {
    const onChanged = vi.fn(); const f = fixture({ observer: onChanged }); await weak(f, 3); onChanged.mockClear();
    const feedback = f.feedback.list("taki");
    f.db.exec("CREATE TRIGGER reject_reset BEFORE INSERT ON initiative_backoff_resets BEGIN SELECT RAISE(ABORT,'reset refused'); END");
    expect(() => f.backoff.reset("taki")).toThrow("reset refused");
    expect(f.backoff.read("taki")).toMatchObject({ stage: "double", qualifiedWeakCount: 3, lastResetAt: null });
    expect(f.feedback.list("taki")).toEqual(feedback); expect(onChanged).not.toHaveBeenCalled();
  });

  it("preserves captured timezone through DST, timezone changes, duplicate capture and clock rewind", async () => {
    const f = fixture(); vi.setSystemTime(Date.parse("2026-10-30T12:00:00.000Z")); await weak(f, 9);
    f.config.timezone = "America/New_York"; vi.setSystemTime(Date.parse("2026-11-01T04:30:00.000Z"));
    const admitted = await admit(f); f.backoff.recordAdmission(admitted.runId);
    vi.setSystemTime(Date.parse("2026-11-02T04:45:00.000Z"));
    expect(f.backoff.refusal("taki")).toBe("backoff-daily");
    f.config.timezone = "Asia/Tokyo";
    expect(f.backoff.refusal("taki")).toBe("backoff-daily");
    expect(() => f.backoff.recordAdmission(admitted.runId)).toThrow("BACKOFF_ADMISSION_CONFLICT");
    vi.setSystemTime(Date.parse("2026-11-01T04:00:00.000Z"));
    expect(f.backoff.refusal("taki")).toBe("backoff-daily");
  });

  it("recovers missed engagement after actual file reopen and retains committed feedback when observers throw", async () => {
    const root = mkdtempSync(join(tmpdir(), "taki-backoff-")); roots.push(root); const path = join(root, "backoff.db");
    const f = fixture({ path, observer: () => { throw new Error("observer unavailable"); } });
    vi.setSystemTime(BASE - 2 * DAY); await weak(f, 9); vi.setSystemTime(BASE);
    const admitted = await admit(f, { capture: false });
    expect(f.backoff.refusal("taki")).toBe("backoff-daily");
    f.db.close();
    const reopened = fixture({ path });
    expect(reopened.backoff.read("taki")).toMatchObject({ stage: "daily", dailyJudgments: 1, refusal: "backoff-daily" });
    expect(reopened.db.prepare("SELECT initiative_timezone FROM runs WHERE run_id=:runId").get({ runId: admitted.runId })?.initiative_timezone).toBeNull();
    const opportunity = reopened.feedback.list("taki").map((record) => record.opportunityMs);
    reopened.store.appendUser("taki", "Persisted before a crash"); reopened.db.close();
    const recovered = fixture({ path, observer: () => { throw new Error("observer unavailable"); } });
    expect(recovered.backoff.read("taki")).toMatchObject({ stage: "normal", qualifiedWeakCount: 0, lastResetReason: "user-engagement" });
    expect(recovered.feedback.list("taki").map((record) => record.opportunityMs)).toEqual(opportunity);
  });

  it("does not expose correlation IDs or raw content in the semantic projection", async () => {
    const f = fixture(); await weak(f, 3); const status = f.backoff.read("taki");
    expect(Object.keys(status)).not.toContain("characterId");
    expect(JSON.stringify(status)).not.toContain("A question");
    expect(JSON.stringify(status)).not.toContain(f.feedback.list("taki")[0]!.deliveryId);
    expect(status.qualifiedWeakCount).toBe(3);
  });
});
