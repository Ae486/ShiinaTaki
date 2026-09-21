/**
 * INPUT:  Core-minted operation identity, sealed request, producer refs and CAS state patches
 * OUTPUT: durable memory_operations rows: admitted insert, state-CAS transition, reads and restart reconciliation
 * POS:    core/db — the operation ledger; single-flight is the partial unique index, not application locking
 */
import { z } from "zod";
import {
  MEMORY_OPERATION_TERMINAL_STATES, MemoryOperationSchema, type MemoryOperation, type MemoryOperationKind, type MemoryOperationProducerRef, type MemoryOperationRequest,
  type MemoryOperationState,
} from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";

interface AdmitInput {
  operationId: string; kind: MemoryOperationKind; family: string; authorityEpochId: string | null;
  request: MemoryOperationRequest; producer: MemoryOperationProducerRef; bootId: string;
}
type Patch = Partial<Pick<MemoryOperation, "state" | "reason" | "producer" | "result" | "errorCode">>;
interface TransitionInput { operationId: string; expectedState: MemoryOperationState; patch: Patch }

export interface MemoryOperationRepo {
  insertAdmitted(input: AdmitInput): MemoryOperation;
  transition(input: TransitionInput): MemoryOperation;
  get(operationId: string): MemoryOperation | undefined;
  activeInFamily(family: string): MemoryOperation | undefined;
  /** The newest row of a family, terminal or not; the per-family read the onboarding status derives actions from. */
  latestInFamily(family: string): MemoryOperation | undefined;
  listActive(): MemoryOperation[];
  listRecent(limit: number): MemoryOperation[];
  /** Non-terminal rows another boot owns, oldest first; read-only input for per-kind boot observation. */
  listForeign(bootId: string): MemoryOperation[];
  /** Rows a previous process left non-terminal become outcome_unknown/core_restart; returns the reconciled rows. */
  reconcileForeign(bootId: string): MemoryOperation[];
}

const COLUMNS = "operation_id,kind,family,state,reason,authority_epoch_id,request_json,producer_json,result_json,error_code,owner_boot_id,created_at,updated_at,terminal_at";

const FOREIGN_OPEN = `SELECT ${COLUMNS} FROM memory_operations WHERE terminal_at IS NULL AND owner_boot_id<>:boot ORDER BY created_at,operation_id`;

export function createMemoryOperationRepo(db: Database, now: () => string = () => new Date().toISOString()): MemoryOperationRepo {
  const clock = () => z.iso.datetime({ offset: true }).parse(now());
  return {
    insertAdmitted: (input) => insertAdmitted(db, input, clock()),
    transition: (input) => transition(db, input, clock()),
    get: (operationId) => optional(db.prepare(`SELECT ${COLUMNS} FROM memory_operations WHERE operation_id=:id`).get({ id: operationId })),
    activeInFamily: (family) => optional(db.prepare(`SELECT ${COLUMNS} FROM memory_operations WHERE family=:family AND terminal_at IS NULL`).get({ family })),
    latestInFamily: (family) => optional(db.prepare(`SELECT ${COLUMNS} FROM memory_operations WHERE family=:family ORDER BY created_at DESC,rowid DESC LIMIT 1`).get({ family })),
    listActive: () => db.prepare(`SELECT ${COLUMNS} FROM memory_operations WHERE terminal_at IS NULL ORDER BY created_at,operation_id`).all().map(parseRow),
    listRecent: (limit) => db.prepare(`SELECT ${COLUMNS} FROM memory_operations WHERE terminal_at IS NOT NULL ORDER BY terminal_at DESC,operation_id LIMIT :limit`)
      .all({ limit: z.int().min(1).max(50).parse(limit) }).map(parseRow),
    listForeign: (bootId) => db.prepare(FOREIGN_OPEN).all({ boot: bootId }).map(parseRow),
    reconcileForeign: (bootId) => reconcileForeign(db, bootId, clock()),
  };
}

function insertAdmitted(db: Database, input: AdmitInput, at: string): MemoryOperation {
  const operation = MemoryOperationSchema.parse({
    operationId: input.operationId, kind: input.kind, state: "admitted", reason: null, authorityEpochId: input.authorityEpochId,
    request: input.request, producer: input.producer, result: null, errorCode: null, createdAt: at, updatedAt: at, terminalAt: null,
  });
  try {
    db.prepare(`INSERT INTO memory_operations (${COLUMNS}) VALUES (:id,:kind,:family,:state,NULL,:epoch,:request,:producer,NULL,NULL,:boot,:at,:at,NULL)`)
      .run({ id: operation.operationId, kind: operation.kind, family: input.family, state: operation.state, epoch: operation.authorityEpochId,
        request: JSON.stringify(operation.request), producer: JSON.stringify(operation.producer), boot: input.bootId, at });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: memory_operations\.family/.test(error.message)) throw new Error("MEMORY_OPERATION_BUSY", { cause: error });
    throw error;
  }
  return operation;
}

function transition(db: Database, input: TransitionInput, at: string): MemoryOperation {
  let result: MemoryOperation | undefined;
  db.transaction(() => {
    const current = optional(db.prepare(`SELECT ${COLUMNS} FROM memory_operations WHERE operation_id=:id`).get({ id: input.operationId }));
    if (!current) throw new Error("MEMORY_OPERATION_NOT_FOUND");
    if (current.state !== input.expectedState || current.terminalAt !== null) throw new Error("MEMORY_OPERATION_STATE_CONFLICT");
    const state = input.patch.state ?? current.state;
    result = MemoryOperationSchema.parse({ ...current, ...input.patch, state, updatedAt: at,
      terminalAt: MEMORY_OPERATION_TERMINAL_STATES.includes(state) ? at : null });
    const changes = db.prepare(`UPDATE memory_operations SET state=:state,reason=:reason,producer_json=:producer,result_json=:result,
      error_code=:error,updated_at=:at,terminal_at=:terminal WHERE operation_id=:id AND state=:expected AND terminal_at IS NULL`).run({
      state: result.state, reason: result.reason, producer: result.producer ? JSON.stringify(result.producer) : null,
      result: result.result ? JSON.stringify(result.result) : null, error: result.errorCode, at, terminal: result.terminalAt,
      id: input.operationId, expected: input.expectedState,
    }).changes;
    if (changes !== 1) throw new Error("MEMORY_OPERATION_STATE_CONFLICT");
  });
  if (!result) throw new Error("MEMORY_OPERATION_STATE_CONFLICT");
  return result;
}

function reconcileForeign(db: Database, bootId: string, at: string): MemoryOperation[] {
  const reconciled: MemoryOperation[] = [];
  db.transaction(() => {
    const rows = db.prepare(FOREIGN_OPEN).all({ boot: bootId }).map(parseRow);
    for (const row of rows) {
      const next = MemoryOperationSchema.parse({ ...row, state: "outcome_unknown", reason: "core_restart", updatedAt: at, terminalAt: at });
      db.prepare("UPDATE memory_operations SET state='outcome_unknown',reason='core_restart',updated_at=:at,terminal_at=:at WHERE operation_id=:id")
        .run({ at, id: row.operationId });
      reconciled.push(next);
    }
  });
  return reconciled;
}

function optional(row: SqlRow | undefined): MemoryOperation | undefined {
  return row ? parseRow(row) : undefined;
}

function parseRow(row: SqlRow): MemoryOperation {
  const json = (value: unknown) => (value === null || value === undefined ? null : JSON.parse(String(value)));
  return MemoryOperationSchema.parse({
    operationId: row.operation_id, kind: row.kind, state: row.state, reason: row.reason, authorityEpochId: row.authority_epoch_id,
    request: json(row.request_json), producer: json(row.producer_json), result: json(row.result_json), errorCode: row.error_code,
    createdAt: row.created_at, updatedAt: row.updated_at, terminalAt: row.terminal_at,
  });
}
