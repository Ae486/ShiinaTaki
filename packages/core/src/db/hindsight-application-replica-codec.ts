/**
 * INPUT:  namespace-scoped D77 objects and stored immutable JSON byte witnesses
 * OUTPUT: lossless local byte encoding, corruption checks and explicit application projection digests
 * POS:    core/db — storage encoding only; native and historical B5 hash contracts remain unchanged
 */
import { hindsightApplicationWireJson, parseHindsightApplicationJson, type TakiApplicationArtifactKey,
  type TakiApplicationNativeHead, type HindsightApplicationReplicaRecord } from "@taki/shared";
import { hindsightApplicationBytesHash, hindsightApplicationHash, type HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";

export function applicationScopeParams(scope: HindsightApplicationScope) {
  return { lineage: scope.namespace.provider_lineage, generation: scope.namespace.bank_generation,
    application: scope.namespace.application_id, bank: scope.bankId };
}

export function applicationStoredBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(hindsightApplicationWireJson(value));
}

export function parseApplicationStoredBytes(bytes: unknown, expectedHash: unknown): unknown {
  if (!(bytes instanceof Uint8Array) || typeof expectedHash !== "string"
    || hindsightApplicationBytesHash(bytes) !== expectedHash) throw new Error("HINDSIGHT_APPLICATION_REPLICA_INTEGRITY_ERROR");
  try { return parseHindsightApplicationJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("HINDSIGHT_APPLICATION_REPLICA_INTEGRITY_ERROR"); }
}

export function applicationArtifactKey(key: TakiApplicationArtifactKey): string {
  // JSON string keys preserve NUL and lone UTF-16 code units without a lossy SQLite TEXT scalar conversion.
  return JSON.stringify([key.artifact_kind, key.artifact_id]);
}

export function applicationObjectKey(value: Pick<TakiApplicationNativeHead, "object_kind" | "object_id">): string {
  return JSON.stringify([value.object_kind, value.object_id]);
}

export function applicationReplicaRecordHash(scope: HindsightApplicationScope, record: HindsightApplicationReplicaRecord): string {
  return hindsightApplicationHash({ ...scope, domain: "record", value: { projection_contract: "taki-application-replica.v1", record } });
}

export const APPLICATION_SCOPE_WHERE = "provider_lineage=:lineage AND bank_generation=:generation AND application_id=:application AND bank_id=:bank";
