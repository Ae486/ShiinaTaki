/**
 * INPUT:  current Core authority, complete Local/replica rows and reviewed Bank setup
 * OUTPUT: source-backed healthy preview identity and separate final configuration/scope guards
 * POS:    core/memory/transitions — no remote effects; full current logical coverage is independent of setup revision
 */
import { MemoryTransitionIdentitySchema, type MemoryTransitionIdentity } from "@taki/shared";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { discoverTransitionLocal } from "../../db/memory-transition-local-capture.ts";
import { readTransitionCustody } from "../../db/memory-transition-custody.ts";
import { requireTransitionCommonBaseline } from "../../db/memory-transition-candidate-repo.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import type { Database, SqlRow } from "../../db/sqlite.ts";
import type { TransitionEvidenceContext } from "./transition-evidence-context.ts";

export function transitionConfiguration(db: Database, fingerprint: string | null) {
  const row = db.prepare("SELECT revision,config_fingerprint,phase FROM hindsight_connection_state WHERE singleton=1").get();
  const banks = db.prepare("SELECT * FROM hindsight_bank_setup ORDER BY external_bank_id").all();
  if (!row || !fingerprint || row.config_fingerprint !== fingerprint || row.phase !== "configured"
    || banks.length === 0 || banks.some((bank) => bank.status !== "verified")) unavailable();
  return { configRevision: Number(row.revision), configFingerprint: fingerprint,
    inventoryRevision: Number(row.revision), inventoryHash: canonicalPayloadHash(banks), banks };
}
export function assertTransitionConfiguration(db: Database, expected: MemoryTransitionIdentity, fingerprint: string | null): void {
  const actual = transitionConfiguration(db, fingerprint);
  if (actual.configRevision !== expected.configRevision || actual.inventoryRevision !== expected.inventoryRevision
    || actual.configFingerprint !== expected.configFingerprint || actual.inventoryHash !== expected.inventoryHash) stale();
  assertTransitionScopeCoverage(db, expected.predecessorEpochId, expected.banks);
}
export function assertTransitionScopeCoverage(db: Database, epochId: string, banks: MemoryTransitionIdentity["banks"]): void {
  const characters = db.prepare(`SELECT character_id FROM timeline_messages UNION
    SELECT character_id FROM primary_memory_groups WHERE assigned_epoch_id=:epoch UNION
    SELECT character_id FROM canonical_memory_banks WHERE authority_epoch_id=:epoch AND scope_kind='character' UNION
    SELECT character_id FROM taki_memory_blocks WHERE scope_kind='character'`).all({ epoch: epochId });
  if (characters.some((row) => !banks.some((bank) => bank.scope.kind === "character" && bank.scope.characterId === row.character_id))) stale();
}
export function readHealthyTransitionIdentity(db: Database, input: { kind: "transition.return-local" | "transition.reenter-hindsight";
  fingerprint: string | null; providerLineage: string }, verification?: TransitionEvidenceContext): MemoryTransitionIdentity {
  const selected = readMemoryAuthoritySelection(db, verification);
  const sourceProvider = input.kind === "transition.return-local" ? "hindsight" : "local";
  if (!selected.epochId || selected.mode !== (sourceProvider === "local" ? "canonical-local" : "hindsight")) unavailable();
  const epoch = db.prepare("SELECT provider_lineage_id FROM canonical_memory_authority_epochs WHERE epoch_id=:id").get({ id: selected.epochId });
  if (!epoch || sourceProvider === "hindsight" && epoch.provider_lineage_id !== input.providerLineage) stale();
  const config = transitionConfiguration(db, input.fingerprint);
  const local = sourceProvider === "local" ? discoverTransitionLocal(db, selected.epochId) : null;
  const common = sourceProvider === "local" ? currentTransitionBaseline(db, selected.epochId) : null;
  const banks = config.banks.map((row) => sourceProvider === "local"
    ? localBank(row, local!, common!) : hindsightBank(db, row, { epochId: selected.epochId!, lineage: input.providerLineage }));
  if (local && local.state.banks.length !== banks.length) stale();
  assertTransitionScopeCoverage(db, selected.epochId, banks);
  const result = MemoryTransitionIdentitySchema.parse({ predecessorEpochId: selected.epochId, sourceProvider,
    sourceLineageId: epoch.provider_lineage_id, targetProvider: sourceProvider === "local" ? "hindsight" : "local",
    targetLineageId: sourceProvider === "local" ? input.providerLineage : localAncestorLineage(db, selected.epochId),
    configRevision: config.configRevision, configFingerprint: config.configFingerprint,
    inventoryRevision: config.inventoryRevision, inventoryHash: config.inventoryHash, banks,
    baselineReceiptId: common?.receipt.receiptId ?? null, baselineHash: common?.baseline.baselineId ?? null,
    custodyBoundaryHash: transitionLocalHash(readTransitionCustody(db, selected.epochId)) });
  return result;
}
export function currentTransitionBaseline(db: Database, epochId: string) {
  const row = db.prepare(`SELECT b.id,p.receipt_id FROM memory_transition_baselines b
    JOIN memory_transition_publications p ON p.transition_id=b.transition_id
    JOIN memory_transition_candidate_reservations r ON r.transition_id=b.transition_id WHERE r.target_epoch_id=:epoch`).get({ epoch: epochId });
  if (!row) unavailable();
  return requireTransitionCommonBaseline(db, { baselineId: String(row.id), receiptId: String(row.receipt_id), epochId });
}
function scope(row: SqlRow): MemoryTransitionIdentity["banks"][number]["scope"] {
  if (row.canonical_identity === "global" && row.scope_kind === "global") return { kind: "global", characterId: null };
  if (row.scope_kind !== "character" || !String(row.canonical_identity).startsWith("character:")) stale();
  return { kind: "character", characterId: String(row.canonical_identity).slice(10) };
}
function localBank(row: SqlRow, current: ReturnType<typeof discoverTransitionLocal>, common: ReturnType<typeof currentTransitionBaseline>) {
  const bankScope = scope(row);
  const bank = current.state.banks.find((value) => transitionLocalHash(value.scope) === transitionLocalHash(bankScope));
  if (!bank) stale();
  const previous = common.candidate.scopes.find((value) => value.localBankId === bank.bankId);
  if (previous && previous.nativeBankId !== row.external_bank_id) stale();
  const records = current.state.records.filter((record) => record.unit.bankId === bank.bankId);
  return { scope: bankScope, sourceBankId: bank.bankId, targetBankId: String(row.external_bank_id),
    sourceRevision: Math.max(0, ...current.state.sources.filter((source) => source.bankId === bank.bankId).map((source) => source.revision)),
    nativeBankId: previous?.nativeBankId ?? null, nativeGeneration: previous?.nativeGeneration ?? null,
    manifestHash: transitionLocalHash(current), mappingHash: transitionLocalHash(common.candidate.mappings.filter((value) => value.localBankId === bank.bankId)),
    policyRevision: Math.max(0, ...records.map((record) => record.policy.policyVersion)),
    blockRevision: blockRevision(current.state.blocks, bankScope) };
}
function hindsightBank(db: Database, row: SqlRow, identity: { epochId: string; lineage: string }) {
  const { epochId, lineage } = identity;
  const bankId = String(row.external_bank_id); const bankScope = scope(row);
  const checkpoint = db.prepare("SELECT * FROM hindsight_replica_sync_checkpoints WHERE bank_id=:bank").get({ bank: bankId });
  const application = db.prepare("SELECT * FROM hindsight_application_replica_checkpoints WHERE bank_id=:bank").get({ bank: bankId });
  if (!checkpoint || !application || checkpoint.authority_epoch_id !== epochId || application.authority_epoch_id !== epochId
    || checkpoint.provider_lineage_id !== lineage || application.provider_lineage !== lineage
    || checkpoint.bank_generation !== application.bank_generation || application.bank_deleted !== 0) stale();
  const heads = db.prepare(`SELECT object_key,bytes_sha256,binding_state,bound_artifact_key,bound_artifact_revision
    FROM hindsight_application_replica_heads WHERE bank_id=:bank ORDER BY object_key`).all({ bank: bankId });
  const records = db.prepare("SELECT object_kind,object_id,object_revision,record_hash FROM hindsight_replica_sync_records WHERE bank_id=:bank ORDER BY object_kind,object_id").all({ bank: bankId });
  const blocks = db.prepare("SELECT revision FROM taki_memory_blocks WHERE scope_kind=:kind AND character_id IS :character")
    .all({ kind: bankScope.kind, character: bankScope.characterId });
  return { scope: bankScope, sourceBankId: bankId, targetBankId: null, sourceRevision: Number(checkpoint.end_cursor),
    nativeBankId: bankId, nativeGeneration: String(checkpoint.bank_generation), manifestHash: transitionLocalHash([checkpoint, application, records]),
    mappingHash: transitionLocalHash(heads), policyRevision: Number(application.state_cursor),
    blockRevision: Math.max(0, ...blocks.map((value) => Number(value.revision))) };
}
function blockRevision(blocks: ReturnType<typeof discoverTransitionLocal>["state"]["blocks"], bankScope: MemoryTransitionIdentity["banks"][number]["scope"]): number {
  return Math.max(0, ...blocks.filter((block) => transitionLocalHash(block.scope) === transitionLocalHash(bankScope)).map((block) => block.block_revision));
}
function localAncestorLineage(db: Database, epochId: string): string {
  const visited = new Set<string>(); let cursor: string | null = epochId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const row = db.prepare("SELECT provider_id,provider_lineage_id,predecessor_epoch_id,reason FROM canonical_memory_authority_epochs WHERE epoch_id=:id").get({ id: cursor });
    if (!row || String(row.reason).includes("emergency")) unavailable();
    if (row.provider_id === "local") return String(row.provider_lineage_id);
    cursor = row.predecessor_epoch_id === null ? null : String(row.predecessor_epoch_id);
  }
  return unavailable();
}
function stale(): never { throw new Error("MEMORY_TRANSITION_STALE"); }
function unavailable(): never { throw new Error("MEMORY_TRANSITION_UNAVAILABLE"); }
