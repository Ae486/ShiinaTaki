/**
 * INPUT:  the current checkout, the read-only patched native checkout (H:/hindsight), a fresh temp root; no network, no
 *         real model, no owner data
 * OUTPUT: the R4 journey (Legacy -> Local -> Hindsight setup/activation -> capture + replica.sync -> new Character
 *         provisioning + recall + ingestion -> post-ingestion turn probe -> config drift + revalidate -> Core restart) over the
 *         real WS RPC surface against a throwaway native instance; evidence/ (result.json + scrubbed logs) next to this
 *         script; full teardown
 * POS:    09-25-hindsight-native-smoke verification harness — rerun with `node native-smoke.mjs` from any cwd
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import * as shared from "../../../../packages/shared/src/index.ts";
import { appliedMigrations, bootCore, openOperator, runCoreChild, stopCore } from "./smoke-core.mjs";
import { startFakeProvider } from "./smoke-fake-provider.mjs";
import {
  freePort, listOwnerTaki, listPg0Registry, listeners, nativeCalls, nativeEgress, nativeLogSize, portPolicy, processSnapshot,
  awaitNativeHealth, descendants, removePg0, running, spawnNative, startPg0, stopNative,
} from "./smoke-native.mjs";

const script = fileURLToPath(import.meta.url);
const evidenceDir = fileURLToPath(new URL("./evidence/", import.meta.url));
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
    const started = Date.now();
    const entry = { id, title, status: "passed", observed: {}, error: null };
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
    entry.nativeCalls = ctx.native ? nativeCalls(ctx.native, offset) : null;
    entry.providerRequests = ctx.provider.log.slice(providerStart).map(({ kind, model, tools, range, answer }) => ({ kind, model, tools, range, answer }));
    return entry.status === "passed";
  };
  return { steps, step };
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

async function onboardLocal(operator, observed) {
  const preview = shared.MemoryOnboardingPreviewResultSchema.parse(await operator.call(shared.MEMORY_ONBOARDING_METHODS.preview));
  const prepared = await submit(operator, { kind: "local.onboard.prepare", source: { mode: "new", previewId: preview.reportId } });
  check(prepared.state === "completed", "local.onboard.prepare did not complete", brief(prepared));
  const activated = await submit(operator, { kind: "local.onboard.activate", runId: prepared.producer.runId });
  check(activated.state === "completed", "local.onboard.activate did not complete", brief(activated));
  observed.onboarding = [brief(prepared), brief(activated)];
}

async function stepSetup(ctx, observed) {
  const { operator } = ctx;
  const secret = await operator.call(shared.SECRET_METHODS.set, { secretRef: API_KEY_REF, value: ctx.apiKey });
  observed.secret = { secretRef: secret.secretRef, present: secret.present, health: secret.health, source: secret.provenance?.source };
  for (const [key, value] of [["TAKI_HINDSIGHT_ENDPOINT", `http://127.0.0.1:${ctx.nativePort}`], ["TAKI_HINDSIGHT_ENABLED", true]]) {
    await operator.call(shared.CONFIG_METHODS.set, { key, value });
  }
  const before = await setupStatus(operator);
  const validated = await submit(operator, { kind: "setup.validate", expectedRevision: before.revision });
  observed.validate = brief(validated);
  check(validated.state === "completed", "setup.validate did not complete", brief(validated));
  const mid = await setupStatus(operator);
  const applied = await submit(operator, { kind: "setup.apply", expectedRevision: mid.revision, characterId: "taki" });
  observed.apply = brief(applied);
  check(applied.state === "completed", "setup.apply did not complete", brief(applied));
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
  const operation = await submit(operator, { kind: "hindsight.activate",
    source: { mode: "new", setupRevision: ctx.setupRevision, expectedEpochId: local.authority.epochId } }, ACTIVATE_MS);
  observed.operation = brief(operation);
  check(operation.state === "completed" && operation.result?.outcome === "activated", "hindsight.activate did not activate", brief(operation));
  const status = await authority(operator);
  const after = await activation(operator);
  observed.authority = status.authority;
  observed.runtime = status.runtime;
  observed.card = { run: after.run && { phase: after.run.phase, status: after.run.status, receipt: after.run.receipt }, operation: after.operation?.state,
    actions: after.actions };
  check(status.authority.mode === "hindsight" && status.runtime.available, "runtime is not Hindsight/available", status.runtime);
  check(after.operation === null || TERMINAL.has(after.operation.state), "activation status is not terminal", after.operation);
  ctx.epochId = status.authority.epochId;
}

async function stepCaptureAndSync(ctx, observed) {
  const { operator } = ctx;
  const run = await chat(operator, "taki", "[retain] I live in a lighthouse by the sea.");
  observed.chat = run;
  ctx.runs.push({ label: "hindsight-capture", ...run });
  check(run.outcome === shared.CHAT_METHODS.complete, "Hindsight chat Run failed", run);
  // replica.sync refuses with HINDSIGHT_PENDING_REMAINS while a retained write is not yet native-confirmed.
  observed.pendingWaitMs = await waitPendingDrained(operator, 180_000);
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

async function waitPendingDrained(operator, budget) {
  const started = Date.now();
  for (const deadline = started + budget; Date.now() < deadline; await sleep(500)) {
    const { pending } = await authority(operator);
    if (pending?.every((bank) => bank.summary.pendingCount === 0 && bank.parentWritesPending === 0)) return Date.now() - started;
  }
  throw new Error("pending writes did not drain");
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
  let provision = await waitProvision(operator, "mika");
  observed.automaticProvision = provision && { trigger: provision.trigger, ...brief(provision.operation) };
  if (!provision || provision.operation.state !== "completed") {
    // A failed automatic attempt is never retried automatically (once-guard); the operator action is the recovery path.
    provision = { operation: await submit(operator, { kind: "bank.provision", characterId: "mika" }), trigger: "operator" };
  }
  observed.provision = { trigger: provision.trigger, ...brief(provision.operation) };
  check(provision.operation.state === "completed", "bank.provision did not complete", observed.provision);
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
  check(observed.migrationHead === 50, "migrations are not at head 050", observed.migrationHead);
  check(JSON.stringify(status.authority) === JSON.stringify(before.authority.authority), "authority changed across restart", observed.authority);
  check(status.runtime.available, "runtime unavailable after restart", status.runtime);
  check(observed.banksStable, "Bank readiness changed across restart", bankView(status));
  check(changed.length === 0, "an operation row was added or redispatched across restart", observed.operationRowsChanged);
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
    await onboardLocal(ctx.operator, observed);
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
  await step(6, "New Character mika: degraded Run, provision, recall, ingestion", (observed) => stepNewCharacter(ctx, observed));
  await step("6b", "Probe: chat turns right after ingestion (consolidation race)", (observed) => stepPostIngestion(ctx, observed));
  await step(7, "Timeout change -> config_changed -> connection.revalidate", (observed) => stepDrift(ctx, observed));
  await step(8, "Core restart: status stable, no redispatch", (observed) => stepRestart(ctx, observed));
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
  rmSync(evidenceDir, { recursive: true, force: true });
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
  ctx.operator?.close();
  if (ctx.core) await attempt("coreStop", async () => {
    const exit = await stopCore(ctx.core);
    ctx.coreExits.push(exit);
    return exit;
  });
  if (ctx.native) await attempt("nativeStop", () => stopNative(ctx.native));
  if (ctx.pg?.started) await attempt("pg0Removal", () => removePg0(ctx.pg));
  await attempt("providerClose", () => ctx.provider.close().then(() => "closed"));
  await sleep(1_500);
  record.listenersOnOurPorts = listeners([ctx.nativePort, ctx.corePort, ctx.provider.port, ctx.pg?.port].filter(Boolean));
  return record;
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "taki-native-smoke-"));
  const before = { pg0Registry: listPg0Registry(), ownerTaki: listOwnerTaki(), processes: processSnapshot() };
  const apiKey = randomBytes(32).toString("base64url");
  const credentialsDir = join(root, "credentials");
  const dataDir = join(root, "core-data");
  mkdirSync(credentialsDir);
  mkdirSync(dataDir);
  writeFileSync(join(credentialsDir, "taki-secret-catalog-master-key"), randomBytes(32));
  const provider = await startFakeProvider({ watch: [DEGRADED_PHRASE] });
  const nativePort = await freePort([provider.port]);
  const corePort = await freePort([provider.port, nativePort]);
  const ctx = { root, apiKey, provider, nativePort, corePort, runs: [], coreExits: [], spawned: [] };
  ctx.journey = createJourney(ctx);
  console.log(`[smoke] temp root ${root}`);
  let fatal = null;
  let sqlite = null;
  try {
    ctx.pg = startPg0(root, await freePort([provider.port, nativePort, corePort]));
    const spawnedAt = Date.now();
    ctx.native = spawnNative({ root, pgPort: ctx.pg.port, port: nativePort, apiKey });
    ctx.nativeBootMs = await awaitNativeHealth(ctx.native) - spawnedAt;
    ctx.spawned.push(ctx.native.pid, ...descendants(ctx.native.pid).map((entry) => entry.pid));
    ctx.coreOptions = { script, dataDir, credentialsDir, port: corePort, providerPort: provider.port, nativePort };
    ctx.core = await bootCore({ ...ctx.coreOptions, logFile: join(root, "core-1.log") });
    ctx.spawned.push(ctx.core.pid);
    ctx.firstApplied = appliedMigrations(ctx.core);
    ctx.operator = await openOperator(corePort, "native smoke");
    await ctx.operator.call(shared.MEMORY_OPERATION_METHODS.subscribe);
    await journey(ctx);
  } catch (error) {
    fatal = { message: error.message, stack: error.stack };
    console.log(`[smoke] FATAL ${error.message}`);
  } finally {
    const nativeTotals = ctx.native ? nativeCalls(ctx.native) : null;
    const egress = ctx.native ? nativeEgress(ctx.native) : null;
    const teardownRecord = await teardown(ctx);
    try { sqlite = existsSync(join(dataDir, "taki.db")) ? sqliteEvidence(dataDir, ctx.runs) : null; } catch (error) { sqlite = { error: error.message }; }
    const after = { pg0Registry: listPg0Registry(), ownerTaki: listOwnerTaki(), processes: processSnapshot() };
    const beforePids = new Set(before.processes.map((entry) => entry.pid));
    const spawnedPids = ctx.spawned;
    const newPids = after.processes.filter((entry) => !beforePids.has(entry.pid) && entry.pid !== process.pid);
    await sleep(5_000);
    const result = {
      status: fatal ? "fatal" : ctx.journey.steps.every((entry) => entry.status === "passed") ? "passed" : "failed",
      fatal, steps: ctx.journey.steps, nativeBootMs: ctx.nativeBootMs ?? null, firstBootApplied: ctx.firstApplied ?? null, sqlite,
      isolation: {
        pg0: ctx.pg && { name: ctx.pg.name, dataDirUnderTemp: ctx.pg.dataDir.startsWith(root), port: ctx.pg.port },
        ports: { native: nativePort, core: corePort, provider: provider.port, policy: portPolicy([nativePort, corePort]) },
        pg0RegistryBefore: before.pg0Registry, pg0RegistryAfter: after.pg0Registry,
        pg0RegistryUnchanged: JSON.stringify(before.pg0Registry) === JSON.stringify(after.pg0Registry),
        ownerTakiUnchanged: JSON.stringify(before.ownerTaki) === JSON.stringify(after.ownerTaki), ownerTakiBefore: before.ownerTaki,
      },
      network: { nativeRefused: egress, coreEgress: ctx.coreExits.map((exit) => exit.egress),
        providerRequests: provider.log.length, providerUnexpectedPaths: provider.log.filter((entry) => entry.kind === "unexpected-path").length },
      nativeTotals,
      teardown: { ...teardownRecord, coreExits: ctx.coreExits.map(({ code, signal, forced }) => ({ code, signal, forced })),
        spawnedPids, spawnedStillRunning: running(spawnedPids),
        newProcessesAfter: newPids, newProcessesStillRunningAfter5s: running(newPids.map((entry) => entry.pid)),
        processesBefore: before.processes },
    };
    copyEvidence(ctx, result);
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 1_000 });
    result.teardown.tempRootRemoved = !existsSync(root);
    writeFileSync(join(evidenceDir, "result.json"), JSON.stringify(result, null, 2).replaceAll(apiKey, "<throwaway-key-redacted>") + "\n", "utf8");
    console.log(`[smoke] result ${result.status}; evidence ${evidenceDir}`);
    for (const entry of ctx.journey.steps) console.log(`[smoke]   ${entry.id} ${entry.status} ${entry.error?.message ?? ""}`);
  }
}

if (process.argv.includes("--core-child")) await runCoreChild(); else await main();
