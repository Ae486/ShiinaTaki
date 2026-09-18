/**
 * INPUT:  active Hindsight authority/Bank guards and immutable foreground write intents
 * OUTPUT: original target capture, independent child evidence and stable full-operation receipts
 * POS:    core/db — parent write journal; an old G1 receipt never certifies an unapplied policy change
 */
import { z } from "zod";
import { TakiApplicationTimeSchema, type TakiApplicationNamespace } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { HindsightApplicationCommandKeySchema, type HindsightApplicationCommandGuard,
  type HindsightApplicationCommandKey } from "./hindsight-application-command-contract.ts";
import { HindsightMemoryWriteIdentitySchema, HindsightMemoryWriteTerminalSchema, hindsightMemoryWriteIntentHash,
  type HindsightMemoryWriteIdentity, type HindsightMemoryWriteJob, type HindsightMemoryWriteState,
  type HindsightMemoryWriteTarget, type HindsightMemoryWriteTerminal } from "./hindsight-memory-write-contract.ts";
import { decodeHindsightMemoryWrite, insertHindsightMemoryWrite, readHindsightMemoryWrite,
  replaceHindsightMemoryWrite } from "./hindsight-memory-write-storage.ts";
import { sameApplicationValue } from "../memory/hindsight/hindsight-application-integrity.ts";

interface Dependencies { db: Database; assertActive(input: HindsightApplicationCommandGuard): void; now?: () => string }
interface Prepare {
  identity: HindsightMemoryWriteIdentity; nativeOperationId: string | null; target: HindsightMemoryWriteTarget | null;
  terminal?: HindsightMemoryWriteTerminal;
}
interface Compare { key: HindsightApplicationCommandKey; revision: number }
interface PendingInput { authorityEpochId: string; bankId: string; namespace?: TakiApplicationNamespace; afterSequence?: number; limit?: number }
export interface HindsightMemoryWriteRepo {
  get(key: HindsightApplicationCommandKey): HindsightMemoryWriteJob | undefined;
  prepare(input: Prepare): HindsightMemoryWriteJob;
  pending(input: PendingInput): HindsightMemoryWriteJob[];
  ownsNativeMutation(input: { authorityEpochId: string; operationId: string }): boolean;
  application(input: Compare & { command: HindsightApplicationCommandKey }): HindsightMemoryWriteJob;
  references(input: Compare & { value: NonNullable<HindsightMemoryWriteState["references"]> }): HindsightMemoryWriteJob;
  finish(input: Compare & { terminal: HindsightMemoryWriteTerminal }): HindsightMemoryWriteJob;
}

export function createHindsightMemoryWriteRepo(deps: Dependencies): HindsightMemoryWriteRepo {
  return {
    get: (key) => get(deps, key), prepare: (input) => prepare(deps, input),
    pending: (input) => pending(deps, input),
    ownsNativeMutation: (input) => {
      const rows = deps.db.prepare(`SELECT * FROM hindsight_memory_write_intents
        WHERE authority_epoch_id=:epoch AND native_operation_id=:operation`).all({ epoch: input.authorityEpochId, operation: input.operationId });
      return rows.some((row) => decodeHindsightMemoryWrite(row).identity.operation.kind === "mutation");
    },
    application: (input) => change(deps, input, (job) => ({ ...job, applicationKey: immutable(job.applicationKey, input.command) })),
    references: (input) => change(deps, input, (job) => ({ ...job, references: immutable(job.references, input.value) })),
    finish: (input) => change(deps, input, (job) => ({ ...job, terminal: immutable(job.terminal, HindsightMemoryWriteTerminalSchema.parse(input.terminal)) })),
  };
}

function get(deps: Dependencies, key: HindsightApplicationCommandKey): HindsightMemoryWriteJob | undefined {
  const job = readHindsightMemoryWrite(deps.db, HindsightApplicationCommandKeySchema.parse(key));
  if (job) assertActive(deps, job.identity); return job;
}
function prepare(deps: Dependencies, input: Prepare): HindsightMemoryWriteJob {
  const identity = HindsightMemoryWriteIdentitySchema.parse(input.identity);
  if (!sameApplicationValue(identity, input.identity)) throw new Error("MEMORY_INVALID_REQUEST");
  return atomic(deps, identity, () => {
    const intentHash = hindsightMemoryWriteIntentHash(identity); const previous = get(deps, identity.key);
    if (previous) {
      if (previous.intentHash !== intentHash || !sameApplicationValue(previous.identity.namespace, identity.namespace)) {
        throw new Error("MEMORY_REQUEST_ID_CONFLICT");
      }
      return previous;
    }
    const at = timestamp(deps);
    return insertHindsightMemoryWrite(deps.db, { identity, intentHash, preparedAt: at, updatedAt: at, revision: 1,
      nativeOperationId: input.nativeOperationId, target: input.target, applicationKey: null, references: null,
      terminal: input.terminal ?? null });
  });
}
function change(deps: Dependencies, input: Compare, update: (job: HindsightMemoryWriteJob) => HindsightMemoryWriteJob): HindsightMemoryWriteJob {
  const captured = get(deps, input.key); if (!captured) throw new Error("MEMORY_NOT_FOUND");
  return atomic(deps, captured.identity, () => {
    const job = get(deps, input.key); if (!job) throw new Error("MEMORY_NOT_FOUND");
    const next = update(job);
    if (sameApplicationValue(next, job)) return job;
    if (job.terminal !== null || job.revision !== input.revision) throw new Error("MEMORY_REVISION_MISMATCH");
    const { sequence, ...state } = next;
    if (sequence !== job.sequence) throw new Error("MEMORY_INTEGRITY_ERROR");
    return replaceHindsightMemoryWrite(deps.db, { previous: job, next: { ...state, revision: job.revision + 1, updatedAt: timestamp(deps) } });
  });
}
function pending(deps: Dependencies, input: PendingInput): HindsightMemoryWriteJob[] {
  const args = { epoch: z.string().min(1).max(256).parse(input.authorityEpochId), bank: z.string().min(1).max(256).parse(input.bankId),
    after: z.int().min(0).parse(input.afterSequence ?? 0), limit: z.int().min(1).max(100).parse(input.limit ?? 100),
    lineage: input.namespace?.provider_lineage ?? null, generation: input.namespace?.bank_generation ?? null };
  const rows = deps.db.prepare(`SELECT * FROM hindsight_memory_write_intents
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND state='pending' AND sequence>:after
      AND (:lineage IS NULL OR provider_lineage=:lineage) AND (:generation IS NULL OR bank_generation=:generation)
    ORDER BY sequence LIMIT :limit`).all(args);
  return rows.map((row) => { const job = decodeHindsightMemoryWrite(row); assertActive(deps, job.identity); return job; });
}
function immutable<T>(previous: T | null, next: T): T {
  if (previous !== null && !sameApplicationValue(previous, next)) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  return previous ?? next;
}
function timestamp(deps: Dependencies): string { return TakiApplicationTimeSchema.parse(deps.now?.() ?? new Date().toISOString()); }
function assertActive(deps: Dependencies, guard: HindsightApplicationCommandGuard): void {
  if (Object.prototype.toString.call(deps.assertActive) === "[object AsyncFunction]") throw new Error("MEMORY_INVALID_REQUEST");
  const result: unknown = deps.assertActive(guard);
  if (result !== null && typeof result === "object" && "then" in result) throw new Error("MEMORY_INVALID_REQUEST");
}
function atomic<T>(deps: Dependencies, guard: HindsightApplicationCommandGuard, action: () => T): T {
  let result: { value: T } | undefined;
  deps.db.transaction(() => { assertActive(deps, guard); result = { value: action() }; assertActive(deps, guard); });
  if (!result) throw new Error("MEMORY_INTERNAL_ERROR"); return result.value;
}
