/**
 * INPUT:  Core SQLite, the artifact store, the last verified backup manifest (a local read) and an optional clock
 * OUTPUT: sealEmergencyEvidence() -> `<dataDir>/backups/incident-<id>/` holding a Core copy and an `incident-local` manifest
 *         (never a full backup) naming the last verified backup, its age and the per-Bank missing interval; resolves the id
 * POS:    core/memory/hindsight-backup — §5.8 hook for the Stage 4 takeover (no caller yet); takes no native route, so it can
 *         never contact or wait for native and works while the native client fails
 */
import { randomUUID } from "node:crypto";
import type { HindsightBackupManifest } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { migrationHead } from "./hindsight-backup-identity.ts";
import { readHindsightBackupStatus } from "./hindsight-backup-status.ts";
import type { HindsightBackupStore } from "./hindsight-backup-store.ts";

export interface HindsightEmergencyEvidenceInput {
  db: Database;
  store: Pick<HindsightBackupStore, "writeIncident">;
  lastVerified: HindsightBackupManifest | null;
  now?: () => string;
}

export async function sealEmergencyEvidence(input: HindsightEmergencyEvidenceInput): Promise<{ incidentId: string }> {
  const { db } = input;
  const createdAt = (input.now ?? (() => new Date().toISOString()))();
  const incidentId = randomUUID();
  const epochId = readMemoryAuthoritySelection(db).epochId;
  const status = readHindsightBackupStatus(db, { epochId, lastVerified: input.lastVerified, now: createdAt });
  await input.store.writeIncident(incidentId, {
    write: (path) => db.backupTo(path),
    manifest: (core) => ({ version: 1, kind: "incident-local", fullBackup: false, incidentId, createdAt, authorityEpochId: epochId,
      core: { file: "core.sqlite", ...core, migrationHead: migrationHead(db) },
      lastVerifiedBackupId: status.lastVerified?.backupId ?? null, backupAgeSeconds: status.ageSeconds, missingInterval: status.missingInterval }),
  });
  return { incidentId };
}
