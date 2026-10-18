/**
 * INPUT:  explicit operator-selected stopped Core copy, verified v2 manifest and actual authenticated Native client
 * OUTPUT: current restore-readiness evidence only after a fresh observation and a second immutable Core read-back
 * POS:    D91 operator gate; no boot hook, replacement, migrations, model providers or writer construction
 */
import { HindsightBackupManifestSchema, type HindsightBackupManifest } from "@taki/shared";
import { openReadonlyDatabase } from "../../db/sqlite.ts";
import type { HindsightClient } from "../hindsight/hindsight-client.ts";
import { readHindsightBackupCopy } from "./hindsight-backup-copy-readback.ts";
import { digestFile } from "./hindsight-backup-files.ts";
import { HindsightBackupFailure } from "./hindsight-backup-failure.ts";
import { observeHindsightTemplateBackup } from "./hindsight-template-backup-observer.ts";
import { validateHindsightRestoreCore } from "./hindsight-backup-restore.ts";

export async function preflightHindsightRestore(input: {
  corePath: string; manifest: HindsightBackupManifest; client: HindsightClient; signal?: AbortSignal;
  missingCredentials(custody: HindsightBackupManifest["custody"]): string[];
}) {
  const manifest = HindsightBackupManifestSchema.parse(input.manifest);
  if (manifest.version !== 2) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_TEMPLATE_OBSERVATION_REQUIRED");
  const before = await digestFile(input.corePath);
  if (!manifest.verifiedAt || before.sha256 !== manifest.core.sha256 || before.bytes !== manifest.core.bytes) invalid();
  if (input.missingCredentials(manifest.custody).length) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_CREDENTIAL_MISSING");
  const copied = readHindsightBackupCopy(input.corePath, manifest);
  if (copied.version !== 2) invalid();
  const observed = await observeHindsightTemplateBackup(input.client, { request: copied.request,
    schema: manifest.native.schema, archived: manifest.native.proof, signal: input.signal });
  const after = await digestFile(input.corePath);
  if (before.sha256 !== after.sha256 || before.bytes !== after.bytes) invalid();
  input.signal?.throwIfAborted();
  const db = openReadonlyDatabase(input.corePath);
  try {
    const validated = validateHindsightRestoreCore(db, { manifest, native: observed.proof, nativeSchema: observed.schema,
      coreSha256: after.sha256, coreBytes: after.bytes, missingCredentials: input.missingCredentials });
    return { ...validated, backupId: manifest.backupId, requestHash: copied.request.requestHash, nativeSchema: observed.schema,
      observations: observed.proof.templates.flatMap((bank) => bank.selected.state === "selected"
        ? [{ target: bank.target, ...bank.selected.configurationObservation }] : []) };
  } finally { db.close(); }
}
function invalid(): never { throw new HindsightBackupFailure("HINDSIGHT_BACKUP_ARTIFACT_INVALID"); }
