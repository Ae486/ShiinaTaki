/**
 * INPUT:  Core Database wrapper and canonical authority/Bank values
 * OUTPUT: explicit Local initialization, provider-neutral active-epoch reads, and scoped Local Bank persistence
 * POS:    core/db — authority-state reader plus Local-only creation; Hindsight promotion has a separate transaction
 */
import { randomUUID } from "node:crypto";
import { CanonicalMemoryBankSchema, MemoryAuthorityEpochSchema, type CanonicalMemoryBank, type MemoryAuthorityEpoch } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";

const NOW = () => new Date().toISOString();
export interface CanonicalMemoryAuthorityRepo {
  initializeLocalAuthority(now?: string): MemoryAuthorityEpoch;
  authorityEpoch(expectedEpochId?: string): MemoryAuthorityEpoch;
  activeEpoch(expectedEpochId?: string): MemoryAuthorityEpoch;
  createBank(input: Omit<CanonicalMemoryBank, "revision" | "createdAt" | "updatedAt"> & Partial<Pick<CanonicalMemoryBank, "revision" | "createdAt" | "updatedAt">>): CanonicalMemoryBank;
  getBank(epochId: string, bankId: string): CanonicalMemoryBank | undefined;
  listBanks(epochId: string): CanonicalMemoryBank[];
}

export function createCanonicalMemoryAuthorityRepo(db: Database): CanonicalMemoryAuthorityRepo {
  return {
    initializeLocalAuthority: (now) => initialize(db, now),
    authorityEpoch: (expected) => readAuthority(db, expected),
    activeEpoch: (expected) => requireActiveLocal(readAuthority(db, expected)),
    createBank: (input) => createBank(db, input),
    getBank: (epoch, bank) => readBank(db, { epochId: epoch, bankId: bank }),
    listBanks: (epoch) => listBanks(db, epoch),
  };
}
function initialize(db: Database, now = NOW()): MemoryAuthorityEpoch {
  const existing = db.prepare("SELECT e.* FROM canonical_memory_authority_state s JOIN canonical_memory_authority_epochs e ON e.epoch_id=s.active_epoch_id WHERE s.singleton=1").get();
  if (existing) return requireActiveLocal(parseEpoch(existing));
  const orphan = db.prepare("SELECT count(*) AS count FROM canonical_memory_authority_epochs WHERE status='active'").get();
  if (Number(orphan?.count ?? 0) !== 0) throw new Error("MEMORY_INTEGRITY_ERROR: active epoch has no authority pointer");
  const epochId = randomUUID(); const lineage = randomUUID();
  db.transaction(() => {
    db.prepare("INSERT INTO canonical_memory_authority_epochs (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason) VALUES (:epoch_id,'local',:lineage,'active',NULL,:started_at,NULL,'initial-local')").run({ epoch_id: epochId, lineage, started_at: now });
    db.prepare("INSERT INTO canonical_memory_authority_state (singleton,active_epoch_id,updated_at) VALUES (1,:epoch_id,:updated_at)").run({ epoch_id: epochId, updated_at: now });
  });
  return { epochId, providerId: "local", providerLineageId: lineage, mode: "authority", status: "active", predecessorEpochId: null, startedAt: now, endedAt: null, reason: "initial-local" };
}
function readAuthority(db: Database, expected?: string): MemoryAuthorityEpoch {
  const row = db.prepare("SELECT e.* FROM canonical_memory_authority_state s JOIN canonical_memory_authority_epochs e ON e.epoch_id=s.active_epoch_id WHERE s.singleton=1").get();
  if (!row) throw new Error("MEMORY_INTEGRITY_ERROR: active authority missing");
  const epoch = parseEpoch(row);
  if (epoch.status !== "active") throw new Error("MEMORY_INTEGRITY_ERROR: authority epoch is closed");
  if (expected && expected !== epoch.epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  return epoch;
}
function requireActiveLocal(epoch: MemoryAuthorityEpoch): MemoryAuthorityEpoch {
  if (epoch.status !== "active" || epoch.providerId !== "local" || epoch.reason !== "initial-local") {
    throw new Error("MEMORY_INTEGRITY_ERROR: Local authority is not active");
  }
  return epoch;
}
function parseEpoch(row: SqlRow): MemoryAuthorityEpoch {
  return MemoryAuthorityEpochSchema.parse({ epochId: row.epoch_id, providerId: row.provider_id, providerLineageId: row.provider_lineage_id, mode: "authority", status: row.status, predecessorEpochId: row.predecessor_epoch_id, startedAt: row.started_at, endedAt: row.ended_at, reason: row.reason });
}
function createBank(db: Database, input: Omit<CanonicalMemoryBank, "revision" | "createdAt" | "updatedAt"> & Partial<Pick<CanonicalMemoryBank, "revision" | "createdAt" | "updatedAt">>): CanonicalMemoryBank {
  const createdAt = input.createdAt ?? NOW(); const updatedAt = input.updatedAt ?? createdAt; const revision = input.revision ?? 1;
  requireActiveLocal(readAuthority(db, input.authorityEpochId));
  const bank = CanonicalMemoryBankSchema.parse({ ...input, revision, createdAt, updatedAt });
  const row = { authority_epoch_id: bank.authorityEpochId, bank_id: bank.bankId, scope_kind: bank.scope.kind, character_id: bank.scope.characterId, name: bank.name, disposition_json: JSON.stringify(bank.disposition), mission: bank.mission, config_json: JSON.stringify(bank.config), revision, created_at: createdAt, updated_at: updatedAt };
  db.prepare("INSERT INTO canonical_memory_banks (authority_epoch_id,bank_id,scope_kind,character_id,name,disposition_json,mission,config_json,revision,created_at,updated_at) VALUES (:authority_epoch_id,:bank_id,:scope_kind,:character_id,:name,:disposition_json,:mission,:config_json,:revision,:created_at,:updated_at)").run(row);
  return bank;
}
function parseBank(row: SqlRow): CanonicalMemoryBank {
  return CanonicalMemoryBankSchema.parse({ authorityEpochId: row.authority_epoch_id, bankId: row.bank_id, scope: row.scope_kind === "global" ? { kind: "global", characterId: null } : { kind: "character", characterId: row.character_id }, name: row.name, disposition: JSON.parse(String(row.disposition_json)), mission: row.mission, config: JSON.parse(String(row.config_json)), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });
}
function readBank(db: Database, input: { epochId: string; bankId: string }): CanonicalMemoryBank | undefined { const row = db.prepare("SELECT * FROM canonical_memory_banks WHERE authority_epoch_id=:epoch AND bank_id=:bank").get({ epoch: input.epochId, bank: input.bankId }); return row ? parseBank(row) : undefined; }
function listBanks(db: Database, epochId: string): CanonicalMemoryBank[] { return db.prepare("SELECT * FROM canonical_memory_banks WHERE authority_epoch_id=:epoch ORDER BY scope_kind,character_id").all({ epoch: epochId }).map(parseBank); }
