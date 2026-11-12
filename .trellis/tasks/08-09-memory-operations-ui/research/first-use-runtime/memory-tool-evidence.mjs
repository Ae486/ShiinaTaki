/** Read-only controlled-journey assertions: model projections never supply internal write authority. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EffectSourceRefSchema, EffectExecutorRefSchema, RunSnapshotSchema, RunMemoryReferenceSchema,
  PendingMemoryStateSchema } from "../../../../../packages/shared/src/index.ts";
import { decodeHindsightMemoryWrite } from "../../../../../packages/core/src/db/hindsight-memory-write-storage.ts";
import { fenceUntrusted } from "../../../../../packages/core/src/agents/untrusted-fence.ts";

export function parseMemoryModelOutput(output) {
  assert.ok(output?.type === "json" || output?.type === "text", "memory tool returned an SDK error");
  if (output.type === "json") return output.value;
  const text = output.value;
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
}

export function readMemoryToolEvidence(db, expected) {
  const { runId, characterId, toolName, providerId, authorityEpochId } = expected;
  const sources = db.prepare("SELECT source_id, memory_json FROM primary_conversation_sources WHERE run_id = ? AND character_id = ?")
    .all(runId, characterId);
  assert.equal(sources.length, 1, "memory Run must have one exact primary source");
  const parts = db.prepare("SELECT parts FROM timeline_messages WHERE primary_source_id = ? AND character_id = ? ORDER BY seq")
    .all(sources[0].source_id, characterId).flatMap((row) => row.parts ? JSON.parse(row.parts) : []);
  const calls = parts.filter((part) => part.type === "tool-call" && part.toolName === toolName);
  const results = parts.filter((part) => part.type === "tool-result" && part.toolName === toolName);
  assert.equal(calls.length, 1, "memory Run must persist exactly one tool call");
  assert.equal(results.length, 1, "memory Run must persist exactly one tool result");
  assert.equal(results[0].toolCallId, calls[0].toolCallId, "persisted memory call/result identity changed");
  const events = db.prepare("SELECT attempt_id, payload_json FROM run_events WHERE run_id = ? AND kind IN ('tool.call.started', 'tool.result.settled') ORDER BY seq")
    .all(runId).map((row) => ({ attemptId: row.attempt_id, ...JSON.parse(row.payload_json) }))
    .filter((event) => event.toolName === toolName);
  const started = events.filter((event) => event.kind === "tool.call.started");
  const settled = events.filter((event) => event.kind === "tool.result.settled");
  assert.equal(started.length, 1, "memory Run must have one started invocation");
  assert.equal(settled.length, 1, "memory Run must have one settled invocation");
  for (const key of ["attemptId", "toolCallId", "callId", "invocationId", "modelEffectId"]) {
    assert.ok(started[0][key], `memory invocation lacks ${key}`);
    assert.equal(settled[0][key], started[0][key], `memory invocation ${key} changed`);
  }
  assert.equal(settled[0].toolCallId, results[0].toolCallId, "memory event belongs to another persisted result");
  assert.equal(started[0].validationState, "accepted");
  assert.equal(settled[0].outcome, "completed", "memory tool invocation failed");
  const effect = db.prepare("SELECT * FROM run_effects WHERE effect_id = ?").get(settled[0].effectId);
  assert.ok(effect, "memory invocation has no durable Effect");
  assert.equal(effect.run_id, runId); assert.equal(effect.attempt_id, settled[0].attemptId);
  assert.equal(effect.kind, "memory"); assert.equal(effect.state, "terminal"); assert.equal(effect.outcome, "completed");
  const source = EffectSourceRefSchema.parse(JSON.parse(effect.source_ref_json));
  const executor = EffectExecutorRefSchema.parse(JSON.parse(effect.executor_ref_json));
  assert.equal(source.type, "memory"); assert.equal(executor.type, "memory");
  assert.equal(source.operation, toolName); assert.equal(source.requestId, effect.effect_id);
  const snapshotRow = db.prepare("SELECT manifest_json FROM run_snapshots WHERE run_id = ?").get(runId);
  assert.ok(snapshotRow, "memory Run has no captured snapshot");
  const snapshot = RunSnapshotSchema.parse(JSON.parse(snapshotRow.manifest_json));
  assert.equal(snapshot.runId, runId); assert.equal(snapshot.characterId, characterId);
  const memory = RunMemoryReferenceSchema.parse(JSON.parse(sources[0].memory_json));
  assert.deepEqual(memory, snapshot.memory, "primary source differs from admitted memory snapshot");
  assert.equal(memory.providerId, providerId); assert.equal(memory.authorityEpochId, authorityEpochId);
  for (const ref of [source, executor]) {
    assert.equal(ref.providerId, providerId); assert.equal(ref.authorityEpoch, authorityEpochId);
    assert.equal(ref.providerLineageId, memory.providerLineageId); assert.equal(ref.capabilityDigest, memory.capabilityDigest);
  }
  const modelView = parseMemoryModelOutput(results[0].output);
  assert.equal(modelView.ok, true, "memory model result reports a failure");
  if (toolName === "retain") {
    assert.ok(["completed", "pending"].includes(modelView.status), "retain status missing");
    assert.ok(["global", "character", "both"].includes(modelView.scope), "retain scope missing");
    assert.ok(Array.isArray(modelView.memories), "retain references missing");
  }
  return { modelView, memoryEffect: { runId, attemptId: effect.attempt_id, effectId: effect.effect_id,
    toolCallId: settled[0].toolCallId, toolName, requestId: source.requestId, authorityEpochId,
    providerId, providerLineageId: source.providerLineageId, capabilityDigest: source.capabilityDigest,
    inputDigest: effect.input_digest } };
}

export function readRetainWrite(db, memoryEffect) {
  assert.equal(memoryEffect.providerId, "hindsight"); assert.equal(memoryEffect.toolName, "retain");
  const parents = db.prepare("SELECT * FROM hindsight_memory_write_intents WHERE authority_epoch_id = ? AND request_id = ?")
    .all(memoryEffect.authorityEpochId, memoryEffect.requestId);
  assert.equal(parents.length, 1, "original retain must still have exactly one parent");
  const parent = decodeHindsightMemoryWrite(parents[0]);
  assert.equal(parent.identity.operation.kind, "retain"); assert.equal(parent.identity.actor, "foreground-agent");
  assert.equal(parent.identity.namespace.provider_lineage, memoryEffect.providerLineageId);
  const request = parent.identity.operation.request;
  // These are the retain tool's original three input fields, in the governance digest's canonical key order.
  const input = { content: request.content, context: request.context, layer: request.policy.layerId };
  assert.equal(createHash("sha256").update(JSON.stringify(input)).digest("hex"), memoryEffect.inputDigest,
    "original retain parent differs from the admitted Effect input");
  const children = db.prepare("SELECT sequence, state_json FROM pending_memory WHERE authority_epoch_id = ? AND bank_id = ? AND operation_id = ?")
    .all(memoryEffect.authorityEpochId, parent.identity.key.bankId, parent.nativeOperationId);
  assert.equal(children.length, 1, "original retain must still have exactly one Native child");
  const child = PendingMemoryStateSchema.parse(JSON.parse(children[0].state_json));
  assert.equal(child.intent.operationId, parent.nativeOperationId);
  assert.equal(child.intent.authorityEpochId, memoryEffect.authorityEpochId);
  assert.equal(child.intent.providerId, memoryEffect.providerId); assert.equal(child.intent.providerLineageId, memoryEffect.providerLineageId);
  assert.equal(child.intent.bank.bankId, parent.identity.key.bankId);
  assert.equal(child.intent.bankGeneration, parent.identity.namespace.bank_generation);
  assert.deepEqual(child.intent.operation, parent.identity.operation, "original parent/child input differs");
  return { parentRow: parents[0], parent, childRow: children[0], child };
}

export function assertRecallModelView(result, expected) {
  assert.equal(result.ok, true); assert.equal(result.partial, false, "recall had a failed branch");
  assert.deepEqual(result.branchFailures, [], "recall branch failures were hidden");
  assert.ok(Array.isArray(result.hits), "recall hits missing");
  assert.equal(result.returned, result.hits.length);
  const matching = result.hits.filter((hit) => hit.text ===
    (expected.providerId === "local" && hit.policy.origin === "observed"
      ? fenceUntrusted({ source: "memory", content: expected.text }) : expected.text));
  assert.equal(matching.length, 1, "recall must return the preserved fact exactly once");
  assert.equal(matching[0].scope, expected.scope, "recalled fact belongs to another scope");
  assert.equal(matching[0].confirmed, true, "recalled fact is not confirmed");
}
