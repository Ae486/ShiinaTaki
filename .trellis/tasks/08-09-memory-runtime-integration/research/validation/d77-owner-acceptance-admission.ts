/**
 * INPUT:  an unchanged completed D78 copy and a restored authenticated native endpoint
 * OUTPUT: refreshed genuine B3/D78 evidence and production B4 promotion in this copy only
 * POS:    task acceptance admission; existing command/certificate identities are preserved exactly
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HindsightConnectionProjectionSchema } from "../../../../../packages/shared/src/hindsight-connection-schema.ts";
import { openDatabase } from "../../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { createHindsightConnectionRepo } from "../../../../../packages/core/src/db/hindsight-connection-repo.ts";
import { createHindsightBankSetupRepo } from "../../../../../packages/core/src/db/hindsight-bank-setup-repo.ts";
import { createHindsightCutoverRunRepo } from "../../../../../packages/core/src/db/hindsight-cutover-run-repo.ts";
import { createHindsightReplicaRepo } from "../../../../../packages/core/src/db/hindsight-replica-repo.ts";
import { hindsightCheckpointSetDigest, promoteHindsightAuthority } from "../../../../../packages/core/src/db/hindsight-authority-repo.ts";
import { createHindsightSetupService } from "../../../../../packages/core/src/memory/hindsight/hindsight-setup-service.ts";
import { createHindsightCompatibilityService } from "../../../../../packages/core/src/memory/hindsight/hindsight-compatibility-service.ts";
import { verifyHindsightCurrentBank } from "../../../../../packages/core/src/memory/hindsight/hindsight-current-orchestrator.ts";
import { readMemoryAuthoritySelection } from "../../../../../packages/core/src/memory/legacy-migration/legacy-activation-repo.ts";
import { at, controller, event, makeClient, ORIGINAL_RUN, ROOT } from "./d77-owner-acceptance-context.ts";

interface Baseline {
  b2RunId: string; sourceEpochId: string; endpoint: string; providerLineage: string;
  commands: Array<{ preparationId: string; verificationId: string; replicaEpochId: string }>;
}

export async function admit(path: string, endpoint: string): Promise<void> {
  const baseline = JSON.parse(readFileSync(join(ROOT, "d78-baseline-state.json"), "utf8")) as Baseline;
  assert.equal(endpoint, baseline.endpoint); assert.equal(baseline.commands.length, 2);
  const db = openDatabase({ path, migrations: MIGRATIONS, onMigrated: (versions) => event("COPY_MIGRATED", { versions }) });
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const selection = readMemoryAuthoritySelection(db);
    if (selection.mode === "hindsight") {
      // A failed later scenario may resume the already genuine copy activation;
      // a new target cannot acquire it merely by sharing a filename.
      const receipt = db.prepare("SELECT provider_lineage FROM hindsight_authority_activation_receipts WHERE hindsight_epoch_id=:epoch")
        .get({ epoch: selection.epochId! });
      assert.equal(receipt?.provider_lineage, baseline.providerLineage);
      event("COPY_ACTIVATION_RECOVERED"); return;
    }
    assert.equal(selection.mode, "canonical-local"); assert.equal(selection.epochId, baseline.sourceEpochId);
    const connection = HindsightConnectionProjectionSchema.parse({ enabled: true, deploymentMode: "existing-instance", endpoint,
      apiKeySecretRef: "memory.hindsight.connection.api-key", requestTimeoutMs: 120000, setupTimeoutMs: 120000,
      desiredTemplateRevision: "taki-bank-v1", model: { defaultProvider: null, defaultModel: null, retainModel: null,
        reflectModel: null, consolidationModel: null, embeddingProvider: null, embeddingModel: null,
        rerankerProvider: null, rerankerModel: null } });
    const client = makeClient(endpoint); const bankRepo = createHindsightBankSetupRepo(db);
    const service = createHindsightSetupService({ config: () => ({ state: "ready", projection: connection }),
      secret: { resolve: () => process.env.TAKI_D78_API_KEY ?? null, marker: () => `owned-d78-real-data-${ORIGINAL_RUN}` },
      client: () => client, compatibility: createHindsightCompatibilityService(),
      connectionRepo: createHindsightConnectionRepo(db), bankRepo, authorityMode: () => readMemoryAuthoritySelection(db).mode });
    const previous = service.status(); const beforeFingerprint = previous.configFingerprint;
    let setup = await service.validate({ expectedRevision: previous.revision });
    assert.equal(setup.phase, "compatible", setup.latestError?.code); assert.equal(setup.configFingerprint, beforeFingerprint);
    assert.equal(setup.compatibility?.providerLineage, baseline.providerLineage);
    for (const bank of bankRepo.list().filter((row) => row.scope === "character")) {
      setup = await service.setup({ expectedRevision: setup.revision, characterId: bank.canonicalIdentity.slice("character:".length) });
      assert.equal(setup.phase, "configured", setup.latestError?.code);
    }
    event("RESTORED_B3_VERIFIED", { banks: setup.banks.length, sameFingerprint: true, modelHealth: setup.modelHealth });
    const runs = createHindsightCutoverRunRepo(db);
    const lease = runs.acquireLease({ runId: baseline.b2RunId, owner: `d77-acceptance-${randomUUID()}`, now: at(),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    heartbeat = setInterval(() => {
      try { const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString(); runs.renewLease({ lease, now: at(), expiresAt }); lease.expiresAt = expiresAt; }
      catch { controller.abort(); }
    }, 30000);
    heartbeat.unref();
    assert.ok(client.prepareCurrentVerification && client.advanceCurrentVerification && client.currentVerificationPage && client.currentSnapshotPage);
    // prepare on the same completed verification validates current native input.
    // An unexpected stale/incomplete result is a failed admission, never a reason
    // to synthesize a certificate or silently run another complete model pass.
    const guarded = { ...client, advanceCurrentVerification: async () => { throw new Error("D77_BASELINE_REQUIRES_NEW_NATIVE_WORK"); } };
    for (const command of baseline.commands) {
      const verified = await verifyHindsightCurrentBank({ db, lease, preparationId: command.preparationId,
        verificationId: command.verificationId, replicaEpochId: command.replicaEpochId,
        client: guarded as Parameters<typeof verifyHindsightCurrentBank>[0]["client"],
        context: { timeoutMs: 120000, signal: controller.signal }, now: at });
      assert.equal(verified.status.state, "complete"); assert.ok(verified.evidence);
      event("RESTORED_NATIVE_CERTIFICATE_VERIFIED", { certificateHash: verified.status.certificate?.certificate_hash });
    }
    const readiness = runs.verify({ runId: baseline.b2RunId, expectedRevision: setup.revision, expectedEpochId: baseline.sourceEpochId });
    assert.equal(readiness.eligible, true, JSON.stringify(readiness.blockingCodes));
    const replicas = createHindsightReplicaRepo(db);
    const banks = setup.banks.map((bank) => {
      const checkpoint = replicas.checkpoint(bank.externalBankId); assert.ok(checkpoint);
      return { bankId: bank.externalBankId, templateDigest: bank.templateDigest, checkpoint };
    });
    const promoted = promoteHindsightAuthority(db, { lease, predecessorEpochId: baseline.sourceEpochId,
      hindsightEpochId: randomUUID(), transactionId: randomUUID(), configFingerprint: setup.configFingerprint!,
      checkpointSetDigest: hindsightCheckpointSetDigest(banks), banks, now: at() });
    assert.equal(promoted.selection.mode, "hindsight");
    event("COPY_B4_PROMOTED", { banks: banks.length, originalAuthorityChanged: false });
  } finally { if (heartbeat) clearInterval(heartbeat); db.close(); }
}
