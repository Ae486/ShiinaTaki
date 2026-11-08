/**
 * INPUT:  explicit completed pair paths, sealed v2 manifest and observed stopped-target schema
 * OUTPUT: complete archive/Core inventory with a frozen digest; no restore, network or eligibility side effect
 * POS:    candidate foundation entry, experimental and not wired to Memory Operations until D1-B
 */
import { HINDSIGHT_CANDIDATE_PROFILE, HindsightCandidateInventorySchema, HindsightBackupManifestV2Schema,
  type HindsightBackupManifestV2, type HindsightCandidateSchemaInventory } from "@taki/shared";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import { transitionLocalHash } from "../transitions/transition-local-encoding.ts";
import { readCandidateArchive } from "./hindsight-candidate-archive.ts";
import { readCandidateCore } from "./hindsight-candidate-core.ts";
import { HINDSIGHT_CANDIDATE_CLASSIFIED } from "./hindsight-candidate-profile.ts";
import { refuse } from "./hindsight-candidate-refusal.ts";
import { assertCandidateDigest, assertCompletedCore, candidateDigest } from "./hindsight-candidate-files.ts";

export interface CandidateAdmissionInput {
  corePath: string; archivePath: string; manifest: HindsightBackupManifestV2; targetSchema: HindsightCandidateSchemaInventory;
}

export async function admitHindsightCandidateArchive(input: CandidateAdmissionInput) {
  const { corePath, archivePath } = input;
  const parsed = HindsightBackupManifestV2Schema.safeParse(input.manifest);
  if (!parsed.success) refuse("tampered", "manifest");
  const manifest = parsed.data;
  const archive = await readCandidateArchive(archivePath, input.targetSchema);
  if (archive.verified.backupId !== manifest.backupId || archive.verified.schema !== manifest.native.schema
    || !templateEqual(archive.verified.proof, manifest.native.proof)) refuse("tampered", "manifest");
  const copy = await readCandidateCore(corePath, manifest);
  assertCandidateDigest(await candidateDigest(archivePath, "archive"),
    { sha256: manifest.native.proof.zipSha256, bytes: manifest.native.proof.zipBytes }, "archive");
  await assertCompletedCore(corePath);
  assertCandidateDigest(await candidateDigest(corePath, "core"), manifest.core, "core");
  const inventory = HindsightCandidateInventorySchema.parse({ version: 1, profile: HINDSIGHT_CANDIDATE_PROFILE,
    backupId: manifest.backupId, requestHash: manifest.requestHash, targetSchemaHash: transitionLocalHash(archive.schema),
    core: copy.core, archive: { sha256: manifest.native.proof.zipSha256, bytes: manifest.native.proof.zipBytes,
      schema: archive.schema.schema, alembicRevision: archive.schema.alembicRevision, compatibilityBuild: archive.schema.compatibilityBuild,
      upstreamCommit: archive.schema.upstreamCommit }, tables: archive.tables, bodies: archive.bodies, banks: copy.banks,
    classified: [...HINDSIGHT_CANDIDATE_CLASSIFIED].map(([name, kind]) => ({ name, kind })) });
  return { inventory, inventoryHash: transitionLocalHash(inventory) };
}
