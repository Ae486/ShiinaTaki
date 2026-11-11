/**
 * INPUT:  the current checkout, the read-only patched native checkout (H:/hindsight), a fresh temp root; no network, no
 *         real model, no owner data
 * OUTPUT: the R4 journey (Legacy -> Local -> Hindsight setup/activation -> capture + replica.sync -> new Character
 *         automatic provisioning + recall + ingestion -> post-ingestion turn probe -> config drift + revalidate -> Core restart) over the
 *         real WS RPC surface against a throwaway native instance; evidence/ (result.json + scrubbed logs) next to this
 *         script; step-level policy settlement status/counts from Core logs; full teardown
 * POS:    10-29-first-use-runtime (adapted from archived native-smoke) verification harness — rerun with `node native-smoke.mjs` from any cwd
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import * as shared from "../../../../../packages/shared/src/index.ts";
import { fenceUntrusted } from "../../../../../packages/core/src/agents/untrusted-fence.ts";
import { decodeHindsightMemoryWrite } from "../../../../../packages/core/src/db/hindsight-memory-write-storage.ts";
import { getApplicationReplicaRecord } from "../../../../../packages/core/src/db/hindsight-application-replica-records.ts";
import { EPISODIC_EVERY_N } from "../../../../../packages/core/src/memory/auto-memory.ts";
import { loadManagedTemplate, TAKI_MANAGED_TEMPLATE_REVISION } from "../../../../../packages/core/src/memory/hindsight/template-lifecycle/template-catalog.ts";
import { appliedMigrations, bootCore, openOperator, runCoreChild, stopCore } from "./smoke-core.mjs";
import { startFakeProvider } from "../../../archive/2026-09/09-25-hindsight-native-smoke/research/smoke-fake-provider.mjs";
import {
  freePort, listOwnerTaki, listPg0Registry, listeners, nativeCalls, nativeEgress, nativeLogSize, portPolicy, processSnapshot,
  awaitNativeHealth, descendants, removePg0, running, spawnNative, startPg0, stopNative,
} from "./smoke-native.mjs";

import { startHome, homeStep } from "./home-browser.mjs";
import { startNativeFault } from "./native-fault.mjs";
import { pendingWriteEvidence, nativeWriteEvidence } from "./pending-write-evidence.mjs";

const script = fileURLToPath(import.meta.url);
const evidenceDir = fileURLToPath(new URL(`./results/${new Date().toISOString().replaceAll(":", "-")}/`, import.meta.url));
const API_KEY_REF = "memory.hindsight.connection.api-key";
const OP_MS = 300_000;
const ACTIVATE_MS = 600_000;
const CHAT_MS = 180_000;
const DEGRADED_PHRASE = "painting boats";
const TERMINAL = new Set(shared.MEMORY_OPERATION_TERMINAL_STATES);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function check(condition, message, detail) {
  if (!condition) throw Object.assign(new Error(message), { detail });
}

function createJourney(ctx) {
  const steps = [];
  const step = async (id, title, body) => {
    const offset = ctx.native ? nativeLogSize(ctx.native) : 0;
    const providerStart = ctx.provider.log.length;
    const coreAtStart = ctx.core;
    const coreLogStart = coreAtStart?.log().length ?? 0;
    const started = Date.now();
    const entry = { id, title, startedAt: new Date(started).toISOString(), status: "passed", observed: {}, error: null };
    steps.push(entry);
    console.log(`[smoke] step ${id}: ${title}`);
    try {
      await body(entry.observed);
    } catch (error) {
      entry.status = "failed";
      entry.error = { message: error.message, detail: error.detail ?? error.rpc ?? null };
      console.log(`[smoke] step ${id} FAILED: ${error.message}`);
    }
    entry.durationMs = Date.now() - started;
    entry.finishedAt = new Date(started + entry.durationMs).toISOString();
    entry.nativeCalls = ctx.native ? nativeCalls(ctx.native, offset) : null;
    entry.providerRequests = ctx.provider.log.slice(providerStart).map(({ kind, model, tools, range, answer }) => ({ kind, model, tools, range, answer }));
    entry.observed.policyReview = observePolicyReviews([
      coreAtStart?.log().slice(coreLogStart) ?? "", ctx.core !== coreAtStart ? ctx.core?.log() ?? "" : "",
    ]);
    if (entry.status !== "passed") throw new Error(`Journey stopped at ${id}: ${entry.error.message}`);
    return true;
  };
  return { steps, step };
}

function observePolicyReviews(logs) {
  const settlements = logs.flatMap((log) => log.split("\n").slice(0, -1))
    .filter((line) => line.includes('"msg":"Hindsight policy review settled"'))
    .map((line) => {
      const { time, characterId, status, assessed, blocks, pending, edits, steps } = JSON.parse(line);
      return { at: new Date(time).toISOString(), characterId, status, assessed, blocks, pending, edits, steps };
    });
  const last = settlements.at(-1);
  return { status: last?.status ?? "not_observed", pending: last?.pending ?? null, settlements };
}

async function authority(operator) {
  return shared.MemoryAuthorityStatusSchema.parse(await operator.call(shared.MEMORY_AUTHORITY_METHODS.status));
}
async function activation(operator) {
  return shared.MemoryActivationStatusSchema.parse(await operator.call(shared.MEMORY_ACTIVATION_METHODS.status));
}
async function setupStatus(operator) {
  return shared.HindsightStatusResultSchema.parse(await operator.call(shared.HINDSIGHT_METHODS.status));
}
async function operationStatus(operator, operationId) {
  return shared.MemoryOperationStatusResultSchema.parse(await operator.call(shared.MEMORY_OPERATION_METHODS.status, { operationId })).operation;
}
async function listOperations(operator) {
  return shared.MemoryOperationListResultSchema.parse(await operator.call(shared.MEMORY_OPERATION_METHODS.list, { includeTerminal: true, limit: 50 })).operations;
}

async function awaitOperation(operator, operationId, budget = OP_MS) {
  for (const deadline = Date.now() + budget; Date.now() < deadline; await sleep(250)) {
    const operation = await operationStatus(operator, operationId);
    if (TERMINAL.has(operation.state)) return operation;
  }
  throw new Error(`operation deadline: ${operationId}`);
}

async function submit(operator, request, budget) {
  const admitted = shared.MemoryOperationSubmitResultSchema.parse(await operator.call(shared.MEMORY_OPERATION_METHODS.submit, { request })).operation;
  return awaitOperation(operator, admitted.operationId, budget);
}

function brief(operation) {
  return { operationId: operation.operationId, kind: operation.kind, state: operation.state, reason: operation.reason,
    errorCode: operation.errorCode, result: operation.result, producer: operation.producer?.kind === "bank" || operation.producer?.kind === "connection"
      ? { kind: operation.producer.kind, origin: operation.producer.origin, phase: operation.producer.phase } : operation.producer?.kind ?? null };
}

async function chat(operator, characterId, message) {
  const started = Date.now();
  // The ack waits for Run admission, which includes the foreground Bank sync; its latency is evidence, not a harness limit.
  const sent = shared.ChatSendResultSchema.parse(await operator.call(shared.CHAT_METHODS.send, { characterId, message }, CHAT_MS));
  const ackMs = Date.now() - started;
  const note = await operator.waitNotification((entry) => (entry.method === shared.CHAT_METHODS.complete || entry.method === shared.CHAT_METHODS.error)
    && entry.params?.messageId === sent.messageId, CHAT_MS);
  let run;
  for (const deadline = Date.now() + CHAT_MS; Date.now() < deadline; await sleep(200)) {
    run = shared.RunStatusResultSchema.parse(await operator.call(shared.RUN_METHODS.status, { runId: sent.runId })).run;
    if (["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"].includes(run.state)) break;
  }
  const reply = operator.notifications.filter((entry) => entry.method === shared.CHAT_METHODS.delta && entry.params?.messageId === sent.messageId)
    .map((entry) => entry.params.delta).join("");
  return { runId: sent.runId, messageId: sent.messageId, ackMs, totalMs: Date.now() - started, outcome: note.method, error: note.method === shared.CHAT_METHODS.error
    ? { code: note.params.code, message: note.params.message } : null, runState: run?.state, reply };
}

function bankView(status) {
  return status.hindsight?.banks.map(({ scope, characterId, nativeBankId, readiness, errorCode }) => ({ scope, characterId, nativeBankId, readiness, errorCode }));
}

async function retainedChat(ctx, message) {
  const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
  try {
    const before = db.prepare("SELECT coalesce(max(seq), 0) AS seq FROM timeline_messages WHERE character_id = 'taki'").get().seq;
    const run = await chat(ctx.operator, "taki", message);
    check(run.outcome === shared.CHAT_METHODS.complete && run.runState === "completed", "retain Run failed", run);
    const parts = db.prepare("SELECT parts FROM timeline_messages WHERE character_id = 'taki' AND seq > ? ORDER BY seq")
      .all(before).flatMap((row) => row.parts ? JSON.parse(row.parts) : []);
    const results = parts.filter((part) => part.type === "tool-result" && part.toolName === "retain");
    check(results.length === 1, "retain must have exactly one persisted tool result", { count: results.length, runId: run.runId });
    const part = results[0];
    check(parts.some((call) => call.type === "tool-call" && call.toolName === "retain" && call.toolCallId === part.toolCallId),
      "persisted retain call/result identity missing");
    const output = part.output;
    check(output.type === "json" || output.type === "text", "retain tool returned an SDK error", output);
    const value = output.type === "json" ? output.value : JSON.parse(output.value.slice(output.value.indexOf("{"), output.value.lastIndexOf("}") + 1)
      .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
    const retain = shared.HindsightMemoryRetainEnvelopeV1Schema.parse(value);
    check(retain.ok && retain.providerId === "hindsight" && retain.authorityEpochId === ctx.epochId, "retain result is not successful current Hindsight", retain);
    return { ...run, retain };
  } finally { db.close(); }
}

function retainedWrite(ctx, run, completed = false) {
  const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
  try {
    const rows = db.prepare("SELECT * FROM hindsight_memory_write_intents WHERE authority_epoch_id = ? AND request_id = ?")
      .all(ctx.epochId, run.retain.requestId);
    check(rows.length === 1, "original retain must have one durable parent", { requestId: run.retain.requestId, count: rows.length });
    const job = decodeHindsightMemoryWrite(rows[0]);
    const bankId = job.identity.key.bankId;
    const childRow = db.prepare("SELECT state_json FROM pending_memory WHERE authority_epoch_id = ? AND bank_id = ? AND operation_id = ?")
      .get(ctx.epochId, bankId, job.nativeOperationId);
    check(childRow, "original retain has no durable Native child");
    const child = shared.PendingMemoryStateSchema.parse(JSON.parse(childRow.state_json));
    const evidence = { requestId: run.retain.requestId, bankId, nativeOperationId: job.nativeOperationId,
      parentState: rows[0].state, childPhase: child.phase, documentId: child.documentId ?? null };
    if (!completed) return evidence;
    check(job.terminal?.kind === "retain" && child.phase === "completed", "original retain has not completed", evidence);
    const result = job.terminal.result;
    check(child.documentId === result.documentId && (!run.retain.data.documentId || run.retain.data.documentId === result.documentId),
      "original retain document identity changed", evidence);
    const projections = db.prepare("SELECT object_kind, object_id FROM hindsight_application_replica_projections WHERE bank_id = ? AND object_kind IN ('memory_unit', 'document')")
      .all(bankId).map((row) => getApplicationReplicaRecord(db, { bankId, objectKind: row.object_kind, objectId: row.object_id }));
    const records = projections.filter((record) => record?.payload?.kind === "memory_unit").map((record) => record.payload.value.unit);
    const documents = projections.filter((record) => record?.payload?.kind === "document")
      .map((record) => record.payload.value).filter((source) => source.retainedText === job.identity.operation.request.content);
    const matching = records.filter((unit) => unit.factType !== "observation" && unit.text === job.identity.operation.request.content);
    // One retain can legitimately extract several units; the original Source and fixture fact must each occur once.
    check(documents.length === 1 && documents[0].documentId === result.documentId && matching.length === 1
      && matching[0].documentId === result.documentId && result.memories.some((ref) => ref.memoryId === matching[0].memoryId)
      && result.memories.every((ref) => records.some((unit) => unit.memoryId === ref.memoryId && unit.documentId === result.documentId)),
    "original retain must have one Source/fact and preserve every returned memory", { ...evidence, result: result.memories, matching, documentCount: documents.length });
    return { ...evidence, sourceRevision: result.sourceRevision, memoryCount: result.memories.length, documentCount: documents.length,
      replicaEffects: matching.map(({ memoryId, documentId }) => ({ memoryId, documentId })) };
  } finally { db.close(); }
}

async function memoryChat(ctx, message, providerId, expectedText) {
  const offset = ctx.provider.log.length;
  const run = await chat(ctx.operator, "taki", message);
  check(run.outcome === shared.CHAT_METHODS.complete, "memory chat did not complete", run);
  const calls = ctx.provider.log.slice(offset).filter((entry) => entry.kind === "main-after-tool");
  check(calls.length === 1, "memory chat did not produce one tool result", calls);
  const text = calls[0].toolResult;
  check(typeof text === "string", "memory tool result missing");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const result = JSON.parse(json);
  check(result.ok === true && result.providerId === providerId && result.authorityEpochId === ctx.epochId,
    "memory tool failed or used another authority", result);
  if (message.startsWith("[retain]")) check(result.data.status === "completed", "Local retain did not commit", result);
  else {
    check(result.data.partial === false, "recall had a failed branch", result);
    // Local fences observed records before returning them. Compare the exact model-facing
    // representation; a derived observation containing the phrase is still not the base fact.
    const matching = result.data.hits.filter((hit) => hit.record.unit.text ===
      (providerId === "local" && hit.record.policy.origin === "observed"
        ? fenceUntrusted({ source: "memory", content: expectedText }) : expectedText));
    check(matching.length === 1, "recall must return the preserved fact exactly once", result);
  }
  return { ...run, toolResult: result };
}

async function stepSetup(ctx, observed) {
  const { operator } = ctx;
  observed.home = await homeStep(ctx, "setup");
  const after = await setupStatus(operator);
  observed.setup = { phase: after.phase, revision: after.revision, fingerprint: after.configFingerprint, banks: after.banks,
    compatibility: after.compatibility && { build: after.compatibility.compatibilityBuild, lineage: after.compatibility.providerLineage } };
  check(after.phase === "configured", "setup is not configured", after);
  ctx.setupRevision = after.revision;
}

async function stepActivate(ctx, observed) {
  const { operator } = ctx;
  const card = await activation(operator);
  observed.before = { actions: card.actions, blocking: card.prerequisites.blocking, setup: card.setup };
  check(card.actions.activate, "activation card does not offer activate", card);
  const local = await authority(operator);
  observed.home = await homeStep(ctx, "activate");
  const admitted = (await listOperations(operator)).find((row) => row.kind === "hindsight.activate");
  observed.operationAtHomeReady = brief(admitted);
  // Home's enabled Sync button observes the committed runtime; activation still owns required Bank preparation.
  const operation = await awaitOperation(operator, admitted.operationId, ACTIVATE_MS);
  observed.operation = brief(operation);
  check(operation.state === "completed", "Home activation incomplete", observed.operation);
  const status = await authority(operator);
  const after = await activation(operator);
  observed.authority = status.authority;
  observed.runtime = status.runtime;
  observed.card = { run: after.run && { phase: after.run.phase, status: after.run.status, receipt: after.run.receipt }, operation: after.operation?.state,
    actions: after.actions };
  const committedAt = after.run?.receipt?.committedAt ?? null;
  observed.activationTiming = { authorityCommittedAt: committedAt, operationCompletedAt: operation.terminalAt,
    commitToCompletionMs: committedAt === null ? null : Date.parse(operation.terminalAt) - Date.parse(committedAt) };
  check(status.authority.mode === "hindsight" && status.runtime.available, "runtime is not Hindsight/available", status.runtime);
  check(after.operation === null || after.operation.state === "completed", "activation status did not confirm completion", after.operation);
  ctx.epochId = status.authority.epochId;
}

async function stepCaptureAndSync(ctx, observed) {
  const { operator } = ctx;
  const before = await authority(operator);
  const run = await retainedChat(ctx, "[retain] I live in a lighthouse by the sea.");
  observed.chat = run;
  ctx.runs.push({ label: "hindsight-capture", ...run });
  check(run.outcome === shared.CHAT_METHODS.complete, "Hindsight chat Run failed", run);
  check(run.retain.data.status === "pending", "automatic settlement requires a Pending retain receipt", run.retain);
  observed.retainedBefore = retainedWrite(ctx, run);
  const bankBefore = before.replica?.find((bank) => bank.bankId === observed.retainedBefore.bankId);
  check(bankBefore?.automatic && bankBefore.run === null && bankBefore.pendingManualKind === null && !bankBefore.catchUpRequested,
    "automatic settlement must start with an idle automatic Bank", bankBefore);
  observed.automaticBefore = bankBefore;
  const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
  try {
    // Status/SQLite reads only: the first explicit sync remains below the original-write completion assertion.
    observed.pendingWaitMs = await waitPendingDrained(operator, 180_000, () => {
      const row = db.prepare("SELECT state_json FROM hindsight_replica_sync_schedule WHERE bank_id = ?").get(bankBefore.bankId);
      check(row, "automatic settlement schedule unavailable");
      const state = shared.MemoryReplicaSyncStateSchema.parse(JSON.parse(row.state_json));
      if (state.lastAttemptAt === null || Date.parse(state.lastAttemptAt) <= Date.parse(bankBefore.lastAttemptAt ?? bankBefore.createdAt)) return false;
      if (state.run) {
        check(state.run.trigger !== "manual" && !state.run.manualRequestId, "settlement was triggered manually", state.run);
        observed.automaticAttempt = { run: state.run, lastAttemptAt: state.lastAttemptAt };
      }
      observed.automaticLatest = state;
      if (state.run || state.mode !== "idle" || state.lastSuccessAt === null || Date.parse(state.lastSuccessAt) < Date.parse(state.lastAttemptAt)) return false;
      observed.automaticSettlement = { bankId: bankBefore.bankId, ...scheduledRunEvidence(ctx, db, bankBefore.bankId),
        lastAttemptAt: state.lastAttemptAt, lastSuccessAt: state.lastSuccessAt };
      return true;
    });
  } finally { db.close(); }
  observed.automaticSettlement.delayAfterChatMs = observed.pendingWaitMs;
  observed.retainedAfterAutomatic = retainedWrite(ctx, run, true);
  const status = await authority(operator);
  observed.pending = status.pending;
  observed.replica = status.replica?.map(({ bankId, lastSuccessAt, lag }) => ({ bankId, lastSuccessAt, lag }));
  check(status.replica?.length, "no replica Banks under Hindsight", status.replica);
  const operations = [];
  for (const { bankId } of status.replica) {
    for (const syncKind of ["incremental", "full"]) operations.push(await submit(operator, { kind: "replica.sync", bankId, syncKind }));
  }
  observed.sync = operations.map(brief);
  check(operations.every((operation) => operation.state === "completed"), "a replica.sync did not complete", observed.sync);
  observed.retainedAfter = retainedWrite(ctx, run, true);
  const second = await openOperator(ctx.corePort, "native smoke second connection");
  try {
    const listed = await listOperations(second);
    const agree = operations.map((operation) => {
      const row = listed.find((entry) => entry.operationId === operation.operationId);
      return { operationId: operation.operationId, listed: row?.state ?? null, same: JSON.stringify(row) === JSON.stringify(operation) };
    });
    const statuses = await Promise.all(operations.map((operation) => operationStatus(second, operation.operationId)));
    observed.secondConnection = { agree, statusAgree: statuses.every((row, index) => JSON.stringify(row) === JSON.stringify(operations[index])) };
    check(agree.every((row) => row.same) && observed.secondConnection.statusAgree, "second connection disagrees", observed.secondConnection);
  } finally {
    second.close();
  }
  observed.pushes = operator.notifications.filter((entry) => entry.method === shared.MEMORY_OPERATION_METHODS.changed
    && operations.some((operation) => operation.operationId === entry.params.operation.operationId)).length;
}

async function waitPendingDrained(operator, budget, observe = () => true) {
  const started = Date.now();
  for (const deadline = started + budget; Date.now() < deadline; await sleep(500)) {
    const status = await authority(operator); const { pending } = status;
    check(Array.isArray(pending) && pending.length > 0, "Pending summary is empty or unavailable", pending);
    check(pending.every((bank) => bank.summary.failedCount === 0 && bank.summary.unknownCount === 0),
      "Pending recovery contains failed or unknown children", pending);
    const observed = observe(status);
    if (observed && pending.every((bank) => bank.summary.pendingCount === 0 && bank.parentWritesPending === 0)) return Date.now() - started;
  }
  throw new Error("pending writes did not drain");
}

async function settlePostTurnWrites(ctx) {
  const started = Date.now();
  const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
  let ingestion;
  try {
    // Chat completion precedes the detached gate. Eligible unclaimed input must be consumed before an empty
    // Pending summary can establish settlement; a completed span may still have durable Pending children.
    for (const deadline = started + OP_MS; Date.now() < deadline; await sleep(500)) {
      const pendingSpans = db.prepare("SELECT count(*) AS n FROM hindsight_ingestion_spans WHERE authority_epoch_id = ? AND state = 'pending'")
        .get(ctx.epochId).n;
      const eligible = db.prepare(`SELECT character_id, count(*) AS unprocessed FROM hindsight_ingestion_primary_commits
        WHERE authority_epoch_id = ? AND ingestion_span_id IS NULL GROUP BY character_id HAVING count(*) >= ?`)
        .all(ctx.epochId, EPISODIC_EVERY_N);
      ingestion = { pendingSpans, eligible };
      if (pendingSpans === 0 && eligible.length === 0) break;
    }
    check(ingestion?.pendingSpans === 0 && ingestion.eligible.length === 0, "post-turn ingestion did not settle", ingestion);
  } finally { db.close(); }
  const ingestionWaitMs = Date.now() - started;
  const status = await authority(ctx.operator);
  check(status.authority.epochId === ctx.epochId, "authority changed while waiting for ingestion");
  const manualSync = await syncPendingBanks(ctx, status.replica.filter((bank) => !bank.automatic));
  const pendingWaitMs = await waitPendingDrained(ctx.operator, OP_MS);
  return { ingestion, ingestionWaitMs, manualSync, pendingWaitMs };
}

// Released leases persist. They prove a fast scheduler run even if it completed between polls; a sync with nothing to apply lasts about 80 ms.
function scheduledRunEvidence(ctx, db, bankId) {
  const lease = db.prepare("SELECT run_id, owner_id, fence FROM hindsight_replica_sync_leases WHERE bank_id = ?").get(bankId);
  check(lease?.owner_id === `hindsight:${ctx.epochId}` && lease.run_id, "scheduled run has no attributable scheduler lease", lease);
  const manual = db.prepare("SELECT state_json FROM hindsight_replica_manual_requests WHERE bank_id = ?").all(bankId)
    .map((entry) => shared.MemoryReplicaRequestSchema.parse(JSON.parse(entry.state_json)));
  check(!manual.some((entry) => entry.claim?.runId === lease.run_id), "scheduled run used a manual scheduler request", { runId: lease.run_id });
  return { runId: lease.run_id, ownerId: lease.owner_id, fence: lease.fence };
}

async function stepScheduledSync(ctx, observed) {
  const bank = (await authority(ctx.operator)).replica.find((row) => row.scope === "global");
  const original = { automatic: bank.automatic, autoIntervalMs: bank.autoIntervalMs,
    fullReconciliationIntervalMs: bank.fullReconciliationIntervalMs };
  const config = { ...original, automatic: true, autoIntervalMs: 60_000 };
  const configure = (value) => ctx.operator.call(shared.MEMORY_REPLICA_METHODS.configure, { bankId: bank.bankId, config: value });
  const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
  const read = () => shared.MemoryReplicaSyncStateSchema.parse(JSON.parse(db.prepare(
    "SELECT state_json FROM hindsight_replica_sync_schedule WHERE bank_id = ?").get(bank.bankId).state_json));
  try {
    const before = read();
    check(before.mode === "idle" && before.run === null && before.pendingManualKind === null && !before.catchUpRequested,
      "scheduled observation must start without queued work", before);
    observed.before = before;
    await configure(config);
    const started = Date.now();
    // Read the durable producer directly so the observer never dispatches an operation or foreground catch-up.
    for (const deadline = started + 180_000; Date.now() < deadline; await sleep(100)) {
      const state = read();
      if (state.lastAttemptAt === before.lastAttemptAt) continue;
      if (state.run) {
        check(state.run.trigger === "interval" && !state.run.manualRequestId, "attempt was not the scheduled interval", state.run);
        continue;
      }
      observed.automaticAttempt = { ...scheduledRunEvidence(ctx, db, bank.bankId), lastAttemptAt: state.lastAttemptAt };
      observed.automaticAfter = state;
      check(state.mode === "idle" && Date.parse(state.lastSuccessAt) > Date.parse(before.lastSuccessAt),
        "scheduled synchronization did not succeed", state);
      break;
    }
    observed.automaticWindowMs = Date.now() - started;
    check(observed.automaticAfter, "no attributable scheduled synchronization completed", observed);
    await configure({ ...config, automatic: false });
    const manualBefore = read();
    const manualStarted = Date.now();
    const windowMs = Math.max(65_000, observed.automaticWindowMs);
    while (Date.now() - manualStarted < windowMs) {
      const state = read();
      check(state.run === null && state.lastAttemptAt === manualBefore.lastAttemptAt && state.lastSuccessAt === manualBefore.lastSuccessAt,
        "manual-only mode dispatched work in the equivalent observation window", state);
      await sleep(100);
    }
    observed.manualWindowMs = Date.now() - manualStarted;
    observed.manualAfter = read();
    check(observed.manualAfter.run === null && observed.manualAfter.lastAttemptAt === manualBefore.lastAttemptAt
      && observed.manualAfter.lastSuccessAt === manualBefore.lastSuccessAt, "manual-only state changed at the end of observation", observed.manualAfter);
    observed.status = (await authority(ctx.operator)).replica.find((row) => row.bankId === bank.bankId);
  } finally {
    db.close();
    await configure(original);
    const restored = (await authority(ctx.operator)).replica.find((row) => row.bankId === bank.bankId);
    observed.originalConfiguration = original;
    observed.restoredConfiguration = { automatic: restored.automatic, autoIntervalMs: restored.autoIntervalMs,
      fullReconciliationIntervalMs: restored.fullReconciliationIntervalMs };
    check(JSON.stringify(observed.restoredConfiguration) === JSON.stringify(original), "schedule step did not restore its original configuration", observed);
  }
}

async function waitBankLease(ctx, bankId) {
  const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
  try {
    const read = db.prepare("SELECT expires_at FROM hindsight_replica_sync_leases WHERE bank_id = ?");
    for (const deadline = Date.now() + 180_000; Date.now() < deadline; await sleep(250)) {
      const lease = read.get(bankId);
      if (!lease || Date.parse(lease.expires_at) <= Date.now()) return;
    }
    throw new Error("replica Bank lease did not release before outage sync");
  } finally { db.close(); }
}

async function waitProvision(operator, characterId) {
  for (const deadline = Date.now() + 30_000; Date.now() < deadline; await sleep(250)) {
    const row = (await listOperations(operator)).find((entry) => entry.kind === "bank.provision" && entry.request.characterId === characterId);
    if (row) return { operation: await awaitOperation(operator, row.operationId), trigger: "automatic-or-existing" };
  }
  return null;
}

async function stepNewCharacter(ctx, observed) {
  const { operator } = ctx;
  const degraded = await chat(operator, "mika", `Hi, I am new here and I like ${DEGRADED_PHRASE}.`);
  observed.degraded = degraded;
  ctx.runs.push({ label: "mika-degraded", ...degraded });
  const request = ctx.provider.log.filter((entry) => entry.model === "smoke-main").at(-1);
  observed.degradedTools = request?.tools ?? null;
  check(degraded.outcome === shared.CHAT_METHODS.complete, "degraded Run did not reply", degraded);
  check(!request?.tools.includes("retain") && !request?.tools.includes("recall"), "degraded Run still offered memory tools", request?.tools);
  const early = await authority(operator);
  observed.readinessAfterDegraded = bankView(early)?.find((bank) => bank.characterId === "mika") ?? null;
  observed.provisionActions = early.hindsight?.actions;
  const provision = await waitProvision(operator, "mika");
  observed.automaticProvision = provision && { trigger: provision.trigger, ...brief(provision.operation) };
  observed.provision = observed.automaticProvision;
  check(provision?.operation.producer?.origin === "automatic" && provision.operation.state === "completed",
    "automatic bank.provision did not complete", observed.automaticProvision);
  const ready = await authority(operator);
  observed.banks = bankView(ready);
  check(observed.banks.find((bank) => bank.characterId === "mika")?.readiness === "ready", "mika Bank is not ready", observed.banks);
  const offset = nativeLogSize(ctx.native);
  const recall = await chat(operator, "mika", "[recall] What do you remember about me?");
  ctx.runs.push({ label: "mika-recall", ...recall });
  observed.recall = recall;
  observed.recallToolResult = ctx.provider.log.filter((entry) => entry.kind === "main-after-tool").at(-1)?.toolResult ?? null;
  observed.recallNativeCalls = nativeCalls(ctx.native, offset);
  check(recall.outcome === shared.CHAT_METHODS.complete, "recall Run failed", recall);
  await driveIngestion(ctx, observed);
}

/** Hindsight ingestion runs only past EPISODIC_EVERY_N unprocessed entries or with a pending span; plain turns reach it. */
async function driveIngestion(ctx, observed) {
  const isMikaGate = (entry) => entry.kind === "utility-gate" && entry.watched?.includes(DEGRADED_PHRASE);
  const turns = [];
  while (!ctx.provider.log.some(isMikaGate) && turns.length < 30) {
    const turn = await chat(ctx.operator, "mika", `Filler turn ${turns.length + 1}: the weather is calm today.`);
    turns.push({ ackMs: turn.ackMs, totalMs: turn.totalMs, outcome: turn.outcome });
    check(turn.outcome === shared.CHAT_METHODS.complete, "filler turn failed", turn);
  }
  observed.fillerTurns = turns;
  for (const deadline = Date.now() + 120_000; Date.now() < deadline; await sleep(500)) {
    const card = await activation(ctx.operator);
    observed.custody = card.custody;
    if (ctx.provider.log.some(isMikaGate) && card.custody.pendingSpans === 0) break;
  }
  observed.mikaGateRequests = ctx.provider.log.filter(isMikaGate).map(({ id, range, answer }) => ({ id, range, answer }));
  check(observed.mikaGateRequests.length > 0, "the degraded turn never reached the ingestion gate", observed.custody);
}

/** Turns right after ingestion land while native consolidation rewrites the fresh units the foreground sync must bind. */
async function stepPostIngestion(ctx, observed) {
  observed.attempts = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const offset = nativeLogSize(ctx.native);
    const started = Date.now();
    try {
      const turn = await chat(ctx.operator, "mika", `Post-ingestion turn ${attempt}.`);
      observed.attempts.push({ attempt, ackMs: turn.ackMs, totalMs: turn.totalMs, outcome: turn.outcome, error: turn.error,
        nativeCommits: countCommits(nativeCalls(ctx.native, offset)) });
    } catch (error) {
      observed.attempts.push({ attempt, failedAfterMs: Date.now() - started, error: error.rpc ?? error.message,
        nativeCommits: countCommits(nativeCalls(ctx.native, offset)) });
    }
    await sleep(5_000);
  }
  const bad = observed.attempts.filter((entry) => entry.outcome !== shared.CHAT_METHODS.complete || entry.ackMs > 30_000);
  check(bad.length === 0, "a post-ingestion chat.send failed or its ack exceeded 30 s", bad);
}

function countCommits(calls) {
  return Object.entries(calls.counts).filter(([key]) => key.includes("/application-state/commits"))
    .reduce((sum, [, count]) => sum + count, 0);
}

async function stepPending(ctx, observed) {
  ctx.fault.interrupt(true);
  try {
    observed.chat = await retainedChat(ctx, "[retain] I collect blue seashells during the fixture outage.");
    check(observed.chat.outcome === shared.CHAT_METHODS.complete, "outage chat failed", observed.chat);
    observed.originalWrite = retainedWrite(ctx, observed.chat);
    const status = await authority(ctx.operator);
    observed.pendingBefore = status.pending;
    observed.rejectedWrites = ctx.fault.rejected();
    check(observed.rejectedWrites > 0, "fault never reached a Native write");
    check(status.pending.some((bank) => bank.summary.pendingCount > 0), "no durable pending write was observed", status.pending);
    check(observed.originalWrite.parentState === "pending" && observed.originalWrite.childPhase !== "completed",
      "the original outage request did not remain Pending", observed.originalWrite);
    const bankId = observed.originalWrite.bankId;
    await waitBankLease(ctx, bankId);
    observed.beforeFailedSync = (await authority(ctx.operator)).replica.find((bank) => bank.bankId === bankId);
    check(!observed.beforeFailedSync.automatic && observed.beforeFailedSync.lastSuccessAt !== null, "outage needs manual mode and prior success");
    const rejectedBefore = ctx.fault.rejected();
    observed.failedSync = brief(await submit(ctx.operator, { kind: "replica.sync", bankId, syncKind: "incremental" }));
    observed.afterFailedSync = (await authority(ctx.operator)).replica.find((bank) => bank.bankId === bankId);
    check(observed.failedSync.state === "failed" && ctx.fault.rejected() > rejectedBefore
      && Date.parse(observed.afterFailedSync.lastAttemptAt) > Date.parse(observed.beforeFailedSync.lastAttemptAt)
      && observed.afterFailedSync.lastSuccessAt === observed.beforeFailedSync.lastSuccessAt,
    "failed outage sync did not preserve last success separately from its attempt", observed);
    observed.failedHome = await homeStep(ctx, "sync-observation", observed.afterFailedSync);
  } finally { ctx.fault.interrupt(false); }
  const status = await authority(ctx.operator);
  observed.recovery = await syncPendingBanks(ctx, status.replica);
  await waitPendingDrained(ctx.operator, 180_000);
  observed.pendingAfter = (await authority(ctx.operator)).pending;
  observed.recoveredWrite = retainedWrite(ctx, observed.chat, true);
  check(observed.recoveredWrite.nativeOperationId === observed.originalWrite.nativeOperationId, "recovery replaced the original Native operation");
  const recovered = (await authority(ctx.operator)).replica.find((bank) => bank.bankId === observed.originalWrite.bankId);
  check(Date.parse(recovered.lastSuccessAt) > Date.parse(observed.afterFailedSync.lastSuccessAt)
    && Date.parse(recovered.lastAttemptAt) > Date.parse(observed.afterFailedSync.lastAttemptAt), "recovery did not advance both sync observations", recovered);
  observed.recoveredHome = await homeStep(ctx, "sync-observation", recovered);
  ctx.outageRetain = observed.chat;
  check((await authority(ctx.operator)).authority.mode === "hindsight", "outage changed authority");
}

async function syncPendingBanks(ctx, banks) {
  const recovery = [];
  // Manual-only Banks need an explicit sync after ingestion; retain the existing bounded original-write recovery.
  const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
  try {
    const readLease = db.prepare("SELECT bank_id, run_id, owner_id, fence, expires_at FROM hindsight_replica_sync_leases WHERE bank_id = ?");
    const progress = db.prepare("SELECT native_cursor, state_cursor, checkpoint_hash FROM hindsight_application_replica_checkpoints WHERE bank_id = ?");
    for (const bank of banks) {
      const started = Date.now();
      // Bound when another explicit attempt may start; each attempt keeps the product's own 60s deadline.
      const leaseDeadline = started + 180_000;
      let operation; let syncAttempts = 0; const attempts = [];
      let checkpointAdvanced = false;
      do {
        if (syncAttempts++) await sleep(2_000);
        for (;;) {
          const lease = readLease.get(bank.bankId);
          if (!lease || Date.parse(lease.expires_at) <= Date.now()) break;
          check(Date.now() < leaseDeadline, "replica Bank lease did not release", lease);
          await sleep(500);
        }
        const before = progress.get(bank.bankId) ?? null;
        const beforeSchedule = (await authority(ctx.operator)).replica.find((row) => row.bankId === bank.bankId);
        operation = await submit(ctx.operator, { kind: "replica.sync", bankId: bank.bankId, syncKind: "incremental" });
        const after = progress.get(bank.bankId) ?? null;
        let waitingSchedule = null;
        if (operation.state === "waiting") {
          waitingSchedule = (await authority(ctx.operator)).replica.find((row) => row.bankId === bank.bankId);
          check(operation.errorCode === null && waitingSchedule.mode === "waiting"
            && waitingSchedule.consecutiveFailures === beforeSchedule.consecutiveFailures
            && waitingSchedule.lastSuccessAt === beforeSchedule.lastSuccessAt,
          "waiting changed real failure history or invented success", { beforeSchedule, waitingSchedule, operation: brief(operation) });
        }
        attempts.push({ ...brief(operation), before, after, waitingSchedule });
        checkpointAdvanced = before !== null && after !== null
          && (after.native_cursor > before.native_cursor || after.state_cursor > before.state_cursor);
      } while ((operation.state === "waiting"
        || ["HINDSIGHT_PENDING_REMAINS", "HINDSIGHT_REPLICA_BUSY", "HINDSIGHT_TIMEOUT"].includes(operation.errorCode)
        || (operation.errorCode === "HINDSIGHT_DEADLINE_EXCEEDED" && checkpointAdvanced)) && Date.now() < leaseDeadline);
      recovery.push({ ...brief(operation), elapsedMs: Date.now() - started, syncAttempts, attempts });
      check(operation.state === "completed", "pending recovery sync failed", brief(operation));
    }
  } finally { db.close(); }
  return recovery;
}

async function stepDrift(ctx, observed) {
  const { operator } = ctx;
  const before = await setupStatus(operator);
  const beforeStatus = await authority(operator);
  await operator.call(shared.CONFIG_METHODS.set, { key: "TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", value: 15_000 });
  const drifted = await authority(operator);
  observed.drift = { connection: drifted.hindsight?.connection, runtime: drifted.runtime, actions: drifted.hindsight?.actions };
  check(drifted.hindsight?.connection.drift === "config_changed" || drifted.runtime.unavailableReason === "config_changed",
    "timeout change did not surface config_changed", observed.drift);
  const operation = await submit(operator, { kind: "connection.revalidate", expectedEpochId: ctx.epochId });
  observed.revalidate = brief(operation);
  check(operation.state === "completed", "connection.revalidate did not complete", observed.revalidate);
  const after = await setupStatus(operator);
  const afterStatus = await authority(operator);
  observed.fingerprint = { before: before.configFingerprint, after: after.configFingerprint };
  observed.runtime = afterStatus.runtime;
  observed.connection = afterStatus.hindsight?.connection;
  observed.banksUnchanged = JSON.stringify(before.banks) === JSON.stringify(after.banks)
    && JSON.stringify(bankView(beforeStatus)) === JSON.stringify(bankView(afterStatus));
  check(afterStatus.runtime.available && before.configFingerprint !== after.configFingerprint, "runtime not available on a new fingerprint", observed);
  check(observed.banksUnchanged, "a Bank row changed during revalidation", { before: before.banks, after: after.banks });
  ctx.preRestart = { authority: afterStatus, operations: await listOperations(operator) };
}

async function stepRestart(ctx, observed) {
  ctx.operator.close();
  const exit = await stopCore(ctx.core);
  ctx.coreExits.push(exit);
  ctx.core = null;
  observed.firstExit = { code: exit.code, signal: exit.signal, forced: exit.forced };
  check(exit.code === 0 && !exit.forced, "Core did not exit cleanly", exit);
  const offset = nativeLogSize(ctx.native);
  ctx.core = await bootCore({ ...ctx.coreOptions, logFile: join(ctx.root, "core-2.log") });
  ctx.spawned.push(ctx.core.pid);
  ctx.operator = await openOperator(ctx.corePort, "native smoke after restart");
  observed.appliedOnReboot = appliedMigrations(ctx.core);
  const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
  try { observed.migrationHead = db.prepare("SELECT max(version) AS head FROM migrations").get().head; } finally { db.close(); }
  let status;
  for (const deadline = Date.now() + 60_000; Date.now() < deadline; await sleep(500)) {
    status = await authority(ctx.operator);
    if (status.runtime.available) break;
  }
  const operations = await listOperations(ctx.operator);
  const before = ctx.preRestart;
  observed.authority = { before: before.authority.authority, after: status.authority };
  observed.runtime = status.runtime;
  observed.connection = status.hindsight?.connection;
  observed.banksStable = JSON.stringify(bankView(before.authority)) === JSON.stringify(bankView(status));
  const changed = operations.filter((row) => JSON.stringify(row) !== JSON.stringify(before.operations.find((old) => old.operationId === row.operationId)));
  observed.operationRowsChanged = changed.map(brief);
  observed.bootNativeCalls = nativeCalls(ctx.native, offset);
  check(observed.migrationHead === 63, "migrations are not at the phase-2 checkpoint head 063", observed.migrationHead);
  check(JSON.stringify(status.authority) === JSON.stringify(before.authority.authority), "authority changed across restart", observed.authority);
  check(status.runtime.available, "runtime unavailable after restart", status.runtime);
  check(observed.banksStable, "Bank readiness changed across restart", bankView(status));
  check(changed.length === 0, "an operation row was added or redispatched across restart", observed.operationRowsChanged);
  observed.outageWriteAfterRestart = retainedWrite(ctx, ctx.outageRetain, true);
}

async function stepSyncDuringHome(ctx, observed) {
  const bank = (await authority(ctx.operator)).replica.find((row) => row.scope === "global");
  const original = { automatic: bank.automatic, autoIntervalMs: bank.autoIntervalMs,
    fullReconciliationIntervalMs: bank.fullReconciliationIntervalMs };
  check(!bank.automatic && bank.run === null, "held sync needs an idle manual Bank", bank);
  const intervalMinutes = bank.autoIntervalMs / 60_000 + 1;
  let gate;
  let operationId;
  let failed = false;
  try {
    observed.home = await homeStep(ctx, "sync-during-home", { bankId: bank.bankId, intervalMinutes }, async () => {
      gate = ctx.fault.holdApplicationState(bank.bankId);
      const admitted = shared.MemoryOperationSubmitResultSchema.parse(await ctx.operator.call(shared.MEMORY_OPERATION_METHODS.submit,
        { request: { kind: "replica.sync", bankId: bank.bankId, syncKind: "incremental" } })).operation;
      operationId = admitted.operationId;
      observed.admitted = brief(admitted);
      for (const deadline = Date.now() + 15_000; gate.snapshot().pending === 0 && Date.now() < deadline; await sleep(25)) {}
      observed.holdBefore = gate.snapshot();
      const operation = await operationStatus(ctx.operator, operationId);
      const running = (await authority(ctx.operator)).replica.find((row) => row.bankId === bank.bankId);
      check(observed.holdBefore.pending > 0 && observed.holdBefore.responses.every((row) => row.statusCode === 200)
        && operation.state === "running" && running.run !== null, "sync was not running with a held real Native response", { operation, running, hold: observed.holdBefore });
      observed.runningBefore = { operation: brief(operation), bank: running };
      return { bankId: bank.bankId, operationId, runId: running.run.lease.runId };
    });
    const operation = await operationStatus(ctx.operator, operationId);
    const after = (await authority(ctx.operator)).replica.find((row) => row.bankId === bank.bankId);
    observed.runningAfter = { operation: brief(operation), bank: after };
    observed.holdAfter = gate.snapshot();
    check(operation.state === "running" && after.run?.lease.runId === observed.runningBefore.bank.run.lease.runId
      && observed.holdAfter.pending > 0 && observed.holdAfter.responses.every((row) => row.abortedAt === null),
    "sync finished, restarted or timed out before Home completed", observed);
    check(after.autoIntervalMs === intervalMinutes * 60_000, "Home save did not reach Core while sync was running", after);
    gate.release();
    observed.completed = brief(await awaitOperation(ctx.operator, operationId));
    check(observed.completed.state === "completed", "held sync failed after release", observed.completed);
    observed.persisted = (await authority(ctx.operator)).replica.find((row) => row.bankId === bank.bankId);
    check(observed.persisted.autoIntervalMs === intervalMinutes * 60_000
      && observed.persisted.automatic === original.automatic
      && observed.persisted.fullReconciliationIntervalMs === original.fullReconciliationIntervalMs,
    "sync completion lost or altered Home's saved setting", observed.persisted);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    gate?.release();
    observed.holdFinal = gate?.snapshot() ?? null;
    // A wedged Core is the failure under test; a cleanup timeout must not replace that first failure.
    try {
      await ctx.operator.call(shared.MEMORY_REPLICA_METHODS.configure, { bankId: bank.bankId, config: original });
      observed.restored = (await authority(ctx.operator)).replica.find((row) => row.bankId === bank.bankId);
      check(Object.entries(original).every(([key, value]) => observed.restored[key] === value), "held sync did not restore settings", observed.restored);
    } catch (error) {
      observed.restoreError = error.message;
      if (!failed) throw error;
    }
  }
}

function assertOriginalPending(write) {
  check(write.parentState === "pending" && ["queued", "submitted", "awaiting_derived", "awaiting_pull"].includes(write.childPhase),
    "original parent/child are not Pending", write);
}

async function stepPendingRestart(ctx, observed) {
  const bank = (await authority(ctx.operator)).replica.find((row) => row.scope === "global");
  const original = { automatic: bank.automatic, autoIntervalMs: bank.autoIntervalMs,
    fullReconciliationIntervalMs: bank.fullReconciliationIntervalMs };
  const rejectedBefore = ctx.fault.rejected();
  let failed = false;
  ctx.fault.interrupt(true);
  try {
    // Enable the existing automatic recovery path; no explicit sync or retain replay occurs in this step.
    await ctx.operator.call(shared.MEMORY_REPLICA_METHODS.configure,
      { bankId: bank.bankId, config: { ...original, automatic: true, autoIntervalMs: 60_000 } });
    observed.chat = await retainedChat(ctx, "[retain] I keep a silver compass in my desk during the restart fixture.");
    ctx.runs.push({ label: "pending-restart", ...observed.chat });
    check(observed.chat.retain.data.status === "pending", "faulted retain did not return Pending", observed.chat.retain);
    observed.originalWrite = pendingWriteEvidence(ctx, observed.chat);
    assertOriginalPending(observed.originalWrite);
    check(observed.originalWrite.identity.parent.bankId === bank.bankId, "restart retain used another Bank", observed.originalWrite);
    observed.rejectedWrites = ctx.fault.rejected() - rejectedBefore;
    check(observed.rejectedWrites > 0, "restart fault never reached a Native retain POST");
    observed.nativeBefore = await nativeWriteEvidence(ctx, observed.originalWrite);
    check(observed.nativeBefore.documents.length === 0 && observed.nativeBefore.facts.length === 0
      && observed.nativeBefore.operations.length === 0, "faulted request already applied at Native", observed.nativeBefore);
    const beforeAuthority = (await authority(ctx.operator)).authority;
    ctx.operator.close();
    const exit = await stopCore(ctx.core);
    ctx.coreExits.push(exit);
    ctx.core = null;
    observed.exit = { code: exit.code, signal: exit.signal, forced: exit.forced };
    check(exit.code === 0 && !exit.forced, "Pending restart Core did not exit cleanly", observed.exit);
    observed.stoppedWrite = pendingWriteEvidence(ctx, observed.chat);
    assertOriginalPending(observed.stoppedWrite);
    check(JSON.stringify(observed.stoppedWrite.identity) === JSON.stringify(observed.originalWrite.identity), "shutdown replaced Pending identities", observed.stoppedWrite);
    ctx.core = await bootCore({ ...ctx.coreOptions, logFile: join(ctx.root, "core-pending-restart.log") });
    ctx.spawned.push(ctx.core.pid);
    ctx.operator = await openOperator(ctx.corePort, "native smoke Pending restart");
    let status;
    for (const deadline = Date.now() + 60_000; Date.now() < deadline; await sleep(250)) {
      status = await authority(ctx.operator);
      if (status.runtime.available) break;
    }
    check(status.runtime.available && JSON.stringify(status.authority) === JSON.stringify(beforeAuthority),
      "Pending restart changed authority or lost its runtime", status);
    observed.afterRestart = pendingWriteEvidence(ctx, observed.chat);
    assertOriginalPending(observed.afterRestart);
    check(JSON.stringify(observed.afterRestart.identity) === JSON.stringify(observed.originalWrite.identity)
      && observed.afterRestart.documentId === observed.originalWrite.documentId, "restart replaced the original Pending rows", observed.afterRestart);
    observed.pendingAfterRestart = status.pending.find((row) => row.bankId === bank.bankId);
    check(observed.pendingAfterRestart?.summary.pendingCount > 0 && observed.pendingAfterRestart.parentWritesPending > 0,
      "Core status lost the durable Pending parent/child", observed.pendingAfterRestart);
    observed.automaticAfterRestart = status.replica.find((row) => row.bankId === bank.bankId);
    check(observed.automaticAfterRestart.automatic && observed.automaticAfterRestart.autoIntervalMs === 60_000, "restart lost automatic recovery settings");
    observed.nativeAfterRestart = await nativeWriteEvidence(ctx, observed.afterRestart);
    check(JSON.stringify(observed.nativeAfterRestart) === JSON.stringify(observed.nativeBefore), "Native changed while retain remained faulted", observed.nativeAfterRestart);
    observed.providerRestoredAt = new Date().toISOString();
    ctx.fault.interrupt(false);
    const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
    try {
      // Reboot can overlap a failed scheduled attempt: allow the normal second (5-minute) backoff plus one OP_MS window.
      observed.recoveryBudgetMs = 300_000 + OP_MS;
      observed.recoveryWaitMs = await waitPendingDrained(ctx.operator, observed.recoveryBudgetMs, (current) => {
        const replica = current.replica.find((row) => row.bankId === bank.bankId);
        if (replica.run || replica.mode !== "idle") return false;
        const write = pendingWriteEvidence(ctx, observed.chat);
        if (write.parentState !== "completed" || write.childPhase !== "completed") return false;
        check(Date.parse(replica.lastSuccessAt) >= Date.parse(observed.providerRestoredAt), "no successful automatic sync after provider restoration", replica);
        observed.automaticRecovery = { ...scheduledRunEvidence(ctx, db, bank.bankId),
          lastAttemptAt: replica.lastAttemptAt, lastSuccessAt: replica.lastSuccessAt };
        return true;
      });
    } finally { db.close(); }
    observed.recoveredWrite = retainedWrite(ctx, observed.chat, true);
    observed.completedWrite = pendingWriteEvidence(ctx, observed.chat);
    check(JSON.stringify(observed.completedWrite.identity) === JSON.stringify(observed.originalWrite.identity)
      && observed.completedWrite.documentId === observed.originalWrite.documentId, "recovery replaced the original write/operation identity", observed.completedWrite);
    observed.nativeAfter = await nativeWriteEvidence(ctx, observed.completedWrite);
    const { documents, facts, operations } = observed.nativeAfter;
    check(documents.length === 1 && documents[0].id === observed.recoveredWrite.documentId
      && facts.length === 1 && facts[0].document_id === documents[0].id
      && facts[0].id === observed.recoveredWrite.replicaEffects[0].memoryId
      && operations.length === 1 && operations[0].operation_id === observed.originalWrite.identity.child.remoteOperationId
      && operations[0].bank_id === bank.bankId && operations[0].operation_kind === "retain" && operations[0].status === "completed"
      && operations[0].provider_lineage === observed.originalWrite.identity.child.providerLineageId
      && operations[0].bank_generation === observed.originalWrite.identity.child.bankGeneration,
    "Native did not apply exactly the original Source/fact and operation", observed.nativeAfter);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    ctx.fault.interrupt(false);
    if (ctx.core && ctx.operator.socket.readyState === WebSocket.OPEN) {
      try {
        await ctx.operator.call(shared.MEMORY_REPLICA_METHODS.configure, { bankId: bank.bankId, config: original });
        observed.restored = (await authority(ctx.operator)).replica.find((row) => row.bankId === bank.bankId);
        check(Object.entries(original).every(([key, value]) => observed.restored[key] === value), "Pending restart did not restore settings", observed.restored);
      } catch (error) {
        observed.restoreError = error.message;
        if (!failed) throw error;
      }
    }
  }
}

async function journey(ctx) {
  const { step } = ctx.journey;
  await step(1, "Boot native + Core; Legacy/empty", async (observed) => {
    const status = await authority(ctx.operator);
    const card = await activation(ctx.operator);
    observed.authority = status.authority;
    observed.runtime = status.runtime;
    observed.setupPhase = status.setup.phase;
    observed.activation = { authority: card.authority, run: card.run, actions: card.actions };
    check(status.authority.mode === "legacy-markdown" && status.hindsight === null && card.run === null, "not Legacy/empty", status.authority);
  });
  await step(2, "Local onboarding + retaining Run", async (observed) => {
    observed.home = await homeStep(ctx, "onboard");
    const status = await authority(ctx.operator);
    observed.authority = status.authority;
    check(status.authority.mode === "canonical-local", "marker is not canonical-local", status.authority);
    const run = await chat(ctx.operator, "taki", "[retain] My favourite colour is teal.");
    ctx.runs.push({ label: "local-retain", ...run });
    observed.chat = run;
    observed.retainToolResult = ctx.provider.log.filter((entry) => entry.kind === "main-after-tool").at(-1)?.toolResult ?? null;
    check(run.outcome === shared.CHAT_METHODS.complete, "Local chat Run failed", run);
    check(ctx.provider.log.some((entry) => entry.kind === "main-retain-call"), "the model never called retain");
  });
  await step(3, "Hindsight connection + setup.validate + setup.apply", (observed) => stepSetup(ctx, observed));
  await step(4, "hindsight.activate", (observed) => stepActivate(ctx, observed));
  await step(5, "Hindsight capture + replica.sync incremental/full + second connection", (observed) => stepCaptureAndSync(ctx, observed));
  await step("settings", "Home per-Bank settings, manual sync and second Home update", async (observed) => {
    observed.home = await homeStep(ctx, "sync");
    const status = await authority(ctx.operator);
    observed.settings = status.replica.map(({ bankId, automatic, autoIntervalMs, fullReconciliationIntervalMs }) => ({ bankId, automatic, autoIntervalMs, fullReconciliationIntervalMs }));
    check(observed.settings.some((row) => !row.automatic && row.autoIntervalMs === 17 * 60_000 && row.fullReconciliationIntervalMs === 3 * 86_400_000), "Home settings not persisted", observed.settings);
  });
  await step("schedule", "Attributable interval sync and an equivalent manual-only window", (observed) => stepScheduledSync(ctx, observed));
  await step(6, "New Character mika: degraded Run, provision, recall, ingestion", (observed) => stepNewCharacter(ctx, observed));
  await step("6b", "Probe: chat turns right after ingestion (consolidation race)", (observed) => stepPostIngestion(ctx, observed));
  await step("pending", "Interrupted retain remains pending then recovers against Native", (observed) => stepPending(ctx, observed));
  await step(7, "Timeout change -> config_changed -> connection.revalidate", (observed) => stepDrift(ctx, observed));
  await step(8, "Core restart: status stable, no redispatch", (observed) => stepRestart(ctx, observed));
  await step(9, "Home reopen and reconnect", async (observed) => { observed.home = await homeStep(ctx, "reopen"); });
  await step("sync-during-home", "Home reads and saves settings while a real Bank sync remains running", (observed) => stepSyncDuringHome(ctx, observed));
  await step("pending-restart", "Original Pending retain survives Core restart and recovers automatically once", (observed) => stepPendingRestart(ctx, observed));
  await step(10, "Explicit v2 template/default handoff", async (observed) => { observed.home = await homeStep(ctx, "template"); });
  await step("10b", "Apply latest template revision through registered operations", (observed) => stepCurrentTemplate(ctx, observed));
  if (process.argv.includes("--with-transitions")) await transitionJourney(ctx);
}

async function stepCurrentTemplate(ctx, observed) {
  const revision = TAKI_MANAGED_TEMPLATE_REVISION;
  const banks = (await authority(ctx.operator)).replica;
  const current = shared.MemoryTemplateStatusSchema.parse(await ctx.operator.call(shared.MEMORY_TEMPLATE_METHODS.status, {}));
  check(current.defaults?.globalTemplateRevision === "taki-bank-v2" && current.defaults.characterTemplateRevision === "taki-bank-v2",
    "the preceding Home handoff did not select v2", current.defaults);
  const params = { target: { kind: "defaults", globalTemplateRevision: revision, characterTemplateRevision: revision },
    enrollment: "fresh", directives: [], refresh: [] };
  const preview = shared.MemoryTemplatePreviewSchema.parse(await ctx.operator.call(shared.MEMORY_TEMPLATE_METHODS.preview, params));
  check(preview.state === "ready" && preview.banks.length === banks.length
    && preview.banks.every((bank) => bank.templateRevision === revision && bank.deletions === 0 && bank.refreshChildren === 0),
  "latest revision preview did not preserve the enrolled Banks", preview);
  observed.revision = revision;
  observed.operation = brief(await submit(ctx.operator, shared.MemoryTemplateApplyRequestSchema.parse({ kind: "template.apply",
    requestId: randomUUID(), previewId: preview.previewId, previewHash: preview.previewHash })));
  check(observed.operation.state === "completed" && observed.operation.result?.outcome === "bound", "latest template was not bound", observed.operation);
  const after = shared.MemoryTemplateStatusSchema.parse(await ctx.operator.call(shared.MEMORY_TEMPLATE_METHODS.status, {}));
  check(after.defaults?.globalTemplateRevision === revision && after.defaults.characterTemplateRevision === revision
    && after.boundSelectionIdentity !== null && after.holdPlanId === null, "latest template defaults were not selected", after);
  const readback = shared.MemoryTemplatePreviewSchema.parse(await ctx.operator.call(shared.MEMORY_TEMPLATE_METHODS.preview, params));
  check(readback.state === "ready", "latest template readback unavailable", readback);
  observed.banks = [];
  for (const bank of banks) {
    const status = shared.MemoryTemplateStatusSchema.parse(await ctx.operator.call(shared.MEMORY_TEMPLATE_METHODS.status, { bankId: bank.bankId }));
    const detail = shared.MemoryTemplateDetailSchema.parse(await ctx.operator.call(shared.MEMORY_TEMPLATE_METHODS.detail,
      { previewId: readback.previewId, previewHash: readback.previewHash, bankId: bank.bankId }));
    const mission = detail.before.config.find((item) => item.key === "retain_mission")?.stored;
    check(status.bank?.selected?.templateRevision === revision && mission?.kind === "value"
      && mission.value === loadManagedTemplate(revision, bank.scope).config.retain_mission, "latest selected/Native template mismatch", status.bank);
    observed.banks.push({ bankId: bank.bankId, selection: status.bank.selected, missionSha256: createHash("sha256").update(mission.value).digest("hex") });
  }
  ctx.templateRevision = revision;
}

function fixtureBanks(status) {
  return status.hindsight.banks.map((bank) => ({ bankId: bank.nativeBankId, scope: bank.scope, characterId: bank.characterId,
    generation: status.replica.find((replica) => replica.bankId === bank.nativeBankId)?.checkpoint?.bankGeneration }))
    .sort((left, right) => left.bankId.localeCompare(right.bankId));
}

async function backupJourney(ctx, observed) {
  observed.postTurnDrain = await settlePostTurnWrites(ctx);
  observed.home = await homeStep(ctx, "backup");
  const status = await authority(ctx.operator);
  const backup = status.hindsight.backup.lastVerified;
  check(backup !== null, "Home backup has no verified pair");
  const pairDir = join(ctx.coreOptions.dataDir, "backups", backup.backupId);
  const manifest = shared.HindsightBackupManifestSchema.parse(JSON.parse(readFileSync(join(pairDir, "manifest.json"), "utf8")));
  check(manifest.version === 2 && manifest.core.migrationHead === 63, "backup did not capture current template/Core build");
  check(manifest.authority.epochId === status.authority.epochId && manifest.verifiedAt, "backup authority or verification mismatch");
  observed.templates = manifest.templates.banks;
  check(observed.templates.length === status.hindsight.banks.length
    && observed.templates.every((bank) => bank.selected?.templateRevision === ctx.templateRevision), "backup lost the selected template revision", observed.templates);
  check(manifest.native.location === "native-host", "fixture expected the enabled Native-host route");
  const nativeArchivePath = join(ctx.root, "native-backups", manifest.native.file);
  check(existsSync(nativeArchivePath), "sealed Native ZIP missing");
  const copied = new DatabaseSync(join(pairDir, "core.sqlite"), { readOnly: true });
  try {
    const tables = copied.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'hindsight_candidate_%'").all();
    observed.candidateRows = Object.fromEntries(tables.map(({ name }) => [name, copied.prepare(`SELECT count(*) AS n FROM ${name}`).get().n]));
    check(tables.length === 5 && Object.values(observed.candidateRows).every((count) => count === 0), "candidate work entered the first-use path");
  } finally { copied.close(); }
  observed.pair = { backupId: backup.backupId, pairDir, nativeArchivePath, version: manifest.version,
    coreHead: manifest.core.migrationHead, verifiedAt: manifest.verifiedAt };
  ctx.restorePair = { pairDir, nativeArchivePath };
}

async function transitionHome(ctx, action, observed) {
  const before = await authority(ctx.operator);
  observed.home = await homeStep(ctx, action);
  const operation = (await listOperations(ctx.operator)).find((row) => row.kind === `transition.${action}`);
  check(operation?.state === "completed", "Home transition did not complete", operation && brief(operation));
  observed.operation = brief(operation);
  observed.transition = shared.MemoryTransitionReadSchema.parse(await ctx.operator.call(shared.MEMORY_TRANSITION_METHODS.status,
    { transitionId: operation.result.transitionId }));
  const after = await authority(ctx.operator);
  observed.authority = after.authority;
  check(after.authority.epochId !== before.authority.epochId && after.runtime.available, "transition did not publish a fresh ready epoch");
  check(after.authority.mode === (action === "reenter-hindsight" ? "hindsight" : "canonical-local"), "transition selected wrong authority");
  ctx.epochId = after.authority.epochId;
  return after;
}

async function transitionJourney(ctx) {
  const { step } = ctx.journey;
  const originalBanks = fixtureBanks(await authority(ctx.operator));
  const originalDefaults = (await ctx.operator.call(shared.MEMORY_TEMPLATE_METHODS.status, {})).defaults;
  await step(11, `Home captures and verifies a backup-v2 pair with ${ctx.templateRevision} at Core head063`, (observed) => backupJourney(ctx, observed));
  await step(12, "Home healthy return; Local recall and a new retained memory", async (observed) => {
    await transitionHome(ctx, "return-local", observed);
    observed.recall = await memoryChat(ctx, "[recall] blue seashells", "local", "The user said: I collect blue seashells during the fixture outage.");
    observed.retain = await memoryChat(ctx, "[retain] My isolated roundtrip keeps a copper compass.", "local");
    const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
    try {
      observed.localDelta = db.prepare("SELECT bank_id, memory_id, text FROM canonical_memory_units WHERE authority_epoch_id = ? AND state = 'valid' AND text = ?")
        .all(ctx.epochId, "The user said: My isolated roundtrip keeps a copper compass.");
      check(observed.localDelta.length === 1, "intervening Local fact was not stored exactly once", observed.localDelta);
    } finally { db.close(); }
  });
  await step(13, `Home re-entry reuses Banks and preserves selected ${ctx.templateRevision} templates`, async (observed) => {
    const after = await transitionHome(ctx, "reenter-hindsight", observed);
    observed.banks = fixtureBanks(after);
    check(JSON.stringify(observed.banks) === JSON.stringify(originalBanks), "re-entry replaced original Banks/generations");
    observed.defaults = (await ctx.operator.call(shared.MEMORY_TEMPLATE_METHODS.status, {})).defaults;
    check(JSON.stringify(observed.defaults) === JSON.stringify(originalDefaults), "re-entry changed template defaults");
    observed.templates = [];
    for (const bank of observed.banks) {
      const status = await ctx.operator.call(shared.MEMORY_TEMPLATE_METHODS.status, { bankId: bank.bankId });
      observed.templates.push({ bankId: bank.bankId, selection: status.bank?.selected });
      check(status.bank?.selected?.templateRevision === ctx.templateRevision, "re-entry lost the selected template revision");
    }
    observed.recall = await memoryChat(ctx, "[recall] copper compass", "hindsight", "The user said: My isolated roundtrip keeps a copper compass.");
  });
  await step(14, "Capture the current pair before offline takeover", (observed) => backupJourney(ctx, observed));
  await step(15, "Home emergency takeover with Native stopped", async (observed) => {
    observed.postTurnDrain = await settlePostTurnWrites(ctx);
    observed.nativeStop = await stopNative(ctx.native);
    check(observed.nativeStop.code === 0 && !observed.nativeStop.forced, "Native did not stop gracefully");
    const modelCalls = ctx.provider.log.length;
    await transitionHome(ctx, "emergency-local", observed);
    check(ctx.provider.log.length === modelCalls, "emergency takeover called a model");
    const incidentDirs = readdirSync(join(ctx.coreOptions.dataDir, "backups")).filter((name) => name.startsWith("incident-"));
    observed.incidents = incidentDirs.map((name) => ({ name,
      manifest: JSON.parse(readFileSync(join(ctx.coreOptions.dataDir, "backups", name, "manifest.json"), "utf8")) }));
    check(observed.incidents.length === 1 && observed.incidents[0].manifest.fullBackup === false, "missing distinct emergency incident");
  });
  await step(16, "Emergency Local authority survives Core restart", async (observed) => {
    const before = await authority(ctx.operator);
    ctx.operator.close(); ctx.coreExits.push(await stopCore(ctx.core));
    ctx.core = await bootCore({ ...ctx.coreOptions, logFile: join(ctx.root, "core-emergency.log") });
    ctx.spawned.push(ctx.core.pid); ctx.operator = await openOperator(ctx.corePort, "emergency reopen");
    const after = await authority(ctx.operator);
    check(JSON.stringify(after.authority) === JSON.stringify(before.authority) && after.runtime.available, "emergency authority changed at reopen");
    observed.authority = after.authority;
    observed.recall = await memoryChat(ctx, "[recall] copper compass", "local", "The user said: My isolated roundtrip keeps a copper compass.");
  });
  await step(17, "Offline paired restore and current authenticated pre-writer verification", async (observed) => {
    ctx.operator.close(); ctx.coreExits.push(await stopCore(ctx.core)); ctx.core = null;
    const { runPairedRestore } = await import("./paired-restore.mjs");
    observed.restore = await runPairedRestore({ ownedRoot: ctx.root, ...ctx.restorePair, pgPort: ctx.pg.port, sourceDatabase: "taki_smoke",
      custodyDataDir: ctx.coreOptions.dataDir, credentialsDir: ctx.coreOptions.credentialsDir, apiKey: ctx.apiKey });
    const manifest = shared.HindsightBackupManifestSchema.parse(JSON.parse(readFileSync(join(ctx.restorePair.pairDir, "manifest.json"), "utf8")));
    observed.restoredTemplates = manifest.templates.banks;
    check(observed.restore.completed && observed.restore.inputsUnchanged && observed.restoredTemplates.length === originalBanks.length
      && observed.restoredTemplates.every((bank) => bank.selected?.templateRevision === ctx.templateRevision), "verified restore lost the selected template revision");
  });
}

function sqliteEvidence(dataDir, runs) {
  const db = new DatabaseSync(join(dataDir, "taki.db"), { readOnly: true });
  try {
    const migrations = db.prepare("SELECT max(version) AS head, count(*) AS count FROM migrations").get();
    const snapshots = runs.map((run) => {
      const row = db.prepare("SELECT manifest_json FROM run_snapshots WHERE run_id = ?").get(run.runId);
      const manifest = row ? JSON.parse(row.manifest_json) : null;
      return { label: run.label, runId: run.runId, memory: manifest && findMemory(manifest) };
    });
    const commits = db.prepare(`SELECT timeline_seq, character_id, ingestion_span_id, run_id FROM hindsight_ingestion_primary_commits
      WHERE character_id = 'mika' ORDER BY timeline_seq`).all();
    const spans = db.prepare(`SELECT span_id, from_seq, through_seq, state, json_extract(gate_json,'$.decision') AS gate,
      json_array_length(receipts_json) AS receipts FROM hindsight_ingestion_spans WHERE character_id = 'mika' ORDER BY from_seq`).all();
    const degradedSeq = db.prepare("SELECT seq FROM timeline_messages WHERE character_id = 'mika' AND role = 'user' ORDER BY seq LIMIT 1").get()?.seq ?? null;
    const covering = spans.filter((span) => degradedSeq !== null && span.from_seq < degradedSeq && degradedSeq <= span.through_seq);
    return { migrations, snapshots, mika: { degradedSeq, commits: commits.slice(0, 8), commitCount: commits.length, spans, coveringSpans: covering } };
  } finally {
    db.close();
  }
}

function findMemory(value) {
  if (value === null || typeof value !== "object") return null;
  if (typeof value.providerId === "string") {
    return { providerId: value.providerId, capabilities: value.capabilities ?? null, vectorRetrieval: value.vectorRetrieval ?? null };
  }
  for (const child of Object.values(value)) {
    const found = findMemory(child);
    if (found) return found;
  }
  return null;
}

function copyEvidence(ctx, result) {
  mkdirSync(evidenceDir, { recursive: true });
  const scrub = (text) => text.replaceAll(ctx.apiKey, "<throwaway-key-redacted>");
  for (const name of readdirSync(ctx.root)) {
    if (/\.(log|jsonl)$/.test(name)) writeFileSync(join(evidenceDir, name), scrub(readFileSync(join(ctx.root, name), "utf8")), "utf8");
  }
  writeFileSync(join(evidenceDir, "provider-requests.json"), JSON.stringify(ctx.provider.log, null, 2), "utf8");
  writeFileSync(join(evidenceDir, "result.json"), scrub(JSON.stringify(result, null, 2)) + "\n", "utf8");
}

async function teardown(ctx) {
  const record = {};
  const attempt = async (label, action) => {
    try { record[label] = await action(); } catch (error) { record[label] = { error: error.message }; }
  };
  if (ctx.home) await attempt("homeClose", () => ctx.home.close());
  ctx.operator?.close();
  if (ctx.core) await attempt("coreStop", async () => {
    const exit = await stopCore(ctx.core);
    ctx.coreExits.push(exit);
    return exit;
  });
  if (ctx.fault) await attempt("faultClose", () => ctx.fault.close());
  if (ctx.native) await attempt("nativeStop", () => stopNative(ctx.native));
  if (ctx.pg?.started) await attempt("pg0Removal", () => removePg0(ctx.pg, { retain: ctx.retainPg === true }));
  await attempt("providerClose", () => ctx.provider.close().then(() => "closed"));
  await sleep(1_500);
  record.listenersOnOurPorts = listeners([ctx.nativePort, ctx.native?.port, ctx.corePort, ctx.provider.port, ctx.pg?.port].filter(Boolean));
  return record;
}

function sourceBaseline(cwd) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  const sources = [...new Set((git("diff", "--name-only", "HEAD") + git("ls-files", "--others", "--exclude-standard")).split(/\r?\n/))]
    .filter((name) => /^(packages\/|apps\/desktop\/src\/|hindsight-api-slim\/)/.test(name) && /\.(ts|tsx|py|json)$/.test(name));
  return { head: git("rev-parse", "HEAD").trim(), changedSource: sources.map((name) => ({ name,
    sha256: existsSync(join(cwd, name)) ? createHash("sha256").update(readFileSync(join(cwd, name))).digest("hex") : null })) };
}

function harnessBaseline() {
  // Keep this inventory with the imports/launchers: it includes indirect Python and archived fixture helpers.
  const paths = ["./native-smoke.mjs", "./smoke-core.mjs", "./smoke-native.mjs", "./native-fault.mjs",
    "./home-browser.mjs", "./home-check.py", "./pending-write-evidence.mjs", "./native-write-evidence.py",
    "../../../archive/2026-09/09-25-hindsight-native-smoke/research/smoke-fake-provider.mjs",
    "../../../archive/2026-09/09-25-hindsight-native-smoke/research/native_launcher.py"];
  if (process.argv.includes("--with-transitions")) paths.push("./paired-restore.mjs", "./paired-restore.py",
    "../../../09-29-hindsight-transitions-emergency/research/w6-paired-native-restore.py",
    "../../../../../packages/core/src/testing/capture-logger.ts");
  const files = paths.map((path) => fileURLToPath(new URL(path, import.meta.url)));
  if (process.argv.includes("--with-transitions")) files.push("H:/hindsight/hindsight-api-slim/tests/native_results/conftest.py");
  return { scope: "Repository harness helpers for the selected journey, including subprocess helpers; third-party packages excluded.",
    files: files.map((name) => ({ name: name.replaceAll("\\", "/"), sha256: createHash("sha256").update(readFileSync(name)).digest("hex") })) };
}

async function main() {
  const baseline = { taki: sourceBaseline("H:/TakiAgent"), native: sourceBaseline("H:/hindsight"), node: process.version,
    harness: harnessBaseline() };
  const root = mkdtempSync("G:/taki-first-use-");
  const before = { pg0Registry: listPg0Registry(), ownerTaki: listOwnerTaki(), processes: processSnapshot() };
  const apiKey = randomBytes(32).toString("base64url");
  const credentialsDir = join(root, "credentials");
  const dataDir = join(root, "core-data");
  mkdirSync(credentialsDir);
  mkdirSync(dataDir);
  writeFileSync(join(credentialsDir, "taki-secret-catalog-master-key"), randomBytes(32));
  const provider = await startFakeProvider({ watch: [DEGRADED_PHRASE], toolResultLimit: 1_048_576 });
  const nativeServicePort = await freePort([provider.port]);
  const fault = await startNativeFault(nativeServicePort);
  const nativePort = fault.port;
  const corePort = await freePort([provider.port, nativePort]);
  const ctx = { root, apiKey, provider, fault, nativePort, corePort, runs: [], coreExits: [], spawned: [] };
  ctx.journey = createJourney(ctx);
  console.log(`[smoke] temp root ${root}`);
  let fatal = null;
  let sqlite = null;
  try {
    ctx.pg = startPg0(root, await freePort([provider.port, nativePort, corePort]));
    const spawnedAt = Date.now();
    ctx.native = spawnNative({ root, pgPort: ctx.pg.port, port: nativeServicePort, apiKey });
    ctx.nativeBootMs = await awaitNativeHealth(ctx.native) - spawnedAt;
    ctx.spawned.push(ctx.native.pid, ...descendants(ctx.native.pid).map((entry) => entry.pid));
    ctx.coreOptions = { script, dataDir, credentialsDir, port: corePort, providerPort: provider.port, nativePort };
    ctx.core = await bootCore({ ...ctx.coreOptions, logFile: join(root, "core-1.log") });
    ctx.spawned.push(ctx.core.pid);
    ctx.firstApplied = appliedMigrations(ctx.core);
    ctx.operator = await openOperator(corePort, "native smoke");
    await ctx.operator.call(shared.MEMORY_OPERATION_METHODS.subscribe);
    ctx.home = await startHome(corePort, root);
    await journey(ctx);
  } catch (error) {
    if (error.ownedPg) ctx.pg = error.ownedPg;
    fatal = { message: error.message, stack: error.stack };
    console.log(`[smoke] FATAL ${error.message}`);
  } finally {
    const nativeTotals = ctx.native ? nativeCalls(ctx.native) : null;
    const egress = ctx.native ? nativeEgress(ctx.native) : null;
    ctx.retainPg = fatal !== null && process.argv.includes("--retain-on-failure");
    const teardownRecord = await teardown(ctx);
    try { sqlite = existsSync(join(dataDir, "taki.db")) ? sqliteEvidence(dataDir, ctx.runs) : null; } catch (error) { sqlite = { error: error.message }; }
    const after = { pg0Registry: listPg0Registry(), ownerTaki: listOwnerTaki(), processes: processSnapshot() };
    const beforePids = new Set(before.processes.map((entry) => entry.pid));
    const spawnedPids = ctx.spawned;
    const newPids = after.processes.filter((entry) => !beforePids.has(entry.pid) && entry.pid !== process.pid);
    await sleep(5_000);
    const result = {
      ownedRoot: root, baseline,
      status: fatal ? "fatal" : ctx.journey.steps.every((entry) => entry.status === "passed") ? "passed" : "failed",
      fatal, steps: ctx.journey.steps, nativeBootMs: ctx.nativeBootMs ?? null, firstBootApplied: ctx.firstApplied ?? null, sqlite,
      isolation: {
        pg0: ctx.pg && { name: ctx.pg.name, dataDirUnderTemp: resolve(ctx.pg.dataDir) === resolve(root, "pg-data"), port: ctx.pg.port },
        ports: { native: nativePort, core: corePort, provider: provider.port, policy: portPolicy([nativePort, corePort]) },
        pg0RegistryBefore: before.pg0Registry, pg0RegistryAfter: after.pg0Registry,
        pg0RegistryUnchanged: JSON.stringify(before.pg0Registry) === JSON.stringify(after.pg0Registry),
        ownerTakiUnchanged: JSON.stringify(before.ownerTaki) === JSON.stringify(after.ownerTaki), ownerTakiBefore: before.ownerTaki,
      },
      network: { nativeRefused: egress, coreEgress: ctx.coreExits.map((exit) => exit.egress),
        providerRequests: provider.log.length, providerUnexpectedPaths: provider.log.filter((entry) => entry.kind === "unexpected-path").length },
      nativeTotals,
      nativeRequestAttribution: "Primary native.log access completions within each step's byte offsets; separate paired-restore Native log excluded.",
      teardown: { ...teardownRecord, coreExits: ctx.coreExits.map(({ code, signal, forced }) => ({ code, signal, forced })),
        spawnedPids, spawnedStillRunning: running(spawnedPids),
        newProcessesAfter: newPids, newProcessesStillRunningAfter5s: running(newPids.map((entry) => entry.pid)),
        processesBefore: before.processes },
    };
    copyEvidence(ctx, result);
    // Retain only this owned run directory for diagnosis; no recursive deletion in this adaptation.
    result.teardown.tempRootRetained = existsSync(root);
    writeFileSync(join(evidenceDir, "result.json"), JSON.stringify(result, null, 2).replaceAll(apiKey, "<throwaway-key-redacted>") + "\n", "utf8");
    process.exitCode = result.status === "passed" ? 0 : 1;
    console.log(`[smoke] result ${result.status}; evidence ${evidenceDir}`);
    for (const entry of ctx.journey.steps) console.log(`[smoke]   ${entry.id} ${entry.status} ${entry.error?.message ?? ""}`);
  }
}

if (process.argv.includes("--core-child")) await runCoreChild(); else await main();
