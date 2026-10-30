/**
 * INPUT:  the actual configured model and a complete copied Hindsight runtime
 * OUTPUT: real curator, Chat, automatic recall and durable pre-retirement ingestion observations
 * POS:    task acceptance; normal Core producers perform all model work and commit source witnesses
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createChatAgent, type TurnUsageReport } from "../../../../../packages/core/src/agents/chat-agent.ts";
import { createConversationStore } from "../../../../../packages/core/src/agents/conversation-store.ts";
import { getBlock } from "../../../../../packages/core/src/memory/block-registry.ts";
import { HindsightIngestionBatchSchema, HindsightIngestionCoverageSchema } from "../../../../../packages/core/src/memory/hindsight/hindsight-ingestion-contract.ts";
import { sameApplicationValue } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-integrity.ts";
import { bodyFor } from "./d77-owner-acceptance-storage.ts";
import { at, call, controller, event, faults, hash, privateJson, sync, traffic, type AcceptanceRuntime } from "./d77-owner-acceptance-context.ts";
import { policyAndReflect, reopen, retainWithLostResponse, type RuntimeOwner } from "./d77-owner-acceptance-policy.ts";
import { originalRecallCases } from "./d77-owner-acceptance-recall.ts";
import { completedRecallObservations, replayCompletedRetain } from "./d77-owner-acceptance-resume.ts";

function userBlocks(runtime: AcceptanceRuntime) {
  return runtime.db.prepare("SELECT * FROM taki_memory_blocks ORDER BY scope_kind,character_id,block_id").all()
    .filter((row) => getBlock(String(row.block_id))?.writer === "user");
}

async function curate(runtime: AcceptanceRuntime) {
  const before = userBlocks(runtime); const started = performance.now();
  const result = await runtime.subsystem.curator.runNow(runtime.characterId);
  privateJson("actual-curator-result.json", { result, elapsedMs: performance.now() - started,
    reportClassCap: 3, maxSteps: 4, userBlockCount: before.length });
  assert.deepEqual(userBlocks(runtime), before, "CURATOR_CHANGED_USER_BLOCK");
  assert.equal(result.status, "ran"); assert.ok(result.assessed > 0); assert.equal(result.pending, 0);
  event("REAL_POLICY_CURATOR_PASSED", { ...result, elapsedMs: Math.round(performance.now() - started), userBlocksPreserved: true });
  return result;
}

async function chatAndRetirement(owner: RuntimeOwner) {
  let runtime = owner.current;
  const capture = await runtime.subsystem.captureRun(runtime.characterId);
  const recallQuery = "我希望验收结果先说结论，再给验证证据，最后说明下一步。你之前还记得我哪些沟通偏好？";
  const recallStarted = performance.now();
  const automatic = await capture.automaticRecall?.({ query: recallQuery,
    visibleContext: capture.assemble?.(recallQuery) ?? "", now: Date.now(), signal: controller.signal });
  const automaticElapsedMs = performance.now() - recallStarted;
  event("ACTUAL_AUTOMATIC_RECALL_OBSERVED", { elapsedMs: Math.round(automaticElapsedMs), characters: automatic?.length ?? 0,
    returnedText: Boolean(automatic), defaultDeadlineMs: 1500 });
  const fromSeq = runtime.timeline.latestSeq(runtime.characterId); const usage: TurnUsageReport[] = [];
  const store = createConversationStore({ repo: runtime.timeline, window: { budget: () => 4000 } });
  const agent = createChatAgent({ model: runtime.models.model, store, memory: runtime.subsystem.engine,
    memoryPrompt: capture.prompt, maxSteps: 3, onUsage: (report) => usage.push(report),
    onPrimaryCommitted: runtime.subsystem.recordPrimaryCommitted,
    runContext: () => ({ memoryTools: capture.tools, memorySnapshot: capture.snapshot,
      automaticMemoryRecall: capture.automaticRecall, memoryPrompt: capture.prompt, assembleMemory: capture.assemble }),
    instructionsExtra: () => "This is an isolated acceptance dialogue. Give a short answer in Chinese using eligible memories. Do not call any memory mutation tool; the ordinary post-commit source gate will decide what to retain." });
  let text = ""; const chatStarted = performance.now();
  for await (const chunk of agent.stream({ characterId: runtime.characterId, message: recallQuery },
    { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]), turnKind: "primary" })) text += chunk;
  assert.ok(text.trim());
  await new Promise((resolve) => setTimeout(resolve, 0));
  const throughSeq = runtime.timeline.latestSeq(runtime.characterId); assert.ok(throughSeq > fromSeq);
  const committed = runtime.timeline.rangeAscending(runtime.characterId, fromSeq, throughSeq);
  assert.ok(committed.some((row) => row.role === "user" && row.content === recallQuery));
  assert.ok(committed.some((row) => row.role === "assistant"));
  privateJson("actual-dialogue-result.json", { question: recallQuery, text, committed, usage,
    elapsedMs: performance.now() - chatStarted, automatic, automaticElapsedMs });
  event("REAL_PRIMARY_DIALOGUE_COMMITTED", { rows: committed.length, elapsedMs: Math.round(performance.now() - chatStarted),
    responseSha256: hash(text), usage: usage.map((item) => ({ inputTokens: item.inputTokens ?? null, outputTokens: item.outputTokens ?? null })) });

  // Network loss occurs before native dispatch. The real utility Write Gate
  // still runs, and only actual saved source/Bank outbox coverage may permit
  // retirement. A role-labelled synthetic Timeline row is never supplied.
  const request = { characterId: runtime.characterId, fromSeq, throughSeq, operationId: `acceptance-retire:${randomUUID()}` };
  const writesBefore = traffic.nativeWrites; faults.offline = true;
  const flushStarted = performance.now();
  const durable = await runtime.subsystem.memoryFlush.prepareRetirement(request);
  privateJson("offline-retirement-result.json", { durable, request, usage: runtime.utility.usage(), at: at() });
  assert.equal(durable.status, "success", JSON.stringify(durable));
  assert.equal(traffic.nativeWrites, writesBefore);
  const spans = runtime.db.prepare(`SELECT source_hash,source_json,gate_json,batches_json,receipts_json,state
    FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch AND character_id=:character AND through_seq>:after
    ORDER BY through_seq`).all({ epoch: runtime.epochId, character: runtime.characterId, after: fromSeq });
  assert.ok(spans.length > 0);
  const batches = spans.flatMap((span) => HindsightIngestionBatchSchema.array().parse(JSON.parse(String(span.batches_json))));
  const receipts = spans.flatMap((span) => HindsightIngestionCoverageSchema.array().parse(JSON.parse(String(span.receipts_json))));
  assert.ok(batches.length > 0, "REAL_WRITE_GATE_SKIPPED_ALL_REQUESTED_SOURCE");
  assert.equal(receipts.length, batches.length); assert.ok(receipts.every((receipt) => receipt.status === "pending" && receipt.evidence.kind === "outbox"));
  event("OFFLINE_RETIREMENT_DURABLY_COVERED", { selectedBanks: batches.length, receipts: receipts.length,
    elapsedMs: Math.round(performance.now() - flushStarted), utility: runtime.utility.usage() });
  runtime = await reopen(owner); faults.offline = false;
  const deadline = Date.now() + 240000;
  const complete = new Set<string>();
  while (Date.now() < deadline && complete.size !== batches.length) {
    for (const batch of batches) {
      if (complete.has(batch.requestId)) continue;
      try { await runtime.subsystem.state.service.recover({ bankId: batch.bank.bankId,
        context: { timeoutMs: 120000, signal: controller.signal } }); }
      catch (error) { if (!(error instanceof Error) || !error.message.startsWith("HINDSIGHT_PENDING_")) throw error; }
      const result = await runtime.subsystem.state.provider.retain({ ...call(runtime, batch.requestId), actor: "background-policy" }, batch.request);
      assert.ok(result.ok, JSON.stringify(result));
      if (result.data.status === "completed") complete.add(batch.requestId);
    }
    if (complete.size !== batches.length) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(complete.size, batches.length, "PRE_RETIREMENT_SOURCE_RECOVERY_INCOMPLETE");
  const replay = await runtime.subsystem.memoryFlush.prepareRetirement(request);
  assert.equal(replay.status, "success");
  assert.equal(runtime.utility.usage().calls, 0, "WRITE_GATE_REPEATED_AFTER_REOPEN");
  for (const batch of batches) {
    await sync(runtime, batch.bank.bankId);
    const source = bodyFor(runtime, batch.bank.bankId, "document", batch.request.documentId!).content;
    assert.equal(source.body_schema, "application-source.v1");
    if (source.body_schema !== "application-source.v1") throw new Error("D77_SOURCE_BODY_MISSING");
    assert.equal(source.value.original_source.retainedText, batch.request.content);
    assert.ok(sameApplicationValue(source.value.original_source.metadata, batch.request.metadata));
  }
  const restored = runtime.db.prepare(`SELECT source_hash,source_json,gate_json,batches_json,receipts_json,state
    FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch AND character_id=:character AND through_seq>:after
    ORDER BY through_seq`).all({ epoch: runtime.epochId, character: runtime.characterId, after: fromSeq });
  assert.deepEqual(restored, spans);
  privateJson("retirement-recovery-result.json", { selectedBanks: batches.length, completedBanks: complete.size,
    originalSourcePreserved: true, gateRepeated: false, replay, request });
  event("PRE_RETIREMENT_REOPEN_RECOVERY_PASSED", { banks: complete.size, gateRepeated: false, originalSourcePreserved: true });
  return { dialogueUsage: usage.map((item) => ({ inputTokens: item.inputTokens ?? null, outputTokens: item.outputTokens ?? null })),
    automaticRecall: { characters: automatic?.length ?? 0, elapsedMs: automaticElapsedMs }, selectedBanks: batches.length };
}

export async function runModelAndRecovery(owner: RuntimeOwner, resume = false) {
  for (const bank of owner.current.banks) await sync(owner.current, bank.externalBankId);
  const recalls = resume ? completedRecallObservations(owner.current) : await originalRecallCases(owner.current);
  const failures = recalls.filter((item) => !item.passed).map((item) => `original-recall-${item.scope}`);
  const observations: Record<string, unknown> = {};
  const scenario = async <T>(name: string, action: () => Promise<T>): Promise<T | undefined> => {
    try {
      const result = await action(); observations[name] = { passed: true, result }; return result;
    } catch (error) {
      failures.push(name);
      const failure = { passed: false, name: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined };
      observations[name] = failure; privateJson(`scenario-${name}-failure.json`, failure);
      event("INDEPENDENT_ACCEPTANCE_SCENARIO_FAILED", { scenario: name, errorType: failure.name });
      if (controller.signal.aborted) throw error;
      // Finish the failed scenario's lifetime before running another case.
      // Remote writes are recovered through the real outbox, never repeated
      // by re-executing a model or synthesizing a completed receipt.
      await reopen(owner);
      faults.offline = false; faults.loseNextNativeAck = false; faults.loseNextApplicationAck = false;
      for (const bank of owner.current.banks) await sync(owner.current, bank.externalBankId);
      return undefined;
    }
  };
  const sample = await scenario("native-response-loss", () => resume ? replayCompletedRetain(owner.current) : retainWithLostResponse(owner));
  const policies = sample ? await scenario("policy-reflection", () => policyAndReflect(owner, sample)) : undefined;
  const curator = await scenario("curator", () => curate(owner.current));
  const dialogue = await scenario("dialogue-retirement", () => chatAndRetirement(owner));
  for (const bank of owner.current.banks) await sync(owner.current, bank.externalBankId);
  assert.equal(owner.current.db.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
  assert.equal(owner.current.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  const result = { recalls, policies, curator, dialogue, failures, observations,
    retiredUtility: owner.retiredUsage, currentUtility: owner.current.utility.usage() };
  privateJson("actual-model-scenarios-result.json", result);
  event("INDEPENDENT_ACCEPTANCE_SCENARIOS_FINISHED", { failures, passed: failures.length === 0 });
  assert.equal(failures.length, 0, "ACTUAL_MODEL_ACCEPTANCE_FAILED");
  return result;
}
