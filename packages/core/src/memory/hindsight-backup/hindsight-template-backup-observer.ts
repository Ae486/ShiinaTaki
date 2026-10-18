/**
 * INPUT:  the real authenticated client, complete original copied request and the archive's actual schema/context
 * OUTPUT: fresh nonce-bound proof-only observation with stable source context across compatible service restarts
 * POS:    D91/healthy read adapter; never creates a ZIP, starts a model, changes a Bank or invents digest fields
 */
import { randomUUID } from "node:crypto";
import { HindsightTemplateBackupObservationResponseSchema, type HindsightBackupNativeRequestV2,
  type HindsightBackupNativeProofBodyV2, type HindsightBackupNativeProofV2 } from "@taki/shared";
import type { HindsightClient } from "../hindsight/hindsight-client.ts";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import { HindsightBackupFailure } from "./hindsight-backup-failure.ts";
import { hindsightBackupHash, readHindsightBackupRequest } from "./hindsight-template-backup-integrity.ts";
import { hindsightTemplateBackupObservationValue } from "@taki/shared";

export async function observeHindsightTemplateBackup(client: HindsightClient, input: {
  request: HindsightBackupNativeRequestV2; schema?: string; archived?: HindsightBackupNativeProofV2 | HindsightBackupNativeProofBodyV2;
  signal?: AbortSignal; timeoutMs?: number;
}) {
  if (!client.observeTemplateBackup) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_TEMPLATE_OBSERVATION_REQUIRED");
  const request = readHindsightBackupRequest(input.request);
  if (request.version !== 2) invalid();
  const nonce = randomUUID();
  const response = HindsightTemplateBackupObservationResponseSchema.parse(await client.observeTemplateBackup({
    request: { version: 2, nonce, request }, context: { signal: input.signal, timeoutMs: input.timeoutMs ?? 60_000 } }));
  input.signal?.throwIfAborted();
  if (response.nonce !== nonce || response.requestHash !== request.requestHash || input.schema !== undefined && input.schema !== response.schema) invalid();
  assertHindsightTemplateObservation({ proof: response.proof, schema: response.schema, requestHash: request.requestHash, archived: input.archived });
  return response;
}

export function assertHindsightTemplateObservation(input: {
  proof: HindsightBackupNativeProofBodyV2 | HindsightBackupNativeProofV2; schema: string; requestHash: string;
  archived?: HindsightBackupNativeProofBodyV2 | HindsightBackupNativeProofV2;
}): void {
  if (input.proof.requestHash !== input.requestHash) invalid();
  for (const bank of input.proof.templates) {
    if (bank.selected.state === "unselected") continue;
    const observation = bank.selected.configurationObservation;
    if (observation.source !== "authenticated-service" || observation.schema !== input.schema
      || observation.requestHash !== input.requestHash || observation.inheritedConfigHash !== bank.selected.inheritedConfigHash
      || hindsightBackupHash("observation", hindsightTemplateBackupObservationValue(bank.target, observation)) !== observation.observationHash) invalid();
    if (input.archived) {
      const archived = input.archived.templates.find((value) => templateEqual(value.target, bank.target));
      if (archived?.selected.state !== "selected" || archived.selected.configurationObservation.schema !== input.schema
        || archived.selected.configurationObservation.contextHash !== observation.contextHash) invalid();
    }
  }
}
function invalid(): never { throw new HindsightBackupFailure("HINDSIGHT_BACKUP_PAIR_MISMATCH", { reason: "template_configuration", bankId: null }); }
