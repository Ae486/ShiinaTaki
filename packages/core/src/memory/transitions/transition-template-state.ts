/**
 * INPUT:  admitted healthy scope and complete current Core template/default/hold history
 * OUTPUT: versioned commitments, exact-incarnation Bank attestations and historical inventory verification
 * POS:    healthy transition guard; new Native incarnations never acquire old ownership through their Bank IDs
 */
import type { HindsightTemplateBackupBankAttestation, HindsightTemplateTarget, MemoryTransitionIdentity,
  MemoryTransitionNativeEvidence, MemoryTransitionTemplateCommitment } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { readHindsightTemplateComponents, assertHindsightLegacyTemplateEmpty } from "../hindsight-backup/hindsight-template-backup-attestation.ts";
import { hindsightBackupHash } from "../hindsight-backup/hindsight-template-backup-integrity.ts";
import { TemplateBankIdentitySchema } from "../hindsight/template-lifecycle/template-overlay-schema.ts";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";

type Bank = MemoryTransitionIdentity["banks"][number];
type Components = ReturnType<typeof readHindsightTemplateComponents>["body"];
export function transitionTemplateLineage(identity: MemoryTransitionIdentity): string {
  return identity.sourceProvider === "hindsight" ? identity.sourceLineageId : identity.targetLineageId;
}
export function transitionTemplateBankIdentity(bank: Bank, target: HindsightTemplateTarget) {
  if (target.bank_id !== (bank.nativeBankId ?? bank.targetBankId)
    || bank.nativeGeneration !== null && target.bank_generation !== bank.nativeGeneration) invalid();
  return TemplateBankIdentitySchema.parse({ scope: bank.scope.kind,
    canonicalIdentity: bank.scope.kind === "global" ? "global" : "character:" + bank.scope.characterId, target });
}

/** Unresolved new scopes remain explicit in the reviewed hash until actual W2 supplies their incarnation. */
export function readTransitionTemplateState(db: Database, identity: MemoryTransitionIdentity,
  resolved: HindsightTemplateTarget[] = []) {
  const lineage = transitionTemplateLineage(identity);
  const identities = identity.banks.flatMap((bank) => {
    const target = bank.nativeGeneration === null ? resolved.find((value) => value.bank_id === bank.targetBankId)
      : { provider_lineage: lineage, bank_id: bank.nativeBankId ?? invalid(), bank_generation: bank.nativeGeneration };
    if (!target) return [];
    if (target.provider_lineage !== lineage) invalid();
    return [transitionTemplateBankIdentity(bank, target)];
  });
  const state = readHindsightTemplateComponents(db, { epochId: identity.predecessorEpochId, providerLineageId: lineage, identities });
  for (const bank of identity.banks.filter((value) => value.nativeGeneration === null)) {
    const actual = state.body.banks.find((value) => value.target.bank_id === bank.targetBankId);
    if (actual) requireUnmanagedNewBank(actual);
  }
  return { ...state, commitment: transitionTemplateCommitment(identity, state.body) };
}

export function transitionTemplateCommitment(identity: MemoryTransitionIdentity, body: Components): MemoryTransitionTemplateCommitment {
  const known = new Set(identity.banks.flatMap((bank) => bank.nativeGeneration === null ? [] : [bank.nativeBankId ?? invalid()]));
  const banks = body.banks.filter((bank) => known.has(bank.target.bank_id)).sort(compareBank);
  if (banks.length !== known.size) invalid();
  const unresolved = identity.banks.filter((bank) => bank.nativeGeneration === null).map((bank) => ({
    scope: bank.scope, nativeBankId: bank.targetBankId,
  })).sort((left, right) => compare(String(left.nativeBankId), String(right.nativeBankId)));
  return { version: 1, hash: hindsightBackupHash("transition", { ...body, banks, unresolved }) };
}

/** This is a live read. Historical receipt readers instead reconstruct their stored association below. */
export function assertTransitionTemplatesCurrent(db: Database, identity: MemoryTransitionIdentity): void {
  try {
    if (!identity.templates) {
      assertHindsightLegacyTemplateEmpty(db, { epochId: identity.predecessorEpochId, providerLineageId: transitionTemplateLineage(identity) });
    } else if (!templateEqual(readTransitionTemplateState(db, identity).commitment, identity.templates)) stale();
  } catch { stale(); }
}

/** Called with fully verified immutable W2 documents; no current selection substitutes for their saved history. */
export function verifyTransitionTemplateInventory(identity: MemoryTransitionIdentity, evidence: MemoryTransitionNativeEvidence[]): void {
  if (!identity.templates) {
    if (evidence.some((value) => value.templateBackup !== undefined)) invalid();
    return;
  }
  if (evidence.length !== identity.banks.length) invalid();
  const associations = evidence.map((value) => {
    const association = value.templateBackup;
    const bank = identity.banks.find((bank) => (bank.nativeBankId ?? bank.targetBankId) === value.status.bank_id);
    if (!association || !bank || !templateEqual(association.admitted, identity.templates)
      || !templateEqual(transitionTemplateBankIdentity(bank, association.bank.target), {
        scope: association.bank.scope, canonicalIdentity: association.bank.canonicalIdentity, target: association.bank.target })) invalid();
    if (bank.nativeGeneration === null) requireUnmanagedNewBank(association.bank);
    return association;
  });
  const first = associations[0]; if (!first) invalid();
  if (new Set(associations.map((value) => value.bank.target.bank_id)).size !== associations.length
    || associations.some((value) => value.defaultsHash !== first.defaultsHash || !templateEqual(value.hold, first.hold))) invalid();
  const body = { version: 1 as const, authorityEpochId: identity.predecessorEpochId,
    providerLineageId: transitionTemplateLineage(identity), defaultsHash: first.defaultsHash,
    hold: first.hold, banks: associations.map((value) => value.bank) };
  if (!templateEqual(transitionTemplateCommitment(identity, body), identity.templates)) invalid();
}

/** The last synchronous read-back runs before W9's live-clock lease check and may never perform Native I/O. */
export function assertTransitionTemplatePublication(db: Database,
  input: { identity: MemoryTransitionIdentity; evidence: MemoryTransitionNativeEvidence[] }): void {
  const { identity, evidence } = input;
  verifyTransitionTemplateInventory(identity, evidence);
  assertTransitionTemplatesCurrent(db, identity);
  if (!identity.templates) return;
  const resolved = evidence.map((value) => value.templateBackup?.bank.target ?? invalid());
  const current = readTransitionTemplateState(db, identity, resolved);
  if (!templateEqual(current.commitment, identity.templates)) stale();
  for (const entry of evidence) {
    const saved = entry.templateBackup ?? invalid();
    const actual = current.body.banks.find((bank) => bank.target.bank_id === entry.status.bank_id);
    if (!actual || !templateEqual(actual, saved.bank) || saved.defaultsHash !== current.body.defaultsHash
      || !templateEqual(saved.hold, current.body.hold)) stale();
  }
}

function requireUnmanagedNewBank(bank: HindsightTemplateBackupBankAttestation): void {
  const identity = TemplateBankIdentitySchema.parse({ target: bank.target, scope: bank.scope, canonicalIdentity: bank.canonicalIdentity });
  const emptyHash = hindsightBackupHash("history", { identity, enrollments: [], users: [], selections: [], currentSelectionRevision: 0 });
  if (bank.selected !== null || bank.receiptInventory.count !== 0 || bank.historyHash !== emptyHash) invalid();
}
function compareBank(left: HindsightTemplateBackupBankAttestation, right: HindsightTemplateBackupBankAttestation): number {
  return compare(left.canonicalIdentity, right.canonicalIdentity);
}
function compare(left: string, right: string): number { return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")); }
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
function stale(): never { throw new Error("MEMORY_TRANSITION_STALE"); }
