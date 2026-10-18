/**
 * INPUT:  synthetic scoped native/application records and an owned SQLite path
 * OUTPUT: real curator/work/outbox/replica composition with deterministic byte-client and model substitutes; a stale artifact/native
 *         CAS returns a durable refused receipt like native
 * POS:    core/memory/hindsight tests only — no production authority, original data or external model calls
 */
import type { LanguageModel } from "ai";
import type { MemoryBankScope, TakiApplicationCommitReceipt, TakiApplicationCommitRequest, TakiApplicationFailureCode,
  TakiApplicationMemoryBody, TakiMemoryPolicyProjection } from "@taki/shared";
import { loadMemoryConfig } from "../../config/memory-config.ts";
import { loadHindsightPolicyConfig } from "../../config/hindsight-policy-config.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { createHindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-repo.ts";
import { createHindsightApplicationCommandRepo } from "../../db/hindsight-application-command-repo.ts";
import { applicationCommandList } from "../../db/hindsight-application-command-contract.ts";
import { applicationCommandTestClient } from "../../db/hindsight-application-command-fixtures.ts";
import { createHindsightPolicyWorkRepo } from "../../db/hindsight-policy-work-repo.ts";
import { HindsightPolicyTargetSchema, type HindsightPolicyWorkScope } from "../../db/hindsight-policy-work-contract.ts";
import { createStructuredMemoryBlockRepo } from "../../db/structured-memory-block-repo.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { generatingModel } from "../../testing/mock-language-model.ts";
import { APPLICATION_TEST_AT, APPLICATION_TEST_SCOPE, applicationTestArtifact, applicationTestBody,
  applicationTestSnapshot, applicationTestEvent, applicationTestNativeBaseline,
  type ApplicationArtifactFixture, type ApplicationNativeFixture } from "../../testing/hindsight-application-fixtures.ts";
import { applicationTestBind, applicationTestBoundBank, applicationTestBoundMemory } from "../../testing/hindsight-application-runtime-fixtures.ts";
import { createIntlSegmenterTokenizer } from "../search-tokenizer.ts";
import { createUtilitySlot, type UtilitySlot } from "../utility-slot.ts";
import { createHindsightApplicationCommandRunner } from "./hindsight-application-command-runner.ts";
import { createHindsightApplicationWriter } from "./hindsight-application-writer.ts";
import { createHindsightPolicyCurator } from "./hindsight-policy-curator.ts";
import type { HindsightPolicyCuratorDeps } from "./hindsight-policy-curator-context.ts";
import type { HindsightPolicyCuratorDriver, HindsightPolicyCuratorDriverInput } from "./hindsight-policy-curator-model.ts";
import type { HindsightApplicationClient } from "./hindsight-application-client.ts";
import type { HindsightApplicationEvent } from "./hindsight-application-bundle.ts";
import { decodeHindsightApplicationBody, hindsightApplicationHash, sameApplicationValue, withoutApplicationHash,
  type HindsightApplicationBody, type HindsightApplicationScope } from "./hindsight-application-integrity.ts";

export interface CuratorTestBank {
  scope: HindsightApplicationScope; bankScope: MemoryBankScope;
  native: ApplicationNativeFixture[]; artifacts: ApplicationArtifactFixture[]; events: HindsightApplicationEvent[];
  server: ReturnType<typeof applicationCommandTestClient>;
}
export function curatorTestBank(input: { bankId?: string; characterId?: string; namespace?: HindsightApplicationScope["namespace"];
  memories?: Array<{ id: string; text?: string; policy?: Partial<TakiMemoryPolicyProjection>; invalidated?: boolean }> } = {}): CuratorTestBank {
  const scope = { ...APPLICATION_TEST_SCOPE, namespace: input.namespace ?? APPLICATION_TEST_SCOPE.namespace, bankId: input.bankId ?? "bank-a" };
  const bankScope: MemoryBankScope = input.characterId ? { kind: "character", characterId: input.characterId } : { kind: "global", characterId: null };
  const bank = applicationTestBoundBank(scope, bankScope);
  const memories = (input.memories ?? [{ id: "memory-a" }]).map((memory) => applicationTestBoundMemory({ scope, bankScope,
    payload: { memory_id: memory.id, text: memory.text ?? `${scope.bankId} fact ${memory.id}`, state: memory.invalidated ? "invalidated" : "valid",
      invalidated_at: memory.invalidated ? APPLICATION_TEST_AT : null, invalidation_reason: memory.invalidated ? "fixture" : null }, policy: memory.policy }));
  const server = applicationCommandTestClient(scope); server.cursor.native = 2;
  const state: CuratorTestBank = { scope, bankScope, native: [bank.native, ...memories.map((entry) => entry.native)],
    artifacts: [bank.application, ...memories.map((entry) => entry.application)], events: [], server };
  const commit = server.client.commitApplication;
  server.client.commitApplication = async (request) => {
    if (server.receipts.has(request.request.operation_id)) return commit(request);
    const plan = remotePlan(state, request.request);
    if (typeof plan === "string") return refusedReceipt(state, request.request, plan);
    const original = await commit(request); const from = { native_cursor: server.cursor.native, state_cursor: server.cursor.state - 1 };
    const event = remoteEvent(state, plan, from); state.events.push(event);
    const affected = applicationTestBody("application-affected-versions.v1", { artifacts: plan.map(({ artifact }) => ({
      key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash })) }, scope);
    server.storeBody(affected); const receipt = { ...original, affected_versions_ref: affected.ref };
    receipt.result_hash = hindsightApplicationHash({ ...scope, domain: "receipt", value: withoutApplicationHash(receipt, "result_hash") });
    server.receipts.set(receipt.operation_id, receipt); return receipt;
  };
  return state;
}
/** Like native, a stale artifact/native CAS is a durable refused receipt for that exact operation, not a transport error. */
function remotePlan(bank: CuratorTestBank, request: TakiApplicationCommitRequest): ApplicationArtifactFixture[] | TakiApplicationFailureCode {
  const commands = applicationCommandList(uploaded(bank, request.commands_ref.body_id)); const plan: ApplicationArtifactFixture[] = [];
  for (const command of commands) {
    if (command.command !== "put_artifact") throw new Error("fixture only accepts curator put commands");
    const prior = bank.artifacts.find((entry) => sameApplicationValue(entry.artifact.key, command.key));
    const version = prior ? { key: prior.artifact.key, revision: prior.artifact.revision, record_hash: prior.artifact.record_hash } : null;
    if (!sameApplicationValue(command.expected_artifact, version)) return "artifact_conflict";
    if (command.expected_native) {
      const native = bank.native.find((entry) => entry.head.object_kind === command.expected_native?.object_kind
        && entry.head.object_id === command.expected_native.object_id);
      if (!sameApplicationValue(native?.head.version, command.expected_native)) return "native_version_conflict";
    }
    plan.push(applicationTestArtifact({ scope: bank.scope, key: command.key, binding: command.binding,
      revision: (prior?.artifact.revision ?? 0) + 1, body: uploaded(bank, command.body_ref.body_id) }));
  }
  return plan;
}
function refusedReceipt(bank: CuratorTestBank, request: TakiApplicationCommitRequest, code: TakiApplicationFailureCode): TakiApplicationCommitReceipt {
  const receipt: TakiApplicationCommitReceipt = { namespace: request.namespace, bank_id: bank.scope.bankId, operation_id: request.operation_id,
    request_hash: request.request_hash, state: "refused", result_hash: "", checkpoint: null, affected_versions_ref: null,
    refusal: { error: "application_state_error", code, detail: code }, completed_at: APPLICATION_TEST_AT };
  receipt.result_hash = hindsightApplicationHash({ ...bank.scope, domain: "receipt", value: withoutApplicationHash(receipt, "result_hash") });
  bank.server.receipts.set(receipt.operation_id, receipt); return receipt;
}
function remoteEvent(bank: CuratorTestBank, artifacts: ApplicationArtifactFixture[], from: { native_cursor: number; state_cursor: number }) {
  const changed: ApplicationNativeFixture[] = [];
  for (const entry of artifacts) {
    bank.artifacts = [...bank.artifacts.filter((old) => !sameApplicationValue(old.artifact.key, entry.artifact.key)), entry];
    const binding = entry.artifact.binding;
    if (binding.kind === "exact_native") {
      const native = bank.native.find((candidate) => candidate.head.object_kind === binding.native.object_kind && candidate.head.object_id === binding.native.object_id);
      if (!native) throw new Error("fixture native missing"); applicationTestBind(native, entry.artifact);
      changed.push({ ...native, head: { ...native.head } });
    }
  }
  return applicationTestEvent({ scope: bank.scope, native: changed, artifacts, from,
    to: { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state } });
}
function uploaded(bank: CuratorTestBank, bodyId: string): HindsightApplicationBody {
  const upload = bank.server.uploads.get(bodyId); if (!upload?.sealed) throw new Error("fixture body is not sealed");
  return decodeHindsightApplicationBody({ ...bank.scope, ref: upload.ref,
    bytes: Buffer.concat(Array.from({ length: upload.ref.total_parts }, (_, index) => upload.parts.get(index)!)) });
}
export function curatorTestRemotePolicy(bank: CuratorTestBank, memoryId: string, change: (value: TakiApplicationMemoryBody) => TakiApplicationMemoryBody) {
  const old = bank.artifacts.find((entry) => entry.artifact.key.artifact_kind === "memory" && entry.artifact.key.artifact_id === memoryId)!;
  if (old.body.content.body_schema !== "application-memory.v1") throw new Error("fixture memory body missing");
  const body = applicationTestBody("application-memory.v1", change(old.body.content.value), bank.scope);
  const artifact = applicationTestArtifact({ ...old, scope: bank.scope, key: old.artifact.key, binding: old.artifact.binding,
    revision: old.artifact.revision + 1, body });
  const from = { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state++ };
  bank.events.push(remoteEvent(bank, [artifact], from));
}
function routedClient(banks: CuratorTestBank[]): HindsightApplicationClient {
  const client = (bankId: string) => { const bank = banks.find((entry) => entry.scope.bankId === bankId); if (!bank) throw new Error("fixture Bank missing"); return bank.server.client; };
  const unused = async (): Promise<never> => { throw new Error("unused curator fixture endpoint"); };
  return { uploadApplicationBody: (request) => client(request.bankId).uploadApplicationBody(request),
    putApplicationBodyPart: (request) => client(request.bankId).putApplicationBodyPart(request),
    sealApplicationBody: (request) => client(request.bankId).sealApplicationBody(request),
    applicationBody: (request) => client(request.bankId).applicationBody(request),
    applicationBodyPart: (request) => client(request.bankId).applicationBodyPart(request),
    commitApplication: (request) => client(request.bankId).commitApplication(request),
    applicationCommit: (request) => client(request.bankId).applicationCommit(request),
    initializeApplication: unused, hydrateApplication: unused, createApplicationSnapshot: unused, applicationSnapshot: unused,
    applicationSnapshotPage: unused, applicationChanges: unused, applicationChangePage: unused, pruneApplicationChanges: unused, reflectApplication: unused };
}

export function curatorTestFixture(input: { path?: string; banks?: CuratorTestBank[]; clock?: { at: string };
  driver?: HindsightPolicyCuratorDriver; model?: LanguageModel; slot?: UtilitySlot } = {}) {
  const banks = input.banks ?? [curatorTestBank()]; const clock = input.clock ?? { at: APPLICATION_TEST_AT }; const now = () => clock.at;
  const db = openCuratorTestDatabase(input.path ?? ":memory:", now());
  const authority = createCanonicalMemoryAuthorityRepo(db); const blocks = createStructuredMemoryBlockRepo(db);
  const find = (id: string) => { const bank = banks.find((entry) => entry.scope.bankId === id); if (!bank) throw new Error("fixture Bank missing"); return bank; };
  const replica = createHindsightApplicationReplicaRepo({ db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }), now,
    bankScope: (id) => find(id).bankScope });
  const publication = (bank: CuratorTestBank) => ({ ...bank.scope, authorityEpochId: "epoch", expectedBank: {
    bankId: bank.scope.bankId, scope: bank.bankScope.kind, characterId: bank.bankScope.characterId },
    expectedCheckpoint: replica.checkpoint(bank.scope.bankId) ?? null, expectedNativeCheckpoint: replica.nativeCheckpoint(bank.scope.bankId) ?? null,
    lease: replica.leases.acquire({ bankId: bank.scope.bankId, ownerId: "curator-fixture", durationMs: 60_000 }),
    deadlineAt: new Date(Date.parse(now()) + 60_000).toISOString() });
  for (const bank of banks) if (!replica.checkpoint(bank.scope.bankId)) {
    const bundle = applicationTestSnapshot({ scope: bank.scope, native: bank.native, artifacts: bank.artifacts,
      checkpoint: { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state } });
    const args = publication(bank);
    try { replica.seedVerifiedSnapshot({ ...args, bundle, nativeBaseline: applicationTestNativeBaseline(bundle) }); }
    finally { replica.leases.release(args.lease); }
  }
  const assertActive = (scope: HindsightPolicyWorkScope) => {
    const epoch = authority.authorityEpoch(scope.authorityEpochId); const binding = replica.bankBinding(scope.bankId);
    if (epoch.providerId !== "hindsight" || binding?.authorityEpochId !== scope.authorityEpochId
      || !sameApplicationValue(binding.namespace, scope.namespace) || binding.bankDeleted) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  };
  const work = createHindsightPolicyWorkRepo({ db, now, assertActive });
  const commands = createHindsightApplicationCommandRepo({ db, now,
    assertActive: (value) => assertActive({ authorityEpochId: value.key.authorityEpochId, bankId: value.key.bankId, namespace: value.namespace }) });
  const runner = createHindsightApplicationCommandRunner({ repo: commands, client: routedClient(banks) });
  const writer = createHindsightApplicationWriter({ commands, runner, replica, now });
  const { logger, records: logs } = createCaptureLogger(); const slot = input.slot ?? createUtilitySlot({ logger, mainModel: input.model ?? generatingModel("unused") });
  const config = { memory: loadMemoryConfig({}), policy: loadHindsightPolicyConfig({}) };
  const refreshBank: HindsightPolicyCuratorDeps["refreshBank"] = async (id, context) => {
    if (context.signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
    for (const event of find(id).events) if (event.manifest.state_cursor > replica.checkpoint(id)!.checkpoint.state_cursor) {
      const args = publication(find(id));
      try { replica.applyEvent({ ...args, expectedCheckpoint: args.expectedCheckpoint!, event }); }
      finally { replica.leases.release(args.lease); }
    }
  };
  const deps: HindsightPolicyCuratorDeps = { authority, replica, work, writer, slot, readBlock: blocks.read, refreshBank, now,
    resolveBanks: () => banks.map((bank) => ({ bankId: bank.scope.bankId, scope: bank.bankScope.kind, characterId: bank.bankScope.characterId })),
    config: () => config, ...(input.driver ? { driver: input.driver } : {}) };
  const curator = createHindsightPolicyCurator(deps); let closed = false;
  return { banks, clock, db, authority, replica, blocks, work, commands, writer, runner, slot, config, deps, curator, logs,
    close: async () => { if (closed) return; await curator.stop(); await writer.stop(); db.close(); closed = true; } };
}
function openCuratorTestDatabase(path: string, at: string) {
  const db = openDatabase({ path, migrations: MIGRATIONS });
  db.prepare(`INSERT OR IGNORE INTO canonical_memory_authority_epochs
    (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
    VALUES ('epoch','hindsight',:lineage,'active',NULL,:at,NULL,'planned-switch')`).run({ lineage: APPLICATION_TEST_SCOPE.namespace.provider_lineage, at });
  db.prepare("INSERT OR IGNORE INTO canonical_memory_authority_state(singleton,active_epoch_id,updated_at) VALUES(1,'epoch',:at)").run({ at });
  return db;
}
export type CuratorTestFixture = ReturnType<typeof curatorTestFixture>;
export function curatorTestTarget(fixture: CuratorTestFixture, bank = fixture.banks[0]!, memoryId = "memory-a") {
  const head = fixture.replica.nativeHead({ ...bank.scope, objectKind: "memory_unit", objectId: memoryId })!;
  const native = fixture.replica.body({ ...bank.scope, bodyId: head.body_ref!.body_id })!;
  const artifact = fixture.replica.artifact({ ...bank.scope, version: head.bound_artifact! })!;
  const body = fixture.replica.body({ ...bank.scope, bodyId: artifact.body_ref.body_id })!;
  if (native.content.body_schema !== "application-native-record.v1" || body.content.body_schema !== "application-memory.v1") throw new Error("fixture body mismatch");
  return HindsightPolicyTargetSchema.parse({ kind: "policy", bank: fixture.replica.bankBinding(bank.scope.bankId)!.bank,
    native: native.content.value, artifact, memory: body.content.value });
}
export function curatorTestPolicy(fixture: CuratorTestFixture, bank = fixture.banks[0]!, memoryId = "memory-a") {
  return curatorTestTarget(fixture, bank, memoryId).memory;
}
export function curatorTestReport(input: HindsightPolicyCuratorDriverInput) {
  const start = input.prompt.indexOf("<policy-review-data>\n") + "<policy-review-data>\n".length;
  const raw = input.prompt.slice(start, input.prompt.lastIndexOf("\n</policy-review-data>"))
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  return JSON.parse(raw) as { bank: { id: string; scope: MemoryBankScope }; policies: Array<{
    workId: string; nativeId: string; text: string; policy: TakiMemoryPolicyProjection }>; writableBlocks: Array<{ workId: string; blockId: string }> };
}
export async function curatorTestTool(input: HindsightPolicyCuratorDriverInput, name: string, value: Record<string, unknown> = {}) {
  const execute = input.tools[name]?.execute; if (!execute) throw new Error(`fixture missing tool ${name}`);
  return await execute(value, { toolCallId: name, messages: [], context: {} }) as { ok: boolean; code?: string; status?: string };
}
export function curatorTestAssessment(policy: TakiMemoryPolicyProjection, id: string, character = false) {
  return { id, layerId: character ? "episodes" : "profile", importance: 5, visibility: "retrieved", disclosure: "fixture recall trigger",
    emotionalWeight: null, retention: policy.retention };
}
export const curatorTestAssessDriver: HindsightPolicyCuratorDriver = async (input) => {
  input.assertInput(); const report = curatorTestReport(input);
  for (const row of report.policies) {
    const result = await curatorTestTool(input, "memory_policy_assess", curatorTestAssessment(row.policy, row.workId, report.bank.scope.kind === "character"));
    if (!result.ok) throw new Error(`fixture assessment refused: ${result.code}`);
  }
  await curatorTestTool(input, "policy_review_finish"); input.onStepEnd();
  return { steps: 1, usage: { inputTokens: 11, outputTokens: 7 } };
};
