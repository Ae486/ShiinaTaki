/**
 * INPUT:  an owned native HTTP listener, synthetic Bank identities and a fresh temporary SQLite path
 * OUTPUT: real D77 client/provider/write/snapshot/Run assertions across SQLite restart and provider-only reseeding
 * POS:    task validation — actual Core implementation; only native external models are deterministic fixture substitutes
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { JsonValue, RetainRequest, TakiApplicationMemoryBody } from "../../../../../packages/shared/src/index.ts";
import { createConfigRepo } from "../../../../../packages/core/src/db/config-repo.ts";
import { createConfigSource } from "../../../../../packages/core/src/config/config-source.ts";
import { loadMemoryConfig } from "../../../../../packages/core/src/config/memory-config.ts";
import { createHindsightBankSetupRepo } from "../../../../../packages/core/src/db/hindsight-bank-setup-repo.ts";
import { openDatabase } from "../../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { createTimelineRepo } from "../../../../../packages/core/src/db/timeline-repo.ts";
import { createSecretCatalogService } from "../../../../../packages/core/src/secrets/secret-catalog-service.ts";
import { createCaptureLogger } from "../../../../../packages/core/src/testing/capture-logger.ts";
import { scriptedGenerateModel } from "../../../../../packages/core/src/testing/mock-language-model.ts";
import { createUtilitySlot } from "../../../../../packages/core/src/memory/utility-slot.ts";
import { createHindsightMemorySubsystem } from "../../../../../packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts";
import { createHindsightClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { HINDSIGHT_SECRET_REFS } from "../../../../../packages/core/src/memory/hindsight/hindsight-secret-refs.ts";
import { prepareHindsightApplicationBody } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-body-transfer.ts";
import { hindsightApplicationArtifactVersion } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-binding-context.ts";
import { sameApplicationValue } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-integrity.ts";

const [endpoint, globalBank, characterBank, lineage, sqlitePath] = process.argv.slice(2);
if (process.env.TAKI_D77_HTTP_FIXTURE !== "1" || !endpoint || new URL(endpoint).hostname !== "127.0.0.1"
  || !globalBank || !characterBank || !lineage || !sqlitePath || !isAbsolute(sqlitePath)
  || basename(sqlitePath) !== "fixture.sqlite" || existsSync(sqlitePath)) throw new Error("owned fixture input required");
const at = new Date().toISOString(); const epochId = "d77-owned-epoch";
const config = loadMemoryConfig({}); const { logger } = createCaptureLogger();
const model = scriptedGenerateModel([]); const utility = createUtilitySlot({ mainModel: model, logger });
const secrets = await createSecretCatalogService({ filePath: join(dirname(sqlitePath), "fixture-secrets.bin"),
  storeId: "11111111-1111-4111-8111-111111111111", logger,
  keySource: { kind: "credentials-directory", canCreate: false, read: () => new Uint8Array(32).fill(23), create: () => { throw new Error("fixture key is read-only"); } } });
secrets.set(HINDSIGHT_SECRET_REFS.connectionApiKey, "native-results-offline-test");
const faults = { offline: false, loseNextNativeAck: false }; let nativeWrites = 0;
const client = createHindsightClient({ endpoint, resolveApiKey: () => secrets.resolve(HINDSIGHT_SECRET_REFS.connectionApiKey),
  transport: async (address, init) => {
    const url = new URL(address); assert.equal(url.origin, endpoint);
    if (faults.offline) throw new Error("owned simulated outage");
    const response = await fetch(url, init); const body = await response.text();
    if (init?.method === "POST" && url.pathname.endsWith("/retains") || init?.method === "PATCH" && url.pathname.includes("/memories/")) {
      nativeWrites++;
      if (faults.loseNextNativeAck) { faults.loseNextNativeAck = false; faults.offline = true; throw new Error("owned lost native ACK"); }
    }
    return { status: response.status, body, headers: response.headers };
  } });

function open(path: string) {
  const db = openDatabase({ path, migrations: MIGRATIONS });
  if (!db.prepare("SELECT epoch_id FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: epochId })) {
    db.prepare(`INSERT INTO canonical_memory_authority_epochs
      (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES (:epoch,'hindsight',:lineage,'active',NULL,:at,NULL,'planned-switch')`).run({ epoch: epochId, lineage: lineage!, at });
    db.prepare("INSERT INTO canonical_memory_authority_state(singleton,active_epoch_id,updated_at) VALUES(1,:epoch,:at)").run({ epoch: epochId, at });
  }
  const banks = createHindsightBankSetupRepo(db);
  for (const [scope, identity, bankId] of [["global", "global", globalBank!], ["character", "character:taki", characterBank!]] as const) {
    banks.upsert({ scope, canonicalIdentity: identity, externalBankId: bankId, templateRevision: "taki-bank-v1",
      templateDigest: "a".repeat(64), status: "verified", operationIds: [], lastVerifiedAt: at, lastError: null });
  }
  const source = createConfigSource({ repo: createConfigRepo(db), env: {
    TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: endpoint, TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS: "30000",
  } });
  const subsystem = createHindsightMemorySubsystem({ db, epochId, config, source, secrets,
    timeline: createTimelineRepo(db), utility, logger, client });
  const writeFailures: string[] = []; const retain = subsystem.state.writes.retain;
  subsystem.state.writes.retain = async (context, request) => {
    try { return await retain(context, request); }
    catch (error) { writeFailures.push(error instanceof Error ? error.stack ?? error.message : String(error)); throw error; }
  };
  return { db, subsystem, writeFailures, close: async () => { await subsystem.stop(); db.close(); } };
}
type Fixture = ReturnType<typeof open>;
function call(requestId: string = randomUUID()) { return { requestId, authorityEpochId: epochId, actor: "foreground-agent" as const }; }
const sourceMetadata: Record<string, JsonValue> = { "10": "ten", "2": "two", nested: { yes: true, no: null, empty: [] }, text: '{"literal":true}' };
function retainRequest(bankId: string, characterId: string | null): RetainRequest {
  return { bankId, content: characterId ? "Taki shared a calm seaside conversation." : "Alice works at Acme and prefers clear status updates.",
    context: "owned D77 runtime source", timestamp: at, tags: [], entities: [], metadata: sourceMetadata,
    observationScopes: "shared", documentId: characterId ? "character-source" : "typed-source", strategy: null, updateMode: "replace",
    provenance: { actor: "user", origin: "explicit-user", characterId, timelineFromSeq: 1, timelineToSeq: 2,
      capturedAt: at, sanitized: true, sourceRef: "owned-d77-http" },
    policy: { layerId: characterId ? "episodes" : "profile", visibility: "retrieved", importance: 5,
      disclosure: null, origin: "self", emotionalWeight: null, policyVersion: 1, retention: { kind: "permanent" } } };
}
async function sync(f: Fixture, bankId: string) { await f.subsystem.state.service.synchronize({ bankId, context: { timeoutMs: 60_000 } }); }
function scope(f: Fixture, bankId: string) {
  const checkpoint = f.subsystem.state.replica.checkpoint(bankId); assert.ok(checkpoint); return { bankId, namespace: checkpoint.namespace };
}
function target(f: Fixture, bankId: string, memoryId: string) {
  const address = scope(f, bankId); const repo = f.subsystem.state.replica;
  const head = repo.nativeHead({ ...address, objectKind: "memory_unit", objectId: memoryId });
  assert.ok(head?.version && head.bound_artifact);
  const artifact = repo.artifact({ ...address, version: head.bound_artifact }); assert.ok(artifact);
  const body = repo.body({ ...address, bodyId: artifact.body_ref.body_id });
  assert.equal(body?.content.body_schema, "application-memory.v1");
  if (body?.content.body_schema !== "application-memory.v1") throw new Error("fixture memory body missing");
  return { address, head, artifact, body: body.content.value };
}
async function putPolicy(f: Fixture, bankId: string, memoryId: string, update: (body: TakiApplicationMemoryBody) => TakiApplicationMemoryBody) {
  const current = target(f, bankId, memoryId); const state = f.subsystem.state;
  const id = `fixture-policy:${randomUUID()}`;
  const job = state.writer.prepare({ key: { authorityEpochId: epochId, bankId, requestId: id }, namespace: current.address.namespace,
    intent: { purpose: "owned integration policy", id }, create: () => {
      const body = prepareHindsightApplicationBody({ ...current.address, schema: "application-memory.v1", value: update(current.body) });
      return { bodies: [body], commands: [{ command: "put_artifact", key: current.artifact.key,
        expected_artifact: hindsightApplicationArtifactVersion(current.artifact), expected_native: current.head.version,
        body_ref: body.ref, binding: { kind: "exact_native", native: current.head.version! }, actor: { kind: "user", actor_ref: id } }] };
    } });
  const outcome = await state.writer.run({ key: job.key, context: { timeoutMs: 30_000 } });
  assert.equal(outcome.status, "completed", JSON.stringify(outcome)); assert.equal(state.writer.applied(outcome.job), false);
  await sync(f, bankId); assert.equal(state.writer.applied(outcome.job), true);
}

let fixture = open(sqlitePath);
try {
  await sync(fixture, globalBank); await sync(fixture, characterBank);
  const captured = await fixture.subsystem.captureRun("taki");
  assert.equal(captured.snapshot.providerId, "hindsight"); assert.ok(captured.automaticRecall);
  assert.equal(utility.usage().calls, 0);
  const existing = fixture.subsystem.state.replica.search({ ...scope(fixture, globalBank), query: "EVIDENCE", limit: 100 });
  const visible = existing.find((record) => record.unit.text === "VISIBLE_EVIDENCE");
  const hidden = existing.find((record) => record.unit.text === "HIDDEN_EVIDENCE");
  assert.ok(visible && hidden); assert.equal(visible.policy.layerId, "unclassified");
  await putPolicy(fixture, globalBank, hidden.unit.memoryId, (body) => ({ ...body, policy_basis: "registry",
    policy: { ...body.policy, visibility: "hidden", policyVersion: body.policy.policyVersion + 1, updatedAt: new Date().toISOString() } }));
  const recall = await fixture.subsystem.state.provider.recall(call(), { bankId: globalBank, query: "EVIDENCE", queryTimestamp: null,
    budget: "low", limit: 100, maxTokens: 8000, factTypes: ["world", "experience", "observation"], layerIds: [], includeInvalidated: false });
  assert.ok(recall.ok, JSON.stringify(recall)); assert.ok(recall.data.hits.some((hit) => hit.record.unit.memoryId === visible.unit.memoryId));
  assert.equal(recall.data.hits.some((hit) => hit.record.unit.memoryId === hidden.unit.memoryId), false);
  const reflection = await fixture.subsystem.state.provider.reflect(call(), { bankId: globalBank, query: "EVIDENCE", budget: "low", maxTokens: 1000 });
  assert.ok(reflection.ok, JSON.stringify(reflection)); assert.equal(reflection.data.text, "VISIBLE_EVIDENCE");

  const retainCall = call("owned-retain-ack-loss"); const request = retainRequest(globalBank, null);
  faults.loseNextNativeAck = true;
  const queued = await fixture.subsystem.state.provider.retain(retainCall, request);
  assert.ok(queued.ok, JSON.stringify({ queued, writeFailures: fixture.writeFailures })); assert.equal(queued.data.status, "pending");
  const original = fixture.subsystem.state.pending.get({ authorityEpochId: epochId, bankId: globalBank, operationId: retainCall.requestId });
  assert.ok(original?.dispatch); const writtenBeforeRestart = nativeWrites;
  await fixture.close(); faults.offline = false; fixture = open(sqlitePath);
  await fixture.subsystem.state.service.recover({ bankId: globalBank, context: { timeoutMs: 60_000 } });
  const completed = await fixture.subsystem.state.provider.retain(retainCall, request);
  assert.ok(completed.ok, JSON.stringify(completed)); assert.equal(completed.data.status, "completed");
  assert.equal(nativeWrites, writtenBeforeRestart); assert.ok(completed.data.memories.length > 0);
  const source = fixture.subsystem.state.replica.logicalRecord({ ...scope(fixture, globalBank), objectKind: "document", objectId: "typed-source" });
  assert.equal(source?.payload?.kind, "document");
  if (source?.payload?.kind !== "document") throw new Error("fixture source missing");
  assert.ok(sameApplicationValue(source.payload.value.metadata, sourceMetadata));
  assert.equal(source.payload.value.retainedText, request.content);

  const first = completed.data.memories[0]!;
  const layer = await fixture.subsystem.state.provider.mutate(call("owned-layer"), {
    kind: "edit", bankId: globalBank, memoryId: first.memoryId, expectedRevision: first.revision, patch: { layerId: "profile" } });
  assert.ok(layer.ok, JSON.stringify(layer)); assert.equal(layer.data.outcome, "applied");
  assert.equal(nativeWrites, writtenBeforeRestart);
  const editCall = call("owned-compound");
  const editRequest = { kind: "edit" as const, bankId: globalBank, memoryId: first.memoryId,
    expectedRevision: first.revision, patch: { text: "Alice requested precise D77 recovery evidence.", layerId: "activity" } };
  const edit = await fixture.subsystem.state.provider.mutate(editCall, editRequest);
  assert.ok(edit.ok, JSON.stringify(edit)); assert.equal(edit.data.outcome, "applied");
  assert.equal(edit.data.record?.policy.layerId, "activity"); assert.equal(edit.data.record?.unit.revision, first.revision + 1);
  assert.deepEqual(await fixture.subsystem.state.provider.mutate(editCall, editRequest), edit);

  const character = await fixture.subsystem.state.provider.retain(call("owned-character-retain"), retainRequest(characterBank, "taki"));
  assert.ok(character.ok, JSON.stringify(character)); assert.equal(character.data.status, "completed");
  fixture.subsystem.state.blocks.replace({ blockId: "user-card", scope: { kind: "global", characterId: null },
    content: "The user wrote this preserved D77 card.", actor: "user", expectedRevision: 0 });
  await sync(fixture, globalBank);
  const beforeLoss = await fixture.subsystem.captureRun("taki");
  assert.ok(beforeLoss.assemble?.("hello").includes("preserved D77 card"));
  const full = fixture.subsystem.state.replica.record({ ...scope(fixture, globalBank), memoryId: first.memoryId })!;
  await fixture.close();

  // A new SQLite database has no old outbox, source capture or replica rows.
  // Reconstruction comes only from the actual provider's joint application snapshot.
  const recoveredPath = join(dirname(sqlitePath), "provider-only.sqlite"); assert.equal(existsSync(recoveredPath), false);
  fixture = open(recoveredPath); await sync(fixture, globalBank); await sync(fixture, characterBank);
  const recovered = fixture.subsystem.state.replica.record({ ...scope(fixture, globalBank), memoryId: first.memoryId });
  assert.ok(sameApplicationValue(recovered, full));
  assert.equal(fixture.subsystem.state.blocks.read("user-card", { kind: "global", characterId: null })?.content,
    "The user wrote this preserved D77 card.");
  const sourceAgain = fixture.subsystem.state.replica.logicalRecord({ ...scope(fixture, globalBank), objectKind: "document", objectId: "typed-source" });
  assert.ok(sameApplicationValue(sourceAgain?.payload, source.payload));
  assert.equal(utility.usage().calls, 0);
  assert.equal(fixture.db.prepare("SELECT count(*) AS n FROM hindsight_memory_write_intents").get()?.n, 0);
  assert.equal(fixture.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n, 0);
  assert.deepEqual(fixture.db.prepare("PRAGMA foreign_key_check").all(), []);
  console.log(JSON.stringify({ banks: 2, neutralBeforeModel: true, hiddenExcluded: true, nativeReflect: true,
    nativeWrites, ackReplayWithoutDuplicate: true, compoundApplied: true, sourceMetadataPreserved: true,
    providerOnlyReconstruction: true, coreModelCalls: utility.usage().calls }));
} finally { await fixture.close(); await utility.stop(); }
