import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunSnapshotSchema, type InitiativeIntentionPlan, type InitiativeIntentionPlanResult, type TriggerRequest } from "@taki/shared";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { initiativeIntentionsMigration054 } from "../../db/migrations/054-initiative-intentions.ts";
import { createRunRepo } from "../../db/run-repo.ts";
import { createRunDeliveryRepo } from "../../db/run-delivery-repo.ts";
import { createRunEventRepo } from "../../db/run-event-repo.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";
import { createRunServiceStub } from "../../testing/run-service-stub.ts";
import { createIntentionService, DEFAULT_INTENTION_WINDOW_MS, type IntentionServiceOptions } from "./intention-service.ts";

const databases: Database[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const path of directories.splice(0)) {
    if (dirname(resolve(path)) !== resolve(tmpdir()) || !basename(path).startsWith("taki-intention-")) throw new Error("unsafe fixture cleanup");
    rmSync(path, { recursive: true, force: true });
  }
});
const migrations = [...MIGRATIONS.filter((migration) => migration.version < 54), initiativeIntentionsMigration054];
const instant = (value: number) => new Date(value).toISOString();

async function admit(db: Database, input: { key?: string; initiator?: TriggerRequest["initiator"]; characterId?: string } = {}) {
  const initiator = input.initiator ?? "heartbeat";
  const key = input.key ?? randomUUID();
  const request: TriggerRequest = { triggerRequestId: key, idempotencyKey: key, characterId: input.characterId ?? "taki",
    initiator, provenance: { provider: "test" }, deliveryClass: initiator === "primary" ? "class_a" : "class_b",
    contextMode: initiator === "primary" ? "primary" : "autonomous" };
  const draft = await createRunServiceStub().admit(request);
  const snapshot = RunSnapshotSchema.omit({ snapshotId: true, runId: true, capturedAt: true, manifestDigest: true }).strip().parse(draft.snapshot);
  return createRunRepo(db).admit({ runId: randomUUID(), request, snapshot, provider: "test", modelId: "test" });
}

async function fixture(options: { path?: string; content?: string; sourceState?: IntentionServiceOptions["sourceState"]; maximumWindowMs?: () => number;
  onChanged?: IntentionServiceOptions["onChanged"] } = {}) {
  const db = openDatabase({ path: options.path ?? ":memory:", migrations }); databases.push(db);
  const repo = createRunRepo(db); const primary = await admit(db, { initiator: "primary" });
  repo.start(primary.run.runId, primary.attempt.attemptId);
  const timeline = createTimelineRepo(db);
  const user = timeline.append({ characterId: "taki", role: "user", content: options.content ?? "I have an interview on Friday. Exact time is unknown." });
  let clock = Date.now() + 100;
  const service = createIntentionService({ db, now: () => clock, sourceState: options.sourceState,
    maximumWindowMs: options.maximumWindowMs, onChanged: options.onChanged });
  const source = { characterId: "taki", runId: primary.run.runId, attemptId: primary.attempt.attemptId,
    userTimelineId: user.id, userTimelineSeq: user.seq };
  const actor = { runId: source.runId, attemptId: source.attemptId, toolCallId: "actual-tool-call" };
  const plan: InitiativeIntentionPlan = { purpose: "Consider asking about the interview, whose outcome is unknown.",
    notBefore: instant(clock), expiresAt: instant(clock + 60000), reportedEventTime: null };
  expect(service.registerPrimarySource(source)).toBe(true);
  return { db, repo, timeline, user, primary, service, source, actor, plan, setNow: (at: number) => { clock = at; }, now: () => clock,
    create: (change: Partial<InitiativeIntentionPlan> = {}) => service.plan({ characterId: "taki", plan: { ...plan, ...change } }, actor) };
}
function value(result: InitiativeIntentionPlanResult) {
  if (result.status === "refused") throw new Error(result.reason);
  return result.intention;
}
function claimFor(record: ReturnType<typeof value>, key = `initiative:${randomUUID()}`) {
  return { intentionId: record.intentionId, characterId: record.characterId, canonicalRunKey: key };
}

describe("finite source-bound Intention formation", () => {
  it("bounds the active window, including far-future windows and exact millisecond boundaries", async () => {
    const f = await fixture(); const future = f.now() + 90 * 86400000;
    expect(f.create({ notBefore: instant(future), expiresAt: instant(future + DEFAULT_INTENTION_WINDOW_MS + 1) }))
      .toEqual({ status: "refused", reason: "window_too_long" });
    const created = value(f.create({ notBefore: instant(future), expiresAt: instant(future + DEFAULT_INTENTION_WINDOW_MS) }));
    expect(created.state).toBe("active"); expect(f.service.listDue("taki")).toEqual([]);
    f.setNow(future - 1); expect(f.service.claim(claimFor(created))).toBe(false);
    f.setNow(future); expect(f.service.listDue("taki")).toEqual([{ intentionId: created.intentionId,
      characterId: "taki", sourceKey: created.sourceKey, sourceRevision: created.source.digest, purpose: created.purpose,
      notBefore: future, expiresAt: future + DEFAULT_INTENTION_WINDOW_MS }]);
    expect(f.service.claim(claimFor(created))).toBe(true);
    expect(f.db.prepare("SELECT * FROM scheduled_tasks").all()).toEqual([]);
  });

  it("honors configurable maximums and refuses empty, malformed and already-expired windows", async () => {
    const f = await fixture({ maximumWindowMs: () => 1000 });
    expect(f.create()).toEqual({ status: "refused", reason: "window_too_long" });
    expect(f.create({ expiresAt: f.plan.notBefore })).toEqual({ status: "refused", reason: "invalid_request" });
    expect(f.create({ expiresAt: "invalid" })).toEqual({ status: "refused", reason: "invalid_request" });
    expect(f.create({ notBefore: instant(f.now() - 100), expiresAt: instant(f.now()) })).toEqual({ status: "refused", reason: "expired" });
    expect(f.create({ expiresAt: instant(f.now() + 1000) }).status).toBe("created");
  });

  it("deduplicates wording, deadlines and tool identities without renewing the original opportunity", async () => {
    const f = await fixture(); const first = value(f.create());
    const result = f.service.plan({ characterId: "taki", plan: { ...f.plan, purpose: "Different phrasing.", expiresAt: instant(f.now() + 90000) } },
      { ...f.actor, toolCallId: "another-call" });
    expect(result).toEqual({ status: "duplicate", intention: first });
    f.setNow(Date.parse(first.expiresAt));
    expect(f.service.listDue("taki")).toEqual([]);
    expect(f.create()).toMatchObject({ status: "duplicate", intention: { intentionId: first.intentionId, state: "terminal", disposition: "expired", purpose: null } });
    expect(f.db.prepare("SELECT count(*) AS n FROM initiative_intentions").get()?.n).toBe(1);
    expect(f.timeline.latestAscending("taki", 10)).toEqual([f.user]);
  });

  it("refuses foreign, invented, unregistered and inactive primary identities", async () => {
    const f = await fixture();
    expect(f.service.plan({ characterId: "other", plan: f.plan }, f.actor)).toMatchObject({ status: "refused" });
    expect(f.service.registerPrimarySource({ ...f.source, userTimelineId: "invented" })).toBe(false);
    const assistant = f.timeline.append({ characterId: "taki", role: "assistant", content: "Not a user source." });
    expect(f.service.registerPrimarySource({ ...f.source, userTimelineId: assistant.id, userTimelineSeq: assistant.seq })).toBe(false);
    expect(f.service.plan({ characterId: "taki", plan: f.plan }, { ...f.actor, runId: "invented" })).toMatchObject({ status: "refused" });
    f.repo.settle({ runId: f.actor.runId, attemptId: f.actor.attemptId, outcome: "completed", retryability: "not_retryable" });
    expect(f.create()).toMatchObject({ status: "refused", reason: "source_stale" });
  });

  it("retains the exact user source through retry and permits a genuinely new user row as a new opportunity", async () => {
    const f = await fixture(); const first = value(f.create());
    const retry = f.repo.retry(f.actor.runId, f.actor.attemptId, "overflow");
    expect(f.create()).toMatchObject({ status: "refused", reason: "source_stale" });
    expect(f.service.plan({ characterId: "taki", plan: f.plan }, { ...f.actor, attemptId: retry.run.activeAttemptId! }))
      .toEqual({ status: "duplicate", intention: first });
    const primary = await admit(f.db, { initiator: "primary" }); f.repo.start(primary.run.runId, primary.attempt.attemptId);
    const next = f.timeline.append({ characterId: "taki", role: "user", content: "A new interview next month." });
    expect(f.service.registerPrimarySource({ characterId: "taki", runId: primary.run.runId, attemptId: primary.attempt.attemptId,
      userTimelineId: next.id, userTimelineSeq: next.seq })).toBe(true);
    const second = value(f.service.plan({ characterId: "taki", plan: f.plan }, { runId: primary.run.runId, attemptId: primary.attempt.attemptId, toolCallId: "new" }));
    expect(second.sourceKey).not.toBe(first.sourceKey);
  });

  it("does not turn vague timing into a reported event timestamp", async () => {
    const f = await fixture();
    expect(f.create({ reportedEventTime: f.plan.notBefore })).toEqual({ status: "refused", reason: "invalid_request" });
    expect(value(f.create()).reportedEventTime).toBeNull();
  });

  it("preserves only the literal user-reported event time while normalizing the policy window to UTC", async () => {
    const reported = "2027-01-08T14:30:00+08:00";
    const f = await fixture({ content: `My interview begins at ${reported}; the outcome is unknown.` });
    const created = value(f.create({ reportedEventTime: reported,
      notBefore: "2027-01-09T08:00:00+08:00", expiresAt: "2027-01-09T09:00:00+08:00" }));
    expect(created).toMatchObject({ reportedEventTime: reported,
      notBefore: "2027-01-09T00:00:00.000Z", expiresAt: "2027-01-09T01:00:00.000Z" });
    expect(f.timeline.latestAscending("taki", 10)).toEqual([f.user]);
  });

  it("rolls back failed writes and isolates post-commit observer failure", async () => {
    const listener = vi.fn(() => { throw new Error("observer down"); }); const f = await fixture({ onChanged: listener });
    f.db.exec("CREATE TRIGGER reject_intention BEFORE INSERT ON initiative_intentions BEGIN SELECT RAISE(ABORT,'write failed'); END");
    expect(() => f.create()).toThrow("write failed"); expect(listener).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT * FROM initiative_intentions").all()).toEqual([]);
    f.db.exec("DROP TRIGGER reject_intention"); expect(f.create().status).toBe("created");
    expect(listener).toHaveBeenCalledOnce(); expect(f.service.notificationFailures()).toBe(1);
  });
});

describe("source and absolute-deadline guards", () => {
  it("keeps unavailable plans on the finite timer without writes, excluding withdrawn, claimed, expired and foreign plans", async () => {
    let sourceState: "current" | "unavailable" | "withdrawn" = "current";
    const f = await fixture({ sourceState: () => sourceState }); const now = f.now();
    const first = value(f.create({ notBefore: instant(now + 1000) }));
    const writes = () => Number(f.db.prepare("SELECT total_changes() AS n").get()?.n);
    const before = writes();
    expect(f.service.nextWakeAt("other")).toBeUndefined();
    expect(f.service.nextWakeAt("taki")).toBe(now + 1000);
    sourceState = "unavailable"; expect(f.service.nextWakeAt("taki")).toBe(now + 1000);
    sourceState = "withdrawn"; expect(f.service.nextWakeAt("taki")).toBeUndefined();
    sourceState = "current"; f.setNow(now + 1000); expect(f.service.nextWakeAt("taki")).toBe(now + 1000);
    f.setNow(Date.parse(first.expiresAt)); expect(f.service.nextWakeAt("taki")).toBeUndefined();
    expect(writes()).toBe(before);
    expect(f.db.prepare("SELECT state FROM initiative_intentions").get()?.state).toBe("active");
    f.setNow(now + 1000); f.service.claim(claimFor(first)); expect(f.service.nextWakeAt("taki")).toBeUndefined();
  });

  it.each(["corrected", "deleted"])("immediately withdraws a %s source without changing the underlying matter", async (kind) => {
    const f = await fixture(); const first = value(f.create()); const claim = claimFor(first);
    expect(f.service.claim(claim)).toBe(true);
    if (kind === "corrected") f.db.prepare("UPDATE timeline_messages SET content='Interview cancelled.' WHERE seq=:seq").run({ seq: f.user.seq });
    else f.timeline.deleteEntry("taki", f.user.seq);
    expect(f.service.isCurrent(claim)).toBe(false);
    expect(f.service.get(first)).toMatchObject({ state: "terminal", disposition: "source_invalidated", purpose: null });
    expect(f.service.releaseUnadmitted(claim)).toBe(false);
  });

  it("distinguishes unavailable Memory evidence from withdrawal and retains the original window", async () => {
    let sourceState: "current" | "unavailable" | "withdrawn" = "current";
    const witness = vi.fn(() => sourceState); const f = await fixture({ sourceState: witness });
    const first = value(f.create()); const claim = claimFor(first);
    expect(witness).toHaveBeenCalledWith({ characterId: "taki", userTimelineId: f.user.id, userTimelineSeq: f.user.seq, sourceDigest: first.source.digest });
    sourceState = "unavailable";
    expect(f.service.listDue("taki")).toEqual([]); expect(f.service.claim(claim)).toBe(false);
    expect(f.service.isCurrent(claim)).toBe(false); expect(f.service.get(first)?.state).toBe("active");
    sourceState = "current"; expect(f.service.claim(claim)).toBe(true); expect(f.service.isCurrent(claim)).toBe(true);
    sourceState = "withdrawn"; expect(f.service.isCurrent(claim)).toBe(false);
    sourceState = "current"; expect(f.service.get(first)).toMatchObject({ state: "terminal", disposition: "source_invalidated" });
  });

  it("closes expiry exactly before output and expires inactive Characters on reconciliation", async () => {
    const f = await fixture(); const first = value(f.create()); const claim = claimFor(first);
    expect(f.service.claim(claim)).toBe(true); expect(f.service.listDue("taki")).toEqual([]);
    f.setNow(Date.parse(first.expiresAt) - 1); expect(f.service.isCurrent(claim)).toBe(true);
    f.setNow(Date.parse(first.expiresAt)); expect(f.service.isCurrent(claim)).toBe(false);
    expect(f.service.get(first)).toMatchObject({ disposition: "expired", purpose: null });
    const inactive = await fixture(); const stale = value(inactive.create());
    inactive.setNow(Date.parse(stale.expiresAt) + 86400000); inactive.service.reconcile();
    expect(inactive.service.get(stale)).toMatchObject({ state: "terminal", disposition: "expired" });
  });
});

describe("canonical claim and terminal reconciliation", () => {
  it("enforces immutable identities, active-state claim shape and source/Run scopes in SQLite", async () => {
    const f = await fixture(); const first = value(f.create());
    expect(() => f.db.prepare("UPDATE initiative_intentions SET expires_at=:at WHERE intention_id=:id")
      .run({ at: instant(Date.parse(first.expiresAt) + 1), id: first.intentionId })).toThrow("immutable Intention source opportunity");
    expect(() => f.db.exec("UPDATE initiative_intentions SET canonical_run_key='unclaimed'")).toThrow(/CHECK/);
    const claim = claimFor(first); f.service.claim(claim);
    expect(() => f.db.prepare("UPDATE initiative_intentions SET run_id=:runId").run({ runId: f.primary.run.runId }))
      .toThrow("foreign Intention Run");
    expect(() => f.db.exec(`INSERT INTO initiative_intentions(intention_id,character_id,source_key,source_json,
      source_run_id,purpose,not_before,expires_at,state,created_at)
      SELECT 'forged','other',replace(source_key,substr(source_key,1,1),'b'),source_json,
        source_run_id,purpose,not_before,expires_at,'active',created_at FROM initiative_intentions`))
      .toThrow("foreign Intention source Run");
    expect(f.db.prepare("SELECT count(*) AS n FROM initiative_intentions").get()?.n).toBe(1);
  });

  it("permits one claim and requires the exact Character, initiator and canonical Run key", async () => {
    const f = await fixture(); const first = value(f.create()); const claim = claimFor(first);
    expect(f.service.claim(claim)).toBe(true); expect(f.service.claim(claim)).toBe(false);
    expect(f.service.isCurrent({ ...claim, canonicalRunKey: "foreign" })).toBe(false);
    const foreign = await admit(f.db); expect(f.service.link({ ...claim, runId: foreign.run.runId })).toBe(false);
    const own = await admit(f.db, { key: claim.canonicalRunKey });
    expect(f.service.link({ ...claim, runId: own.run.runId })).toBe(true);
    expect(f.service.link({ ...claim, runId: own.run.runId })).toBe(true);
    expect(f.service.releaseUnadmitted(claim)).toBe(false);
    expect(f.service.get(first)?.runId).toBe(own.run.runId);
  });

  it("releases a known unadmitted refusal without sliding its window, but never releases committed admission", async () => {
    const f = await fixture(); const first = value(f.create()); const claim = claimFor(first);
    expect(f.service.claim(claim)).toBe(true); expect(f.service.releaseUnadmitted(claim)).toBe(true);
    expect(f.service.get(first)).toMatchObject({ state: "active", notBefore: first.notBefore, expiresAt: first.expiresAt });
    expect(f.service.claim(claim)).toBe(true); const admitted = await admit(f.db, { key: claim.canonicalRunKey });
    expect(f.service.releaseUnadmitted(claim)).toBe(false);
    expect(f.service.get(first)?.runId).toBe(admitted.run.runId);
  });

  it("refuses release when the canonical key belongs to a foreign Run and never adopts it on recovery", async () => {
    for (const foreign of [{ characterId: "other" }, { initiator: "primary" as const }]) {
      const f = await fixture(); const first = value(f.create()); const claim = claimFor(first);
      expect(f.service.claim(claim)).toBe(true);
      await admit(f.db, { key: claim.canonicalRunKey, ...foreign });
      expect(f.service.releaseUnadmitted(claim)).toBe(false);
      f.service.reconcile();
      expect(f.service.get(first)).toMatchObject({ state: "terminal", disposition: "unknown", runId: null });
      expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(2);
    }
  });

  it("keeps linked work current across an in-window restart without creating another Run", async () => {
    const f = await fixture(); const first = value(f.create()); const claim = claimFor(first);
    f.service.claim(claim); const admitted = await admit(f.db, { key: claim.canonicalRunKey });
    const restarted = createIntentionService({ db: f.db, now: f.now }); restarted.reconcile();
    expect(restarted.get(first)).toMatchObject({ state: "claimed", runId: admitted.run.runId });
    expect(restarted.listDue("taki")).toEqual([]); expect(restarted.isCurrent(claim)).toBe(true);
    restarted.reconcile(); expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(2);
  });

  it.each(["failed", "cancelled", "outcome_unknown", "completed"] as const)("closes %s once, without rearming from source replay", async (outcome) => {
    const f = await fixture(); const first = value(f.create()); const claim = claimFor(first);
    f.service.claim(claim); const admitted = await admit(f.db, { key: claim.canonicalRunKey });
    f.repo.start(admitted.run.runId, admitted.attempt.attemptId); f.service.link({ ...claim, runId: admitted.run.runId });
    f.repo.settle({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, outcome, retryability: "not_retryable" });
    f.service.settleLinked({ intentionId: first.intentionId, characterId: first.characterId });
    const settled = f.service.get(first);
    expect(settled).toMatchObject({ state: "terminal", disposition: outcome === "outcome_unknown" ? "unknown" : outcome, purpose: null });
    f.service.reconcile(); expect(f.service.get(first)).toEqual(settled);
    expect(f.create()).toEqual({ status: "duplicate", intention: settled });
  });

  it("consumes intentional silence while retaining claimed currentness until non-silent publication settles", async () => {
    for (const silent of [true, false]) {
      const f = await fixture(); const first = value(f.create()); const claim = claimFor(first);
      f.service.claim(claim); const admitted = await admit(f.db, { key: claim.canonicalRunKey });
      const runId = admitted.run.runId; const attemptId = admitted.attempt.attemptId; f.repo.start(runId, attemptId);
      const deliveries = createRunDeliveryRepo({ db: f.db, events: createRunEventRepo(f.db) });
      deliveries.stage({ runId, attemptId, characterId: "taki", deliveryClass: "class_b", primaryVersion: 0,
        expiresAt: first.expiresAt, consideredCount: 1, decision: silent ? { outcome: "silent", selectedCandidateIds: [] }
          : { outcome: "speak", selectedCandidateIds: ["candidate"], text: "How was the interview?", presentation: null, responseExpectation: "invitation" } });
      f.repo.settle({ runId, attemptId, outcome: "completed", retryability: "not_retryable" });
      f.service.settleLinked({ intentionId: first.intentionId, characterId: first.characterId });
      expect(f.service.get(first)?.state).toBe(silent ? "terminal" : "claimed");
      if (silent) expect(f.service.get(first)?.disposition).toBe("silent");
      else expect(f.service.isCurrent(claim)).toBe(true);
    }
  });

  it("consumes a completed expression without waiting for a speech publication that cannot occur", async () => {
    const f = await fixture(); const first = value(f.create()); const claim = claimFor(first);
    expect(f.service.claim(claim)).toBe(true);
    const admitted = await admit(f.db, { key: claim.canonicalRunKey });
    const runId = admitted.run.runId; const attemptId = admitted.attempt.attemptId;
    f.repo.start(runId, attemptId); expect(f.service.link({ ...claim, runId })).toBe(true);
    const deliveries = createRunDeliveryRepo({ db: f.db, events: createRunEventRepo(f.db) });
    const staged = deliveries.stage({ runId, attemptId, characterId: "taki", deliveryClass: "class_b", primaryVersion: 0,
      expiresAt: first.expiresAt, consideredCount: 1, decision: { outcome: "express", selectedCandidateIds: ["candidate"],
        presentation: { kind: "expression", name: "happy" } } });
    // The real delivery owner completes the executable continuation; express has no Timeline publication.
    deliveries.transition({ runId, expectedVersion: staged.version, continuation: "completed",
      fact: { kind: "delivery.presentation_settled", state: "completed", reasonCode: "presentation" } });
    f.repo.settle({ runId, attemptId, outcome: "completed", retryability: "not_retryable" });
    expect(deliveries.get(runId)).toMatchObject({ state: "staged", continuation: "completed", timelineSeq: null });
    f.service.settleLinked({ characterId: first.characterId, intentionId: first.intentionId });
    expect(f.service.get(first)).toMatchObject({ state: "terminal", disposition: "express", purpose: null, runId });
    expect(f.service.isCurrent(claim)).toBe(false);
    const restarted = createIntentionService({ db: f.db, now: f.now }); restarted.reconcile();
    expect(restarted.get(first)).toEqual(f.service.get(first));
    expect(f.create()).toMatchObject({ status: "duplicate", intention: { state: "terminal", disposition: "express" } });
    expect(f.timeline.latestAscending("taki", 10)).toEqual([f.user]);
  });

  it("reopens SQLite, repairs the admit-before-link crash cut, expires content and retains identity", async () => {
    const directory = mkdtempSync(join(tmpdir(), "taki-intention-")); directories.push(directory);
    const path = join(directory, "state.db"); const f = await fixture({ path }); const first = value(f.create()); const claim = claimFor(first);
    f.service.claim(claim); const admitted = await admit(f.db, { key: claim.canonicalRunKey }); f.db.close();
    const reopened = openDatabase({ path, migrations }); databases.push(reopened);
    const service = createIntentionService({ db: reopened, now: () => Date.parse(first.expiresAt) }); service.reconcile();
    expect(service.get({ intentionId: first.intentionId, characterId: "taki" })).toMatchObject({ state: "terminal", disposition: "expired",
      runId: admitted.run.runId, canonicalRunKey: claim.canonicalRunKey, sourceKey: first.sourceKey, purpose: null });
    expect(reopened.prepare("SELECT count(*) AS n FROM migrations WHERE version=54").get()?.n).toBe(1);
    expect(createTimelineRepo(reopened).latestAscending("taki", 10)).toEqual([f.user]);
    expect(() => reopened.prepare("UPDATE initiative_intentions SET state='active',purpose='replay' WHERE intention_id=:id")
      .run({ id: first.intentionId })).toThrow("terminal Intention cannot be rearmed");
  });

  it("closes a lost pre-admission claim as unknown rather than minting a retry on restart", async () => {
    const f = await fixture(); const first = value(f.create()); const claim = claimFor(first); f.service.claim(claim);
    const restarted = createIntentionService({ db: f.db, now: f.now }); restarted.reconcile();
    expect(restarted.get({ characterId: first.characterId, intentionId: first.intentionId })).toMatchObject({ state: "terminal", disposition: "unknown", runId: null });
    expect(restarted.claim(claim)).toBe(false);
  });
});
