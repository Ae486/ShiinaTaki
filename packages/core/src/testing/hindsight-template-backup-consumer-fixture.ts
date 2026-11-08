/**
 * INPUT:  actual isolated Core lifecycle/capture and independent synthetic Native maps
 * OUTPUT: real staged SQLite, ZIP, admit, historical verify and stopped-copy preflight consumers
 * POS:    Core consumer integration fixture; Native SQL/COPY/auth is covered by the separate joint drill
 */
import { randomUUID, createHash } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { HINDSIGHT_TEMPLATE_BACKUP_BUILD, type HindsightBackupNativeProofBodyV2 } from "@taki/shared";
import { templateLifecycleFixture } from "../memory/hindsight/template-lifecycle/template-lifecycle-fixtures.ts";
import { createJointTemplateBackupFixture } from "./hindsight-template-backup-joint-fixture.ts";
import { templateObservationFixture } from "./hindsight-template-observation-fixtures.ts";
import { preflightHindsightRestore } from "../memory/hindsight-backup/hindsight-backup-preflight.ts";
import { createHindsightRuntimeAdmissionRepo } from "../db/hindsight-runtime-admission-repo.ts";
import { createHindsightBackupService } from "../memory/hindsight-backup/hindsight-backup-service.ts";
import { readHindsightBackupCustody } from "../memory/hindsight-backup/hindsight-backup-custody.ts";

export async function templateBackupConsumerFixture(scenario: "unselected" | "selected" | "removed" = "selected", coreMigrationHead?: number) {
  const source = templateLifecycleFixture({ coreMigrationHead }); source.service.stop(); await source.owner.stop();
  source.native.manifest.source_identity.compatibility_build = HINDSIGHT_TEMPLATE_BACKUP_BUILD;
  source.native.manifest.contracts.template_backup = { version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" } };
  const joint = await createJointTemplateBackupFixture({ endpoint: "http://127.0.0.1:18481", client: source.native.client, coreMigrationHead,
    targets: source.base.banks.map(({ scope }) => ({ bank_id: scope.bankId, provider_lineage: scope.namespace.provider_lineage,
      bank_generation: scope.namespace.bank_generation })) });
  try {
    if (scenario === "selected") await joint.prepare("customized");
    else if (scenario === "removed") await joint.prepare("removed");
    else {
      // Unselected does not run Apply. Admit the supported runtime manifest through
      // the same repository used by runtime setup so capture selects the v2 contract.
      const repo = createHindsightRuntimeAdmissionRepo(joint.fixture.db);
      repo.save({ authorityEpochId: "epoch", configFingerprint: joint.fixture.live.configFingerprint,
        manifest: source.native.manifest, admittedAt: joint.fixture.state.now });
    }
    return consumerMethods(joint, source);
  } catch (error) { await joint.close(); await source.close(); throw error; }
}

function consumerMethods(joint: Awaited<ReturnType<typeof createJointTemplateBackupFixture>>, source: ReturnType<typeof templateLifecycleFixture>) {
  const observer = templateObservationFixture(source.native);
  const underlying = observer.client.observeTemplateBackup;
  observer.client.observeTemplateBackup = async (input) => {
    const response = await underlying(input);
    for (const bank of response.proof.banks) bank.application = { nativeCursor: bank.currentCursor, stateCursor: 100 };
    return response;
  };
  const fileName = "consumer-native.zip";
  const artifact = async (capture: Awaited<ReturnType<typeof joint.capture>>, mutate?: (proof: HindsightBackupNativeProofBodyV2) => void) => {
    if (capture.staged.request.version !== 2) throw new Error("v2 fixture required");
    const response = await observer.client.observeTemplateBackup({ request: { version: 2, nonce: randomUUID(), request: capture.staged.request }, context: { timeoutMs: 1000 } });
    mutate?.(response.proof);
    const table = strToU8("PGCOPY\n\xff\r\n\0consumer-table");
    const manifest = { version: "2", created_at: joint.fixture.state.now, schema: response.schema,
      tables: { memory_units: { rows: 1, size_bytes: table.length, columns: [{ name: "id", type_name: "uuid" }] } },
      taki: { version: 2, backupId: capture.backupId, requestHash: response.requestHash, proof: response.proof,
        entries: [{ name: "memory_units.bin", bytes: table.length, sha256: createHash("sha256").update(table).digest("hex") }] } };
    const bytes = Buffer.from(zipSync({ "memory_units.bin": table, "manifest.json": strToU8(JSON.stringify(manifest)) }));
    mkdirSync(join(joint.store.root, "inbox"), { recursive: true });
    writeFileSync(join(joint.store.root, "inbox", fileName), bytes); return bytes;
  };
  const admit = (backupId: string) => joint.backup.admit({ backupId, fileName, expectedEpochId: "epoch", checkpoint: () => undefined });
  const verify = (backupId: string) => joint.backup.verify({ backupId, checkpoint: () => undefined });
  const preflight = async (backupId: string, writerStart: () => void) => {
    const manifest = joint.store.readSync(backupId); if (!manifest) throw new Error("missing admitted manifest");
    const path = join(joint.fixture.base.dataDir, "stopped-restore.sqlite");
    copyFileSync(joint.store.corePath(backupId), path);
    const result = await preflightHindsightRestore({ corePath: path, manifest,
      client: { ...source.native.client, ...observer.client }, missingCredentials: () => [] });
    writerStart(); return result;
  };
  return { joint, source, observer, artifact, admit, verify, preflight,
    captureNative: (mutate?: (proof: HindsightBackupNativeProofBodyV2) => void) => captureNative(joint, observer, mutate),
    close: async () => { await joint.close(); await source.close(); } };
}

async function captureNative(joint: Awaited<ReturnType<typeof createJointTemplateBackupFixture>>,
  observer: ReturnType<typeof templateObservationFixture>, mutate?: (proof: HindsightBackupNativeProofBodyV2) => void) {
  const backupId = randomUUID(); const digest = { sha256: "a".repeat(64), bytes: 100 };
  const service = createHindsightBackupService({ db: joint.fixture.db, store: joint.store,
    route: { available: () => true, readBack: async () => digest, snapshot: async (request) => {
      const { signal, ...body } = request; if (body.version !== 2) throw new Error("v2 capture required");
      const response = await observer.client.observeTemplateBackup({ request: { version: 2, nonce: randomUUID(), request: body }, context: { signal, timeoutMs: 1000 } });
      mutate?.(response.proof);
      return { schema: response.schema, proof: { ...response.proof, zipSha256: digest.sha256, zipBytes: digest.bytes },
        artifact: { location: "native-host" as const, file: `taki-backup-${backupId}.zip` } };
    } }, custody: () => readHindsightBackupCustody({ catalog: joint.fixture.base.secrets.catalog, storeId: "consumer" }),
    missingCredentials: () => [], logger: joint.fixture.base.logger, now: () => joint.fixture.state.now });
  try {
    const result = await service.capture({ backupId, operationId: randomUUID(), route: "native-endpoint", checkpoint: () => undefined,
      runtime: { ...joint.fixture.live, scheduler: { started: () => false, stop: async () => undefined, start: () => undefined },
        writeFence: { quiesce: async () => undefined, release: () => undefined } } });
    return { backupId, result, verified: result.ok ? await service.verify({ backupId, checkpoint: () => undefined }) : null };
  } finally { await service.stop(); }
}
