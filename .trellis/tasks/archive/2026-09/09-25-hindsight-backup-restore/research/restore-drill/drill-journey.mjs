/**
 * INPUT:  an open operator client (smoke-core.mjs openOperator) and the drill context (throwaway API key, endpoint port)
 * OUTPUT: the operator journey helpers the drill reuses from the archived native-smoke orchestrator: status reads, operation
 *         submit/await, chat, Local onboarding, Hindsight setup + activation, and compact views
 * POS:    09-25-hindsight-backup-restore W6 drill — the native-smoke journey helpers lifted out of its orchestrator
 */
import * as shared from "../../../../../packages/shared/src/index.ts";

export const API_KEY_REF = "memory.hindsight.connection.api-key";
const OP_MS = 300_000;
const ACTIVATE_MS = 600_000;
const CHAT_MS = 180_000;
const TERMINAL = new Set(shared.MEMORY_OPERATION_TERMINAL_STATES);
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function check(condition, message, detail) {
  if (!condition) throw Object.assign(new Error(message), { detail });
}

export async function authority(operator) {
  return shared.MemoryAuthorityStatusSchema.parse(await operator.call(shared.MEMORY_AUTHORITY_METHODS.status));
}
export async function activation(operator) {
  return shared.MemoryActivationStatusSchema.parse(await operator.call(shared.MEMORY_ACTIVATION_METHODS.status));
}
export async function setupStatus(operator) {
  return shared.HindsightStatusResultSchema.parse(await operator.call(shared.HINDSIGHT_METHODS.status));
}
export async function operationStatus(operator, operationId) {
  return shared.MemoryOperationStatusResultSchema.parse(await operator.call(shared.MEMORY_OPERATION_METHODS.status, { operationId })).operation;
}
export async function listOperations(operator) {
  return shared.MemoryOperationListResultSchema.parse(await operator.call(shared.MEMORY_OPERATION_METHODS.list, { includeTerminal: true, limit: 50 })).operations;
}

export async function awaitOperation(operator, operationId, budget = OP_MS) {
  for (const deadline = Date.now() + budget; Date.now() < deadline; await sleep(250)) {
    const operation = await operationStatus(operator, operationId);
    if (TERMINAL.has(operation.state)) return operation;
  }
  throw new Error(`operation deadline: ${operationId}`);
}

export async function submit(operator, request, budget) {
  const admitted = shared.MemoryOperationSubmitResultSchema.parse(await operator.call(shared.MEMORY_OPERATION_METHODS.submit, { request })).operation;
  return awaitOperation(operator, admitted.operationId, budget);
}

export function brief(operation) {
  const producer = operation.producer;
  return { operationId: operation.operationId, kind: operation.kind, state: operation.state, reason: operation.reason,
    errorCode: operation.errorCode, result: operation.result,
    producer: producer && "phase" in producer ? { kind: producer.kind, phase: producer.phase, origin: producer.origin } : producer?.kind ?? null };
}

export async function chat(operator, characterId, message) {
  const started = Date.now();
  const sent = shared.ChatSendResultSchema.parse(await operator.call(shared.CHAT_METHODS.send, { characterId, message }, CHAT_MS));
  const ackMs = Date.now() - started;
  const note = await operator.waitNotification((entry) => (entry.method === shared.CHAT_METHODS.complete || entry.method === shared.CHAT_METHODS.error)
    && entry.params?.messageId === sent.messageId, CHAT_MS);
  let run;
  for (const deadline = Date.now() + CHAT_MS; Date.now() < deadline; await sleep(200)) {
    run = shared.RunStatusResultSchema.parse(await operator.call(shared.RUN_METHODS.status, { runId: sent.runId })).run;
    if (["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"].includes(run.state)) break;
  }
  return { runId: sent.runId, messageId: sent.messageId, ackMs, totalMs: Date.now() - started, outcome: note.method,
    error: note.method === shared.CHAT_METHODS.error ? { code: note.params.code, message: note.params.message } : null, runState: run?.state };
}

export function bankView(status) {
  return status.hindsight?.banks.map(({ scope, characterId, nativeBankId, readiness, errorCode }) => ({ scope, characterId, nativeBankId, readiness, errorCode }));
}

export async function onboardLocal(operator, observed) {
  const preview = shared.MemoryOnboardingPreviewResultSchema.parse(await operator.call(shared.MEMORY_ONBOARDING_METHODS.preview));
  const prepared = await submit(operator, { kind: "local.onboard.prepare", source: { mode: "new", previewId: preview.reportId } });
  check(prepared.state === "completed", "local.onboard.prepare did not complete", brief(prepared));
  const activated = await submit(operator, { kind: "local.onboard.activate", runId: prepared.producer.runId });
  check(activated.state === "completed", "local.onboard.activate did not complete", brief(activated));
  observed.onboarding = [brief(prepared), brief(activated)];
}

export async function setupHindsight(ctx, observed) {
  const { operator } = ctx;
  const secret = await operator.call(shared.SECRET_METHODS.set, { secretRef: API_KEY_REF, value: ctx.apiKey });
  observed.secret = { secretRef: secret.secretRef, present: secret.present, health: secret.health };
  for (const [key, value] of [["TAKI_HINDSIGHT_ENDPOINT", `http://127.0.0.1:${ctx.endpointPort}`], ["TAKI_HINDSIGHT_ENABLED", true]]) {
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
  observed.setup = { phase: after.phase, revision: after.revision, banks: after.banks };
  check(after.phase === "configured", "setup is not configured", after);
  ctx.setupRevision = after.revision;
}

export async function activateHindsight(ctx, observed) {
  const { operator } = ctx;
  const local = await authority(operator);
  const operation = await submit(operator, { kind: "hindsight.activate",
    source: { mode: "new", setupRevision: ctx.setupRevision, expectedEpochId: local.authority.epochId } }, ACTIVATE_MS);
  observed.operation = brief(operation);
  check(operation.state === "completed" && operation.result?.outcome === "activated", "hindsight.activate did not activate", brief(operation));
  const status = await authority(operator);
  observed.authority = status.authority;
  observed.runtime = status.runtime;
  check(status.authority.mode === "hindsight" && status.runtime.available, "runtime is not Hindsight/available", status.runtime);
  ctx.epochId = status.authority.epochId;
}
