/**
 * INPUT:  actual copied memories and the real native/application command paths
 * OUTPUT: recall/pin/hidden/CAS and both response-loss recovery evidence without invented provider results
 * POS:    task acceptance scenarios; policy edits and new test facts stay in the isolated target
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RetainRequest, TakiApplicationMemoryBody } from "../../../../../packages/shared/src/index.ts";
import { prepareHindsightApplicationBody } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-body-transfer.ts";
import { hindsightApplicationArtifactVersion } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-binding-context.ts";
import { sameApplicationValue } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-integrity.ts";
import { bodyFor } from "./d77-owner-acceptance-storage.ts";
import { at, call, controller, event, faults, hash, openRuntime, privateJson, scope, sync, traffic,
  type AcceptanceRuntime } from "./d77-owner-acceptance-context.ts";

export interface RuntimeOwner { current: AcceptanceRuntime; retiredUsage: unknown[] }
export async function reopen(owner: RuntimeOwner) {
  const old = owner.current; owner.retiredUsage.push(old.utility.usage());
  await old.close();
  owner.current = await openRuntime(old.path, old.endpoint);
  return owner.current;
}
export async function recall(runtime: AcceptanceRuntime, bankId: string, query: string) {
  const started = performance.now();
  const result = await runtime.subsystem.state.provider.recall(call(runtime), { bankId, query, queryTimestamp: null,
    budget: "low", limit: 25, maxTokens: 5000, factTypes: ["world", "experience", "observation"], layerIds: [], includeInvalidated: false });
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.data.hits.every((hit) => hit.record.unit.state === "valid" && hit.record.policy.visibility !== "hidden"));
  return { result: result.data, elapsedMs: performance.now() - started };
}

export function preparePolicy(runtime: AcceptanceRuntime, bankId: string, memoryId: string,
  update: (value: TakiApplicationMemoryBody) => TakiApplicationMemoryBody, requestId = randomUUID()) {
  const current = bodyFor(runtime, bankId, "memory_unit", memoryId);
  assert.equal(current.content.body_schema, "application-memory.v1");
  if (current.content.body_schema !== "application-memory.v1") throw new Error("D77_POLICY_BODY_MISSING");
  const value = update(current.content.value);
  return runtime.subsystem.state.writer.prepare({ key: { authorityEpochId: runtime.epochId, bankId, requestId },
    namespace: current.address.namespace, intent: { purpose: "owner acceptance policy scenario", requestId }, create: () => {
      const body = prepareHindsightApplicationBody({ ...current.address, schema: "application-memory.v1", value });
      return { bodies: [body], commands: [{ command: "put_artifact", key: current.artifact.key,
        expected_artifact: hindsightApplicationArtifactVersion(current.artifact), expected_native: current.head.version,
        body_ref: body.ref, binding: { kind: "exact_native", native: current.head.version! },
        actor: { kind: "user", actor_ref: requestId } }] };
    } });
}

export async function applyPolicy(runtime: AcceptanceRuntime, bankId: string, memoryId: string,
  update: (value: TakiApplicationMemoryBody) => TakiApplicationMemoryBody) {
  const job = preparePolicy(runtime, bankId, memoryId, update);
  const result = await runtime.subsystem.state.writer.run({ key: job.key, context: { timeoutMs: 120000, signal: controller.signal } });
  assert.equal(result.status, "completed"); await sync(runtime, bankId);
  assert.equal(runtime.subsystem.state.writer.applied(result.job), true); return result;
}

export async function retainWithLostResponse(owner: RuntimeOwner) {
  let runtime = owner.current;
  const bankId = runtime.banks.find((bank) => bank.scope === "global")!.externalBankId;
  const identity = randomUUID(); const nickname = `sapphire-cedar-${identity.slice(0, 8)}`;
  const request: RetainRequest = { bankId, content: `For the isolated acceptance exercise, my checklist nickname is ${nickname}.`,
    context: "Owner-approved isolated acceptance scenario; this is test input, not a production user preference.",
    timestamp: at(), tags: [], entities: [], metadata: { acceptanceScenario: "response-loss", nested: { enabled: true, absent: null } },
    observationScopes: "shared", documentId: `d77-acceptance-${identity}`, strategy: null, updateMode: "replace",
    provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: null, timelineToSeq: null,
      capturedAt: at(), sanitized: true, sourceRef: `owner-acceptance:${identity}` },
    policy: { layerId: "profile", visibility: "retrieved", importance: 5, disclosure: null, origin: "self",
      emotionalWeight: null, policyVersion: 1, retention: { kind: "permanent" } } };
  const requestId = `acceptance-retain-${identity}`;
  faults.loseNextNativeAck = true;
  const pending = await runtime.subsystem.state.provider.retain(call(runtime, requestId), request);
  assert.ok(pending.ok, JSON.stringify(pending)); assert.equal(pending.data.status, "pending");
  assert.equal(faults.loseNextNativeAck, false); assert.equal(faults.offline, true);
  const committedDispatches = traffic.nativeWrites;
  const offline = await recall(runtime, bankId, request.content);
  assert.equal(offline.result.vectorState, "degraded"); assert.equal(offline.result.partial, true);
  event("NATIVE_RESPONSE_LOSS_PENDING_DURABLE", { nativeWrites: committedDispatches, pendingOverlays: offline.result.pending?.length ?? 0 });
  runtime = await reopen(owner); faults.offline = false;
  const deadline = Date.now() + 180000;
  let completed: Awaited<ReturnType<typeof runtime.subsystem.state.provider.retain>> | undefined;
  while (Date.now() < deadline) {
    try { await runtime.subsystem.state.service.recover({ bankId, context: { timeoutMs: 120000, signal: controller.signal } }); }
    catch (error) { if (!(error instanceof Error) || !error.message.startsWith("HINDSIGHT_PENDING_")) throw error; }
    const attempt = await runtime.subsystem.state.provider.retain(call(runtime, requestId), request);
    assert.ok(attempt.ok, JSON.stringify(attempt));
    if (attempt.data.status === "completed") { completed = attempt; break; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(completed?.ok && completed.data.status === "completed", "NATIVE_RETAIN_DID_NOT_COMPLETE");
  assert.equal(traffic.nativeWrites, committedDispatches, "NATIVE_RESPONSE_LOSS_REDISPATCHED");
  assert.ok(completed.data.memories.length > 0);
  const source = bodyFor(runtime, bankId, "document", request.documentId!).content;
  assert.equal(source.body_schema, "application-source.v1");
  if (source.body_schema !== "application-source.v1") throw new Error("D77_SOURCE_BODY_MISSING");
  assert.equal(source.value.original_source.retainedText, request.content);
  assert.ok(sameApplicationValue(source.value.original_source.metadata, request.metadata));
  privateJson("native-response-loss-result.json", { completed, nickname, request, committedDispatches, redispatched: false });
  event("NATIVE_RESPONSE_LOSS_REOPEN_PASSED", { memories: completed.data.memories.length, redispatched: false });
  return { bankId, nickname, memories: completed.data.memories };
}

const visibility = (value: TakiApplicationMemoryBody, next: "pinned" | "retrieved" | "hidden"): TakiApplicationMemoryBody => ({ ...value,
  policy_basis: "curated", policy: { ...value.policy, visibility: next, policyVersion: value.policy.policyVersion + 1, updatedAt: at() },
  // This is an explicit owner's policy edit. It is neither a neutral first
  // policy nor a model assessment; historical assessment bytes remain immutable.
  assessment: { state: "not_required", target: value.assessment.target, attempts: 0, next_attempt_at: null,
    last_failure_code: null, prompt_version: null, prompt_hash: null, completed_at: null } });

async function frozenOriginalPin(runtime: AcceptanceRuntime) {
  const bankId = runtime.banks.find((bank) => bank.scope === "character")!.externalBankId;
  const candidates = runtime.db.prepare(`SELECT object_id FROM hindsight_application_replica_projections
    WHERE bank_id=:bank AND object_kind='memory_unit' AND unit_state='valid' AND visibility='pinned'
    ORDER BY object_id`).all({ bank: bankId });
  const chosen = candidates.map((row) => runtime.subsystem.state.replica.record({ ...scope(runtime, bankId), memoryId: String(row.object_id) }))
    .find((record) => record?.policy.layerId === "relationship" && record.policy.retention.kind === "permanent");
  assert.ok(chosen);
  const captured = await runtime.subsystem.captureRun(runtime.characterId);
  const text = captured.assemble?.("acceptance") ?? ""; assert.ok(text.includes(chosen.unit.text));
  // The original data already contains many non-truncatable promises. Use one
  // of those to verify the frozen Run under the unchanged normal pin budget.
  await applyPolicy(runtime, bankId, chosen.unit.memoryId, (value) => visibility(value, "retrieved"));
  try {
    assert.equal(captured.assemble?.("acceptance"), text, "ADMITTED_RUN_PROMPT_CHANGED");
    const next = await runtime.subsystem.captureRun(runtime.characterId);
    assert.equal(next.assemble?.("acceptance").includes(chosen.unit.text), false);
  } finally { await applyPolicy(runtime, bankId, chosen.unit.memoryId, (value) => visibility(value, "pinned")); }
  event("ORIGINAL_PIN_RUN_IMMUTABILITY_PASSED", { originalPinRestored: true, normalPinBudgetChanged: false });
}

export async function policyAndReflect(owner: RuntimeOwner, sample: Awaited<ReturnType<typeof retainWithLostResponse>>) {
  let runtime = owner.current; const memoryId = sample.memories[0]!.memoryId;
  const visible = await recall(runtime, sample.bankId, sample.nickname);
  assert.ok(visible.result.hits.some((hit) => sample.memories.some((memory) => memory.memoryId === hit.record.unit.memoryId)));
  await frozenOriginalPin(runtime);
  await applyPolicy(runtime, sample.bankId, memoryId, (value) => visibility(value, "pinned"));
  // Both requests capture the same real CAS. The later restriction wins; an
  // older response must not reopen it, including after an acknowledged loss.
  const stale = preparePolicy(runtime, sample.bankId, memoryId, (value) => visibility(value, "retrieved"));
  const hidden = preparePolicy(runtime, sample.bankId, memoryId, (value) => visibility(value, "hidden"));
  faults.loseNextApplicationAck = true;
  const pending = await runtime.subsystem.state.writer.run({ key: hidden.key, context: { timeoutMs: 120000, signal: controller.signal } });
  assert.equal(pending.status, "pending"); assert.equal(faults.loseNextApplicationAck, false);
  assert.equal(runtime.subsystem.state.writer.applied(pending.job), false);
  const commitCount = traffic.applicationCommits;
  runtime = await reopen(owner); faults.offline = false;
  const recovered = await runtime.subsystem.state.writer.run({ key: hidden.key, context: { timeoutMs: 120000, signal: controller.signal } });
  assert.equal(recovered.status, "completed"); assert.equal(traffic.applicationCommits, commitCount);
  await sync(runtime, sample.bankId); assert.equal(runtime.subsystem.state.writer.applied(recovered.job), true);
  const refused = await runtime.subsystem.state.writer.run({ key: stale.key, context: { timeoutMs: 120000, signal: controller.signal } });
  assert.equal(refused.status, "refused"); await sync(runtime, sample.bankId);
  const current = bodyFor(runtime, sample.bankId, "memory_unit", memoryId).content;
  assert.equal(current.body_schema, "application-memory.v1");
  if (current.body_schema !== "application-memory.v1") throw new Error("D77_POLICY_BODY_MISSING");
  assert.equal(current.value.policy.visibility, "hidden");
  for (const memory of sample.memories.slice(1)) await applyPolicy(runtime, sample.bankId, memory.memoryId, (value) => visibility(value, "hidden"));
  const fresh = await runtime.subsystem.captureRun(runtime.characterId);
  assert.equal(fresh.assemble?.("acceptance").includes(sample.nickname), false);
  const recallHidden = await recall(runtime, sample.bankId, sample.nickname);
  assert.equal(recallHidden.result.hits.some((hit) => sample.memories.some((memory) => memory.memoryId === hit.record.unit.memoryId)), false);
  event("POLICY_RESPONSE_LOSS_AND_CAS_PASSED", { redispatched: false, staleState: refused.status, hiddenMemoryCount: sample.memories.length });

  const start = performance.now();
  const reflection = await runtime.subsystem.state.provider.reflect(call(runtime), { bankId: sample.bankId,
    query: "What is the checklist nickname from the isolated acceptance exercise? Use only eligible saved memories; if it is unavailable, say so.",
    budget: "low", maxTokens: 512 });
  assert.ok(reflection.ok, JSON.stringify(reflection));
  assert.equal(reflection.data.text.includes(sample.nickname), false);
  assert.equal(reflection.data.evidence.memoryIds.some((id) => sample.memories.some((memory) => memory.memoryId === id)), false);
  privateJson("guarded-reflection-result.json", { reflection, elapsedMs: performance.now() - start, excludedIds: sample.memories.map((memory) => memory.memoryId) });
  event("REAL_GUARDED_REFLECTION_PASSED", { elapsedMs: Math.round(performance.now() - start),
    inputTokens: reflection.data.usage.inputTokens, outputTokens: reflection.data.usage.outputTokens,
    responseSha256: hash(reflection.data.text), hiddenNicknameAbsent: true });
  return { hidden: sample.memories.length, usage: reflection.data.usage, elapsedMs: performance.now() - start };
}
