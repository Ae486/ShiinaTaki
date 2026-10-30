import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreparedPublicationRequestSchema, type PreparedPublicationResult, type TriggerRequest } from "@taki/shared";
import { preparedPublicationFixture } from "../testing/prepared-publication-fixture.ts";
import { createChatAgent } from "../agents/chat-agent.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createRunService } from "../harness/run-service.ts";
import { createRecoveryCoordinator } from "../harness/recovery-coordinator.ts";
import { createPreparedPublication } from "./prepared-publication.ts";
import { createPreparedPublicationSource } from "./prepared-publication-source.ts";

type Fixture = Awaited<ReturnType<typeof preparedPublicationFixture>>;
const fixtures: Fixture[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-11T04:00:00.000Z"); });
afterEach(() => { for (const f of fixtures.splice(0)) f.cleanup(); vi.useRealTimers(); });
async function fixture(options?: Parameters<typeof preparedPublicationFixture>[0]) {
  const f = await preparedPublicationFixture(options); fixtures.push(f); return f;
}
const first = { candidateRef: "one", expectedRevision: "r1" };
const second = { candidateRef: "two", expectedRevision: "r1" };
function runId(result: PreparedPublicationResult): string {
  if (result.status !== "recorded") throw new Error(`Expected recorded output, got ${result.status}`);
  return result.runId;
}
function revise(f: Fixture, text = "Revised first output.") {
  f.accepted.revision = "r2";
  f.candidates.set("one", { ...f.candidates.get("one")!, revision: "r2", text });
}

describe("trusted prepared publication composition", () => {
  it("copies immutable material and generation context through publication independently of transient producer data", async () => {
    const f = await fixture();
    const sourceContext = { generatedBy: { runId: "child-run", attemptId: "child-attempt" },
      materials: [{ label: "External interview", reference: "document:interview", speaker: "Guest", time: "00:12" }] };
    f.candidates.set("one", { ...f.candidates.get("one")!, sourceContext });
    const captured = f.source.binding.publication!.resolve(first)!;
    expect(captured.sourceContext).toEqual(sourceContext);
    expect(Object.isFrozen(captured.sourceContext)).toBe(true);
    expect(Object.isFrozen(captured.sourceContext?.materials?.[0])).toBe(true);
    expect(captured.sourceContext).not.toBe(sourceContext);
    const result = await f.owner.publish(first);
    const record = f.deliveries.get(runId(result))!;
    expect(record.sourceContext).toEqual(sourceContext);
    const entry = f.timeline.latestAscending("taki", 10)[0]!;
    expect(entry).toMatchObject({ content: "First prepared output.", role: "assistant", sourceContext });
    expect(record.timelineSeq).toBe(entry.seq);
    expect(record.runId).not.toBe(sourceContext.generatedBy.runId);
    expect(f.effects.list?.(record.runId)).toEqual([]);
    f.candidates.clear(); f.source.retire();
    expect(f.timeline.latestAscending("taki", 10)[0]).toEqual(entry);
    expect(f.deliveries.get(record.runId)).toEqual(record);
  });

  it("refuses source-only candidate drift at the final publication boundary", async () => {
    const f = await fixture();
    const sourceContext = { materials: [{ label: "Interview", speaker: "Original guest" }] };
    f.candidates.set("one", { ...f.candidates.get("one")!, sourceContext });
    f.hooks.beforeCommit = () => { sourceContext.materials[0]!.speaker = "Changed guest"; };
    const result = await f.owner.publish(first);
    expect(f.deliveries.get(runId(result))).toMatchObject({ state: "suppressed", timelineSeq: null,
      sourceContext: { materials: [{ label: "Interview", speaker: "Original guest" }] } });
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("publishes two explicitly requested non-media report outputs around a foreground Agent turn without new model Effects", async () => {
    const f = await fixture({ hold: false });
    const model = scriptedModel([{ kind: "text", deltas: ['["First prepared output.","Second prepared output."]'] },
      { kind: "text", deltas: ["Foreground acknowledged."] }]);
    const agent = createChatAgent({ model, store: f.store, memory: f.memory, effectLifecycle: f.effects });
    const releasePreparation = f.queue.tryAcquireBackground("taki")!;
    let prepared = "";
    for await (const delta of agent.stream({ characterId: "taki", message: "Prepare two report updates I requested." }, {
      turnKind: "non-primary", controlInput: "Prepare two private report updates.", runId: f.root.run.runId,
      attemptId: f.root.attempt.attemptId, onSettledText: (text) => { prepared = text; },
    })) { expect(typeof delta).toBe("string"); }
    expect(JSON.parse(prepared)).toEqual([...f.candidates.values()].map((candidate) => candidate.text));
    expect(f.hold().changed).toBe(true); releasePreparation();
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    const one = await f.owner.publish(first);
    const primary = f.queue.reservePrimary("taki");
    expect(await f.owner.publish(second)).toEqual({ status: "deferred", reason: "foreground_busy" });
    const releasePrimary = await primary.acquire();
    const foregroundRequest: TriggerRequest = { triggerRequestId: "foreground", idempotencyKey: "foreground", characterId: "taki",
      initiator: "primary", deliveryClass: "class_a", contextMode: "primary", provenance: { provider: "chat" } };
    const foreground = await f.runs.admit(foregroundRequest); f.runs.start(foreground.run.runId, foreground.attempt.attemptId);
    for await (const delta of agent.stream({ characterId: "taki", message: "Foreground input" }, {
      turnKind: "primary", runId: foreground.run.runId, attemptId: foreground.attempt.attemptId,
    })) { expect(typeof delta).toBe("string"); }
    f.runs.settle(foreground.run.runId, foreground.attempt.attemptId, "completed"); releasePrimary();
    const two = await f.owner.publish(second);
    expect(runId(one)).not.toBe(runId(two));
    expect(await f.owner.publish(first)).toEqual(one);
    for (const result of [one, two]) {
      expect(f.effects.list?.(runId(result))).toEqual([]);
      expect(f.runs.status(runId(result)).run).toMatchObject({ parentRunId: f.root.run.runId, deliveryClass: "class_a", budgetUsed: 0 });
    }
    expect(f.runs.status(f.root.run.runId).run.state).toBe("waiting");
    expect(f.runs.status(f.root.run.runId).attempts).toHaveLength(1);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(f.capture).toHaveBeenCalledTimes(2);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.timeline.latestAscending("taki", 10).map((entry) => entry.content)).toEqual([
      "First prepared output.", "Foreground input", "Foreground acknowledged.", "Second prepared output.",
    ]);
    expect(f.db.prepare("SELECT count(*) AS n FROM run_deliveries WHERE delivery_class='class_b' AND charged_at IS NOT NULL").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS n FROM initiative_model_opportunities").get()?.n).toBe(0);
  });

  it("rejects helper-supplied text/class/root, unknown candidates and repeated source attachment", async () => {
    const f = await fixture();
    for (const extra of [{ text: "override" }, { deliveryClass: "class_a" }, { rootRunId: "forged" }]) {
      const input = { ...first, ...extra };
      expect(PreparedPublicationRequestSchema.safeParse(input).success).toBe(false);
      expect(await f.owner.publish(input)).toEqual({ status: "refused", reason: "invalid_input" });
    }
    expect(await f.owner.publish({ candidateRef: "not-offered", expectedRevision: "r1" }))
      .toEqual({ status: "refused", reason: "revision_unavailable" });
    expect(() => createPreparedPublication(f)).toThrow("PREPARED_ROOT_UNAVAILABLE");
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1);
  });

  it("preserves one held slot and defers another candidate without creating an extra child", async () => {
    const f = await fixture(); f.flags.gate = "hold";
    const one = await f.owner.publish(first); expect(one).toMatchObject({ status: "recorded", state: "held" });
    expect(f.runs.status(runId(one)).run.state).toBe("completed");
    expect(await f.owner.publish(second)).toEqual({ status: "deferred", reason: "held_slot_busy" });
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(2);
    f.flags.gate = "ready";
    expect(await f.owner.publish(first)).toMatchObject({ runId: runId(one), state: "sent" });
    expect(await f.owner.publish(second)).toMatchObject({ state: "sent" });
  });

  it("expires a candidate rejected before dispatch and never revives it when the gate later opens", async () => {
    const f = await fixture(); f.flags.gate = "suppress";
    const result = await f.owner.publish(first);
    expect(result).toMatchObject({ status: "recorded", state: "expired" });
    f.flags.gate = "ready";
    expect(await f.owner.publish(first)).toEqual(result);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
  });

  it.each(["expired", "beyond_source"] as const)("refuses %s candidate freshness while the finite source is current", async (kind) => {
    const f = await fixture();
    f.candidates.set("one", { ...f.candidates.get("one")!, expiresAt: kind === "expired" ? new Date().toISOString()
      : new Date(Date.parse(f.accepted.validity.expiresAt) + 1).toISOString() });
    expect(f.source.binding.isCurrent()).toBe(true);
    expect(await f.owner.publish(first)).toEqual({ status: "refused", reason: "revision_unavailable" });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1);
  });

  it("closes publication before acknowledging a revision edit and refuses stale or superseded confirmations", async () => {
    const f = await fixture(); f.flags.gate = "hold";
    const one = await f.owner.publish(first);
    const terminal = f.runs.status(runId(one));
    const edit = f.owner.beginEdit("r1")!;
    expect(f.deliveries.get(runId(one))?.state).toBe("expired");
    expect(f.runs.status(runId(one))).toEqual(terminal);
    expect(await f.owner.publish(second)).toEqual({ status: "refused", reason: "revision_unavailable" });
    expect(f.owner.confirmEdit(edit, "r2")).toBe(false);
    revise(f);
    expect(f.owner.confirmEdit({ ...edit, editId: "wrong-operation" }, "r2")).toBe(false);
    expect(f.owner.confirmEdit(edit, "r2")).toBe(true);
    expect(f.owner.confirmEdit(edit, "r2")).toBe(false);
    f.flags.gate = "ready";
    const revised = await f.owner.publish({ candidateRef: "one", expectedRevision: "r2" });
    expect(runId(revised)).not.toBe(runId(one));
    expect(await f.owner.publish(first)).toEqual({ status: "refused", reason: "output_committed" });
    expect(f.timeline.latestAscending("taki", 10).map((entry) => entry.content)).toEqual(["Revised first output."]);
  });

  it.each(["source", "authority", "publication_authorization", "cancel", "edit", "revision", "text"] as const)(
    "refuses %s invalidation between coordinator precheck and final transaction commitment", async (invalidation) => {
    const f = await fixture();
    f.hooks.beforeCommit = () => {
      if (invalidation === "source") f.flags.source = false;
      if (invalidation === "authority") f.flags.authority = false;
      if (invalidation === "publication_authorization") f.flags.publicationAuthorized = false;
      if (invalidation === "cancel") f.runs.requestCancel(f.root.run.runId);
      if (invalidation === "edit") f.source.beginEdit("r1");
      if (invalidation === "revision") revise(f);
      if (invalidation === "text") f.candidates.get("one")!.text = "Changed without revision.";
    };
    const result = await f.owner.publish(first);
    expect(result).toMatchObject({ status: "recorded", state: "suppressed" });
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    expect(f.deliveries.get(runId(result))).toMatchObject({ chargedAt: null, timelineSeq: null });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("retires only owned pending output on Stop, preserving terminal evidence and another task/foreground turn", async () => {
    const f = await fixture(); f.flags.gate = "hold";
    const one = await f.owner.publish(first); const terminal = f.runs.status(runId(one));
    const other = await f.runs.admit({ triggerRequestId: "other", idempotencyKey: "other", characterId: "taki",
      initiator: "scheduled", deliveryClass: "class_a", contextMode: "autonomous", provenance: { provider: "scheduled" } });
    f.runs.start(other.run.runId, other.attempt.attemptId);
    const otherDelivery = f.deliveries.stage({ runId: other.run.runId, attemptId: other.attempt.attemptId, characterId: "taki",
      deliveryClass: "class_a", expiresAt: f.accepted.validity.expiresAt, primaryVersion: 0, consideredCount: 1,
      decision: { outcome: "speak", text: "Other task.", selectedCandidateIds: ["other"], presentation: null, responseExpectation: "none" } });
    const primary = f.queue.reservePrimary("taki"); const release = await primary.acquire();
    const foreground = f.turns.begin("taki", undefined, "actual-foreground");
    f.owner.stop(); f.owner.stop();
    expect(f.runs.status(runId(one))).toEqual(terminal);
    expect(f.deliveries.get(runId(one))?.state).toBe("expired");
    expect(f.runs.status(f.root.run.runId).run.state).toBe("cancelled");
    expect(f.deliveries.get(other.run.runId)).toEqual(otherDelivery);
    expect(foreground.signal.aborted).toBe(false);
    f.turns.end("taki", foreground); release();
    f.flags.gate = "ready";
    expect(await f.delivery.resume(runId(one))).toBe("refused");
    expect(await f.owner.publish(second)).toEqual({ status: "refused", reason: "closed" });
    await f.delivery.finish(otherDelivery, { isCurrent: () => true, gate: () => "ready", present: async () => "failed" });
    expect(f.timeline.latestAscending("taki", 10).map((entry) => entry.content)).toEqual(["Other task."]);
  });

  it("keeps unknown output idempotent across exact retries and a new plan revision", async () => {
    const f = await fixture(); f.flags.transport = "unknown";
    const one = await f.owner.publish(first); expect(one).toMatchObject({ state: "unknown" });
    const before = f.deliveries.get(runId(one));
    expect(await f.owner.publish(first)).toEqual(one);
    const edit = f.owner.beginEdit("r1")!; revise(f);
    expect(f.owner.confirmEdit(edit, "r2")).toBe(true);
    expect(await f.owner.publish({ candidateRef: "one", expectedRevision: "r2" })).toEqual({ status: "refused", reason: "output_committed" });
    f.owner.stop();
    expect(f.deliveries.get(runId(one))).toEqual(before);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(1);
  });

  it("keeps unknown edits, expired scopes and late confirmations closed after Stop", async () => {
    const f = await fixture(); const edit = f.owner.beginEdit("r1")!;
    expect(f.owner.confirmEdit(edit, "r2")).toBe(false);
    expect(f.owner.beginEdit("r1")).toEqual(edit);
    expect(await f.owner.publish(first)).toMatchObject({ status: "refused" });
    revise(f); f.owner.stop();
    expect(f.owner.confirmEdit(edit, "r2")).toBe(false);
    expect(await f.owner.publish({ candidateRef: "one", expectedRevision: "r2" })).toEqual({ status: "refused", reason: "closed" });
    const expired = await fixture(); const expiredEdit = expired.owner.beginEdit("r1")!; revise(expired);
    vi.setSystemTime(Date.parse(expired.accepted.validity.expiresAt));
    expect(expired.owner.confirmEdit(expiredEdit, "r2")).toBe(false);
  });

  it("fails closed after context loss and expires terminal held text through existing recovery without replay", async () => {
    const f = await fixture(); f.flags.gate = "hold";
    const one = await f.owner.publish(first); const terminal = f.runs.status(runId(one));
    const restarted = createRunService({ repo: f.runRepo, snapshot: { capture: f.capture }, provider: "fixture", modelId: "fixture" });
    expect(() => createPreparedPublication({ ...f, runs: restarted })).toThrow("PREPARED_ROOT_UNAVAILABLE");
    await expect(restarted.admitAcceptedWork(f.request, f.source.binding)).rejects.toThrow("RUN_WORK_CONTINUE_REQUIRED");
    await createRecoveryCoordinator({ db: f.db, runs: f.runRepo, effects: f.effects }).scan();
    expect(f.runs.status(runId(one))).toEqual(terminal);
    expect(f.deliveries.get(runId(one))?.state).toBe("expired");
    expect(f.runs.status(f.root.run.runId).run.state).toBe("waiting");
    expect(f.send).not.toHaveBeenCalled();
  });

  it("refuses absent acceptance and truthy non-boolean source authority", async () => {
    const f = await fixture(); f.flags.accepted = false;
    expect(() => createPreparedPublicationSource(f.producer, f.authorization)).toThrow();
    f.flags.accepted = true;
    Reflect.set(f.producer, "isCurrent", () => Promise.resolve(true));
    expect(() => createPreparedPublicationSource(f.producer, f.authorization)).toThrow("PREPARED_SOURCE_UNAVAILABLE");
    expect(await f.owner.publish(first)).toEqual({ status: "refused", reason: "root_unavailable" });
  });

  it("retains the closed edit ticket after a retirement persistence failure and permits only its explicit retry", async () => {
    const f = await fixture(); f.flags.gate = "hold";
    const one = await f.owner.publish(first);
    const failure = vi.spyOn(f.deliveries, "transition").mockImplementationOnce(() => { throw new Error("fixture disk failure"); });
    expect(() => f.owner.beginEdit("r1")).toThrow("PREPARED_RETIREMENT_FAILED");
    expect(f.deliveries.get(runId(one))?.state).toBe("held");
    expect(await f.owner.publish(second)).toEqual({ status: "refused", reason: "revision_unavailable" });
    const edit = f.owner.beginEdit("r1")!;
    expect(f.deliveries.get(runId(one))?.state).toBe("expired");
    failure.mockRestore(); revise(f);
    expect(f.owner.confirmEdit(edit, "r2")).toBe(true);
  });

  it("preserves already committed transport uncertainty when Stop arrives before its callback", async () => {
    const f = await fixture();
    let complete!: (outcome: "unknown") => void;
    f.send.mockImplementationOnce(() => new Promise<"unknown">((resolve) => { complete = resolve; }));
    const publication = f.owner.publish(first);
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(1);
    f.owner.stop(); complete("unknown");
    const one = await publication;
    expect(one).toMatchObject({ state: "unknown" });
    expect(await f.owner.publish(first)).toEqual(one);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.deliveries.get(runId(one))?.chargedAt).not.toBeNull();
  });

  it("invalidates an old child's root Attempt binding without adopting the replacement Attempt", async () => {
    const f = await fixture({ hold: false }); f.flags.gate = "hold";
    const one = await f.owner.publish(first);
    const replacement = f.runs.retry(f.root.run.runId, f.root.attempt.attemptId, "fixture retry");
    f.flags.gate = "ready";
    expect(await f.owner.publish(first)).toEqual({ status: "refused", reason: "source_unavailable" });
    expect(f.deliveries.get(runId(one))?.state).toBe("expired");
    expect(f.runs.status(f.root.run.runId).run.activeAttemptId).toBe(replacement.run.activeAttemptId);
    expect(() => f.runs.admitPreparedPublication({ rootRunId: f.root.run.runId, ...first })).toThrow("RUN_IDEMPOTENCY_CONFLICT");
    expect(f.send).not.toHaveBeenCalled();
  });

  it("cancels an owned child if source validity is lost immediately after admission, before staging", async () => {
    const f = await fixture(); const append = f.events.appendMany;
    vi.spyOn(f.events, "appendMany").mockImplementation((events) => {
      const result = append(events);
      if (events.some((event) => event.kind === "run.admitted")) f.flags.source = false;
      return result;
    });
    expect(await f.owner.publish(first)).toEqual({ status: "refused", reason: "source_unavailable" });
    expect(f.db.prepare("SELECT state FROM runs WHERE parent_run_id=:id").all({ id: f.root.run.runId })).toEqual([{ state: "cancelled" }]);
    expect(f.db.prepare("SELECT count(*) AS n FROM run_deliveries").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS n FROM run_effects").get()?.n).toBe(0);
  });

  it("never grants publication from source JSON, a copied handle or mismatched acceptance scope", async () => {
    const f = await fixture();
    for (const forged of [undefined, { deliveryClass: "class_a", isCurrent: () => true }, { ...f.authorization }]) {
      expect(() => Reflect.apply(createPreparedPublicationSource, undefined, [f.producer, forged]))
        .toThrow("PREPARED_SOURCE_UNAVAILABLE");
    }
    for (const change of [{ sourceRef: "other" }, { acceptanceRef: "other" }, { characterId: "other" },
      { validity: { kind: "expires_at", expiresAt: new Date(Date.parse(f.accepted.validity.expiresAt) + 1000).toISOString() } },
      { validity: { kind: "until_cancelled" } }]) {
      const producer = { ...f.producer, readAccepted: () => ({ ...f.accepted, ...change }) };
      expect(() => createPreparedPublicationSource(producer, f.authorization)).toThrow("PREPARED_SOURCE_UNAVAILABLE");
    }
    const jsonProducer = { ...f.producer, readAccepted: () => ({ ...f.accepted, deliveryClass: "class_a", accepted: true }) };
    expect(() => createPreparedPublicationSource(jsonProducer, f.authorization)).toThrow();
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("refuses revoked publication authority before child admission or held-output resumption", async () => {
    const f = await fixture();
    f.flags.publicationAuthorized = false;
    expect(await f.owner.publish(first)).toEqual({ status: "refused", reason: "root_unavailable" });
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1);
    f.flags.publicationAuthorized = true; f.flags.gate = "hold";
    const one = await f.owner.publish(first);
    f.flags.publicationAuthorized = false; f.flags.gate = "ready";
    expect(await f.delivery.resume(runId(one))).toBe("refused");
    expect(f.deliveries.get(runId(one))?.state).toBe("expired");
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("keeps an edit closed if its separate publication authorization is revoked", async () => {
    const f = await fixture();
    const edit = f.owner.beginEdit("r1")!;
    revise(f); f.flags.publicationAuthorized = false;
    expect(f.owner.confirmEdit(edit, "r2")).toBe(false);
    expect(await f.owner.publish({ candidateRef: "one", expectedRevision: "r2" }))
      .toEqual({ status: "refused", reason: "root_unavailable" });
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    expect(f.send).not.toHaveBeenCalled();
  });
});
