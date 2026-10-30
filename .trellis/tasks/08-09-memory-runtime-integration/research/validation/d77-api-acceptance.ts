/**
 * INPUT: one owned restored target, the production API reranker and real captured Hindsight provider
 * OUTPUT: exact-target recall, ordinary Chinese recall, automatic recall and guarded reflection evidence
 * POS: task-only real-model consumer; prior acceptance and original user storage stay read-only
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "../../../../../packages/shared/node_modules/zod/index.js";
import { admittedArguments, call, controller, event, hash, openRuntime, ROOT, traffic,
  type AcceptanceHttpObservation, type AcceptanceRuntime } from "./d77-owner-acceptance-context.ts";

const SOURCE = resolve("H:/TakiAgent/.trellis/.runtime/d77-acceptance/9e41c8d27fa0");
const referenceSchema = z.object({ targetId: z.string().uuid(), response: z.object({ trace: z.object({
  query: z.object({ query_text: z.string().min(1) }),
}) }) });
const hiddenSchema = z.object({ nickname: z.string().min(1), request: z.object({ bankId: z.string() }),
  completed: z.object({ data: z.object({ memories: z.array(z.object({ memoryId: z.string() })) }) }) });
const identity = process.env.TAKI_D78_CONSUMER_ID ?? "";
const artifactIdentity = /^api-[a-z0-9-]+$/.test(identity) ? identity : "api-admission";
const httpObservations: AcceptanceHttpObservation[] = [];
const stopped = () => controller.abort();
process.on("SIGINT", stopped); process.on("SIGTERM", stopped);
process.stdin.setEncoding("utf8"); process.stdin.on("data", stopped); process.stdin.on("end", stopped);
let runtime: AcceptanceRuntime | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let scenariosFinished = false;

function privateJson(name: string, value: unknown): void {
  assert.match(name, /^[a-z0-9-]+\.json$/);
  // A retry has a new consumer identity. It cannot overwrite the evidence of
  // an earlier failure, even when that earlier consumer never wrote completion.
  writeFileSync(join(ROOT, `${artifactIdentity}-${name}`), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function reference(scope: "global" | "character") {
  return referenceSchema.parse(JSON.parse(readFileSync(join(SOURCE, `recall-${scope}-low-probe.json`), "utf8")));
}

async function recallCase(active: AcceptanceRuntime, scope: "global" | "character", exact: boolean) {
  const bank = active.banks.find((value) => value.scope === scope); assert.ok(bank);
  const old = reference(scope);
  const query = exact ? old.response.trace.query.query_text
    : scope === "global" ? "用户在以往交流中表达过哪些偏好？" : "我和用户之间有哪些重要的约定？";
  const started = performance.now();
  const result = await active.subsystem.state.provider.recall(call(active), {
    bankId: bank.externalBankId, query, queryTimestamp: null, budget: "low", limit: 25, maxTokens: 5000,
    factTypes: ["world", "experience", "observation"], layerIds: [], includeInvalidated: false,
  });
  const elapsedMs = performance.now() - started;
  privateJson(`api-recall-${scope}-${exact ? "exact" : "ordinary"}.json`, { query, expectedMemoryId: exact ? old.targetId : null, result, elapsedMs });
  assert.ok(result.ok, "D77_API_RECALL_FAILED");
  assert.equal(result.data.vectorState, "ready");
  assert.equal(result.data.partial, false);
  assert.ok(result.data.hits.every((hit) => hit.record.unit.state === "valid"
    && hit.record.policy.visibility !== "hidden" && hit.record.unit.factType !== "observation"));
  const targetIndex = result.data.hits.findIndex((hit) => hit.record.unit.memoryId === old.targetId);
  if (exact) assert.ok(targetIndex >= 0, "D77_API_ORIGINAL_TARGET_MISSING");
  const summary = { scope, exact, hits: result.data.hits.length, targetRank: exact ? targetIndex + 1 : null,
    elapsedMs: Math.round(elapsedMs), ordinaryQualityManuallyAccepted: false };
  event("API_PROVIDER_RECALL_COMPLETE", summary);
  return summary;
}

async function hiddenRecallCase(active: AcceptanceRuntime) {
  const sample = hiddenSchema.parse(JSON.parse(readFileSync(join(ROOT, "native-response-loss-result.json"), "utf8")));
  const query = "What is the checklist nickname from the isolated acceptance exercise? Use only eligible saved memories; if it is unavailable, say so.";
  const started = performance.now();
  const result = await active.subsystem.state.provider.recall(call(active), {
    bankId: sample.request.bankId, query, queryTimestamp: null, budget: "low", limit: 25, maxTokens: 5000,
    factTypes: ["world", "experience", "observation"], layerIds: [], includeInvalidated: false,
  });
  const elapsedMs = performance.now() - started;
  privateJson("api-recall-hidden.json", { query, result, elapsedMs });
  assert.ok(result.ok, "D77_HIDDEN_RECALL_FAILED");
  assert.equal(result.data.vectorState, "ready");
  assert.equal(result.data.partial, false);
  assert.equal(JSON.stringify(result.data).includes(sample.nickname), false, "D77_RECALL_DISCLOSED_HIDDEN_CONTENT");
  assert.ok(result.data.hits.every((hit) => hit.record.unit.factType !== "observation"
    && !sample.completed.data.memories.some((memory) => memory.memoryId === hit.record.unit.memoryId)));
  const summary = { elapsedMs: Math.round(elapsedMs), hits: result.data.hits.length,
    hiddenNicknameAbsent: true, unprovenObservationsAbsent: true };
  event("API_HIDDEN_RECALL_COMPLETE", summary);
  return summary;
}

async function automaticCase(active: AcceptanceRuntime) {
  const captureStarted = performance.now();
  const capture = await active.subsystem.captureRun(active.characterId, controller.signal);
  const captureElapsedMs = performance.now() - captureStarted;
  const query = "请回忆我在以往交流中表达的偏好。";
  const beforeSeq = active.timeline.latestSeq(active.characterId);
  assert.ok(capture.automaticRecall);
  const started = performance.now();
  const text = await capture.automaticRecall({ query, visibleContext: capture.assemble?.(query) ?? "",
    now: Date.now(), signal: controller.signal });
  const elapsedMs = performance.now() - started;
  privateJson("api-automatic-recall.json", { query, text, elapsedMs, captureElapsedMs, snapshot: capture.snapshot });
  assert.ok(text.length > 0, "D77_API_AUTOMATIC_RECALL_EMPTY");
  assert.equal(active.timeline.latestSeq(active.characterId), beforeSeq, "D77_AUTOMATIC_RECALL_PERSISTED");
  const summary = { characters: text.length, elapsedMs: Math.round(elapsedMs), captureElapsedMs: Math.round(captureElapsedMs),
    completed: true, timelineUnchanged: true };
  event("API_AUTOMATIC_RECALL_COMPLETE", summary);
  return summary;
}

async function reflectCase(active: AcceptanceRuntime, hidden: boolean) {
  const sample = hiddenSchema.parse(JSON.parse(readFileSync(join(ROOT, "native-response-loss-result.json"), "utf8")));
  const bank = active.banks.find((value) => value.scope === "character"); assert.ok(bank);
  const old = reference("character");
  const query = hidden
    ? "What is the checklist nickname from the isolated acceptance exercise? Use only eligible saved memories; if it is unavailable, say so."
    : `根据已保存的记忆，说明“${old.response.trace.query.query_text}”这件事的背景，明确区分记忆中记载的事实与无法确认的信息。`;
  const started = performance.now();
  const result = await active.subsystem.state.provider.reflect(call(active), {
    bankId: hidden ? sample.request.bankId : bank.externalBankId, query, budget: "low", maxTokens: 8192,
  });
  const elapsedMs = performance.now() - started;
  privateJson(`api-reflect-${hidden ? "hidden" : "grounded"}.json`, { query, result, elapsedMs });
  assert.ok(result.ok, "D77_API_REFLECT_FAILED");
  assert.ok(result.data.text.trim().length > 0, "D77_API_REFLECT_EMPTY");
  if (hidden) {
    assert.equal(JSON.stringify(result.data).includes(sample.nickname), false, "D77_REFLECT_DISCLOSED_HIDDEN_CONTENT");
    assert.equal(result.data.evidence.memoryIds.some((id) => sample.completed.data.memories.some((memory) => memory.memoryId === id)), false);
  } else assert.ok(result.data.evidence.memoryIds.length > 0, "D77_REFLECT_WITHOUT_MEMORY_EVIDENCE");
  const summary = { hidden, elapsedMs: Math.round(elapsedMs), characters: result.data.text.length,
    evidenceMemories: result.data.evidence.memoryIds.length, usage: result.data.usage,
    responseSha256: hash(result.data.text), subjectiveOwnerAcceptance: false };
  event("API_GUARDED_REFLECT_COMPLETE", summary);
  return summary;
}

try {
  assert.equal(ROOT, resolve("H:/TakiAgent/.trellis/.runtime/d77-api-acceptance/ca744d0f8a27"));
  assert.match(identity, /^api-[a-z0-9-]+$/);
  assert.equal(existsSync(join(ROOT, `consumer-${identity}-complete.json`)), false);
  const { path, endpoint } = admittedArguments();
  event("API_ACCEPTANCE_STARTED", { identity, reranker: "Qwen/Qwen3-Reranker-4B", embedding: "unchanged-local-index" });
  runtime = await openRuntime(path, endpoint, { requestTimeoutMs: 10000,
    onHttp: (observation) => { httpObservations.push(observation); } });
  heartbeat = setInterval(() => event("API_ACCEPTANCE_PROGRESS", { identity, ...traffic }), 30000);
  heartbeat.unref();
  const results: Record<string, unknown> = {};
  const failures: string[] = [];
  const scenario = async (name: string, action: () => Promise<unknown>) => {
    try { results[name] = { passed: true, result: await action() }; }
    catch (error) {
      failures.push(name);
      privateJson(`api-${name}-failure.json`, { errorType: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      results[name] = { passed: false };
      event("API_ACCEPTANCE_SCENARIO_FAILED", { scenario: name, errorType: error instanceof Error ? error.name : "unknown" });
      if (controller.signal.aborted) throw error;
    }
  };
  const active = runtime;
  for (const scope of ["character", "global"] as const) {
    await scenario(`recall-${scope}-exact`, () => recallCase(active, scope, true));
    await scenario(`recall-${scope}-ordinary`, () => recallCase(active, scope, false));
  }
  await scenario("recall-hidden", () => hiddenRecallCase(active));
  await scenario("automatic-recall", () => automaticCase(active));
  await scenario("reflect-grounded", () => reflectCase(active, false));
  await scenario("reflect-hidden", () => reflectCase(active, true));
  scenariosFinished = true;
  const summary = { identity, passed: failures.length === 0, failures, results, traffic, utility: runtime.utility.usage(),
    ordinaryRequestTimeoutMs: 10000, generousPreSynchronization: false };
  privateJson("api-runtime-summary.json", summary);
  await runtime.close(); runtime = undefined;
  assert.equal(failures.length, 0, "D77_API_ACCEPTANCE_HAS_FAILURES");
  writeFileSync(join(ROOT, `consumer-${identity}-complete.json`), `${JSON.stringify({ schemaVersion: 1,
    runDirectoryId: basename(ROOT), consumerId: identity, state: "complete" })}\n`, { flag: "wx" });
  event("API_ACCEPTANCE_COMPLETE", { identity, cases: Object.keys(results).length, passed: true });
} catch (error) {
  privateJson(`api-failure-${identity || "admission"}.json`, { name: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
  event("API_ACCEPTANCE_FAILED", { identity, errorType: error instanceof Error ? error.name : "unknown" });
  process.exitCode = 1;
} finally {
  if (heartbeat) clearInterval(heartbeat);
  if (runtime) { try { await runtime.close(); } catch { process.exitCode = 1; } }
  // Preserve already observed HTTP work after cancellation or an early failure.
  // Closing the owned runtime first settles its request callbacks before this
  // single exclusive write; the marker distinguishes a partial attempt.
  try { privateJson("api-http-observations.json", { partial: !scenariosFinished, observations: httpObservations }); }
  catch { process.exitCode = 1; event("API_HTTP_OBSERVATIONS_WRITE_FAILED", { identity }); }
  process.stdin.pause();
  process.off("SIGINT", stopped); process.off("SIGTERM", stopped);
}
