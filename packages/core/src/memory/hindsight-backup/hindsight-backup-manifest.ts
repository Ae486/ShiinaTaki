/**
 * INPUT:  version-preserving staged Core and the real endpoint/archive proof
 * OUTPUT: a strict sealed manifest only when both sides use the same backup version and actual schema
 * POS:    backup artifact assembly; no union projection may silently drop v2 template evidence
 */
import { HindsightBackupManifestV1Schema, HindsightBackupManifestV2Schema,
  type HindsightBackupNativeProof, type HindsightBackupManifest, type HindsightBackupRoute } from "@taki/shared";
import type { HindsightBackupStagedRecord } from "./hindsight-backup-staging.ts";

export function createHindsightSealedManifest(core: HindsightBackupStagedRecord["core"], input: {
  route: HindsightBackupRoute; native: { location: "native-host" | "core-dir"; file: string };
  schema: string; proof: HindsightBackupNativeProof; verifiedAt: string;
}): HindsightBackupManifest {
  const native = { ...input.native, nativeManifestVersion: "2" as const, schema: input.schema, proof: input.proof };
  const value = { ...core, route: input.route, native, sensitive: true, verifiedAt: input.verifiedAt };
  if (core.version === 1) {
    if ("version" in input.proof) invalid();
    return HindsightBackupManifestV1Schema.parse(value);
  }
  if (!("version" in input.proof) || input.proof.version !== 2 || input.proof.templates.some((bank) => bank.selected.state === "selected"
    && bank.selected.configurationObservation.schema !== input.schema)) invalid();
  return HindsightBackupManifestV2Schema.parse(value);
}
function invalid(): never { throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID"); }
