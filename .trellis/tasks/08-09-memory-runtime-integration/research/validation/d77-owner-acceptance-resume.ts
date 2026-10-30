/**
 * INPUT:  previously completed private acceptance evidence and the current isolated runtime
 * OUTPUT: validated reuse of completed baseline cases and idempotent replay of the actual saved retain
 * POS:    task continuation; no repeated model work and no claim that later test mutations equal the baseline
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Task scripts are outside workspace packages; reuse Shared's locked dependency.
import { z } from "../../../../../packages/shared/node_modules/zod/index.js";
import { RetainRequestSchema } from "../../../../../packages/shared/src/index.ts";
import { sameApplicationValue } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-integrity.ts";
import { bodyFor } from "./d77-owner-acceptance-storage.ts";
import { call, event, ROOT, scope, traffic, type AcceptanceRuntime } from "./d77-owner-acceptance-context.ts";

const read = (name: string): unknown => JSON.parse(readFileSync(join(ROOT, name), "utf8"));

export function completedBaseline() {
  const proof = z.object({ cachedBodies: z.number().positive(), cachedBodiesRedownloaded: z.literal(0),
    completeEvidence: z.unknown(), elapsedMs: z.number().positive(), originalSourceTablesUsed: z.literal(false) })
    .parse(read("cold-reconstruction-proof.json"));
  const original = z.object({ evidence: z.unknown() }).parse(read("bootstrap-original-comparison.json"));
  assert.deepEqual(proof.completeEvidence, original.evidence);
  event("COMPLETED_ORIGINAL_BASELINE_REUSED", { originalConsumer: "models-full-1", laterTestMutationsExcluded: true });
  return { ...proof, originalConsumer: "models-full-1", laterTestMutationsExcluded: true };
}

export function completedRecallObservations(runtime: AcceptanceRuntime) {
  const results = [];
  for (const bank of runtime.banks) {
    const saved = z.object({ query: z.string(), detail: z.object({ scope: z.enum(["global", "character"]),
      exactTarget: z.string(), passed: z.boolean(), exactHits: z.number(), exactLatencyMs: z.number(),
      naturalHits: z.number(), naturalLatencyMs: z.number() }) }).parse(read(`recall-${bank.scope}.json`));
    assert.equal(saved.detail.scope, bank.scope);
    const current = runtime.subsystem.state.replica.record({ ...scope(runtime, bank.externalBankId), memoryId: saved.detail.exactTarget });
    assert.ok(current); assert.equal(current.unit.text, saved.query);
    // Failed quality evidence is carried forward verbatim. A continuation never
    // upgrades that result merely because other independent checks succeed.
    results.push(saved.detail);
  }
  event("COMPLETED_RECALL_OBSERVATIONS_REUSED", { cases: results.length, failed: results.filter((item) => !item.passed).length });
  return results;
}

export async function replayCompletedRetain(runtime: AcceptanceRuntime) {
  const saved = z.object({ request: RetainRequestSchema, nickname: z.string(), redispatched: z.literal(false),
    completed: z.object({ ok: z.literal(true), requestId: z.string(), data: z.unknown() }) })
    .parse(read("native-response-loss-result.json"));
  const before = traffic.nativeWrites;
  const replay = await runtime.subsystem.state.provider.retain(call(runtime, saved.completed.requestId), saved.request);
  assert.ok(replay.ok); assert.equal(replay.data.status, "completed");
  assert.deepEqual(replay.data, saved.completed.data); assert.equal(traffic.nativeWrites, before);
  const source = bodyFor(runtime, saved.request.bankId, "document", saved.request.documentId!).content;
  assert.equal(source.body_schema, "application-source.v1");
  if (source.body_schema !== "application-source.v1") throw new Error("D77_SOURCE_BODY_MISSING");
  assert.equal(source.value.original_source.retainedText, saved.request.content);
  assert.ok(sameApplicationValue(source.value.original_source.metadata, saved.request.metadata));
  event("COMPLETED_NATIVE_RETAIN_REPLAYED", { memories: replay.data.memories.length, redispatched: false });
  return { bankId: saved.request.bankId, nickname: saved.nickname, memories: replay.data.memories };
}
