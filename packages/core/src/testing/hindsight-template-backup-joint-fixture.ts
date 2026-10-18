/**
 * INPUT:  an isolated authenticated Native client whose exact Banks match jointTemplateBackupSeed()
 * OUTPUT: actual Core operation/lifecycle/publication plus staged backup producers for the Native restore drill
 * POS:    joint test fixture; initial authority/replica and runtime delegates are synthetic, Native receipts are not
 */
import { randomUUID } from "node:crypto";
import { HindsightTemplateTargetSchema, type MemoryTemplatePreviewParams, type HindsightTemplateModelDefinition,
  type HindsightTemplateTarget } from "@taki/shared";
import { createConfigRepo } from "../db/config-repo.ts";
import { createHindsightBankSetupRepo } from "../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../db/hindsight-connection-repo.ts";
import { readApplicationCheckpoint, applicationCheckpointHash } from "../db/hindsight-application-replica-checkpoint.ts";
import { publishReplicaCheckpoint, readReplicaCheckpoint } from "../db/hindsight-replica-checkpoint-store.ts";
import { createHindsightBackupStore } from "../memory/hindsight-backup/hindsight-backup-store.ts";
import { createHindsightBackupService } from "../memory/hindsight-backup/hindsight-backup-service.ts";
import { createUnavailableHindsightBackupRoute } from "../memory/hindsight-backup/hindsight-backup-route.ts";
import { readHindsightBackupCustody } from "../memory/hindsight-backup/hindsight-backup-custody.ts";
import { hindsightBankBindings } from "../memory/hindsight/hindsight-bank-identity.ts";
import type { HindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { projectHindsightCompatibilityManifest } from "../memory/hindsight/hindsight-compatibility-service.ts";
import { readHindsightLiveProjection } from "../memory/hindsight/hindsight-runtime-connection.ts";
import { TAKI_MANAGED_TEMPLATE_REVISION } from "../memory/hindsight/template-lifecycle/template-catalog.ts";
import { templateLifecycleFixture, type TemplateLifecycleFixture } from "../memory/hindsight/template-lifecycle/template-lifecycle-fixtures.ts";
import { createHindsightTemplateLifecycleService } from "../memory/hindsight/template-lifecycle/template-lifecycle-service.ts";
import { readTemplateBankReceipt } from "../memory/hindsight/template-lifecycle/template-native-evidence-store.ts";
import { readTemplateSelectionIdentity } from "../memory/hindsight/template-lifecycle/template-runtime-selection.ts";
import type { TemplateRuntimeControl } from "../memory/hindsight/template-lifecycle/template-rollout.ts";
import { createMemoryOperationService } from "../memory/operations/memory-operation-service.ts";
import { fakeSetup } from "../memory/operations/memory-operation-fixtures.ts";

export const JOINT_TEMPLATE_USER_MODEL: HindsightTemplateModelDefinition = {
  id: "user-travel-notes", name: "User travel notes", source_query: "Summarize only explicit travel plans.",
  tags: ["user-owned", "travel"], max_tokens: 1536, trigger: { mode: "full", refresh_after_consolidation: false,
    fact_types: ["world"], exclude_mental_models: true, include_chunks: false, keep_trace: false },
};

/** Native creates the Banks and returns its real lineage/generations; Core only fixes canonical Bank IDs. */
export function jointTemplateBackupSeed() {
  return { authorityEpochId: "epoch", nativeCursorMinimum: 2, applicationStateCursorMinimum: 0,
    banks: hindsightBankBindings("taki") };
}

export async function createJointTemplateBackupFixture(input: { endpoint: string; client: HindsightClient; targets: HindsightTemplateTarget[] }) {
  const targets = input.targets.map((target) => HindsightTemplateTargetSchema.parse(target));
  if (targets.length !== 2 || new Set(targets.map((target) => target.provider_lineage)).size !== 1
    || !jointTemplateBackupSeed().banks.every((bank) => targets.some((target) => target.bank_id === bank.externalBankId))) {
    throw new Error("joint fixture requires Native-produced targets for the exact Core Bank set");
  }
  const fixture = templateLifecycleFixture({ namespaces: new Map(targets.map((target) => [target.bank_id,
    { provider_lineage: target.provider_lineage, bank_generation: target.bank_generation, application_id: "taki" }])) });
  try {
    fixture.service.stop(); await fixture.owner.stop();
    createConfigRepo(fixture.db).upsert("TAKI_HINDSIGHT_ENDPOINT", input.endpoint);
    const live = readHindsightLiveProjection(fixture.deps);
    if (live.state !== "ready") throw new Error("joint fixture connection unavailable");
    const manifest = await input.client.compatibility({ timeoutMs: 30_000 });
    const connections = createHindsightConnectionRepo(fixture.db);
    const current = connections.read(createHindsightBankSetupRepo(fixture.db).list());
    // This joint starts after verified Bank setup. Template publication preserves
    // the admitted connection phase; it cannot promote the B2 fixture's compatibility-only seed.
    connections.save({ ...current, revision: current.revision + 1, phase: "configured", lastSuccessfulPhase: "configured",
      configFingerprint: live.fingerprint, compatibility: projectHindsightCompatibilityManifest(manifest),
      lastSuccessAt: fixture.state.now, updatedAt: fixture.state.now }, current.revision, live.projection.deploymentMode);
    fixture.live.configFingerprint = live.fingerprint;
    return createJointOwners(fixture, input.client);
  } catch (error) { await fixture.close(); throw error; }
}

function createJointOwners(fixture: TemplateLifecycleFixture, client: HindsightClient) {
  const runtime = jointRuntime(fixture);
  const service = createHindsightTemplateLifecycleService({ ...fixture.deps, client: () => client, runtime });
  const owner = createMemoryOperationService({ db: fixture.db, bootId: fixture.state.bootId, now: () => fixture.state.now,
    templates: service, setup: fakeSetup(), live: () => fixture.live, logger: fixture.base.logger, onChanged: () => undefined });
  const store = createHindsightBackupStore(fixture.base.dataDir);
  const backup = createHindsightBackupService({ db: fixture.db, store, route: createUnavailableHindsightBackupRoute(),
    custody: () => readHindsightBackupCustody({ catalog: fixture.base.secrets.catalog, storeId: "isolated-joint-core" }),
    missingCredentials: () => [], logger: fixture.base.logger, now: () => fixture.state.now });
  const apply = async (params: MemoryTemplatePreviewParams) => {
    const preview = await service.preview(params);
    if (preview.state !== "ready") throw new Error(`joint preview refused: ${preview.reason}`);
    // Detail is consumed before admission, as in the operator flow. The owner mints
    // operation/plan IDs and the production executor is the only publisher.
    for (const bank of preview.banks) service.detail({ previewId: preview.previewId, previewHash: preview.previewHash, bankId: bank.target.bank_id });
    const operation = owner.submit({ kind: "template.apply", requestId: randomUUID(), previewId: preview.previewId, previewHash: preview.previewHash });
    await owner.stop();
    const result = owner.status(operation.operationId);
    if (result.state !== "completed") throw new Error(`joint operation refused: ${result.errorCode ?? result.state}`);
    return result;
  };
  return { fixture, service, owner, store, backup, apply,
    prepare: async (scenario: "customized" | "removed", options: { refresh?: boolean } = {}) => {
      await apply(fixture.params());
      const bankId = fixture.bindings[1].externalBankId;
      await apply({ target: { kind: "bank", bankId, templateRevision: TAKI_MANAGED_TEMPLATE_REVISION,
        userChoices: { config: [{ key: "retain_mission", choice: { mode: "value", value: "Preserve this explicit operator customization." } }],
          labels: [], models: [{ id: JOINT_TEMPLATE_USER_MODEL.id, choice: { mode: "value", value: JOINT_TEMPLATE_USER_MODEL } }],
          directives: [] } }, enrollment: "fresh", directives: [],
        refresh: options.refresh ? [{ bankId, modelIds: [JOINT_TEMPLATE_USER_MODEL.id] }] : [] });
      if (scenario === "removed") await apply({ target: { kind: "bank", bankId, templateRevision: "none", userChoices: null },
        enrollment: "fresh", directives: [], refresh: [] });
      return service.status({ bankId });
    },
    capture: async () => {
      const backupId = randomUUID();
      const result = await backup.capture({ operationId: randomUUID(), backupId, route: "operator-artifact",
        runtime: { ...fixture.live, scheduler: { started: () => false, start: () => undefined, stop: async () => undefined },
          writeFence: { quiesce: async () => undefined, release: () => undefined } }, checkpoint: () => undefined });
      if (!result.ok) throw new Error(`joint capture refused: ${result.code}`);
      const staged = await store.readStaged(backupId);
      if (staged?.request.version !== 2) throw new Error("joint capture requires actual backup-v2 admission");
      return { backupId, staged, corePath: store.corePath(backupId, "staged") };
    },
    close: async () => { service.stop(); await owner.stop(); await backup.stop(); await fixture.close(); },
  };
}

/** This delegate advances only the isolated replica cursor from the real stored receipt.
 * It does not assert production replication/boot coverage or fabricate a Native response. */
function jointRuntime(fixture: TemplateLifecycleFixture): TemplateRuntimeControl {
  return {
    quiesce: async ({ assertCurrent }) => { assertCurrent(); fixture.state.bound = null; },
    synchronize: async ({ plan, bank, assertCurrent }) => {
      assertCurrent();
      const receipt = readTemplateBankReceipt(fixture.db, { planId: plan.planId, bank });
      const previous = readApplicationCheckpoint(fixture.db, bank.identity.target.bank_id);
      if (!receipt || !previous) throw new Error("joint fixture requires stored Native receipt and initial replica");
      const cursor = Math.max(previous.checkpoint.native_cursor, receipt.journal_after);
      const value = { ...previous, checkpoint: { ...previous.checkpoint, native_cursor: cursor }, native: { ...previous.native, endCursor: cursor } };
      fixture.db.transaction(() => {
        // D91 validates both checkpoint stores. The synthetic cursor delegate must
        // preserve their pairing just as the real replica publisher does.
        publishReplicaCheckpoint(fixture.db, { previous: readReplicaCheckpoint(fixture.db, bank.identity.target.bank_id) ?? null,
          next: value.native });
        fixture.db.prepare(`UPDATE hindsight_application_replica_checkpoints SET native_cursor=:cursor, checkpoint_json=:json,
          checkpoint_hash=:hash WHERE bank_id=:bank`).run({ cursor, json: JSON.stringify(value), hash: applicationCheckpointHash(value), bank: bank.identity.target.bank_id });
      });
      assertCurrent();
    },
    replaceBinding: async (epochId) => { fixture.state.bound = readTemplateSelectionIdentity(fixture.db, epochId); },
    boundSelectionIdentity: () => fixture.state.bound,
  };
}
