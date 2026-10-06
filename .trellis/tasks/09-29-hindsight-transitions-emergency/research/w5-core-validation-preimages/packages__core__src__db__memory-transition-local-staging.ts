/**
 * INPUT:  immutable verified W3 candidate and an unselected target epoch created by the caller's COMMIT transaction
 * OUTPUT: exact canonical Local rows, independent provenance and eligible FTS without authority selection
 * POS:    core/db — W3 row installer for W4's atomic join; this never creates epochs, receipts, custody or markers
 */
import type { CanonicalMemoryBank } from "@taki/shared";
import { readVerifiedTransitionCandidate } from "../memory/transitions/transition-final-mapping.ts";
import { insertCanonicalUnitAndPolicy, upsertCanonicalSource, addCanonicalLineage, upsertCanonicalFts,
  readCanonicalRecord } from "./canonical-memory-maintenance-records.ts";
import { saveCanonicalSnapshot } from "./canonical-memory-maintenance-storage.ts";
import { requireTransitionLocalClosure } from "./memory-transition-local-capture.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import type { Database } from "./sqlite.ts";
import { insertCanonicalHistoricalReference } from "./canonical-memory-historical-references.ts";
import { insertCanonicalSourceAlias, replaceCanonicalSourceSet } from "./canonical-memory-source-references.ts";

/** Call inside W4's outer transaction after target epoch allocation, before marker/receipt publication. */
export function installTransitionLocalCandidate(db: Database, candidateId: string): void {
  db.transaction(() => {
    const candidate = readVerifiedTransitionCandidate(db, candidateId);
    const selected = db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state WHERE singleton=1").get();
    const epoch = db.prepare("SELECT * FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: candidate.targetEpochId });
    if (!epoch || epoch.provider_id !== "local" || epoch.reason !== "planned-switch"
      || epoch.predecessor_epoch_id !== candidate.predecessorEpochId || selected?.active_epoch_id !== candidate.predecessorEpochId
      || db.prepare("SELECT 1 FROM canonical_memory_banks WHERE authority_epoch_id=:epoch LIMIT 1").get({ epoch: candidate.targetEpochId })) {
      throw new Error("MEMORY_TRANSITION_STALE");
    }
    requireTransitionLocalClosure(candidate.state);
    for (const bank of candidate.state.banks) insertBank(db, bank);
    for (const source of candidate.state.sources) upsertCanonicalSource(db, source, source.revision);
    for (const record of candidate.state.records) {
      insertCanonicalUnitAndPolicy(db, { unit: record.unit, policy: record.policy, searchTerms: "" });
      db.prepare("INSERT INTO canonical_memory_record_provenance VALUES(:epoch,:bank,:memory,:provenance)")
        .run({ epoch: record.unit.authorityEpochId, bank: record.unit.bankId, memory: record.unit.memoryId, provenance: JSON.stringify(record.provenance) });
      saveCanonicalSnapshot(db, record, candidate.createdAt);
    }
    for (const edge of candidate.state.historicalReferences) insertCanonicalHistoricalReference(db, candidate.targetEpochId, edge);
    for (const alias of candidate.state.sourceAliases) insertCanonicalSourceAlias(db, candidate.targetEpochId, alias);
    for (const set of candidate.state.sourceSets) replaceCanonicalSourceSet(db, { epochId: candidate.targetEpochId, ...set });
    for (const record of candidate.state.records) {
      const identity = { epochId: record.unit.authorityEpochId, bankId: record.unit.bankId, memoryId: record.unit.memoryId };
      for (const sourceMemoryId of record.unit.sourceMemoryIds) {
        if (!candidate.state.historicalReferences.some((edge) => edge.bankId === identity.bankId
          && edge.memoryId === identity.memoryId && edge.sourceMemoryId === sourceMemoryId)) addCanonicalLineage(db, { ...identity, sourceMemoryId });
      }
      upsertCanonicalFts(db, record.unit, record.unit.text);
      if (transitionLocalHash(readCanonicalRecord(db, identity)) !== transitionLocalHash(record)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    }
    for (const derived of candidate.state.derived) {
      db.prepare("INSERT INTO canonical_memory_derived VALUES(:epoch,:bank,:id,:kind,:payload,:revision)")
        .run({ epoch: derived.authorityEpochId, bank: derived.bankId, kind: derived.payload.kind,
          id: derived.payload.kind === "mental_model" ? derived.payload.mentalModelId : derived.payload.directiveId,
          payload: JSON.stringify(derived.payload), revision: derived.objectRevision });
    }
    // Blocks are global current state. Their guarded publication remains in W4's full transaction; writing them while
    // merely staging this unselected epoch would alter the still-selected provider's view.
  });
}
function insertBank(db: Database, bank: CanonicalMemoryBank): void {
  db.prepare(`INSERT INTO canonical_memory_banks(authority_epoch_id,bank_id,scope_kind,character_id,name,disposition_json,
    mission,config_json,revision,created_at,updated_at) VALUES(:epoch,:bank,:scope,:character,:name,:disposition,:mission,:config,:revision,:created,:updated)`)
    .run({ epoch: bank.authorityEpochId, bank: bank.bankId, scope: bank.scope.kind, character: bank.scope.characterId,
      name: bank.name, disposition: JSON.stringify(bank.disposition), mission: bank.mission, config: JSON.stringify(bank.config),
      revision: bank.revision, created: bank.createdAt, updated: bank.updatedAt });
}
