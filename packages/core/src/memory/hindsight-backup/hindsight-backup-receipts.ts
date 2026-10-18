/**
 * INPUT:  Core SQLite (Pending 035, D77 application command jobs 044) scoped to one Hindsight epoch, lineage and Bank set
 * OUTPUT: HINDSIGHT_BACKUP_RECEIPT_MAP (every Core terminal write kind -> the native table that proves it, or cursor-only)
 *         and readHindsightTerminalOperations() -> the printable-ASCII ids the native route checks for membership
 * POS:    core/memory/hindsight-backup — design ruling 3; pure synchronous read, called inside the capture's one Core read
 */
import type { Database } from "../../db/sqlite.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { TemplateBankIdentitySchema } from "../hindsight/template-lifecycle/template-overlay-schema.ts";
import { readHindsightTemplateAttestation } from "./hindsight-template-backup-attestation.ts";

export interface HindsightBackupReceiptRule {
  core: string;
  /** The native table whose row proves the effect; null means the Bank cursor comparison is the only proof. */
  native: "memory_native_operation_receipts" | "memory_mutation_receipts" | "memory_application_operations"
    | "memory_template_receipts" | "memory_template_refresh_results" | null;
  id: string | null;
}

/** Pinned by test: a new Core terminal write kind must be added here with its native proof before capture may claim it. */
export const HINDSIGHT_BACKUP_RECEIPT_MAP: readonly HindsightBackupReceiptRule[] = Object.freeze([
  { core: "pending tracked_native_v1 retain, native-confirmed", native: "memory_native_operation_receipts",
    id: "native-operation:<bankId>:<bankGeneration>:retain:<remoteOperationId>" },
  { core: "pending tracked_native_v1 edit/invalidate/restore, native-confirmed", native: "memory_native_operation_receipts",
    id: "native-operation:<bankId>:<bankGeneration>:mutation:<remoteOperationId>" },
  { core: "pending legacy edit/invalidate/restore, native-confirmed", native: "memory_mutation_receipts",
    id: "mutation-receipt:<bankId>:<remoteOperationId>" },
  { core: "pending legacy retain, native-confirmed", native: null, id: null },
  { core: "D77 application command job completed", native: "memory_application_operations",
    id: "application-operation:<providerLineage>:<bankId>:<bankGeneration>:<operationId>" },
  { core: "D77 memory write intent completed (047)", native: null, id: null },
  { core: "ingestion span, outbox evidence", native: null, id: null },
  { core: "ingestion span, provider evidence", native: null, id: null },
  { core: "policy work request (045)", native: null, id: null },
  { core: "observed write", native: null, id: null },
  { core: "primary conversation witness", native: null, id: null },
  { core: "B2 original template Apply receipt, published", native: "memory_template_receipts", id: "template-receipt:<request UUID>" },
  { core: "B2 persisted semantic refresh-result marker claim", native: "memory_template_refresh_results", id: "template-refresh-result:<child UUID>" },
]);

export interface HindsightTerminalScope {
  epochId: string;
  providerLineageId: string;
  /** Native Bank id -> its current Core generation; receipts of an older generation are not this Bank's history. */
  generations: ReadonlyMap<string, string>;
  /** Explicit v2 opt-in keeps historical v1 membership bytes unchanged. */
  includeTemplates?: boolean;
}

export function readHindsightTerminalOperations(db: Database, scope: HindsightTerminalScope): string[] {
  return [...pendingOperations(db, scope), ...applicationOperations(db, scope), ...scope.includeTemplates ? templateOperations(db, scope) : []];
}

function templateOperations(db: Database, scope: HindsightTerminalScope): string[] {
  const identities = createHindsightBankSetupRepo(db).list().flatMap((bank) => {
    const generation = scope.generations.get(bank.externalBankId);
    return generation ? [TemplateBankIdentitySchema.parse({ scope: bank.scope, canonicalIdentity: bank.canonicalIdentity,
      target: { provider_lineage: scope.providerLineageId, bank_id: bank.externalBankId, bank_generation: generation } })] : [];
  });
  if (identities.length !== scope.generations.size) throw new Error("HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN");
  return readHindsightTemplateAttestation(db, { epochId: scope.epochId, providerLineageId: scope.providerLineageId, identities }).operationIds;
}

function pendingOperations(db: Database, scope: HindsightTerminalScope): string[] {
  const rows = db.prepare(`SELECT bank_id, operation_kind,
      json_extract(state_json,'$.remoteOperationId') AS remote, json_extract(state_json,'$.intent.bankGeneration') AS generation,
      coalesce(json_extract(state_json,'$.dispatch.protocol'),'legacy_native_v1') AS protocol
    FROM pending_memory WHERE authority_epoch_id=:epoch
      AND (json_type(state_json,'$.nativeReceipt')='object' OR json_type(state_json,'$.nativeResultReceipt')='object')
    ORDER BY sequence`).all({ epoch: scope.epochId });
  return rows.flatMap((row) => {
    const bankId = String(row.bank_id); const generation = String(row.generation);
    if (scope.generations.get(bankId) !== generation) return [];
    const kind = row.operation_kind === "retain" ? "retain" : "mutation";
    if (row.protocol === "tracked_native_v1") return [`native-operation:${bankId}:${generation}:${kind}:${String(row.remote)}`];
    return kind === "mutation" ? [`mutation-receipt:${bankId}:${String(row.remote)}`] : [];
  });
}

function applicationOperations(db: Database, scope: HindsightTerminalScope): string[] {
  const rows = db.prepare(`SELECT bank_id, bank_generation, operation_id FROM hindsight_application_command_jobs
    WHERE authority_epoch_id=:epoch AND provider_lineage=:lineage AND state='completed' ORDER BY prepared_at, operation_id`)
    .all({ epoch: scope.epochId, lineage: scope.providerLineageId });
  return rows.flatMap((row) => {
    const bankId = String(row.bank_id); const generation = String(row.bank_generation);
    if (scope.generations.get(bankId) !== generation) return [];
    return [`application-operation:${scope.providerLineageId}:${bankId}:${generation}:${String(row.operation_id)}`];
  });
}
