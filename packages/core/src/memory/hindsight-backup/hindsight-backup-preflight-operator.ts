/**
 * INPUT:  explicit operator-selected stopped copy/manifest, current target endpoint and current host Secret Catalog
 * OUTPUT: D91 readiness using actual authenticated HTTP observation and presence-only credential custody checks
 * POS:    maintained operator/runbook caller; reads completed files and never opens or starts the live Core writer
 */
import { HindsightBackupManifestSchema, parseHindsightApplicationJson } from "@taki/shared";
import type { SecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import { createHindsightClient } from "../hindsight/hindsight-client.ts";
import { createHindsightConnectionSecret } from "../hindsight/hindsight-secret-refs.ts";
import { missingHindsightCredentials } from "./hindsight-backup-custody.ts";
import { readBoundedHindsightBackupTextSync } from "./hindsight-backup-json.ts";
import { preflightHindsightRestore } from "./hindsight-backup-preflight.ts";
import { HindsightBackupFailure } from "./hindsight-backup-failure.ts";

export async function runHindsightRestorePreflight(input: {
  corePath: string; manifestPath: string; endpoint: string; catalog: SecretCatalogService; signal?: AbortSignal;
}) {
  const manifest = HindsightBackupManifestSchema.parse(parseHindsightApplicationJson(readBoundedHindsightBackupTextSync(input.manifestPath)));
  const secret = createHindsightConnectionSecret(input.catalog); const marker = secret.marker();
  const result = await preflightHindsightRestore({ corePath: input.corePath, manifest,
    client: createHindsightClient({ endpoint: input.endpoint, resolveApiKey: () => input.catalog.resolve("memory.hindsight.connection.api-key") }),
    missingCredentials: (custody) => missingHindsightCredentials(custody, input.catalog), signal: input.signal });
  if (secret.marker() !== marker) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_CREDENTIAL_MISSING");
  return result;
}
