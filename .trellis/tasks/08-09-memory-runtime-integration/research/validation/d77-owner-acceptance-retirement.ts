/**
 * INPUT:  the genuine saved offline-retirement span and its existing two-Bank outboxes
 * OUTPUT: bounded eventual recovery, exact Source preservation and proof that the Write Gate did not repeat
 * POS:    task continuation after a real native-version race; no new Chat turn or replacement model decision
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "../../../../../packages/shared/node_modules/zod/index.js";
import { HindsightIngestionBatchSchema, HindsightIngestionCoverageSchema } from "../../../../../packages/core/src/memory/hindsight/hindsight-ingestion-contract.ts";
import { HindsightApplicationRefusal } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-client.ts";
import { sameApplicationValue } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-integrity.ts";
import { bodyFor } from "./d77-owner-acceptance-storage.ts";
import { call, controller, event, privateJson, ROOT, traffic, type AcceptanceRuntime } from "./d77-owner-acceptance-context.ts";

function readSpans(runtime: AcceptanceRuntime, fromSeq: number) {
  return runtime.db.prepare(`SELECT source_hash,source_json,gate_json,batches_json,receipts_json,state
    FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch AND character_id=:character AND through_seq>:after
    ORDER BY through_seq`).all({ epoch: runtime.epochId, character: runtime.characterId, after: fromSeq });
}

export async function finishSavedRetirement(runtime: AcceptanceRuntime) {
  const saved = z.object({ durable: z.object({ status: z.literal("success"), writes: z.number().int().positive() }),
    request: z.object({ characterId: z.string(), fromSeq: z.number().int(), throughSeq: z.number().int(), operationId: z.string() }) })
    .parse(JSON.parse(readFileSync(join(ROOT, "offline-retirement-result.json"), "utf8")));
  assert.equal(saved.request.characterId, runtime.characterId);
  const spans = readSpans(runtime, saved.request.fromSeq); assert.ok(spans.length > 0);
  const batches = spans.flatMap((span) => HindsightIngestionBatchSchema.array().parse(JSON.parse(String(span.batches_json))));
  const receipts = spans.flatMap((span) => HindsightIngestionCoverageSchema.array().parse(JSON.parse(String(span.receipts_json))));
  assert.equal(batches.length, saved.durable.writes); assert.equal(receipts.length, batches.length);
  assert.ok(receipts.every((receipt) => receipt.status === "pending" && receipt.evidence.kind === "outbox"));
  const deadline = Date.now() + 240000;
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(240000)]);
  const context = () => ({ timeoutMs: Math.min(120000, Math.max(1, deadline - Date.now())), signal });
  const completed = new Set<string>(); const writes = traffic.nativeWrites;
  let conflicts = 0;
  while (Date.now() < deadline && completed.size < batches.length) {
    for (const batch of batches) {
      if (completed.has(batch.requestId)) continue;
      assert.ok(runtime.banks.some((bank) => bank.externalBankId === batch.bank.bankId));
      try { await runtime.subsystem.state.service.recover({ bankId: batch.bank.bankId, context: context() }); }
      catch (error) {
        // Concurrent native maintenance can legitimately stale an exact binding.
        // Start another bounded pull from current state; never force that CAS or
        // suppress an integrity/ownership refusal as though it were a race.
        if (error instanceof HindsightApplicationRefusal
          && ["native_version_conflict", "artifact_conflict"].includes(error.refusal.code)) {
          conflicts++; event("RETIREMENT_RECOVERY_VERSION_RETRY", { code: error.refusal.code }); continue;
        }
        if (!(error instanceof Error) || !error.message.startsWith("HINDSIGHT_PENDING_")) throw error;
      }
      const replay = await runtime.subsystem.state.provider.retain({ ...call(runtime, batch.requestId), actor: "background-policy", signal }, batch.request);
      assert.ok(replay.ok, "SAVED_RETIREMENT_REPLAY_FAILED");
      if (replay.data.status === "completed") completed.add(batch.requestId);
    }
    if (completed.size < batches.length) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(completed.size, batches.length, "PRE_RETIREMENT_SOURCE_RECOVERY_INCOMPLETE");
  assert.equal(traffic.nativeWrites, writes, "SAVED_NATIVE_RETAIN_REDISPATCHED");
  const replay = await runtime.subsystem.memoryFlush.prepareRetirement(saved.request);
  assert.equal(replay.status, "success"); assert.equal(runtime.utility.usage().calls, 0, "WRITE_GATE_REPEATED_AFTER_REOPEN");
  for (const batch of batches) {
    await runtime.subsystem.state.service.synchronize({ bankId: batch.bank.bankId, context: context() });
    const source = bodyFor(runtime, batch.bank.bankId, "document", batch.request.documentId!).content;
    assert.equal(source.body_schema, "application-source.v1");
    if (source.body_schema !== "application-source.v1") throw new Error("D77_SOURCE_BODY_MISSING");
    assert.equal(source.value.original_source.retainedText, batch.request.content);
    assert.ok(sameApplicationValue(source.value.original_source.metadata, batch.request.metadata));
  }
  assert.deepEqual(readSpans(runtime, saved.request.fromSeq), spans);
  const result = { selectedBanks: batches.length, completedBanks: completed.size, originalSourcePreserved: true,
    gateRepeated: false, nativeRedispatched: false, observedRetryConflicts: conflicts, priorRunConflictPreserved: true, replay };
  privateJson("retirement-recovery-result.json", result);
  event("PRE_RETIREMENT_REOPEN_RECOVERY_PASSED", result);
  return result;
}
