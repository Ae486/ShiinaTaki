/**
 * INPUT:  persisted Local Bank scopes, verified B3 setup bindings, and frozen coverage Bank identities
 * OUTPUT: exact Local-to-native Bank bindings and a complete native Bank set check
 * POS:    core/db — shared ownership gate for source confirmation and the final B4 promotion transaction
 */
import { HindsightSourceBankBindingSchema, type HindsightLocalCoverageManifest, type HindsightSourceBankBinding } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createHindsightBankSetupRepo } from "./hindsight-bank-setup-repo.ts";

export function readHindsightLocalBankBinding(db: Database, input: {
  localEpochId: string; sourceBankId: string;
}): HindsightSourceBankBinding {
  const bank = createCanonicalMemoryAuthorityRepo(db).getBank(input.localEpochId, input.sourceBankId);
  if (!bank) throw new Error("HINDSIGHT_SOURCE_BANK_BINDING_MISSING");
  const identity = bank.scope.kind === "global" ? "global" : `character:${bank.scope.characterId}`;
  const native = createHindsightBankSetupRepo(db).get(identity);
  if (!native || native.status !== "verified" || native.scope !== bank.scope.kind) {
    throw new Error("HINDSIGHT_SOURCE_BANK_BINDING_MISSING");
  }
  return HindsightSourceBankBindingSchema.parse({ sourceBankId: input.sourceBankId,
    nativeBankId: native.externalBankId, scope: bank.scope });
}

/** Coverage names Local Banks; promotion checkpoints name the verified native Banks for those scopes. */
export function requireHindsightLocalCoverageBanks(db: Database, input: {
  coverage: Pick<HindsightLocalCoverageManifest, "localEpochId" | "bankIds">; nativeBankIds: string[];
}): void {
  const expected = input.coverage.bankIds.map((sourceBankId) => readHindsightLocalBankBinding(db, {
    localEpochId: input.coverage.localEpochId, sourceBankId,
  }).nativeBankId).sort();
  const actual = [...input.nativeBankIds].sort();
  if (new Set(expected).size !== expected.length || expected.length !== actual.length
    || expected.some((bankId, index) => bankId !== actual[index])) {
    throw new Error("HINDSIGHT_BANKS_INCOMPLETE");
  }
}
