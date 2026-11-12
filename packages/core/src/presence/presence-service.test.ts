import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { HeartbeatDecision, PresenceReportParams } from "@taki/shared";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createConnectionRegistry } from "../server/connection-registry.ts";
import { createInitiativeFeedbackRepo, type FeedbackFact } from "./initiative-feedback-repo.ts";
import { createPresenceService } from "./presence-service.ts";
import { FEEDBACK_DEADLINE_MS, PRESENCE_MAX_EXPOSURES, PRESENCE_MAX_SOURCES, PRESENCE_REPORT_BURST } from "./presence-policy.ts";

const BASE = Date.parse("2026-09-27T02:00:00.000Z");
const databases: Database[] = []; const roots: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-presence-")) throw new Error("unsafe fixture path");
    rmSync(root, { recursive: true, force: true });
  }
});

function setup() {
  const clock = { at: BASE };
  const f = initiativeFixture(() => new Date(clock.at).toISOString()); databases.push(f.db);
  const facts: FeedbackFact[] = [];
  const feedback = createInitiativeFeedbackRepo({ db: f.db, now: () => clock.at, commitFact: (fact) => { facts.push(fact); } });
  const connections = createConnectionRegistry();
  const service = createPresenceService({ db: f.db, connections, feedback, now: () => clock.at });
  return { ...f, clock, facts, feedback, connections, service };
}
type Fixture = ReturnType<typeof setup>;
async function publish(f: Fixture, options: { deliveryClass?: "class_a" | "class_b"; expectation?: "none" | "invitation"; publish?: boolean; sync?: boolean } = {}) {
  const identity = await f.admit(options.deliveryClass ?? "class_b");
  const decision: HeartbeatDecision = { outcome: "speak", selectedCandidateIds: ["candidate"], text: "A question",
    presentation: null, responseExpectation: options.expectation ?? "invitation" };
  f.deliveries.stage({ ...identity, decision, expiresAt: new Date(f.clock.at + 60_000).toISOString(), primaryVersion: 0, consideredCount: 1 });
  f.runs.settle(identity.runId, identity.attemptId, "completed");
  const entry = options.publish === false ? undefined : f.deliveries.commitPublication({ runId: identity.runId,
    policy: { hourLimit: 100, dayLimit: 100, gapMs: 0, dayStart: "2026-09-27T00:00:00.000Z", timezone: "UTC" }, append: f.store.appendDelivery });
  if (options.sync !== false) f.feedback.syncPublished();
  return { characterId: "taki", timelineSeq: entry?.seq ?? -1, runId: identity.runId };
}

function surface(f: Fixture, deviceId = "desktop", kind: PresenceReportParams["surface"] = "chat") {
  const connection = f.connections.create();
  f.connections.authenticate(connection, { deviceId, role: "operator", capabilities: [] });
  const sourceId = randomUUID(); let sequence = 1; let inputSequence = 0; let inputAt: number | null = null;
  const initial: PresenceReportParams = { sourceId, sequence, observedAgeMs: 0, surface: kind,
    state: "active", visible: true, focused: true, lastInput: null };
  expect(f.service.reportPresence(connection, initial).status).toBe("accepted");
  const report = (patch: Partial<PresenceReportParams> = {}) => f.service.reportPresence(connection, { ...initial, sequence: ++sequence,
    lastInput: inputAt === null ? null : { sequence: inputSequence, kind: "keyboard", ageMs: f.clock.at - inputAt }, ...patch });
  return { connection, initial, report,
    input() { inputAt = f.clock.at; inputSequence++; return report(); },
    exposure(reference: { characterId: string; timelineSeq: number }, exposed = true, observedAgeMs = 0) {
      return f.service.reportPresentation(connection, { sourceId, sequence: ++sequence, observedAgeMs,
        characterId: reference.characterId, timelineSeq: reference.timelineSeq, exposed });
    },
  };
}

function userRow(f: Fixture, characterId = "taki", at = f.clock.at) {
  f.db.prepare(`INSERT INTO timeline_messages(id,character_id,role,content,created_at) VALUES(:id,:character,'user','Reply',:at)`)
    .run({ id: randomUUID(), character: characterId, at: new Date(at).toISOString() });
}

describe("connection-bound presence", () => {
  it("keeps independent same-device windows and phone presence separate from Host availability", () => {
    const f = setup(); const home = surface(f, "desktop", "home"); const chat = surface(f); const phone = surface(f, "phone", "phone");
    expect(f.service.snapshot()).toMatchObject({ state: "unknown", sourceCount: 3, deviceCount: 2 });
    f.clock.at++; expect(chat.input().status).toBe("accepted"); expect(phone.input().status).toBe("accepted");
    f.connections.remove(home.connection);
    expect(f.service.snapshot()).toMatchObject({ state: "present", sourceCount: 2, inputFreshSources: 2 });
    f.connections.remove(chat.connection);
    expect(f.service.snapshot()).toMatchObject({ state: "present", sourceCount: 1, deviceCount: 1 });
    expect(f.connections.findHost("phone")).toBeUndefined();
    f.connections.remove(phone.connection); expect(f.service.snapshot().state).toBe("unknown");
  });

  it("refuses wrong roles, replay, source/surface changes, old sockets and buffered initial input", () => {
    const f = setup(); const client = surface(f);
    expect(f.service.reportPresence(client.connection, client.initial)).toMatchObject({ reason: "stale-sequence" });
    expect(client.report({ surface: "pet" })).toMatchObject({ reason: "stale-source" });
    expect(client.report({ sourceId: "another" })).toMatchObject({ reason: "stale-source" });
    const node = f.connections.create(); f.connections.authenticate(node, { deviceId: "node", role: "node", capabilities: [] });
    expect(f.service.reportPresence(node, client.initial)).toMatchObject({ reason: "unauthorized" });
    f.connections.remove(client.connection);
    expect(client.report()).toMatchObject({ reason: "unauthorized" });
    const replacement = f.connections.create(); f.connections.authenticate(replacement, { deviceId: "desktop", role: "operator", capabilities: [] });
    expect(f.service.reportPresence(replacement, { ...client.initial, lastInput: { sequence: 1, kind: "keyboard", ageMs: 0 } }))
      .toMatchObject({ reason: "stale-source" });
  });

  it("preserves input age on renewal and rejects negative, future, stale and regressing evidence", () => {
    const f = setup(); const client = surface(f); f.clock.at++; client.input();
    f.clock.at += 15_000;
    expect(client.report().status).toBe("accepted");
    expect(client.report({ lastInput: { sequence: 1, kind: "keyboard", ageMs: 0 } })).toMatchObject({ reason: "stale-input" });
    expect(client.report({ observedAgeMs: -1 })).toMatchObject({ reason: "invalid-report" });
    expect(client.report({ observedAgeMs: 30_000 })).toMatchObject({ reason: "stale-observation" });
    expect(client.report().status).toBe("accepted");
    for (let i = 0; i < 4; i++) { f.clock.at += 15_000; expect(client.report().status).toBe("accepted"); }
    expect(f.service.snapshot()).toMatchObject({ state: "unknown", sourceCount: 1, inputFreshSources: 0 });
  });

  it("accepts variable network delay on same-input renewals without extending the original freshness bound", () => {
    const f = setup(); const client = surface(f);
    // Input occurred at client +100ms and its first report arrived 10ms later.
    f.clock.at = BASE + 110;
    expect(client.report({ lastInput: { sequence: 1, kind: "keyboard", ageMs: 0 } }).status).toBe("accepted");
    // These ages are measured at send time; Core cannot require their deltas to equal transport elapsed time.
    for (const [receivedOffset, inputAge] of [[15_120, 15_000], [30_105, 30_000], [45_140, 45_000]]) {
      f.clock.at = BASE + receivedOffset!;
      expect(client.report({ lastInput: { sequence: 1, kind: "keyboard", ageMs: inputAge! } }).status).toBe("accepted");
      expect(f.service.snapshot().state).toBe("present");
    }
    // Even a frozen (nondecreasing) client age cannot advance the initially captured input instant.
    f.clock.at = BASE + 60_109;
    expect(client.report({ lastInput: { sequence: 1, kind: "keyboard", ageMs: 45_000 } }).status).toBe("accepted");
    expect(f.service.snapshot().state).toBe("present");
    f.clock.at++;
    expect(client.report({ lastInput: { sequence: 1, kind: "keyboard", ageMs: 45_000 } }).status).toBe("accepted");
    expect(f.service.snapshot()).toMatchObject({ state: "unknown", sourceCount: 1, inputFreshSources: 0 });
    expect(client.report({ lastInput: { sequence: 1, kind: "keyboard", ageMs: 44_999 } })).toMatchObject({ reason: "stale-input" });
    expect(client.report({ lastInput: { sequence: 1, kind: "touch", ageMs: 45_000 } })).toMatchObject({ reason: "stale-input" });
  });

  it("accepts same-millisecond coalesced input sequences without adding freshness or accepting older input", () => {
    const f = setup(); const client = surface(f); f.clock.at += 1_100;
    const firstInputAt = f.clock.at;
    expect(client.report({ lastInput: { sequence: 1, kind: "keyboard", ageMs: 0 } }).status).toBe("accepted");
    // The real producer immediately reports input after 1s quiet, then coalesces a second event for 1s.
    f.clock.at += 1_000;
    expect(client.report({ lastInput: { sequence: 2, kind: "pointer", ageMs: 1_000 } }).status).toBe("accepted");
    expect(client.report({ lastInput: { sequence: 1, kind: "keyboard", ageMs: 1_000 } })).toMatchObject({ reason: "stale-input" });
    expect(client.report({ lastInput: { sequence: 3, kind: "keyboard", ageMs: 1_001 } })).toMatchObject({ reason: "stale-input" });
    for (const ageMs of [20_000, 40_000, 59_999]) {
      f.clock.at = firstInputAt + ageMs;
      expect(client.report({ lastInput: { sequence: 2, kind: "pointer", ageMs } }).status).toBe("accepted");
    }
    expect(f.service.snapshot().state).toBe("present");
    f.clock.at = firstInputAt + 60_000;
    expect(f.service.snapshot()).toMatchObject({ state: "unknown", sourceCount: 1, inputFreshSources: 0 });
  });

  it("cannot renew an explicitly retired generation and does not treat focus as input", () => {
    const f = setup(); const client = surface(f); f.clock.at += 1_000;
    client.report({ focused: true }); expect(f.service.snapshot().state).toBe("unknown");
    expect(client.report({ state: "retired", visible: false }).status).toBe("accepted");
    expect(client.report()).toMatchObject({ reason: "stale-source" });
    expect(f.service.snapshot().sourceCount).toBe(0);
  });

  it("shares the bounded report bucket across presence and presentation without affecting another source", async () => {
    const f = setup(); const message = await publish(f); const client = surface(f); const another = surface(f);
    for (let i = 1; i < PRESENCE_REPORT_BURST; i++) expect(client.report().status).toBe("accepted");
    expect(client.exposure(message)).toMatchObject({ status: "refused", reason: "rate-limited" });
    expect(client.report()).toMatchObject({ reason: "rate-limited" });
    expect(another.exposure(message).status).toBe("accepted");
    f.clock.at += 124; expect(client.report()).toMatchObject({ reason: "rate-limited" });
    f.clock.at++; expect(client.exposure(message).status).toBe("accepted");
    expect(client.report()).toMatchObject({ reason: "rate-limited" });
    f.connections.remove(client.connection);
    expect(f.service.snapshot().sourceCount).toBe(1);
  });

  it.each(["hidden", "retired"] as const)("accepts a valid %s lifecycle transition after quota exhaustion without admitting new input", async (transition) => {
    const f = setup(); const message = await publish(f); const client = surface(f); const phone = surface(f, "phone", "phone");
    f.clock.at++; client.input(); phone.input(); client.exposure(message);
    for (let i = 3; i < PRESENCE_REPORT_BURST; i++) expect(client.report().status).toBe("accepted");
    expect(client.report({ state: "retired", sequence: 1 })).toMatchObject({ reason: "stale-sequence" });
    expect(client.report({ state: "retired", observedAgeMs: -1 })).toMatchObject({ reason: "invalid-report" });
    expect(client.report({ state: "retired", sourceId: "another-source" })).toMatchObject({ reason: "stale-source" });
    expect(client.report({ visible: false, state: transition === "retired" ? "retired" : "active",
      lastInput: { sequence: 2, kind: "touch", ageMs: 0 } }).status).toBe("accepted");
    expect(f.service.snapshot()).toMatchObject({ sourceCount: transition === "retired" ? 1 : 2, inputFreshSources: 1 });
    f.clock.at += 5_000;
    if (transition === "hidden") {
      expect(client.report({ visible: true, lastInput: null }).status).toBe("accepted");
      expect(client.exposure(message).status).toBe("accepted");
    } else expect(client.exposure(message)).toMatchObject({ reason: "stale-source" });
    expect(f.feedback.get(message)?.opportunityMs).toBe(0);
  });

  it.each(["hidden", "retired"] as const)("closes a valid %s transition independently of stale attached input", (transition) => {
    const f = setup(); const client = surface(f); f.clock.at++; client.input();
    f.clock.at++; client.input();
    expect(client.report({ state: transition === "retired" ? "retired" : "active", visible: false,
      lastInput: { sequence: 1, kind: "keyboard", ageMs: 0 } }).status).toBe("accepted");
    expect(f.service.snapshot()).toMatchObject({ state: "unknown", sourceCount: transition === "retired" ? 0 : 1 });
  });

  it("bounds retained source ownership and reclaims expired history without reviving its presence", () => {
    const f = setup(); const clients = Array.from({ length: PRESENCE_MAX_SOURCES }, () => surface(f));
    const extra = f.connections.create(); f.connections.authenticate(extra, { deviceId: "extra", role: "operator", capabilities: [] });
    const initial = { ...clients[0]!.initial, sourceId: "extra" };
    expect(f.service.reportPresence(extra, initial)).toMatchObject({ reason: "source-limit" });
    expect(f.service.snapshot()).toMatchObject({ sourceCount: PRESENCE_MAX_SOURCES, state: "unknown" });
    f.clock.at += 90_001;
    expect(f.service.reportPresence(extra, initial).status).toBe("accepted");
    expect(f.service.snapshot()).toMatchObject({ sourceCount: 1, state: "unknown" });
    expect(clients[0]!.report().status).toBe("accepted");
    expect(f.service.snapshot()).toMatchObject({ sourceCount: 2, inputFreshSources: 0 });
  });

  it("retires evidence when the same connection receives another authentication generation", async () => {
    const f = setup(); const message = await publish(f); const home = surface(f, "desktop", "home"); const pet = surface(f, "desktop", "pet");
    f.clock.at++; home.input(); pet.exposure(message);
    f.clock.at += 5_000;
    f.connections.authenticate(home.connection, { deviceId: "desktop", role: "operator", capabilities: [] });
    expect(f.service.snapshot()).toMatchObject({ state: "unknown", sourceCount: 1 });
    expect(home.report()).toMatchObject({ reason: "stale-source" });
    pet.exposure(message); expect(f.feedback.get(message)?.opportunityMs).toBe(0);
  });
});

describe("actual per-message response opportunities", () => {
  it("does not create presentation evidence from hidden-only reports or empty/non-assistant Timeline rows", async () => {
    const f = setup(); const message = await publish(f); const client = surface(f);
    expect(client.exposure(message, false).status).toBe("accepted");
    expect(f.db.prepare("SELECT * FROM delivery_presentations").all()).toEqual([]);
    expect(f.facts).toEqual([]); expect(f.feedback.get(message)?.opportunityMs).toBe(0);
    for (const [role, content] of [["user", "Reply"], ["assistant", ""], ["assistant", " \n\t "]]) {
      const row = f.db.prepare(`INSERT INTO timeline_messages(id,character_id,role,content,created_at)
        VALUES(:id,'taki',:role,:content,:at) RETURNING seq`).get({ id: randomUUID(), role: role!, content: content!, at: new Date(f.clock.at).toISOString() });
      expect(client.exposure({ characterId: "taki", timelineSeq: Number(row?.seq) })).toMatchObject({ reason: "unknown-message" });
    }
  });

  it("bounds active exposures and makes a hidden message release its slot", () => {
    const f = setup(); const client = surface(f);
    const messages = Array.from({ length: PRESENCE_MAX_EXPOSURES + 1 }, () => {
      const row = f.db.prepare(`INSERT INTO timeline_messages(id,character_id,role,content,created_at)
        VALUES(:id,'taki','assistant','Existing text',:at) RETURNING seq`).get({ id: randomUUID(), at: new Date(f.clock.at).toISOString() });
      return { characterId: "taki", timelineSeq: Number(row?.seq) };
    });
    for (const message of messages.slice(0, PRESENCE_MAX_EXPOSURES)) expect(client.exposure(message).status).toBe("accepted");
    expect(client.exposure(messages.at(-1)!)).toMatchObject({ reason: "exposure-limit" });
    expect(client.exposure(messages[0]!, false).status).toBe("accepted");
    expect(client.exposure(messages.at(-1)!).status).toBe("accepted");
    expect(f.feedback.list("taki")).toEqual([]);
  });
  it("unions two windows and devices once, requires actual matching message, and waits for the deadline", async () => {
    const f = setup(); const message = await publish(f);
    const chat = surface(f); const pet = surface(f, "desktop", "pet"); const phone = surface(f, "phone", "phone");
    f.clock.at++; chat.input(); phone.input(); chat.exposure(message); pet.exposure(message); phone.exposure(message);
    expect(chat.exposure({ ...message, characterId: "another" })).toMatchObject({ reason: "unknown-message" });
    for (let i = 1; i <= 8; i++) {
      f.clock.at += 15_000; chat.input(); phone.input(); pet.report();
      chat.exposure(message); pet.exposure(message); phone.exposure(message);
    }
    expect(f.feedback.get(message)).toMatchObject({ opportunityMs: 120_000, disposition: null });
    expect(f.facts.filter((fact) => fact.kind === "delivery.presented")).toHaveLength(1);
    f.clock.at = BASE + FEEDBACK_DEADLINE_MS; f.service.sweep(); f.service.sweep();
    expect(f.feedback.get(message)).toMatchObject({ disposition: "weak_non_engagement", opportunityMs: 120_000 });
    expect(f.facts.filter((fact) => fact.kind === "delivery.feedback_settled")).toHaveLength(1);
  });

  it("does not associate native/phone presence with an unattended Desktop display", async () => {
    const f = setup(); const message = await publish(f); const chat = surface(f); const phone = surface(f, "phone", "phone");
    f.clock.at++; phone.input(); chat.exposure(message);
    f.clock.at += 15_000; phone.report(); chat.report(); chat.exposure(message);
    expect(f.service.snapshot().state).toBe("present"); expect(f.feedback.get(message)?.opportunityMs).toBe(0);
    const native = createPresenceService({ db: f.db, connections: f.connections, feedback: f.feedback, now: () => f.clock.at,
      nativeEvidence: () => ({ observedAt: f.clock.at, idleSeconds: 0 }) });
    expect(native.snapshot()).toMatchObject({ state: "present", nativePresence: "present", inputFreshSources: 0 });
    expect(f.feedback.get(message)?.opportunityMs).toBe(0);
    native.close();
  });

  it("excludes unknown idle, stale/future native evidence and stale direct input", () => {
    const f = setup(); const native = { observedAt: f.clock.at, idleSeconds: null as number | null };
    const service = createPresenceService({ db: f.db, connections: f.connections, feedback: f.feedback, now: () => f.clock.at,
      nativeEvidence: () => native });
    expect(service.snapshot().state).toBe("unknown"); native.idleSeconds = 0; native.observedAt++;
    expect(service.snapshot().state).toBe("unknown"); native.observedAt = f.clock.at - 60_000;
    expect(service.snapshot().state).toBe("unknown"); native.observedAt = f.clock.at; native.idleSeconds = 180;
    expect(service.snapshot()).toMatchObject({ state: "unknown", nativePresence: "inactive" });
  });

  it("does not accrue exposure from timer ticks, hidden state, expired leases or late renewals", async () => {
    const f = setup(); const message = await publish(f); const client = surface(f); f.clock.at++; client.input(); client.exposure(message);
    f.clock.at += 15_000; f.service.sweep(); expect(f.feedback.get(message)?.opportunityMs).toBe(0);
    client.report(); f.clock.at += 20_000; client.report(); client.exposure(message);
    expect(f.feedback.get(message)?.opportunityMs).toBe(0);
    f.clock.at += 10_000; client.report({ visible: false });
    expect(f.feedback.get(message)?.opportunityMs).toBe(10_000);
    expect(client.exposure(message)).toMatchObject({ reason: "stale-source" });
    f.clock.at += 40_000; client.report({ visible: true }); client.exposure(message);
    expect(f.feedback.get(message)?.opportunityMs).toBe(10_000);
  });

  it("does not backfill transport-delay gaps and closes at the actual report observation", async () => {
    const f = setup(); const message = await publish(f); const client = surface(f); f.clock.at++; client.input(); client.exposure(message);
    f.clock.at += 10_000;
    expect(client.exposure(message, true, 2_000).status).toBe("accepted");
    expect(f.feedback.get(message)?.opportunityMs).toBe(8_000);
    f.clock.at += 10_000; client.exposure(message, false, 2_000);
    expect(f.feedback.get(message)?.opportunityMs).toBe(16_000);
  });

  it("does not backfill disconnected or null-input gaps when the same-device source becomes fresh again", async () => {
    const f = setup(); const message = await publish(f); const chat = surface(f); const pet = surface(f, "desktop", "pet");
    f.clock.at++; chat.input(); pet.exposure(message);
    f.clock.at += 5_000; chat.report({ lastInput: null });
    f.clock.at += 5_000; chat.input();
    f.clock.at += 5_000; pet.exposure(message);
    expect(f.feedback.get(message)?.opportunityMs).toBe(10_000);
    f.connections.remove(chat.connection);
    f.clock.at += 5_000; pet.report(); pet.exposure(message);
    expect(f.feedback.get(message)?.opportunityMs).toBe(10_000);
    const next = surface(f); f.clock.at += 5_000; next.input();
    f.clock.at += 5_000; pet.report(); pet.exposure(message);
    expect(f.feedback.get(message)?.opportunityMs).toBe(15_000);
  });

  it("requires published Class B invitations and keeps other presentations free of invented measurements", async () => {
    const f = setup(); const classA = await publish(f, { deliveryClass: "class_a" });
    const noReply = await publish(f, { expectation: "none" }); await publish(f, { publish: false });
    expect(f.feedback.list("taki")).toEqual([]);
    const client = surface(f); client.exposure(classA); client.exposure(noReply);
    expect(f.facts).toHaveLength(2); expect(f.facts.every((fact) => fact.opportunityMs === undefined)).toBe(true);
  });

  it("accepts only a later same-character durable user row and never reopens historical feedback", async () => {
    const f = setup(); userRow(f); const message = await publish(f);
    f.service.observeUserTurn("taki", new Date(f.clock.at).toISOString());
    expect(f.feedback.get(message)?.disposition).toBeNull();
    f.clock.at += 1_000; userRow(f, "another"); f.service.observeUserTurn("another", new Date(f.clock.at).toISOString());
    expect(f.feedback.get(message)?.disposition).toBeNull();
    userRow(f); f.service.observeUserTurn("taki", new Date(f.clock.at).toISOString());
    expect(f.feedback.get(message)?.disposition).toBe("engaged");
    const later = await publish(f); f.clock.at += FEEDBACK_DEADLINE_MS; f.service.sweep();
    expect(f.feedback.get(later)?.disposition).toBe("unknown");
    const client = surface(f); f.clock.at++; client.input(); client.exposure(later);
    userRow(f); f.service.observeUserTurn("taki", new Date(f.clock.at).toISOString());
    expect(f.feedback.get(later)?.disposition).toBe("unknown");
  });

  it("uses Timeline sequence for same-millisecond replies and refuses callback-only or at-deadline replies", async () => {
    const f = setup(); userRow(f); const first = await publish(f);
    f.service.observeUserTurn("taki"); expect(f.feedback.get(first)?.disposition).toBeNull();
    userRow(f); f.service.sweep(); expect(f.feedback.get(first)?.disposition).toBe("engaged");
    const deadlineMessage = await publish(f);
    f.clock.at += FEEDBACK_DEADLINE_MS; userRow(f); f.service.observeUserTurn("taki");
    expect(f.feedback.get(deadlineMessage)?.disposition).toBe("unknown");
    expect(f.facts.filter((fact) => fact.kind === "delivery.feedback_settled")).toHaveLength(2);
  });
});

describe("durable feedback and process lifetime", () => {
  it("retires hidden surface exposures before an unrelated feedback write can fail", async () => {
    const f = setup(); const message = await publish(f); const chat = surface(f); const home = surface(f, "desktop", "home");
    f.clock.at++; chat.input(); home.input(); chat.exposure(message);
    await publish(f, { sync: false });
    f.db.exec(`CREATE TRIGGER reject_new_feedback BEFORE INSERT ON initiative_feedback
      BEGIN SELECT RAISE(ABORT,'feedback sync refused'); END`);
    expect(() => chat.report({ visible: false })).toThrow("feedback sync refused");
    f.db.exec("DROP TRIGGER reject_new_feedback");
    f.clock.at += 5_000; chat.report({ visible: true, lastInput: null }); chat.exposure(message);
    expect(f.service.snapshot().inputFreshSources).toBe(1);
    expect(f.feedback.get(message)?.opportunityMs).toBe(0);
  });

  it("rolls presentation and settlement back on required fact failure and isolates post-commit observers", async () => {
    const f = setup(); const message = await publish(f); const published: FeedbackFact[][] = [];
    const broken = createInitiativeFeedbackRepo({ db: f.db, now: () => f.clock.at,
      commitFact: () => { throw new Error("event write failed"); }, publishFacts: (facts) => { published.push([...facts]); } });
    expect(() => broken.present(message)).toThrow("event write failed");
    expect(f.db.prepare("SELECT * FROM delivery_presentations").all()).toEqual([]); expect(published).toEqual([]);
    f.clock.at += FEEDBACK_DEADLINE_MS;
    expect(() => broken.settleDue()).toThrow("event write failed"); expect(f.feedback.get(message)?.disposition).toBeNull();
    const isolated = createInitiativeFeedbackRepo({ db: f.db, now: () => f.clock.at, commitFact: () => {},
      publishFacts: () => { throw new Error("disconnected observer"); } });
    isolated.settleDue(); expect(f.feedback.get(message)?.disposition).toBe("unknown");
  });

  it("keeps interval unions and totals atomic, bounds fragmentation, and validates persisted interval rows", async () => {
    const f = setup(); const message = await publish(f); f.clock.at += 30_000;
    f.feedback.observeInterval({ ...message, start: BASE, end: BASE + 5_000 });
    f.db.exec(`CREATE TRIGGER reject_feedback_interval BEFORE UPDATE OF intervals_json ON initiative_feedback
      BEGIN SELECT RAISE(ABORT,'interval refused'); END`);
    expect(() => f.feedback.observeInterval({ ...message, start: BASE + 5_000, end: BASE + 10_000 })).toThrow("interval refused");
    expect(f.feedback.get(message)).toMatchObject({ opportunityMs: 5_000, intervals: [[BASE, BASE + 5_000]] });
    f.db.exec("DROP TRIGGER reject_feedback_interval");
    f.feedback.observeInterval({ ...message, start: BASE + 3_000, end: BASE + 8_000 });
    expect(f.feedback.get(message)).toMatchObject({ opportunityMs: 8_000, intervals: [[BASE, BASE + 8_000]] });
    for (let i = 0; i < 127; i++) f.feedback.observeInterval({ ...message, start: BASE + 10_000 + i * 2, end: BASE + 10_001 + i * 2 });
    const retained = f.feedback.get(message);
    f.feedback.observeInterval({ ...message, start: BASE + 20_000, end: BASE + 20_001 });
    expect(f.feedback.get(message)).toEqual(retained); expect(retained?.intervals).toHaveLength(128);
    f.db.exec("UPDATE initiative_feedback SET intervals_json='[[-1,1]]'");
    expect(() => f.feedback.get(message)).toThrow();
  });

  it("reopens actual SQLite history without live leases or outage accrual and recovers a missed user callback", async () => {
    const f = setup(); const message = await publish(f); const replied = await publish(f);
    const client = surface(f); f.clock.at++; client.input(); client.exposure(message);
    f.clock.at += 15_000; client.report(); client.exposure(message);
    expect(f.feedback.get(message)?.opportunityMs).toBe(15_000);
    userRow(f);
    const unanswered = await publish(f);
    const root = mkdtempSync(join(tmpdir(), "taki-presence-")); roots.push(root); const path = join(root, "feedback.db");
    f.db.prepare("VACUUM INTO :path").run({ path }); f.service.close(); f.db.close();
    f.clock.at += 600_000;
    const db = openDatabase({ path, migrations: MIGRATIONS }); databases.push(db);
    const facts: FeedbackFact[] = [];
    const feedback = createInitiativeFeedbackRepo({ db, now: () => f.clock.at, commitFact: (fact) => { facts.push(fact); } });
    const connections = createConnectionRegistry();
    const service = createPresenceService({ db, connections, feedback, now: () => f.clock.at });
    service.sweep();
    expect(service.snapshot()).toMatchObject({ state: "unknown", sourceCount: 0 });
    expect(feedback.get(message)).toMatchObject({ opportunityMs: 15_000, disposition: "engaged" });
    expect(feedback.get(replied)?.disposition).toBe("engaged");
    expect(feedback.get(unanswered)).toMatchObject({ opportunityMs: 0, disposition: null });
    expect(facts.filter((fact) => fact.kind === "delivery.feedback_settled")).toHaveLength(2);
    service.sweep(); expect(facts).toHaveLength(2);
    f.clock.at += FEEDBACK_DEADLINE_MS; service.sweep();
    expect(feedback.get(unanswered)).toMatchObject({ opportunityMs: 0, disposition: "unknown" });
    service.sweep(); expect(facts).toHaveLength(3);
  });
});
