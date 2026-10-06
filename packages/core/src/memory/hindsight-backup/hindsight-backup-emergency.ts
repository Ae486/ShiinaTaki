/**
 * INPUT:  Core SQLite, the artifact store, the last verified backup manifest (a local read) and an optional clock
 * OUTPUT: sealEmergencyEvidence() -> `<dataDir>/backups/incident-<id>/` holding a Core copy and an `incident-local` manifest
 *         (never a full backup) naming the last verified backup, its age and the per-Bank missing interval; resolves the id
 * POS:    core/memory/hindsight-backup — Stage 4 emergency producer's immutable seal; takes no native route, so it can
 *         never contact or wait for native and works while the native client fails
 */
import { randomUUID } from "node:crypto";
import type { HindsightBackupManifest, HindsightIncidentManifest, MemoryEmergencyCapture } from "@taki/shared";
import { openReadonlyDatabase, type Database } from "../../db/sqlite.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { migrationHead } from "./hindsight-backup-identity.ts";
import { readHindsightBackupStatus } from "./hindsight-backup-status.ts";
import type { HindsightBackupStore } from "./hindsight-backup-store.ts";
import { readEmergencySnapshot } from "./hindsight-emergency-snapshot.ts";
import { transitionLocalHash } from "../transitions/transition-local-encoding.ts";

export interface HindsightEmergencyEvidenceInput {
  db: Database;
  store: Pick<HindsightBackupStore, "writeIncident" | "readIncident" | "incidentCorePath"> & Partial<Pick<HindsightBackupStore, "readSync">>;
  lastVerified: HindsightBackupManifest | null;
  /** W6 must reserve this identity before calling. Legacy Stage3 callers retain their isolated seal behavior. */
  capture?: MemoryEmergencyCapture;
  now?: () => string;
}

export async function sealEmergencyEvidence(input: HindsightEmergencyEvidenceInput): Promise<{ incidentId: string; manifest: HindsightIncidentManifest }> {
  const { db } = input;
  const createdAt = input.capture?.createdAt ?? (input.now ?? (() => new Date().toISOString()))();
  const incidentId = input.capture?.incidentId ?? randomUUID();
  const existing = await input.store.readIncident(incidentId);
  if (existing) {
    assertCapture(existing, input.capture);
    verifyCapturedFacts(input, existing);
    return { incidentId, manifest: existing };
  }
  await input.store.writeIncident(incidentId, {
    write: (path) => db.backupTo(path),
    manifest: (core, path) => {
      const copy = openReadonlyDatabase(path);
      try {
        const epochId = readMemoryAuthoritySelection(copy).epochId;
        const transition = input.capture ? readEmergencySnapshot(copy, input.capture, input.lastVerified) : undefined;
        const status = transition ? null : readHindsightBackupStatus(copy, { epochId, lastVerified: input.lastVerified, now: createdAt });
        const backup = input.lastVerified?.verifiedAt ? input.lastVerified : null;
        return { version: 1, kind: "incident-local", fullBackup: false, incidentId, createdAt, authorityEpochId: epochId,
          core: { file: "core.sqlite", ...core, migrationHead: migrationHead(copy) },
          lastVerifiedBackupId: backup?.backupId ?? null,
          backupAgeSeconds: backup ? Math.max(0, Math.floor((Date.parse(createdAt) - Date.parse(backup.createdAt)) / 1000)) : null,
          missingInterval: transition ? transition.banks.map((bank) => ({ bankId: bank.bankId,
            fromNativeCursor: bank.backupNativeCursor, toReplicaCursor: bank.replicaCursor, pendingCount: bank.pendingCount })) : status!.missingInterval,
          ...(transition ? { transition } : {}) };
      } finally { copy.close(); }
    },
  });
  const manifest = await input.store.readIncident(incidentId);
  if (!manifest) throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
  assertCapture(manifest, input.capture);
  verifyCapturedFacts(input, manifest);
  return { incidentId, manifest };
}

/** A schema-valid manifest and a matching file digest alone do not prove that its facts describe that file. */
function verifyCapturedFacts(input: HindsightEmergencyEvidenceInput, manifest: HindsightIncidentManifest): void {
  if (!input.capture) return;
  const backup = manifest.lastVerifiedBackupId === null ? null : input.store.readSync?.(manifest.lastVerifiedBackupId)
    ?? (input.lastVerified?.backupId === manifest.lastVerifiedBackupId ? input.lastVerified : null);
  if (manifest.lastVerifiedBackupId !== null && !backup) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  const copy = openReadonlyDatabase(input.store.incidentCorePath(manifest.incidentId));
  try {
    const actual = readEmergencySnapshot(copy, input.capture, backup);
    if (transitionLocalHash(actual) !== transitionLocalHash(manifest.transition) || manifest.core.migrationHead !== migrationHead(copy)) {
      throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    }
  } finally { copy.close(); }
}

function assertCapture(manifest: HindsightIncidentManifest, capture: MemoryEmergencyCapture | undefined): void {
  if (capture && (!manifest.transition || manifest.authorityEpochId !== capture.predecessorEpochId
    || transitionLocalHash(manifest.transition.capture) !== transitionLocalHash(capture))) {
    throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
}
