/**
 * INPUT: the owned copied runtime, approved real models and retained B6 implementation
 * OUTPUT: scoped Recall/Reflect/prompt and durable curator-continuation evidence
 * POS: task-only closeout; D81 remains a recorded limitation and owner acceptance stays separate
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "../../../../../packages/shared/node_modules/zod/index.js";
import { verifyCuratorContinuation } from "./d77-b6-curator-continuation.ts";
import { admittedArguments, call, controller, event, hash, openRuntime, ROOT, traffic,
  type AcceptanceHttpObservation, type AcceptanceRuntime, type AcceptanceRuntimeOptions } from "./d77-owner-acceptance-context.ts";

const SOURCE = resolve("H:/TakiAgent/.trellis/.runtime/d77-acceptance/9e41c8d27fa0");
const referenceSchema = z.object({ targetId: z.string().uuid(), response: z.object({ trace: z.object({
  query: z.object({ query_text: z.string().min(1) }),
}) }) });
const hiddenSchema = z.object({ nickname: z.string().min(1), request: z.object({ bankId: z.string() }),
  completed: z.object({ data: z.object({ memories: z.array(z.object({ memoryId: z.string() })) }) }) });
const identity = process.env.TAKI_D78_CONSUMER_ID ?? "";
const http: AcceptanceHttpObservation[] = [];
const options: AcceptanceRuntimeOptions = { requestTimeoutMs: 10000, curatorMaxSteps: 12, curatorTimeoutMs: 60000,
  onHttp: (value) => { http.push(value); } };
let owner: { current: AcceptanceRuntime } | undefined;
let stop: Promise<void> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let finished = false;
let scopedPassed = false;
const stopped = () => {
  controller.abort();
  if (owner && !stop) stop = owner.current.subsystem.stop().catch(() => { process.exitCode = 1; });
};
process.on("SIGINT", stopped); process.on("SIGTERM", stopped);
process.stdin.setEncoding("utf8"); process.stdin.on("data", stopped); process.stdin.on("end", stopped);

function evidence(name: string, value: unknown): void {
  assert.match(identity, /^api-b6-closeout-[a-z0-9-]+$/);
  assert.match(name, /^[a-z0-9-]+\.json$/);
  writeFileSync(join(ROOT, `${identity}-${name}`), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
function reference(scope: "global" | "character") {
  return referenceSchema.parse(JSON.parse(readFileSync(join(SOURCE, `recall-${scope}-low-probe.json`), "utf8")));
}
async function exactRecall(active: AcceptanceRuntime, scope: "global" | "character") {
  const bank = active.banks.find((value) => value.scope === scope); assert.ok(bank);
  const original = reference(scope); const started = performance.now();
  const result = await active.subsystem.state.provider.recall(call(active), {
    bankId: bank.externalBankId, query: original.response.trace.query.query_text, queryTimestamp: null,
    budget: "low", limit: 25, maxTokens: 5000, factTypes: ["world", "experience", "observation"], layerIds: [], includeInvalidated: false,
  });
  const elapsedMs = Math.round(performance.now() - started); evidence(`recall-${scope}.json`, { result, elapsedMs });
  assert.ok(result.ok, "B6_RECALL_FAILED"); assert.equal(result.data.vectorState, "ready"); assert.equal(result.data.partial, false);
  assert.ok(result.data.hits.every((hit) => hit.record.unit.state === "valid" && hit.record.policy.visibility !== "hidden"));
  const index = result.data.hits.findIndex((hit) => hit.record.unit.memoryId === original.targetId);
  assert.ok(index >= 0, "B6_ORIGINAL_RECALL_TARGET_MISSING");
  return { scope, elapsedMs, targetRank: index + 1, hits: result.data.hits.length,
    observations: result.data.hits.filter((hit) => hit.record.unit.factType === "observation").length };
}
async function hiddenDirectRecord(active: AcceptanceRuntime) {
  const sample = hiddenSchema.parse(JSON.parse(readFileSync(join(ROOT, "native-response-loss-result.json"), "utf8")));
  const started = performance.now();
  const result = await active.subsystem.state.provider.recall(call(active), {
    bankId: sample.request.bankId, query: "What is the checklist nickname from the isolated acceptance exercise?",
    queryTimestamp: null, budget: "low", limit: 25, maxTokens: 5000, factTypes: ["world", "experience", "observation"],
    layerIds: [], includeInvalidated: false,
  });
  const elapsedMs = Math.round(performance.now() - started); evidence("hidden-direct-record.json", { result, elapsedMs });
  assert.ok(result.ok, "B6_HIDDEN_RECORD_RECALL_FAILED"); assert.equal(result.data.partial, false);
  assert.equal(result.data.hits.some((hit) => sample.completed.data.memories.some((item) => item.memoryId === hit.record.unit.memoryId)), false);
  assert.ok(result.data.hits.every((hit) => hit.record.policy.visibility !== "hidden" && hit.record.unit.state === "valid"));
  // This is the direct-unit contract. Record the deferred derived-content
  // outcome independently; it cannot be reported as a passing privacy case.
  const summary = { elapsedMs, hiddenOriginalReturned: false,
    observationHits: result.data.hits.filter((hit) => hit.record.unit.factType === "observation").length,
    derivedNicknamePresent: JSON.stringify(result.data).includes(sample.nickname),
    derivedPropagationAccepted: false, deferredDecision: "D81" };
  evidence("derived-limitation.json", summary);
  event("B6_DIRECT_HIDDEN_RECORD_CHECK", summary); return summary;
}
async function automaticRecall(active: AcceptanceRuntime) {
  const started = performance.now(); const captured = await active.subsystem.captureRun(active.characterId, controller.signal);
  const captureElapsedMs = Math.round(performance.now() - started); const before = active.timeline.latestSeq(active.characterId);
  assert.ok(captured.automaticRecall); const query = "请回忆我在以往交流中表达的偏好。";
  const recalledAt = performance.now();
  const text = await captured.automaticRecall({ query, visibleContext: captured.assemble?.(query) ?? "", now: Date.now(), signal: controller.signal });
  const elapsedMs = Math.round(performance.now() - recalledAt);
  evidence("automatic-recall.json", { text, captureElapsedMs, elapsedMs, snapshot: captured.snapshot });
  assert.ok(text.length > 0, "B6_AUTOMATIC_RECALL_EMPTY"); assert.equal(active.timeline.latestSeq(active.characterId), before);
  return { characters: text.length, elapsedMs, captureElapsedMs, timelineUnchanged: true };
}
async function groundedReflect(active: AcceptanceRuntime) {
  const bank = active.banks.find((value) => value.scope === "character"); assert.ok(bank);
  const original = reference("character"); const started = performance.now();
  const result = await active.subsystem.state.provider.reflect(call(active), { bankId: bank.externalBankId, budget: "low", maxTokens: 8192,
    query: `根据已保存的记忆，说明“${original.response.trace.query.query_text}”这件事的背景，明确区分记忆中记载的事实与无法确认的信息。` });
  const elapsedMs = Math.round(performance.now() - started); evidence("grounded-reflect.json", { result, elapsedMs });
  assert.ok(result.ok, "B6_REFLECT_FAILED"); assert.ok(result.data.text.trim().length > 0, "B6_REFLECT_EMPTY");
  assert.ok(result.data.evidence.memoryIds.length > 0, "B6_REFLECT_WITHOUT_MEMORY_EVIDENCE");
  return { elapsedMs, characters: result.data.text.length, evidenceMemories: result.data.evidence.memoryIds.length,
    usage: result.data.usage, responseSha256: hash(result.data.text), subjectiveOwnerAcceptance: false };
}

try {
  assert.equal(ROOT, resolve("H:/TakiAgent/.trellis/.runtime/d77-api-acceptance/ca744d0f8a27"));
  assert.match(identity, /^api-b6-closeout-[a-z0-9-]+$/);
  assert.equal(existsSync(join(ROOT, `consumer-${identity}-complete.json`)), false);
  const { path, endpoint } = admittedArguments();
  owner = { current: await openRuntime(path, endpoint, options) };
  heartbeat = setInterval(() => event("B6_CLOSEOUT_PROGRESS", { identity, ...traffic }), 30000); heartbeat.unref();
  const results: Record<string, unknown> = {}; const failures: string[] = [];
  const scenario = async (name: string, action: () => Promise<unknown>) => {
    try { results[name] = { passed: true, result: await action() }; event("B6_CLOSEOUT_SCENARIO_PASSED", { name }); }
    catch (error) {
      failures.push(name); results[name] = { passed: false };
      evidence(`${name}-failure.json`, { name: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : String(error) });
      event("B6_CLOSEOUT_SCENARIO_FAILED", { name });
      if (controller.signal.aborted) throw error;
    }
  };
  const active = owner;
  await scenario("recall-character", () => exactRecall(active.current, "character"));
  await scenario("recall-global", () => exactRecall(active.current, "global"));
  await scenario("direct-hidden-record", () => hiddenDirectRecord(active.current));
  await scenario("automatic-recall", () => automaticRecall(active.current));
  await scenario("grounded-reflect", () => groundedReflect(active.current));
  await scenario("curator-continuation", () => verifyCuratorContinuation({ owner: active, options, evidence }));
  finished = true; scopedPassed = failures.length === 0;
  evidence("summary.json", { identity, scopedAutomatedChecksPassed: scopedPassed, failures, results, traffic,
    ordinaryRequestTimeoutMs: 10000, curatorReportClassCap: 3, curatorMaxSteps: 12, curatorTimeoutMs: 60000,
    knownLimitations: ["D81 derived policy propagation is deferred; prior hidden-content failure remains a failure"],
    ownerAccepted: false, originalAuthorityActivated: false });
  if (!scopedPassed) process.exitCode = 1;
} catch (error) {
  process.exitCode = 1;
  evidence("failure.json", { name: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : String(error) });
} finally {
  if (heartbeat) clearInterval(heartbeat);
  if (stop) await stop;
  if (owner) { try { await owner.current.close(); } catch { process.exitCode = 1; } }
  try { evidence("http-observations.json", { partial: !finished, observations: http }); } catch { process.exitCode = 1; }
  process.stdin.pause(); process.off("SIGINT", stopped); process.off("SIGTERM", stopped);
}
if (scopedPassed && !process.exitCode) {
  writeFileSync(join(ROOT, `consumer-${identity}-complete.json`), `${JSON.stringify({ schemaVersion: 1,
    runDirectoryId: basename(ROOT), consumerId: identity, state: "complete" })}\n`, { flag: "wx" });
  event("B6_CLOSEOUT_COMPLETE", { identity, scopedAutomatedChecksPassed: true, ownerAccepted: false, derivedPropagationAccepted: false });
}
