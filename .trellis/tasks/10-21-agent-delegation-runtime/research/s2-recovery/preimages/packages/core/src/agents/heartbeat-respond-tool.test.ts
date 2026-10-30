import { describe, expect, it } from "vitest";
import { asSchema } from "ai";
import { createHeartbeatDecisionCollector } from "./heartbeat-respond-tool.ts";

function fixture() {
  let current = true;
  const collector = createHeartbeatDecisionCollector({ candidateIds: ["candidate"], isCurrent: () => current,
    acceptsPresentation: (value) => value.name === "happy" });
  const call = (input: unknown) => collector.tools.heartbeat_respond!.execute!(wireInput(input),
    { toolCallId: "decision", messages: [], context: undefined });
  return { collector, call, retire: () => { current = false; } };
}
const silent = { outcome: "silent", selectedCandidateIds: [] };
function wireInput(input: unknown) {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? { text: null, presentation: null, responseExpectation: null, ...input } : input;
}

describe("heartbeat terminal decision admission", () => {
  it("advertises an object-root schema accepted by real provider function calling", async () => {
    const f = fixture();
    const schema = await asSchema(f.collector.tools.heartbeat_respond!.inputSchema).jsonSchema;
    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("oneOf");
    expect(schema.additionalProperties).toBe(false);
    expect(new Set(schema.required)).toEqual(new Set(["outcome", "selectedCandidateIds", "text", "presentation", "responseExpectation"]));
  });
  it("keeps the model loop open after an outcome refusal and accepts a later valid structural silence", async () => {
    const collector = createHeartbeatDecisionCollector({ candidateIds: ["candidate"], isCurrent: () => true,
      acceptsPresentation: () => true, acceptsDecision: (decision) => decision.outcome === "silent" });
    const call = (decision: unknown) => collector.tools.heartbeat_respond!.execute!(wireInput(decision),
      { toolCallId: "outcome-policy", messages: [], context: undefined });
    expect(await call({ outcome: "speak", selectedCandidateIds: ["candidate"], text: "Not allowed",
      presentation: null, responseExpectation: "none" })).toMatchObject({ ok: false, code: "DECISION_OUTCOME_REFUSED" });
    expect(await collector.stop({ steps: [] })).toBe(false); expect(() => collector.decision()).toThrow("DECISION_MISSING");
    expect(await call(silent)).toMatchObject({ ok: true, accepted: true });
    expect(await collector.stop({ steps: [] })).toBe(true); expect(collector.decision()).toEqual(silent);
  });
  it("refuses missing wire fields instead of inventing a terminal decision", async () => {
    const f = fixture();
    expect(await f.collector.tools.heartbeat_respond!.execute!(silent, { toolCallId: "missing", messages: [], context: undefined }))
      .toMatchObject({ ok: false, code: "DECISION_INVALID" });
    expect(() => f.collector.decision()).toThrow("DECISION_MISSING");
  });
  it.each([
    { outcome: "silent", selectedCandidateIds: [] },
    { outcome: "express", selectedCandidateIds: ["candidate"], presentation: { kind: "expression", name: "happy" } },
    { outcome: "speak", selectedCandidateIds: ["candidate"], text: "Full utterance", presentation: null, responseExpectation: "none" },
  ])("accepts $outcome and exact duplicate calls without replacing the original decision", async (decision) => {
    const f = fixture();
    expect(await f.collector.stop({ steps: [] })).toBe(false);
    expect(await f.call(decision)).toMatchObject({ ok: true, accepted: true });
    expect(await f.call(structuredClone(decision))).toMatchObject({ ok: true, accepted: true });
    expect(await f.collector.stop({ steps: [] })).toBe(true);
    expect(f.collector.decision()).toEqual(decision);
  });

  it.each([
    { outcome: "silent", selectedCandidateIds: [], text: "hidden text" },
    { outcome: "silent", selectedCandidateIds: ["unoffered"] },
    { outcome: "express", selectedCandidateIds: ["candidate"], presentation: { kind: "expression", name: "unavailable" } },
  ])("does not stop or fabricate silence after a refused terminal call", async (decision) => {
    const f = fixture();
    expect(await f.call(decision)).toMatchObject({ ok: false });
    expect(await f.collector.stop({ steps: [] })).toBe(false);
    expect(() => f.collector.decision()).toThrow("DECISION_MISSING");
  });

  it("latches conflict even if the first decision is submitted again", async () => {
    const f = fixture(); await f.call(silent);
    expect(await f.call({ outcome: "silent", selectedCandidateIds: ["candidate"] })).toMatchObject({ code: "DECISION_CONFLICT" });
    await f.call(silent);
    expect(() => f.collector.decision()).toThrow("DECISION_CONFLICT");
  });

  it.each(["retire", "close"] as const)("rejects accepted and later decisions after %s", async (boundary) => {
    const f = fixture(); await f.call(silent);
    if (boundary === "retire") f.retire(); else f.collector.close();
    expect(await f.call(silent)).toMatchObject({ code: "DECISION_STALE" });
    expect(() => f.collector.decision()).toThrow("DECISION_STALE");
  });
});
