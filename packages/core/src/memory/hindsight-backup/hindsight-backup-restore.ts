/**
 * INPUT:  a stopped immutable Core copy, its exact sealed manifest and freshly read restored Native proof
 * OUTPUT: complete Core identity, current replica/body closure and pair preflight before writer construction
 * POS:    core/memory/hindsight-backup — D91 read-only gate; no copying, replacement, credentials or runtime startup
 */
import { HindsightBackupManifestSchema, HindsightBackupNativeProofSchema,
  type HindsightBackupManifest, type HindsightBackupNativeProof } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { readCurrentReplicaClosure } from "../../db/memory-transition-surviving-capture.ts";
import { transitionLocalHash } from "../transitions/transition-local-encoding.ts";
import { readHindsightBackupIdentity } from "./hindsight-backup-identity.ts";
import { verifyHindsightBackupPair } from "./hindsight-backup-pair.ts";

export function validateHindsightRestoreCore(db: Database, input: {
  manifest: HindsightBackupManifest; native: HindsightBackupNativeProof;
  nativeSchema: string; coreSha256: string; coreBytes: number;
  missingCredentials(custody: HindsightBackupManifest["custody"]): string[];
}) {
  const manifest = HindsightBackupManifestSchema.parse(input.manifest);
  const native = HindsightBackupNativeProofSchema.parse(input.native);
  if (!manifest.verifiedAt || input.coreSha256 !== manifest.core.sha256 || input.coreBytes !== manifest.core.bytes) fail("ARTIFACT_INVALID");
  if (input.missingCredentials(manifest.custody).length > 0) fail("CREDENTIAL_MISSING");
  if (input.nativeSchema !== manifest.native.schema || native.compatibilityBuild !== manifest.native.proof.compatibilityBuild
    || native.upstreamCommit !== manifest.native.proof.upstreamCommit
    || native.alembicRevision !== manifest.native.proof.alembicRevision) fail("NATIVE_INCOMPATIBLE");
  const selected = readMemoryAuthoritySelection(db);
  if (selected.mode !== "hindsight" || selected.epochId !== manifest.authority.epochId
    || selected.transactionId !== manifest.authority.activationTransactionId
    || (selected.transitionReceiptId ?? undefined) !== manifest.authority.transitionReceiptId) fail("PAIR_MISMATCH");
  const connection = db.prepare("SELECT config_fingerprint FROM hindsight_connection_state WHERE singleton=1").get();
  if (connection?.config_fingerprint !== manifest.authority.configFingerprint) fail("PAIR_MISMATCH");
  // Source scopes come from the restored Core itself. A caller-supplied manifest cannot omit a Bank silently.
  const banks = db.prepare("SELECT external_bank_id,scope_kind,canonical_identity FROM hindsight_bank_setup ORDER BY external_bank_id").all().map((row) => {
    if (row.scope_kind !== "global" && row.scope_kind !== "character") fail("ARTIFACT_INVALID");
    const characterId = row.scope_kind === "character" && String(row.canonical_identity).startsWith("character:")
      ? String(row.canonical_identity).slice(10) : null;
    if (row.scope_kind === "global" ? row.canonical_identity !== "global" : !characterId) fail("ARTIFACT_INVALID");
    return { bankId: String(row.external_bank_id), scope: row.scope_kind === "global" ? "global" as const : "character" as const, characterId };
  });
  const identity = readHindsightBackupIdentity(db, { epochId: manifest.authority.epochId,
    configFingerprint: manifest.authority.configFingerprint, deploymentMode: manifest.authority.deploymentMode, banks: () => banks });
  if (identity.migrationHead !== manifest.core.migrationHead
    || transitionLocalHash(identity.core.authority) !== transitionLocalHash(manifest.authority)
    || transitionLocalHash([...identity.core.banks].sort((a, b) => a.nativeBankId.localeCompare(b.nativeBankId)))
      !== transitionLocalHash([...manifest.banks].sort((a, b) => a.nativeBankId.localeCompare(b.nativeBankId)))
    || transitionLocalHash(identity.core.terminalOperations) !== transitionLocalHash(manifest.terminalOperations)) fail("READBACK_MISMATCH");
  const pair = verifyHindsightBackupPair(identity.core, native); if (!pair.ok) fail("PAIR_MISMATCH");
  const closures = identity.core.banks.map((bank) => readCurrentReplicaClosure(db, {
    epochId: manifest.authority.epochId, lineage: manifest.authority.providerLineageId,
    bank: { nativeBankId: bank.nativeBankId, nativeGeneration: bank.bankGeneration,
      scope: bank.scope === "global" ? { kind: "global", characterId: null } : { kind: "character", characterId: bank.characterId! } },
  }));
  return { epochId: selected.epochId, transitionReceiptId: selected.transitionReceiptId ?? null,
    banks: closures.map((closure) => ({ bankId: closure.bankId, checkpointHash: closure.checkpointHash,
      closureHash: transitionLocalHash(closure), heads: closure.heads.length, artifacts: closure.artifacts.length, bodies: closure.bodies.length })) };
}
function fail(code: "ARTIFACT_INVALID" | "CREDENTIAL_MISSING" | "NATIVE_INCOMPATIBLE" | "PAIR_MISMATCH" | "READBACK_MISMATCH"): never {
  throw new Error(`HINDSIGHT_BACKUP_${code}`);
}
