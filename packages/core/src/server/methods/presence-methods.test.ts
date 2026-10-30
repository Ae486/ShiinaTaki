import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESENCE_METHODS, PresenceReportResultSchema, PresenceSnapshotSchema,
  TrajectoryInspectorSchema, type RunEvent } from "@taki/shared";
import { initiativeFixture } from "../../testing/initiative-fixture.ts";
import { createRunEventLiveBus } from "../../db/run-event-live.ts";
import { createConnectionRegistry } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { createPerceptionEvidence } from "../../perception/perception-evidence.ts";
import { composePresenceRuntime } from "../../initiative/presence-composition.ts";
import { createObservabilityQueryService } from "../../observability/observability-query-service.ts";
import { registerPresenceMethods } from "./presence-methods.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.useRealTimers(); });

function fixture() {
  vi.useFakeTimers(); vi.setSystemTime("2026-09-28T02:00:00.000Z");
  const f = initiativeFixture(() => new Date().toISOString());
  const connections = createConnectionRegistry();
  const registry = createMethodRegistry();
  const live = createRunEventLiveBus((runId, afterSeq, limit) => f.events.page({ runId, afterSeq, limit }));
  const runtime = composePresenceRuntime({ db: f.db, events: f.events, live, connections, logger: { warn: vi.fn() },
    evidence: createPerceptionEvidence({ isPaused: () => false, freshnessMs: 60_000, onRetire: () => undefined }) });
  cleanups.push(() => { runtime.close(); f.db.close(); });
  registerPresenceMethods(registry, { service: runtime.service, connections });
  const context = (role?: "operator" | "node", deviceId = "desktop") => {
    const connection = connections.create();
    if (role) connections.authenticate(connection, { role, deviceId, capabilities: [] });
    return { connection, notify: vi.fn(), onClose: vi.fn(), close: () => connections.remove(connection) } satisfies MethodContext;
  };
  const call = (ctx: MethodContext, method: string, params: unknown) => registry.dispatch({ jsonrpc: "2.0", id: 1, method, params }, ctx);
  const result = async (ctx: MethodContext, method: string, params: unknown) => {
    const response = await call(ctx, method, params);
    if (!("result" in response)) throw new Error(JSON.stringify(response.error));
    return response.result as unknown;
  };
  return { ...f, connections, runtime, context, call, result, live };
}
type Fixture = ReturnType<typeof fixture>;

const report = (sourceId: string, sequence: number) => ({ sourceId, sequence, observedAgeMs: 0,
  surface: "chat", state: "active", visible: true, focused: false, lastInput: null });

async function publish(f: Fixture, deliveryClass: "class_a" | "class_b" = "class_b") {
  const identity = await f.admit(deliveryClass);
  f.deliveries.stage({ ...identity, decision: { outcome: "speak", text: "Would you like a break?",
    selectedCandidateIds: ["candidate"], presentation: null, responseExpectation: "invitation" },
    expiresAt: new Date(Date.now() + 60_000).toISOString(), primaryVersion: 0, consideredCount: 1 });
  f.runs.settle(identity.runId, identity.attemptId, "completed");
  const entry = f.deliveries.commitPublication({ runId: identity.runId, append: f.store.appendDelivery,
    policy: { hourLimit: 10, dayLimit: 10, gapMs: 0, timezone: "UTC", dayStart: "2026-09-28T00:00:00.000Z" } });
  if (!entry) throw new Error("Fixture did not publish");
  return { ...identity, entry };
}

describe("presence operator methods and production composition", () => {
  it("enforces live operator authority and retires only the malformed caller", async () => {
    const f = fixture();
    expect(await f.call(f.context(), PRESENCE_METHODS.read, {})).toMatchObject({ error: { data: { code: "NOT_AUTHENTICATED" } } });
    expect(await f.call(f.context("node"), PRESENCE_METHODS.read, {})).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    const home = f.context("operator"); const chat = f.context("operator");
    expect(PresenceReportResultSchema.parse(await f.result(home, PRESENCE_METHODS.report, report("home", 1))).status).toBe("accepted");
    await f.result(chat, PRESENCE_METHODS.report, report("chat", 1));
    expect(await f.call(home, PRESENCE_METHODS.report, { ...report("home", 2), deviceId: "foreign" }))
      .toMatchObject({ error: { code: -32602 } });
    expect(PresenceSnapshotSchema.parse(await f.result(chat, PRESENCE_METHODS.read, {}))).toMatchObject({ state: "unknown", sourceCount: 1 });
    chat.close();
    expect(await f.call(chat, PRESENCE_METHODS.read, {})).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
  });

  it("publishes measured presentation and actual user engagement into the existing durable Monitor", async () => {
    const f = fixture(); const message = await publish(f); const ctx = f.context("operator");
    const observed: RunEvent[] = [];
    const subscription = f.live.subscribe(message.runId, (event) => { observed.push(event); }, { afterSeq: f.events.tail(message.runId).seq });
    cleanups.push(() => subscription.close());
    await f.result(ctx, PRESENCE_METHODS.report, report("chat", 1));
    await f.result(ctx, PRESENCE_METHODS.report, { ...report("chat", 2), lastInput: { sequence: 1, kind: "keyboard", ageMs: 0 } });
    const exposure = { sourceId: "chat", sequence: 3, observedAgeMs: 0, characterId: "taki", timelineSeq: message.entry.seq, exposed: true };
    expect(PresenceReportResultSchema.parse(await f.result(ctx, PRESENCE_METHODS.presentationReport, exposure)).status).toBe("accepted");
    vi.setSystemTime(Date.now() + 2_000);
    await f.result(ctx, PRESENCE_METHODS.presentationReport, { ...exposure, sequence: 4, exposed: false });
    const user = f.store.appendUser("taki", "Thanks");
    f.runtime.observeEntry(user);
    await Promise.resolve(); await Promise.resolve();
    const facts = f.events.list(message.runId).filter((event) => event.kind === "delivery.presented" || event.kind === "delivery.feedback_settled");
    expect(facts).toHaveLength(2);
    expect(facts[1]?.payload).toMatchObject({ disposition: "engaged", opportunityMs: 2_000 });
    expect(observed).toEqual(facts);
    const query = createObservabilityQueryService({ db: f.db, events: f.events, mode: () => "FULL_LOCAL" });
    const detail = TrajectoryInspectorSchema.parse(query.inspect({ characterId: "taki", runKey: message.runId, rowKey: facts[1]!.eventId }));
    expect(detail).toMatchObject({ technical: [], detail: expect.arrayContaining([
      { label: "已记录有效回应机会", value: "2 秒" }, { label: "互动观察", value: "观察到后续互动" },
    ]) });
    expect(detail.redactionNotice).toContain("呈现不代表已阅读");
    f.runtime.observeEntry(user);
    expect(f.events.list(message.runId).filter((event) => event.kind === "delivery.feedback_settled")).toHaveLength(1);
  });

  it("rolls back required facts without sending phantom live events and keeps Class A opportunity unknown", async () => {
    const f = fixture(); const message = await publish(f, "class_a"); const ctx = f.context("operator");
    await f.result(ctx, PRESENCE_METHODS.report, report("chat", 1));
    const exposure = { sourceId: "chat", sequence: 2, observedAgeMs: 0, characterId: "taki", timelineSeq: message.entry.seq, exposed: true };
    f.db.exec("CREATE TRIGGER reject_presentation BEFORE INSERT ON run_events WHEN NEW.kind='delivery.presented' BEGIN SELECT RAISE(ABORT,'fixture refusal'); END");
    expect(await f.call(ctx, PRESENCE_METHODS.presentationReport, exposure)).toHaveProperty("error");
    expect(f.db.prepare("SELECT count(*) AS n FROM delivery_presentations").get()?.n).toBe(0);
    expect(f.events.list(message.runId).filter((event) => event.kind === "delivery.presented")).toHaveLength(0);
    f.db.exec("DROP TRIGGER reject_presentation");
    await f.result(ctx, PRESENCE_METHODS.presentationReport, exposure);
    const event = f.events.list(message.runId).find((item) => item.kind === "delivery.presented");
    expect(event?.payload).not.toHaveProperty("opportunityMs");
    expect(f.db.prepare("SELECT count(*) AS n FROM initiative_feedback").get()?.n).toBe(0);
  });

  it("preserves a durable primary reply when its feedback writer fails and reconciles it once after commit", async () => {
    const f = fixture(); const message = await publish(f);
    const observed: RunEvent[] = [];
    const subscription = f.live.subscribe(message.runId, (event) => { observed.push(event); },
      { afterSeq: f.events.tail(message.runId).seq });
    cleanups.push(() => subscription.close());
    f.db.exec("CREATE TRIGGER reject_feedback BEFORE INSERT ON run_events WHEN NEW.kind='delivery.feedback_settled' BEGIN SELECT RAISE(ABORT,'fixture refusal'); END");
    const user = f.store.appendUser("taki", "Thanks for checking in.");
    expect(() => f.runtime.observeEntry(user)).not.toThrow();
    expect(f.db.prepare("SELECT content FROM timeline_messages WHERE seq=:seq").get({ seq: user.seq })?.content)
      .toBe(user.content);
    expect(f.db.prepare("SELECT disposition FROM initiative_feedback WHERE timeline_seq=:seq").get({ seq: message.entry.seq })?.disposition)
      .toBeNull();
    await Promise.resolve();
    expect(observed).toEqual([]);
    expect(f.events.list(message.runId).some((event) => event.kind === "delivery.feedback_settled")).toBe(false);

    f.db.exec("DROP TRIGGER reject_feedback");
    // Exercise the production maintenance owner, without replaying the primary append or callback.
    await vi.advanceTimersByTimeAsync(15_000);
    const facts = f.events.list(message.runId).filter((event) => event.kind === "delivery.feedback_settled");
    expect(facts).toHaveLength(1);
    expect(facts[0]?.payload).toMatchObject({ disposition: "engaged", opportunityMs: 0 });
    expect(observed).toEqual(facts);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.events.list(message.runId).filter((event) => event.kind === "delivery.feedback_settled")).toEqual(facts);
  });

  it("never bridges a hidden interval when the source has exhausted its ordinary report allowance", async () => {
    const f = fixture(); const message = await publish(f); const ctx = f.context("operator");
    await f.result(ctx, PRESENCE_METHODS.report, report("chat", 1));
    const input = { sequence: 1, kind: "keyboard", ageMs: 0 };
    await f.result(ctx, PRESENCE_METHODS.report, { ...report("chat", 2), lastInput: input });
    const exposure = { sourceId: "chat", sequence: 3, observedAgeMs: 0,
      characterId: "taki", timelineSeq: message.entry.seq, exposed: true };
    await f.result(ctx, PRESENCE_METHODS.presentationReport, exposure);
    for (let sequence = 4; sequence <= 128; sequence++) {
      await f.result(ctx, PRESENCE_METHODS.report, { ...report("chat", sequence), lastInput: input });
    }
    await f.result(ctx, PRESENCE_METHODS.presentationReport, { ...exposure, sequence: 129, exposed: false });
    vi.setSystemTime(Date.now() + 5_000);
    await f.result(ctx, PRESENCE_METHODS.presentationReport, { ...exposure, sequence: 130 });
    expect(f.db.prepare("SELECT opportunity_ms FROM initiative_feedback WHERE timeline_seq=:seq")
      .get({ seq: message.entry.seq })?.opportunity_ms).toBe(0);
  });

  it("closes ephemeral exposure even when unrelated durable feedback maintenance fails", async () => {
    const f = fixture(); const message = await publish(f); const ctx = f.context("operator");
    await f.result(ctx, PRESENCE_METHODS.report, report("chat", 1));
    await f.result(ctx, PRESENCE_METHODS.report, { ...report("chat", 2),
      lastInput: { sequence: 1, kind: "keyboard", ageMs: 0 } });
    const exposure = { sourceId: "chat", sequence: 3, observedAgeMs: 0,
      characterId: "taki", timelineSeq: message.entry.seq, exposed: true };
    await f.result(ctx, PRESENCE_METHODS.presentationReport, exposure);
    await publish(f);
    f.db.exec("CREATE TRIGGER reject_feedback_sync BEFORE INSERT ON initiative_feedback BEGIN SELECT RAISE(ABORT,'fixture refusal'); END");
    expect(await f.call(ctx, PRESENCE_METHODS.presentationReport, { ...exposure, sequence: 4, exposed: false }))
      .toHaveProperty("error");
    f.db.exec("DROP TRIGGER reject_feedback_sync");
    vi.setSystemTime(Date.now() + 5_000);
    await f.result(ctx, PRESENCE_METHODS.presentationReport, { ...exposure, sequence: 5 });
    expect(f.db.prepare("SELECT opportunity_ms FROM initiative_feedback WHERE timeline_seq=:seq")
      .get({ seq: message.entry.seq })?.opportunity_ms).toBe(0);
  });
});
