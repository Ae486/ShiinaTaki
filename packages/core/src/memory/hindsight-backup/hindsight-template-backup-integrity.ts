/**
 * INPUT:  strict backup requests, complete lifecycle evidence and normalized definition projections
 * OUTPUT: backup-domain commitments and verified original requests without changing lifecycle hashes
 * POS:    Core paired-backup integrity; schema validity alone never authenticates a stored or remote fact
 */
import { createHash } from "node:crypto";
import { HindsightBackupNativeRequestSchema, hindsightTemplateBackupHashJson, hindsightTemplateBackupRequestValue,
  hindsightTemplateBackupDatabaseValue, hindsightTemplateBackupInheritedValue, normalizeHindsightBackupRequestV2,
  hindsightBackupJsonBytes, HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES,
  type HindsightBackupNativeRequest, type HindsightTemplateBackupHashDomain } from "@taki/shared";
import { signTemplateRequest, verifyTemplateSnapshot } from "../hindsight/template-lifecycle/template-integrity.ts";
import { templateProjectionDigest, type TemplateProjection } from "../hindsight/template-lifecycle/template-projection.ts";

export function hindsightBackupHash(domain: HindsightTemplateBackupHashDomain, value: unknown): string {
  return createHash("sha256").update(hindsightTemplateBackupHashJson(domain, value), "utf8").digest("hex");
}
export function readHindsightBackupRequest(raw: unknown): HindsightBackupNativeRequest {
  const request = HindsightBackupNativeRequestSchema.parse(raw);
  if (request.version === 1) return request;
  if (hindsightBackupJsonBytes(request) > HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES) invalid();
  const value = normalizeHindsightBackupRequestV2(request);
  if (hindsightBackupHash("request", hindsightTemplateBackupRequestValue(value)) !== value.requestHash) invalid();
  for (const bank of value.templates) {
    if (bank.selected === null) continue;
    verifyTemplateSnapshot(bank.selected.request.expected_snapshot);
    if (signTemplateRequest(bank.selected.request).request_hash !== bank.selected.request.request_hash) invalid();
  }
  return value;
}
export function hindsightBackupProjectionHashes(projection: TemplateProjection) {
  return { databaseDefinitionHash: hindsightBackupHash("database", hindsightTemplateBackupDatabaseValue(projection)),
    inheritedConfigHash: hindsightBackupHash("inherited", hindsightTemplateBackupInheritedValue(projection)),
    definitionProjectionHash: templateProjectionDigest(projection) };
}
export function hindsightBackupValueWithout(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}
function invalid(): never { throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID"); }
