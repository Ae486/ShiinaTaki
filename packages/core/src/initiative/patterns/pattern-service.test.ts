import { afterEach, describe, expect, it, vi } from "vitest";
import type { InteractionPatternDefinition, InteractionPatternMutationResult, InteractionPatternView } from "@taki/shared";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { T4_HISTORICAL_MIGRATIONS } from "../../db/migrations/historical-t4.ts";
import { interactionPatternsMigration052 } from "../../db/migrations/052-interaction-patterns.ts";
import { createInteractionPatternService, type InteractionPatternService } from "./pattern-service.ts";
import type { InteractionPatternActor } from "./pattern-source.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const operator: InteractionPatternActor = { kind: "operator", operatorId: "authenticated-user" };
const at = "2026-09-28T12:00:00.000Z";
const definition: InteractionPatternDefinition = {
  title: "Evening check-in", purpose: "Consider a short reflection together.",
  conditions: { all: [{ kind: "local_time_window", start: "20:00", end: "21:00", daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }] },
  contextSelectors: ["memory_character"], allowedOutcomes: ["silent", "speak"],
  timing: { minimumGapMinutes: 60, chance: 0.5 }, lifetime: { startsAt: null, expiresAt: null },
};
function fixture(onChanged = vi.fn()) {
  const db = openDatabase({ path: ":memory:", migrations: [...T4_HISTORICAL_MIGRATIONS.filter((m) => m.version < 52), interactionPatternsMigration052] });
  dbs.push(db);
  let clock = at;
  const service = createInteractionPatternService({ db, now: () => new Date(clock), onChanged });
  return { db, service, onChanged, setTime: (value: string) => { clock = value; } };
}
function applied(result: InteractionPatternMutationResult): InteractionPatternView {
  expect(result.status).toBe("applied");
  if (result.status === "refused") throw new Error(result.reason);
  return result.pattern;
}
function propose(service: InteractionPatternService, commandId = "proposal") {
  return applied(service.propose({ characterId: "taki", commandId, patternId: null, expectedVersion: 0, definition }, operator));
}
function confirm(service: InteractionPatternService, pattern: InteractionPatternView, commandId = "confirm") {
  return applied(service.confirm({ characterId: pattern.characterId, patternId: pattern.patternId, commandId,
    expectedVersion: pattern.version, candidateRevisionId: pattern.candidateRevision!.revisionId }, operator));
}
function scope(pattern: InteractionPatternView, commandId: string) {
  return { characterId: pattern.characterId, patternId: pattern.patternId, expectedVersion: pattern.version, commandId };
}

describe("Pattern authority on real SQLite", () => {
  it("keeps proposals inactive, activates exactly the reviewed candidate and restores accepted state", () => {
    const f = fixture();
    const candidate = propose(f.service);
    expect(candidate).toMatchObject({ state: "proposed", version: 1, effectiveRevision: null,
      candidateRevision: { baseVersion: 0, acceptedAt: null, origin: { kind: "user" } } });
    expect(f.service.listActive("taki")).toEqual([]);
    const active = confirm(f.service, candidate);
    expect(active).toMatchObject({ state: "active", version: 2, candidateRevision: null,
      effectiveRevision: { revisionId: candidate.candidateRevision!.revisionId, acceptedAt: at } });
    const restarted = createInteractionPatternService({ db: f.db, now: () => new Date(at) });
    expect(restarted.listActive("taki")).toEqual([active]);
    expect(f.service.history({ characterId: "taki", patternId: active.patternId, before: null, limit: 100 }).revisions).toHaveLength(1);
  });

  it("preserves current effective revision and pause status while drafting and accepting new parameters", () => {
    const f = fixture();
    const active = confirm(f.service, propose(f.service));
    const paused = applied(f.service.changeState({ ...scope(active, "pause"), action: "pause" }, operator));
    const draft = applied(f.service.propose({ ...scope(paused, "revision"), definition: { ...definition, purpose: "A gentler check-in." } }, operator));
    expect(draft).toMatchObject({ state: "paused", effectiveRevision: active.effectiveRevision,
      candidateRevision: { changes: ["purpose"], baseVersion: paused.version } });
    expect(f.service.listActive("taki")).toEqual([]);
    const accepted = confirm(f.service, draft, "accept-revision");
    expect(accepted.state).toBe("paused");
    const resumed = applied(f.service.changeState({ ...scope(accepted, "resume"), action: "resume" }, operator));
    expect(f.service.listActive("taki")).toEqual([resumed]);
  });

  it("fences old displayed cards after another draft, and provides current readable state", () => {
    const f = fixture();
    const original = propose(f.service);
    const newer = applied(f.service.propose({ ...scope(original, "new-candidate"), definition: { ...definition, title: "Updated" } }, operator));
    const oldConfirm = { ...scope(original, "stale-confirm"), candidateRevisionId: original.candidateRevision!.revisionId };
    expect(f.service.confirm(oldConfirm, operator)).toEqual({ status: "refused", reason: "conflict", current: newer });
    expect(f.service.confirm({ ...oldConfirm, expectedVersion: newer.version }, operator)).toEqual({ status: "refused", reason: "conflict", current: newer });
    expect(f.service.listActive("taki")).toEqual([]);
    expect(confirm(f.service, newer).effectiveRevision?.definition.title).toBe("Updated");
  });

  it("deduplicates exact commands durably without reapplying a later pause, and rejects conflicting reuse", () => {
    const f = fixture();
    const candidate = propose(f.service);
    const command = { ...scope(candidate, "confirm-once"), candidateRevisionId: candidate.candidateRevision!.revisionId };
    const active = applied(f.service.confirm(command, operator));
    const paused = applied(f.service.changeState({ ...scope(active, "pause"), action: "pause" }, operator));
    expect(f.service.confirm(command, operator)).toEqual({ status: "duplicate", pattern: paused });
    expect(f.service.confirm({ ...command, candidateRevisionId: "different" }, operator))
      .toEqual({ status: "refused", reason: "command_conflict", current: paused });
    expect(f.db.prepare("SELECT count(*) AS n FROM interaction_pattern_reviews").get()?.n).toBe(1);
    expect(f.onChanged).toHaveBeenCalledTimes(3);
  });

  it("copies rollback into a new reviewable revision without rewinding history, grants or effective behavior", () => {
    const f = fixture();
    f.db.exec("UPDATE governance_policy SET level='strict',policy_generation=6");
    f.db.exec("INSERT INTO governance_cell_overrides(cell_key,level,posture,descriptor_revision,updated_at) VALUES('test-cell','strict','deny',1,'2026-09-28T00:00:00.000Z')");
    const permissions = ["governance_policy", "governance_cell_overrides", "approval_state", "approval_decisions"]
      .map((table) => f.db.prepare(`SELECT * FROM ${table}`).all());
    const first = confirm(f.service, propose(f.service));
    const draft = applied(f.service.propose({ ...scope(first, "edit"), definition: { ...definition, title: "New behavior" } }, operator));
    const second = confirm(f.service, draft, "second-accept");
    const rollback = applied(f.service.rollback({ ...scope(second, "rollback"), revisionId: first.effectiveRevision!.revisionId }, operator));
    expect(rollback.effectiveRevision).toEqual(second.effectiveRevision);
    expect(rollback.candidateRevision).toMatchObject({ definition, acceptedAt: null, origin: { kind: "rollback" }, changes: ["title"] });
    expect(rollback.candidateRevision?.revisionId).not.toBe(first.effectiveRevision?.revisionId);
    const accepted = confirm(f.service, rollback, "accept-rollback");
    expect(accepted.version).toBeGreaterThan(second.version);
    expect(f.service.history({ characterId: "taki", patternId: accepted.patternId, before: null, limit: 10 }).revisions).toHaveLength(3);
    expect(["governance_policy", "governance_cell_overrides", "approval_state", "approval_decisions"]
      .map((table) => f.db.prepare(`SELECT * FROM ${table}`).all())).toEqual(permissions);
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS n FROM timeline_messages").get()?.n).toBe(0);
  });

  it("refuses foreign Character reads/mutations and rollback from a different Pattern or an unaccepted candidate", () => {
    const f = fixture();
    const first = confirm(f.service, propose(f.service));
    const second = propose(f.service, "another-pattern");
    expect(f.service.get({ characterId: "other", patternId: first.patternId })).toBeNull();
    expect(f.service.history({ characterId: "other", patternId: first.patternId, before: null, limit: 100 }).revisions).toEqual([]);
    expect(f.service.changeState({ ...scope(first, "foreign"), characterId: "other", action: "pause" }, operator).status).toBe("refused");
    expect(f.service.rollback({ ...scope(second, "foreign-history"), revisionId: first.effectiveRevision!.revisionId }, operator))
      .toMatchObject({ status: "refused", reason: "not_found" });
    expect(f.service.rollback({ ...scope(second, "unaccepted"), revisionId: second.candidateRevision!.revisionId }, operator))
      .toMatchObject({ status: "refused", reason: "not_found" });
  });

  it("retire is terminal for admission and history remains readable", () => {
    const f = fixture();
    const active = confirm(f.service, propose(f.service));
    const retired = applied(f.service.changeState({ ...scope(active, "retire"), action: "retire" }, operator));
    expect(f.service.listActive("taki")).toEqual([]);
    expect(f.service.changeState({ ...scope(retired, "revive"), action: "resume" }, operator)).toMatchObject({ status: "refused", reason: "invalid_state" });
    expect(f.service.propose({ ...scope(retired, "revise"), definition }, operator)).toMatchObject({ status: "refused", reason: "invalid_state" });
    expect(f.service.history({ characterId: "taki", patternId: retired.patternId, before: null, limit: 10 }).revisions).toHaveLength(1);
  });

  it("reads lifetime by absolute instants, refuses expired confirm/resume and never catches up", () => {
    const f = fixture();
    const candidate = applied(f.service.propose({ characterId: "taki", commandId: "timed", patternId: null, expectedVersion: 0,
      definition: { ...definition, lifetime: { startsAt: "2026-09-28T21:00:00+08:00", expiresAt: "2026-09-28T22:00:00+08:00" } } }, operator));
    const active = confirm(f.service, candidate);
    expect(f.service.listActive("taki")).toEqual([]);
    f.setTime("2026-09-28T13:00:00.000Z");
    expect(f.service.listActive("taki")).toEqual([active]);
    const paused = applied(f.service.changeState({ ...scope(active, "pause"), action: "pause" }, operator));
    f.setTime("2026-09-28T14:00:00.000Z");
    expect(f.service.changeState({ ...scope(paused, "resume"), action: "resume" }, operator)).toMatchObject({ status: "refused", reason: "expired" });
    expect(f.service.listActive("taki")).toEqual([]);
  });

  it("uses one seed authority and never overwrites paused or user-edited state by reimport", () => {
    const f = fixture();
    const seed: InteractionPatternActor = { kind: "seed", seedId: "evening", seedVersion: "1" };
    const input = { characterId: "taki", commandId: "seed-import", patternId: null, expectedVersion: 0, definition };
    const candidate = applied(f.service.propose(input, seed));
    expect(f.service.confirm({ ...scope(candidate, "self-accept"), candidateRevisionId: candidate.candidateRevision!.revisionId }, seed))
      .toMatchObject({ status: "refused", reason: "forbidden" });
    const active = confirm(f.service, candidate);
    const paused = applied(f.service.changeState({ ...scope(active, "pause"), action: "pause" }, operator));
    expect(f.service.propose(input, seed)).toEqual({ status: "duplicate", pattern: paused });
    expect(f.service.propose({ ...input, commandId: "upgrade" }, { ...seed, seedVersion: "2" }))
      .toEqual({ status: "duplicate", pattern: paused });
    expect(f.service.findSeed("taki", "evening")).toEqual(paused);
  });

  it("returns bounded stable list/history pages", () => {
    const f = fixture();
    const one = propose(f.service);
    propose(f.service, "two");
    const first = f.service.list({ characterId: "taki", after: null, limit: 1 });
    const next = f.service.list({ characterId: "taki", after: first.nextAfter, limit: 1 });
    expect(first.patterns).toHaveLength(1);
    expect(next.patterns).toHaveLength(1);
    expect(next.nextAfter).toBeNull();
    expect(first.patterns[0]?.patternId).not.toBe(next.patterns[0]?.patternId);
    const draft = applied(f.service.propose({ ...scope(one, "revision"), definition: { ...definition, title: "Changed" } }, operator));
    const page = f.service.history({ characterId: "taki", patternId: draft.patternId, before: null, limit: 1 });
    expect(page.revisions[0]?.revisionId).toBe(draft.candidateRevision?.revisionId);
    expect(f.service.history({ characterId: "taki", patternId: draft.patternId, before: page.nextBefore, limit: 1 }).revisions[0]?.revisionId)
      .toBe(one.candidateRevision?.revisionId);
  });

  it("rolls back state and revisions on receipt failure and notifies only after commit", () => {
    const f = fixture();
    f.db.exec("CREATE TRIGGER reject_pattern_receipt BEFORE INSERT ON interaction_pattern_commands BEGIN SELECT RAISE(ABORT,'test receipt failure'); END");
    expect(() => propose(f.service)).toThrow("test receipt failure");
    expect(f.db.prepare("SELECT * FROM interaction_patterns").all()).toEqual([]);
    expect(f.db.prepare("SELECT * FROM interaction_pattern_revisions").all()).toEqual([]);
    expect(f.onChanged).not.toHaveBeenCalled();
    f.db.exec("DROP TRIGGER reject_pattern_receipt");
    const candidate = propose(f.service);
    f.db.exec("CREATE TRIGGER reject_pattern_review BEFORE INSERT ON interaction_pattern_reviews BEGIN SELECT RAISE(ABORT,'review failed'); END");
    expect(() => confirm(f.service, candidate)).toThrow("review failed");
    expect(f.service.get({ characterId: "taki", patternId: candidate.patternId })).toEqual(candidate);
    expect(f.onChanged).toHaveBeenCalledTimes(1);
  });

  it("rolls back deferred commit failures and isolates throwing post-commit observers", () => {
    const f = fixture();
    f.db.exec(`CREATE TABLE test_pattern_parent(id INTEGER PRIMARY KEY);
      CREATE TABLE test_pattern_child(parent INTEGER REFERENCES test_pattern_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER fail_pattern_commit AFTER INSERT ON interaction_pattern_commands
      BEGIN INSERT INTO test_pattern_child(parent) VALUES(1); END`);
    expect(() => propose(f.service)).toThrow();
    expect(f.db.prepare("SELECT * FROM interaction_patterns").all()).toEqual([]);
    expect(f.db.prepare("SELECT * FROM test_pattern_child").all()).toEqual([]);
    expect(f.onChanged).not.toHaveBeenCalled();
    f.db.exec("DROP TRIGGER fail_pattern_commit");
    const noisy = createInteractionPatternService({ db: f.db, now: () => new Date(at), onChanged: () => { throw new Error("offline UI"); } });
    const candidate = propose(noisy);
    expect(noisy.get({ characterId: "taki", patternId: candidate.patternId })).toEqual(candidate);
    expect(noisy.notificationFailures()).toBe(1);
  });
});
