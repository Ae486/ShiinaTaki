/**
 * INPUT:  owned Core lifecycle operations and deterministic complete W2/observation transports
 * OUTPUT: actual healthy Native session and candidate preparation over configured template history
 * POS:    Core integration fixture; source runtime quiescence and final W4 publication have separate driver tests
 */
import { randomUUID } from "node:crypto";
import { HINDSIGHT_TEMPLATE_BACKUP_BUILD, type MemoryTransitionIntent,
  type MemoryTemplatePreviewParams } from "@taki/shared";
import { createHindsightBankSetupRepo } from "../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../db/hindsight-connection-repo.ts";
import { initializeTransitionDriverBanks } from "../db/memory-transition-driver-repo.ts";
import { DEFAULT_TRANSITION_QUEUE_POLICY, requireTransitionLease } from "../db/memory-transition-repo.ts";
import { projectHindsightCompatibilityManifest } from "../memory/hindsight/hindsight-compatibility-service.ts";
import { templateLifecycleFixture } from "../memory/hindsight/template-lifecycle/template-lifecycle-fixtures.ts";
import { TAKI_MANAGED_TEMPLATE_REVISION } from "../memory/hindsight/template-lifecycle/template-catalog.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { readHealthyTransitionIdentity, transitionConfiguration } from "../memory/transitions/transition-current-identity.ts";
import { createTransitionNativeSession } from "../memory/transitions/transition-native-session.ts";
import { prepareHealthyTransitionCandidate } from "../memory/transitions/transition-healthy-candidate.ts";
import { admitFixtureTransition, W3_AT } from "./memory-transition-candidate-fixtures.ts";
import { JOINT_TEMPLATE_USER_MODEL } from "./hindsight-template-backup-joint-fixture.ts";
import { createHealthyTransitionTransport } from "./memory-transition-healthy-transport.ts";
import { templateTransitionEvidence } from "./memory-transition-template-evidence-fixtures.ts";
import { templateObservationFixture, type TemplateRefreshFixtureResult } from "./hindsight-template-observation-fixtures.ts";

export async function createTemplateTransitionFixture(options: { refresh?: boolean; removed?: boolean } = {}) {
  const source = await createTemplateTransitionSource(options);
  try { return candidateFixture(source.fixture, source.refreshResults); }
  catch (error) { await source.fixture.close(); throw error; }
}

/** Shared real template history setup for candidate-only and complete healthy driver tests. */
export async function createTemplateTransitionSource(options: { refresh?: boolean; removed?: boolean } = {}) {
  const fixture = templateLifecycleFixture(); fixture.state.now = W3_AT;
  try {
    const refreshResults = prepareTemplateConnection(fixture);
    const apply = async (params: MemoryTemplatePreviewParams) => {
      const operation = fixture.owner.submit(await fixture.request(params)); await fixture.owner.stop();
      const status = fixture.owner.status(operation.operationId);
      if (status.state !== "completed") throw new Error(`template fixture operation failed: ${status.errorCode ?? status.state}`);
    };
    await apply(fixture.params());
    const bankId = fixture.bindings[1].externalBankId;
    if (options.refresh || options.removed) await apply({ target: { kind: "bank", bankId, templateRevision: TAKI_MANAGED_TEMPLATE_REVISION,
      userChoices: { config: [], labels: [], directives: [], models: [{ id: JOINT_TEMPLATE_USER_MODEL.id,
        choice: { mode: "value", value: JOINT_TEMPLATE_USER_MODEL } }] } }, enrollment: "fresh", directives: [],
      refresh: options.refresh ? [{ bankId, modelIds: [JOINT_TEMPLATE_USER_MODEL.id] }] : [] });
    if (options.removed) await apply({ target: { kind: "bank", bankId, templateRevision: "none", userChoices: null },
      enrollment: "fresh", directives: [], refresh: [] });
    return { fixture, refreshResults };
  } catch (error) { await fixture.close(); throw error; }
}

function prepareTemplateConnection(fixture: ReturnType<typeof templateLifecycleFixture>) {
  fixture.native.manifest.source_identity.compatibility_build = HINDSIGHT_TEMPLATE_BACKUP_BUILD;
  fixture.native.manifest.contracts.template_backup = { version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" } };
  const connection = createHindsightConnectionRepo(fixture.db);
  const current = connection.read(createHindsightBankSetupRepo(fixture.db).list());
  connection.save({ ...current, revision: current.revision + 1, phase: "configured", lastSuccessfulPhase: "configured",
    compatibility: projectHindsightCompatibilityManifest(fixture.native.manifest) }, current.revision, "existing-instance");
  const results = new Map<string, TemplateRefreshFixtureResult>();
  const read = fixture.native.client.templateRefreshResult!;
  fixture.native.client.templateRefreshResult = async (input) => {
    const pending = await read(input);
    const result: TemplateRefreshFixtureResult = { ...pending, state: "completed", result_revision: 3, result_payload_hash: "c".repeat(64) };
    results.set(result.child_id, result); return result;
  };
  return results;
}

function candidateFixture(fixture: ReturnType<typeof templateLifecycleFixture>, refreshResults: Map<string, TemplateRefreshFixtureResult>) {
  const initial = templateTransitionEvidence(fixture, refreshResults);
  const remote = createHealthyTransitionTransport(initial, fixture.db);
  Object.assign(remote.manifest, structuredClone(fixture.native.manifest));
  const observer = templateObservationFixture(fixture.native, refreshResults);
  for (const evidence of initial) observer.cursors.set(evidence.status.bank_id, evidence.status.proof!.native_snapshot.manifest.end_cursor);
  Object.assign(remote.client, observer.client);
  const expected = readHealthyTransitionIdentity(fixture.db, { kind: "transition.return-local", fingerprint: fixture.live.configFingerprint,
    providerLineage: initial[0]!.status.request.provider_lineage, templateBackup: true });
  const intent: MemoryTransitionIntent = { version: 1, transitionId: randomUUID(), operationId: randomUUID(), actorId: "template-healthy-fixture",
    admittedAt: W3_AT, incidentId: null, queuePolicy: { ...DEFAULT_TRANSITION_QUEUE_POLICY }, request: {
      kind: "transition.return-local", requestId: randomUUID(), previewId: randomUUID(), expected, confirmation: "healthy-switch",
      previewHash: canonicalPayloadHash(["taki-transition-preview.v1", "transition.return-local", expected]) } };
  const lease = admitFixtureTransition(fixture.db, intent);
  const work = () => ({ lease, now: fixture.state.now, assertConfiguration: () => {
    // This candidate-level fixture checks its real lease and complete setup row identity.
    // Production association reads still validate all template history; full driver guards have their own regressions.
    requireTransitionLease(fixture.db, { lease, now: fixture.state.now });
    const current = transitionConfiguration(fixture.db, fixture.live.configFingerprint);
    if (current.configRevision !== expected.configRevision || current.configFingerprint !== expected.configFingerprint
      || current.inventoryHash !== expected.inventoryHash) throw new Error("MEMORY_TRANSITION_STALE");
  } });
  const request = () => { work().assertConfiguration(); return { timeoutMs: 1000 }; };
  const changed = () => undefined;
  initializeTransitionDriverBanks(fixture.db, work());
  const native = createTransitionNativeSession({ db: fixture.db, intent, client: remote.client, work, request, changed });
  return { fixture, initial, remote, observer, intent, native, work, request, changed,
    prepare: () => prepareHealthyTransitionCandidate({ db: fixture.db, intent, native, work, request, changed }),
    close: () => fixture.close() };
}
