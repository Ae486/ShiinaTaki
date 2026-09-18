/**
 * INPUT:  authenticated compatibility manifests and the active epoch/connection identity
 * OUTPUT: integrity-checked last-verified D77 and guarded-reflect support across restart
 * POS:    core/db — runtime capability evidence only; availability and Authority remain independent
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { hindsightApplicationTaggedJson } from "@taki/shared";
import { HindsightCompatibilityWireSchema, type HindsightCompatibilityWire } from "../memory/hindsight/hindsight-contracts.ts";
import { requireHindsightApplicationCapability } from "../memory/hindsight/hindsight-application-capability.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import type { Database } from "./sqlite.ts";

const IdentitySchema = z.strictObject({ authorityEpochId: z.string().min(1).max(256), configFingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
type Identity = z.infer<typeof IdentitySchema>;
interface Evidence extends Identity { manifest: HindsightCompatibilityWire; admittedAt: string }
export interface HindsightRuntimeAdmissionRepo {
  read(identity: Identity): Evidence | undefined;
  save(evidence: Evidence): Evidence;
}

export function createHindsightRuntimeAdmissionRepo(db: Database): HindsightRuntimeAdmissionRepo {
  return { read: (identity) => read(db, identity), save: (evidence) => save(db, evidence) };
}

function read(db: Database, raw: Identity): Evidence | undefined {
  const identity = IdentitySchema.parse(raw);
  const row = db.prepare(`SELECT * FROM hindsight_application_runtime_admission
    WHERE authority_epoch_id=:authorityEpochId AND config_fingerprint=:configFingerprint`).get(identity);
  if (!row) return undefined;
  const evidence = { ...identity, manifest: HindsightCompatibilityWireSchema.parse(JSON.parse(String(row.manifest_json))),
    admittedAt: z.iso.datetime({ offset: true }).parse(row.admitted_at) };
  if (hash(evidence) !== row.evidence_hash || evidence.manifest.provider.lineage !== row.provider_lineage) {
    throw new Error("HINDSIGHT_APPLICATION_ADMISSION_INVALID");
  }
  assertActive(db, evidence);
  return evidence;
}

function save(db: Database, raw: Evidence): Evidence {
  const evidence = { ...IdentitySchema.parse({ authorityEpochId: raw.authorityEpochId, configFingerprint: raw.configFingerprint }),
    manifest: HindsightCompatibilityWireSchema.parse(raw.manifest), admittedAt: z.iso.datetime({ offset: true }).parse(raw.admittedAt) };
  db.transaction(() => {
    assertActive(db, evidence);
    db.prepare(`INSERT INTO hindsight_application_runtime_admission
      (authority_epoch_id,config_fingerprint,provider_lineage,manifest_json,evidence_hash,admitted_at)
      VALUES (:authorityEpochId,:configFingerprint,:lineage,:manifest,:hash,:at)
      ON CONFLICT(authority_epoch_id,config_fingerprint) DO UPDATE SET provider_lineage=excluded.provider_lineage,
        manifest_json=excluded.manifest_json,evidence_hash=excluded.evidence_hash,admitted_at=excluded.admitted_at`)
      .run({ authorityEpochId: evidence.authorityEpochId, configFingerprint: evidence.configFingerprint,
        lineage: evidence.manifest.provider.lineage, manifest: JSON.stringify(evidence.manifest), hash: hash(evidence), at: evidence.admittedAt });
    assertActive(db, evidence);
  });
  return evidence;
}

function assertActive(db: Database, evidence: Evidence): void {
  const epoch = createCanonicalMemoryAuthorityRepo(db).authorityEpoch(evidence.authorityEpochId);
  const admitted = requireHindsightApplicationCapability(evidence.manifest);
  if (epoch.providerId !== "hindsight" || epoch.providerLineageId !== admitted.providerLineage) throw new Error("MEMORY_AUTHORITY_MISMATCH");
}
function hash(evidence: Evidence): string {
  return createHash("sha256").update(hindsightApplicationTaggedJson({ domain: "taki-core-runtime-admission.v1", evidence })).digest("hex");
}
