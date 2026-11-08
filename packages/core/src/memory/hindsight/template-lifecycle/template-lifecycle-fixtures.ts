/**
 * INPUT:  owned temporary Core SQLite, canonical Bank identities and programmable Native-shaped evidence
 * OUTPUT: production preview/lifecycle/operation owners with physical reopen and isolated runtime delegates
 * POS:    Core state-machine tests — synthetic sync advances fixture checkpoints; actual runtime has separate tests
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import type { MemoryOperation, MemoryTemplatePreviewParams, MemoryTemplateRequest, TakiApplicationNamespace } from "@taki/shared";
import { createConfigSource } from "../../../config/config-source.ts";
import { createConfigRepo } from "../../../db/config-repo.ts";
import { createHindsightConnectionRepo } from "../../../db/hindsight-connection-repo.ts";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { readApplicationCheckpoint, applicationCheckpointHash } from "../../../db/hindsight-application-replica-checkpoint.ts";
import { createMemoryOperationRepo } from "../../../db/memory-operation-repo.ts";
import { openDatabase, type Database } from "../../../db/sqlite.ts";
import { hindsightRuntimeFixture } from "../../../testing/hindsight-runtime-composition-fixtures.ts";
import { fakeRuntime, fakeSetup } from "../../operations/memory-operation-fixtures.ts";
import { createMemoryOperationService } from "../../operations/memory-operation-service.ts";
import { hindsightBankBindings } from "../hindsight-bank-identity.ts";
import { curatorTestBank } from "../hindsight-policy-curator-fixtures.ts";
import { readHindsightLiveProjection } from "../hindsight-runtime-connection.ts";
import { projectHindsightCompatibilityManifest } from "../hindsight-compatibility-service.ts";
import { createHindsightTemplateLifecycleService } from "./template-lifecycle-service.ts";
import { templateNativeFixture } from "./template-native-fixtures.ts";
import { TAKI_MANAGED_TEMPLATE_REVISION } from "./template-catalog.ts";
import { readTemplatePlan } from "./template-execution-reads.ts";
import { readTemplateSelectionIdentity } from "./template-runtime-selection.ts";
import type { TemplateRuntimeControl } from "./template-rollout.ts";
import type { TemplateExecutionDependencies } from "./template-execution-service.ts";

export interface TemplateFixtureState {
  now: string; bootId: string; bound: string | null; runtimeCalls: string[]; failBinding: boolean;
  beforeSync?: () => Promise<void> | void;
  beforeBinding?: () => Promise<void> | void;
}
interface TemplateFixtureContext {
  characterId: string; bindings: ReturnType<typeof hindsightBankBindings>; base: ReturnType<typeof hindsightRuntimeFixture>;
  native: ReturnType<typeof templateNativeFixture>; state: TemplateFixtureState;
}

export function templateLifecycleFixture(input: { characterId?: string; globalOnly?: boolean; model?: LanguageModel;
  namespaces?: ReadonlyMap<string, TakiApplicationNamespace>; coreMigrationHead?: number } = {}) {
  const characterId = input.characterId ?? "taki";
  const bindings = hindsightBankBindings(characterId);
  const banks = [curatorTestBank({ bankId: bindings[0].externalBankId, namespace: input.namespaces?.get(bindings[0].externalBankId), memories: [] }),
    ...input.globalOnly ? [] : [curatorTestBank({ bankId: bindings[1].externalBankId,
      namespace: input.namespaces?.get(bindings[1].externalBankId), characterId, memories: [] })]];
  const base = hindsightRuntimeFixture({ banks, model: input.model, coreMigrationHead: input.coreMigrationHead });
  // The base runtime fixture does not exercise return/emergency ancestry. This fixture
  // does, so retain the Local predecessor already named by its activation receipt.
  base.db.prepare("UPDATE canonical_memory_authority_epochs SET predecessor_epoch_id='fixture-local' WHERE epoch_id='epoch'").run();
  const native = templateNativeFixture(base.remote.client);
  const state: TemplateFixtureState = { now: "2026-10-08T00:00:00.000Z", bootId: "template-boot-1", bound: null,
    runtimeCalls: [], failBinding: false };
  return createFixtureSession({ characterId, bindings, base, native, state });
}
export type TemplateLifecycleFixture = ReturnType<typeof templateLifecycleFixture>;

/** This single lifetime replaces the Database and all owners together; remote evidence survives a physical reopen. */
function createFixtureSession(context: TemplateFixtureContext) {
  const { base, native, state, bindings, characterId } = context;
  let db = base.db;
  const makeDependencies = () => fixtureDependencies({ ...context, db });
  let deps = makeDependencies();
  seedConnection(deps, native.manifest);
  let service = createHindsightTemplateLifecycleService(deps);
  const makeOwner = () => createMemoryOperationService({ db, bootId: state.bootId, now: () => state.now,
    templates: service, setup: fakeSetup(), live: () => live, logger: base.logger, onChanged: () => undefined });
  const live = fakeRuntime(bindings.map((bank) => ({ bankId: bank.externalBankId, scope: bank.scope,
    characterId: bank.scope === "character" ? characterId : null })), () => state.now);
  live.configFingerprint = readHindsightLiveProjection(deps).fingerprint ?? "";
  let owner = makeOwner();
  return {
    base, native, state, bindings, live,
    get db() { return db; }, get deps() { return deps; }, get service() { return service; }, get owner() { return owner; },
    params: defaultParams,
    request: async (params = defaultParams()): Promise<MemoryTemplateRequest> => {
      const preview = await service.preview(params);
      if (preview.state !== "ready") throw new Error(`fixture preview refused: ${preview.reason}`);
      return { kind: "template.apply", requestId: randomUUID(), previewId: preview.previewId, previewHash: preview.previewHash };
    },
    admit: (request: MemoryTemplateRequest) => admitFixtureOperation({ db, state, service, request }),
    plan: (operation: MemoryOperation) => {
      if (operation.producer?.kind !== "template") throw new Error("fixture producer missing");
      return readTemplatePlan(db, operation.producer.planId);
    },
    reopen: async () => {
      service.stop(); await owner.stop(); db.close();
      db = openDatabase({ path: join(base.dataDir, "memory.sqlite"), migrations: base.migrations });
      state.bootId = randomUUID(); state.bound = null;
      deps = makeDependencies(); service = createHindsightTemplateLifecycleService(deps); owner = makeOwner();
    },
    close: async () => {
      service.stop(); await owner.stop();
      if (db !== base.db) db.close();
      await base.close(); db.close();
    },
  };
}

function fixtureDependencies(input: TemplateFixtureContext & { db: Database }): TemplateExecutionDependencies {
  const { db, state, native, base } = input;
  const config = createConfigSource({ env: {}, repo: createConfigRepo(db) });
  const runtime: TemplateRuntimeControl = {
    quiesce: async ({ assertCurrent }) => { assertCurrent(); state.runtimeCalls.push("quiesce"); state.bound = null; },
    synchronize: async ({ bank, assertCurrent }) => {
      assertCurrent(); state.runtimeCalls.push(`sync:${bank.identity.target.bank_id}`);
      await state.beforeSync?.(); assertCurrent();
      const receipt = native.receipts.get(bank.preview.request.request_id);
      if (!receipt) throw new Error("fixture receipt missing");
      advanceFixtureCheckpoint(db, bank.identity.target.bank_id, receipt.journal_after);
    },
    replaceBinding: async (epochId) => {
      state.runtimeCalls.push("bind"); await state.beforeBinding?.();
      if (state.failBinding) throw new Error("fixture binding unavailable");
      state.bound = readTemplateSelectionIdentity(db, epochId);
    },
    boundSelectionIdentity: () => state.bound,
  };
  return { db, config, secrets: base.secrets.catalog, bootId: state.bootId, now: () => state.now, client: () => native.client, runtime };
}

function admitFixtureOperation(input: { db: Database; state: TemplateFixtureState;
  service: ReturnType<typeof createHindsightTemplateLifecycleService>; request: MemoryTemplateRequest }): MemoryOperation {
  const { db, state, service, request } = input;
  const repo = createMemoryOperationRepo(db, () => state.now);
  let operation: MemoryOperation | undefined;
  db.transaction(() => {
    operation = repo.insertAdmitted({ operationId: randomUUID(), kind: request.kind, family: "hindsight-template", authorityEpochId: "epoch",
      bootId: state.bootId, request, producer: service.admit(request) });
    service.persistAdmission(operation);
  });
  if (!operation) throw new Error("fixture admission failed");
  return operation;
}

function defaultParams(): MemoryTemplatePreviewParams {
  return { target: { kind: "defaults", globalTemplateRevision: TAKI_MANAGED_TEMPLATE_REVISION, characterTemplateRevision: TAKI_MANAGED_TEMPLATE_REVISION },
    enrollment: "fresh", directives: [], refresh: [] };
}

function seedConnection(deps: TemplateExecutionDependencies, manifest: ReturnType<typeof templateNativeFixture>["manifest"]): void {
  const banks = createHindsightBankSetupRepo(deps.db).list();
  const repo = createHindsightConnectionRepo(deps.db); const current = repo.read(banks);
  const live = readHindsightLiveProjection(deps);
  if (live.state !== "ready") throw new Error("fixture connection missing");
  repo.save({ ...current, revision: current.revision + 1, phase: "compatible", lastSuccessfulPhase: "compatible",
    configFingerprint: live.fingerprint, compatibility: projectHindsightCompatibilityManifest(manifest), updatedAt: deps.now() },
  current.revision, live.projection.deploymentMode);
}

/** Synthetic synchronization for publication units; actual Native->replica->binding evidence is tested separately. */
function advanceFixtureCheckpoint(db: Database, bankId: string, cursor: number): void {
  const previous = readApplicationCheckpoint(db, bankId);
  if (!previous) throw new Error("fixture requires an existing application checkpoint");
  if (previous.checkpoint.native_cursor >= cursor) return;
  const next = { ...previous, checkpoint: { ...previous.checkpoint, native_cursor: cursor }, native: { ...previous.native, endCursor: cursor } };
  db.prepare(`UPDATE hindsight_application_replica_checkpoints SET native_cursor=:cursor, checkpoint_json=:json,
    checkpoint_hash=:hash WHERE bank_id=:bank`).run({ cursor, json: JSON.stringify(next), hash: applicationCheckpointHash(next), bank: bankId });
}
