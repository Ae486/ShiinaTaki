/**
 * INPUT:  unchanged copied memories and the actual native recall pipeline
 * OUTPUT: per-Bank retrieval observations and private native traces for failed quality checks
 * POS:    task acceptance; a failed exact recall remains failed while independent scenarios continue
 */
import assert from "node:assert/strict";
import { HindsightNativeRecallResponseSchema, type HindsightNativeRecallRequest } from "../../../../../packages/shared/src/index.ts";
import { hindsightHttpTransport } from "../../../../../packages/core/src/memory/hindsight/hindsight-http-transport.ts";
import { at, controller, event, privateJson, scope, traffic, type AcceptanceRuntime } from "./d77-owner-acceptance-context.ts";
import { recall } from "./d77-owner-acceptance-policy.ts";

async function diagnosticTrace(runtime: AcceptanceRuntime, bankId: string, request: HindsightNativeRecallRequest) {
  // Native trace duplicates the candidate bodies across retrieval/rank phases.
  // Read it only as a private diagnostic with a separate finite 8 MiB ceiling;
  // ordinary runtime clients keep their unchanged 512 KiB response ceiling.
  const address = new URL(`/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`, runtime.endpoint);
  assert.equal(address.origin, runtime.endpoint);
  traffic.requests++;
  const response = await hindsightHttpTransport(address, { method: "POST", redirect: "manual",
    headers: { authorization: `Bearer ${process.env.TAKI_D78_API_KEY}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(request), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]) },
  { maxBytes: 8 * 1024 * 1024 });
  assert.equal(response.status, 200);
  event("NATIVE_PRIVATE_TRACE_RECEIVED", { bytes: Buffer.byteLength(response.body), normalRuntimeCeilingChanged: false });
  return HindsightNativeRecallResponseSchema.parse(JSON.parse(response.body));
}

export async function originalRecallCases(runtime: AcceptanceRuntime) {
  const results = [];
  for (const bank of runtime.banks) {
    const records = runtime.db.prepare(`SELECT object_id FROM hindsight_application_replica_projections
      WHERE bank_id=:bank AND object_kind='memory_unit' AND unit_state='valid' AND visibility='retrieved'
      ORDER BY object_id LIMIT 100`).all({ bank: bank.externalBankId }).map((row) =>
      runtime.subsystem.state.replica.record({ ...scope(runtime, bank.externalBankId), memoryId: String(row.object_id) }))
      .filter((record) => record !== undefined).sort((left, right) => left.unit.text.length - right.unit.text.length);
    const chosen = records.find((record) => record.unit.text.length >= 25); assert.ok(chosen);
    const native = runtime.client.recallNative; assert.ok(native);
    let nativeDiagnostic: unknown; let nativeCalls = 0;
    runtime.client.recallNative = async (input) => {
      nativeCalls++; const response = await native(input);
      nativeDiagnostic = { input: { ...input, context: undefined }, response }; return response;
    };
    let exact: Awaited<ReturnType<typeof recall>>;
    try { exact = await recall(runtime, bank.externalBankId, chosen.unit.text); }
    finally { runtime.client.recallNative = native; }
    privateJson(`recall-${bank.scope}-exact-diagnostic.json`, { chosen, exact, nativeDiagnostic, nativeCalls });
    const selfMatched = exact.result.hits.some((hit) => hit.record.unit.memoryId === chosen.unit.memoryId);
    event("ACTUAL_EXACT_RECALL_OBSERVED", { scope: bank.scope, nativeCalls, hits: exact.result.hits.length,
      selfMatched, vectorState: exact.result.vectorState, partial: exact.result.partial, elapsedMs: Math.round(exact.elapsedMs) });
    if (!selfMatched) {
      // A semantic quality failure must remain visible. Raw diagnostic candidates
      // stay private and are never admitted to Chat or used to bypass Taki policy.
      for (const budget of ["low", "high"] as const) {
        const started = performance.now();
        const request: HindsightNativeRecallRequest = {
            query: chosen.unit.text, query_timestamp: at(), budget, max_tokens: 5000,
            types: ["world", "experience", "observation"], trace: budget === "low",
            include: { entities: null, chunks: null, source_facts: null },
          };
        const response = budget === "low" ? await diagnosticTrace(runtime, bank.externalBankId, request)
          : await native({ bankId: bank.externalBankId, context: { timeoutMs: 120000, signal: controller.signal }, request });
        privateJson(`recall-${bank.scope}-${budget}-probe.json`, { targetId: chosen.unit.memoryId, response });
        event("NATIVE_RECALL_QUALITY_PROBE", { scope: bank.scope, budget, hits: response.results.length,
          targetRank: response.results.findIndex((item) => item.id === chosen.unit.memoryId) + 1 || null,
          elapsedMs: Math.round(performance.now() - started) });
      }
    }
    const natural = await recall(runtime, bank.externalBankId, bank.scope === "global"
      ? "我平时有哪些稳定的偏好和习惯？" : "我们之前有哪些共同经历？");
    const detail = { scope: bank.scope, exactTarget: chosen.unit.memoryId, passed: selfMatched,
      exactHits: exact.result.hits.length, exactLatencyMs: exact.elapsedMs,
      naturalHits: natural.result.hits.length, naturalLatencyMs: natural.elapsedMs };
    privateJson(`recall-${bank.scope}.json`, { detail, query: chosen.unit.text, exact: exact.result, natural: natural.result });
    event(selfMatched ? "ACTUAL_DATA_RECALL_PASSED" : "ACTUAL_DATA_RECALL_QUALITY_FAILED", detail);
    results.push(detail);
  }
  return results;
}
