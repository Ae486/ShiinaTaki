/**
 * INPUT:  the Core identity recorded at the Core copy (manifest authority, Banks, terminal-operation list) and a native proof
 * OUTPUT: verifyHindsightBackupPair(core, native) -> ok | the first mismatch (closed reason + Bank); hindsightBackupOperationDigest(ids)
 * POS:    core/memory/hindsight-backup — pure PR01 pair check run at capture, admit and verify before any restore worker;
 *         native may be a superset of Core (later cursors, extra receipts), never behind it
 */
import { createHash } from "node:crypto";
import type { HindsightBackupBank, HindsightBackupManifestV1, HindsightBackupManifestV2,
  HindsightBackupNativeProof, HindsightBackupNativeProofBodyV2, HindsightBackupPairMismatch } from "@taki/shared";
import { verifyHindsightTemplateBackupPair } from "./hindsight-template-backup-pair.ts";

export type HindsightBackupCoreIdentityV1 = Pick<HindsightBackupManifestV1, "version" | "authority" | "banks" | "terminalOperations">;
export type HindsightBackupCoreIdentityV2 = Pick<HindsightBackupManifestV2, "version" | "authority" | "banks" | "terminalOperations" | "requestHash" | "templates">;
export type HindsightBackupCoreIdentity = HindsightBackupCoreIdentityV1 | HindsightBackupCoreIdentityV2;
export type HindsightBackupPairResult = { ok: true } | ({ ok: false } & HindsightBackupPairMismatch);
/** A fresh authenticated observation intentionally has no ZIP identity. */
export type HindsightBackupPairProof = HindsightBackupNativeProof | HindsightBackupNativeProofBodyV2;
type NativeBank = HindsightBackupNativeProof["banks"][number];

const OK: HindsightBackupPairResult = { ok: true };
const mismatch = (reason: HindsightBackupPairMismatch["reason"], bankId: string | null = null): HindsightBackupPairResult =>
  ({ ok: false, reason, bankId });

export function verifyHindsightBackupPair(core: HindsightBackupCoreIdentity, native: HindsightBackupPairProof): HindsightBackupPairResult {
  if (core.authority.providerLineageId !== native.providerLineage) return mismatch("lineage");
  const nativeBanks = new Map(native.banks.map((bank) => [bank.bankId, bank]));
  for (const bank of core.banks) {
    const nativeBank = nativeBanks.get(bank.nativeBankId);
    if (!nativeBank) return mismatch("native_bank_id", bank.bankId);
    const result = verifyBank(bank, nativeBank);
    if (!result.ok) return result;
  }
  // The proof answers exactly the Banks Core named; any other Bank means it described a different set.
  if (nativeBanks.size !== core.banks.length) return mismatch("bank_set");
  const { receipts } = native;
  if (receipts.count !== core.terminalOperations.count || receipts.digest !== core.terminalOperations.digest) return mismatch("receipt_scope");
  // A Core terminal success without its native receipt is the reverse-order capture PR01 forbids.
  if (receipts.missingCount > 0) return mismatch("receipt_missing");
  if (core.version === 2) return verifyHindsightTemplateBackupPair(core, native);
  if ("version" in native) return mismatch("template_request");
  return OK;
}

function verifyBank(bank: HindsightBackupBank, native: NativeBank): HindsightBackupPairResult {
  const { core } = bank;
  if (bank.bankGeneration !== null && bank.bankGeneration !== native.bankGeneration) return mismatch("generation", bank.bankId);
  if (core.replicaCursor !== null && native.currentCursor < core.replicaCursor) return mismatch("replica_cursor", bank.bankId);
  if (core.applicationNativeCursor === null || core.applicationStateCursor === null) return OK;
  if (native.application === null || native.application.nativeCursor < core.applicationNativeCursor) {
    return mismatch("application_native_cursor", bank.bankId);
  }
  if (native.application.stateCursor < core.applicationStateCursor) return mismatch("application_state_cursor", bank.bankId);
  return OK;
}

/**
 * The list identity both sides compute: sha256 over the sorted unique ids joined by "\n". Ids must be printable ASCII so
 * the native route reproduces the order and bytes exactly.
 */
export function hindsightBackupOperationDigest(ids: readonly string[]): string {
  if (ids.some((id) => !/^[\x21-\x7e]+$/.test(id))) throw new Error("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
  // Default sort compares UTF-16 code units, which is byte order for printable ASCII.
  const sorted = [...new Set(ids)].sort();
  return createHash("sha256").update(sorted.join("\n"), "utf8").digest("hex");
}
