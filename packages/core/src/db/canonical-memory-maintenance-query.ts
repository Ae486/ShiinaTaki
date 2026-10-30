/**
 * INPUT:  active Local authority and captured Character/Bank scopes
 * OUTPUT: full valid scoped records, source evidence, and content-free all-Bank retention candidates
 * POS:    core/db — Local maintenance query surface; expired records remain visible to retention
 */
import { z } from "zod";
import type { CanonicalMemoryRecord } from "@taki/shared";
import type {
  CanonicalMaintenanceMutation, CanonicalMaintenanceRetentionRow, CanonicalMemoryMaintenanceRepo,
} from "./canonical-memory-maintenance-contract.ts";
import { readCanonicalEvidenceSources } from "./canonical-memory-maintenance-evidence.ts";
import { canonicalPolicyFromRow, readCanonicalRecord, readCanonicalSource,
  requireCanonicalRecord } from "./canonical-memory-maintenance-records.ts";
import { assertCanonicalLocalAuthority, assertCanonicalMaintenanceScope } from "./canonical-memory-maintenance-storage.ts";
import type { Database } from "./sqlite.ts";

const Id = z.string().min(1).max(256);
const List = z.strictObject({ epochId: Id, characterId: Id.nullable(), layerIds: z.array(Id).max(64).optional(),
  includeInvalidated: z.boolean().optional() });

export function createCanonicalMaintenanceQueries(db: Database): Pick<CanonicalMemoryMaintenanceRepo,
  "list" | "listRetention" | "record" | "source" | "evidenceSources"> {
  return {
    list: (input) => list(db, input),
    listRetention: (input) => listRetention(db, input.epochId),
    record(input) {
      assertCanonicalMaintenanceScope(db, input); Id.parse(input.memoryId);
      return readCanonicalRecord(db, input);
    },
    source(input) {
      assertCanonicalMaintenanceScope(db, input); Id.parse(input.documentId);
      return readCanonicalSource(db, input);
    },
    evidenceSources(input) {
      assertCanonicalMaintenanceScope(db, input); Id.parse(input.memoryId);
      return readCanonicalEvidenceSources(db, input);
    },
  };
}

function list(db: Database, raw: Parameters<CanonicalMemoryMaintenanceRepo["list"]>[0]): CanonicalMemoryRecord[] {
  const input = List.parse(raw); assertCanonicalLocalAuthority(db, input.epochId);
  const rows = db.prepare(`SELECT u.bank_id,u.memory_id FROM canonical_memory_units u
    JOIN canonical_memory_banks b ON b.authority_epoch_id=u.authority_epoch_id AND b.bank_id=u.bank_id
    JOIN canonical_memory_policy p ON p.authority_epoch_id=u.authority_epoch_id AND p.bank_id=u.bank_id AND p.memory_id=u.memory_id
    WHERE u.authority_epoch_id=:epoch AND (:invalidated=1 OR u.state='valid')
      AND (b.scope_kind='global' OR b.scope_kind='character' AND b.character_id=:character)
      AND (:all_layers=1 OR p.layer_id IN (SELECT value FROM json_each(:layers)))
    ORDER BY CASE b.scope_kind WHEN 'global' THEN 0 ELSE 1 END,u.bank_id,u.memory_id`)
    .all({ epoch: input.epochId, character: input.characterId, invalidated: input.includeInvalidated ? 1 : 0,
      all_layers: input.layerIds === undefined || input.layerIds.length === 0 ? 1 : 0,
      layers: JSON.stringify(input.layerIds ?? []) });
  return rows.map((row) => requireCanonicalRecord(db, { epochId: input.epochId,
    bankId: String(row.bank_id), memoryId: String(row.memory_id) }));
}

function listRetention(db: Database, epochId: string): CanonicalMaintenanceRetentionRow[] {
  assertCanonicalLocalAuthority(db, epochId);
  const rows = db.prepare(`SELECT p.*,p.updated_at AS policy_updated,b.character_id,
    u.revision,u.created_at AS unit_created_at,u.updated_at AS unit_updated_at
    FROM canonical_memory_units u JOIN canonical_memory_banks b ON b.authority_epoch_id=u.authority_epoch_id AND b.bank_id=u.bank_id
    JOIN canonical_memory_policy p ON p.authority_epoch_id=u.authority_epoch_id AND p.bank_id=u.bank_id AND p.memory_id=u.memory_id
    WHERE u.authority_epoch_id=:epoch AND u.state='valid' ORDER BY u.bank_id,u.memory_id`).all({ epoch: epochId });
  return rows.map((row) => ({ epochId, bankId: String(row.bank_id), memoryId: String(row.memory_id),
    characterId: row.character_id === null ? null : String(row.character_id), revision: Number(row.revision),
    createdAt: String(row.unit_created_at), updatedAt: String(row.unit_updated_at), policy: canonicalPolicyFromRow(row) }));
}

export function requireExpectedCanonicalRecord(db: Database, input: CanonicalMaintenanceMutation): CanonicalMemoryRecord {
  const record = requireCanonicalRecord(db, input);
  if (record.unit.revision !== input.expectedRevision) throw new Error(`MEMORY_REVISION_MISMATCH:${record.unit.revision}`);
  return record;
}
