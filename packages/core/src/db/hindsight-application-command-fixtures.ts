/**
 * INPUT:  synthetic command values and an owned temporary SQLite path
 * OUTPUT: real command repositories plus an immutable, typed in-memory D77 transport fixture
 * POS:    core/db tests only — no production authority, network, model or original user data
 */
import { randomUUID } from "node:crypto";
import type { TakiApplicationCommand, TakiApplicationCommitRequest, TakiApplicationCommitReceipt,
  TakiApplicationBodyRef, TakiApplicationBodyPartReceipt, TakiApplicationBodyUploadStatus,
  TakiApplicationFailureCode, TakiApplicationNamespace, JsonValue } from "@taki/shared";
import { openDatabase } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { hindsightApplicationCommandsMigration044 } from "./migrations/044-hindsight-application-commands.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createHindsightApplicationCommandRepo } from "./hindsight-application-command-repo.ts";
import type { HindsightApplicationCommandGuard, HindsightApplicationCommandJob } from "./hindsight-application-command-contract.ts";
import { applicationCommandList } from "./hindsight-application-command-contract.ts";
import { APPLICATION_TEST_AT, APPLICATION_TEST_SCOPE, applicationTestBody } from "../testing/hindsight-application-fixtures.ts";
import { HindsightApplicationRefusal, type HindsightApplicationClient } from "../memory/hindsight/hindsight-application-client.ts";
import { decodeHindsightApplicationBody, hindsightApplicationBytesHash, hindsightApplicationHash, sameApplicationValue,
  withoutApplicationHash, type HindsightApplicationBody, type HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import { applicationCommitRequest } from "../memory/hindsight/hindsight-application-body-transfer.ts";

export const APPLICATION_COMMAND_TEST_EPOCH = "application-command-epoch";
export function applicationCommandTestInput(input: { requestId?: string; content?: string; scope?: HindsightApplicationScope; intent?: JsonValue } = {}) {
  const scope = input.scope ?? APPLICATION_TEST_SCOPE;
  const body = applicationTestBody("application-block.v1", { block_id: "user-model", scope: { kind: "global", characterId: null },
    content: input.content ?? "Original block", block_revision: 1, updated_at: APPLICATION_TEST_AT, writer: "background", block_contract_version: 1 }, scope);
  const command: TakiApplicationCommand = { command: "put_artifact", key: { artifact_kind: "block", artifact_id: "user-model" },
    expected_artifact: null, body_ref: body.ref, binding: { kind: "core_block" }, expected_native: null,
    actor: { kind: "background", actor_ref: "test-policy" } };
  return { key: { authorityEpochId: APPLICATION_COMMAND_TEST_EPOCH, bankId: scope.bankId, requestId: input.requestId ?? "block-request" },
    namespace: scope.namespace, intent: input.intent ?? { kind: "block", revision: 1 }, bodies: [body],
    commands: applicationTestBody("application-commands.v1", { commands: [command] }, scope) };
}

export function applicationCommandTestRepo(path = ":memory:") {
  const db = openDatabase({ path, migrations: [...MIGRATIONS.filter((migration) => migration.version < 44), hindsightApplicationCommandsMigration044] });
  db.prepare(`INSERT OR IGNORE INTO canonical_memory_authority_epochs
    (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
    VALUES (:epoch,'hindsight',:lineage,'active',NULL,:at,NULL,'planned-switch')`)
    .run({ epoch: APPLICATION_COMMAND_TEST_EPOCH, lineage: APPLICATION_TEST_SCOPE.namespace.provider_lineage, at: APPLICATION_TEST_AT });
  db.prepare(`INSERT OR IGNORE INTO canonical_memory_authority_state(singleton,active_epoch_id,updated_at) VALUES (1,:epoch,:at)`)
    .run({ epoch: APPLICATION_COMMAND_TEST_EPOCH, at: APPLICATION_TEST_AT });
  const control = { namespace: { ...APPLICATION_TEST_SCOPE.namespace }, failWhenPrepared: false, extraGuard: undefined as ((input: HindsightApplicationCommandGuard) => void) | undefined };
  const authority = createCanonicalMemoryAuthorityRepo(db);
  const calls = { ids: 0, clocks: 0, guards: 0 };
  const assertActive = (input: HindsightApplicationCommandGuard) => {
    calls.guards++;
    const epoch = authority.authorityEpoch(input.key.authorityEpochId);
    if (epoch.providerId !== "hindsight" || epoch.providerLineageId !== input.namespace.provider_lineage
      || !sameApplicationValue(input.namespace, control.namespace)) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    if (control.failWhenPrepared && db.prepare("SELECT 1 AS present FROM hindsight_application_command_jobs LIMIT 1").get()) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    control.extraGuard?.(input);
  };
  const repo = createHindsightApplicationCommandRepo({ db, assertActive,
    operationId: () => { calls.ids++; return randomUUID(); }, now: () => { calls.clocks++; return APPLICATION_TEST_AT; } });
  return { db, repo, control, calls, close: () => db.close() };
}

export function applicationCommandTestReceipt(input: {
  job: HindsightApplicationCommandJob; stateCursor?: number; nativeCursor?: number; refusal?: TakiApplicationFailureCode;
}) {
  const { job } = input; const scope = { bankId: job.key.bankId, namespace: job.namespace };
  const body = input.refusal ? null : applicationTestBody("application-affected-versions.v1", { artifacts:
    applicationCommandList(job.commands).map((command) => ({ key: command.key, revision: (command.expected_artifact?.revision ?? 0) + 1,
      record_hash: hindsightApplicationHash({ ...scope, domain: "record", value: { command, operation: job.operationId } }) })),
  }, scope);
  const receipt: TakiApplicationCommitReceipt = { namespace: job.namespace, bank_id: job.key.bankId,
    operation_id: job.operationId, request_hash: job.request.request_hash, state: input.refusal ? "refused" : "completed", result_hash: "",
    checkpoint: input.refusal ? null : { native_cursor: input.nativeCursor ?? 0, state_cursor: input.stateCursor ?? 1 },
    affected_versions_ref: body?.ref ?? null,
    refusal: input.refusal ? { error: "application_state_error", code: input.refusal, detail: "A fixture refusal" } : null,
    completed_at: APPLICATION_TEST_AT };
  receipt.result_hash = hindsightApplicationHash({ ...scope, domain: "receipt", value: withoutApplicationHash(receipt, "result_hash") });
  return { receipt, body };
}

interface Upload { ref: TakiApplicationBodyRef; parts: Map<number, Uint8Array>; sealed: boolean }
interface Server {
  scope: HindsightApplicationScope; uploads: Map<string, Upload>; receipts: Map<string, TakiApplicationCommitReceipt>;
  calls: string[]; cursor: { native: number; state: number };
}
export function applicationCommandTestClient(scope = APPLICATION_TEST_SCOPE) {
  const state: Server = { scope, uploads: new Map(), receipts: new Map(), calls: [], cursor: { native: 0, state: 0 } };
  const unsupported = async (): Promise<never> => { throw new Error("unused fixture route"); };
  const client: HindsightApplicationClient = {
    ...bodyMethods(state), ...commitMethods(state),
    initializeApplication: unsupported, hydrateApplication: unsupported, createApplicationSnapshot: unsupported,
    applicationSnapshot: unsupported, applicationSnapshotPage: unsupported, applicationChanges: unsupported,
    applicationChangePage: unsupported, pruneApplicationChanges: unsupported, reflectApplication: unsupported,
  };
  return { client, ...state, storeBody: (body: HindsightApplicationBody) => storeBody(state, body) };
}

function bodyMethods(state: Server): Pick<HindsightApplicationClient, "uploadApplicationBody" | "putApplicationBodyPart"
  | "sealApplicationBody" | "applicationBody" | "applicationBodyPart"> {
  return {
    uploadApplicationBody: async ({ bankId, request }) => {
      assertScope(state, bankId, request.namespace); state.calls.push(`upload:${request.descriptor.body_id}`);
      const existing = state.uploads.get(request.descriptor.body_id);
      if (existing && !sameApplicationValue(existing.ref, request.descriptor)) refusal("body_conflict");
      const upload = existing ?? { ref: request.descriptor, parts: new Map(), sealed: false };
      state.uploads.set(upload.ref.body_id, upload); return uploadStatus(state, upload);
    },
    putApplicationBodyPart: async ({ bankId, request, bodyId, partNumber }) => {
      assertScope(state, bankId, request.namespace); state.calls.push(`part:${bodyId}:${partNumber}`);
      const upload = requireUpload(state, bodyId); const bytes = Buffer.from(request.data_base64, "base64");
      const prior = upload.parts.get(partNumber);
      if (hindsightApplicationBytesHash(bytes) !== request.part_sha256 || prior && !Buffer.from(prior).equals(bytes)) refusal("body_conflict");
      upload.parts.set(partNumber, bytes); return partReceipt(state, { bodyId, partNumber, bytes });
    },
    sealApplicationBody: async ({ bankId, request, bodyId }) => {
      assertScope(state, bankId, request.namespace); state.calls.push(`seal:${bodyId}`);
      const upload = requireUpload(state, bodyId); readBody(state, upload); upload.sealed = true; return upload.ref;
    },
    applicationBody: async ({ bankId, namespace, bodyId }) => {
      assertScope(state, bankId, namespace); state.calls.push(`read-body:${bodyId}`); return uploadStatus(state, requireUpload(state, bodyId));
    },
    applicationBodyPart: async ({ bankId, namespace, bodyId, partNumber }) => {
      assertScope(state, bankId, namespace); state.calls.push(`read-part:${bodyId}:${partNumber}`);
      const bytes = requireUpload(state, bodyId).parts.get(partNumber); if (!bytes) refusal("body_incomplete");
      return { ...partReceipt(state, { bodyId, partNumber, bytes }), data_base64: Buffer.from(bytes).toString("base64") };
    },
  };
}

function commitMethods(state: Server): Pick<HindsightApplicationClient, "commitApplication" | "applicationCommit"> {
  return {
    commitApplication: async ({ bankId, request }) => {
      assertScope(state, bankId, request.namespace); state.calls.push(`commit:${request.operation_id}`);
      const old = state.receipts.get(request.operation_id);
      if (old) { if (old.request_hash !== request.request_hash) refusal("request_id_conflict"); return old; }
      return commit(state, request);
    },
    applicationCommit: async ({ bankId, namespace, operationId }) => {
      assertScope(state, bankId, namespace); state.calls.push(`status:${operationId}`);
      const receipt = state.receipts.get(operationId) ?? null;
      return { namespace, bank_id: bankId, operation_id: operationId, state: receipt?.state ?? "absent", receipt };
    },
  };
}
function commit(state: Server, request: TakiApplicationCommitRequest): TakiApplicationCommitReceipt {
  const commands = readBody(state, requireUpload(state, request.commands_ref.body_id));
  if (!sameApplicationValue(request, applicationCommitRequest({ ...state.scope, operationId: request.operation_id, commands }))) refusal("request_id_conflict");
  const body = applicationTestBody("application-affected-versions.v1", { artifacts: applicationCommandList(commands).map((command) => ({
    key: command.key, revision: (command.expected_artifact?.revision ?? 0) + 1,
    record_hash: hindsightApplicationHash({ ...state.scope, domain: "record", value: { command, operation: request.operation_id } }),
  })) }, state.scope);
  storeBody(state, body);
  const receipt: TakiApplicationCommitReceipt = { namespace: request.namespace, bank_id: state.scope.bankId, operation_id: request.operation_id,
    request_hash: request.request_hash, state: "completed", result_hash: "", checkpoint: { native_cursor: state.cursor.native, state_cursor: ++state.cursor.state },
    affected_versions_ref: body.ref, refusal: null, completed_at: APPLICATION_TEST_AT };
  receipt.result_hash = hindsightApplicationHash({ ...state.scope, domain: "receipt", value: withoutApplicationHash(receipt, "result_hash") });
  state.receipts.set(request.operation_id, receipt); return receipt;
}
function storeBody(state: Server, body: HindsightApplicationBody): void {
  const parts = new Map<number, Uint8Array>();
  for (let index = 0; index < body.ref.total_parts; index++) parts.set(index, body.bytes.slice(index * body.ref.part_bytes, (index + 1) * body.ref.part_bytes));
  state.uploads.set(body.ref.body_id, { ref: body.ref, parts, sealed: true });
}
function readBody(state: Server, upload: Upload): HindsightApplicationBody {
  const parts = Array.from({ length: upload.ref.total_parts }, (_, index) => upload.parts.get(index));
  if (parts.some((part) => !part)) refusal("body_incomplete");
  return decodeHindsightApplicationBody({ ...state.scope, ref: upload.ref, bytes: Buffer.concat(parts as Uint8Array[]) });
}
function uploadStatus(state: Server, upload: Upload): TakiApplicationBodyUploadStatus {
  return { namespace: state.scope.namespace, bank_id: state.scope.bankId, descriptor: upload.ref,
    state: upload.sealed ? "sealed" : "uploading", received_parts: upload.parts.size, expires_at: null };
}
function requireUpload(state: Server, bodyId: string): Upload { const upload = state.uploads.get(bodyId); if (!upload) refusal("body_not_found"); return upload; }
function assertScope(state: Server, bankId: string, namespace: TakiApplicationNamespace): void {
  if (bankId !== state.scope.bankId || !sameApplicationValue(namespace, state.scope.namespace)) refusal("namespace_mismatch");
}
function partReceipt(state: Server, input: { bodyId: string; partNumber: number; bytes: Uint8Array }): TakiApplicationBodyPartReceipt {
  const result = { namespace: state.scope.namespace, bank_id: state.scope.bankId, body_id: input.bodyId,
    part_number: input.partNumber, part_sha256: hindsightApplicationBytesHash(input.bytes), total_bytes: input.bytes.byteLength };
  return { ...result, part_hash: hindsightApplicationHash({ ...state.scope, domain: "part", value: result }) };
}
function refusal(code: TakiApplicationFailureCode): never { throw new HindsightApplicationRefusal({ error: "application_state_error", code, detail: code }); }
