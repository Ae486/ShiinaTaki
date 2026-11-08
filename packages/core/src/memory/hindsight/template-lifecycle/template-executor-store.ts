/**
 * INPUT:  one immutable plan and explicit execution/recovery admission on the current authority epoch
 * OUTPUT: bounded producer lease, monotonic checkpoint CAS and quarantine-safe executor ownership
 * POS:    template producer ownership is independent of generic failed/unknown operation rows
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MemoryTemplateErrorCodeSchema, MemoryTemplatePhaseSchema } from "@taki/shared";
import type { Database } from "../../../db/sqlite.ts";
import { readCurrentMemoryAuthorityIdentity } from "../../legacy-migration/legacy-activation-repo.ts";
import { readTemplateHold } from "./template-execution-reads.ts";

export const TEMPLATE_EXECUTOR_LEASE_MS = 300_000;
export const TEMPLATE_EXECUTOR_HEARTBEAT_MS = 30_000;
export const TemplateExecutorSchema = z.strictObject({
  planId: z.uuid(), generation: z.int().min(0), revision: z.int().min(0), operationId: z.uuid(), bootId: z.string().min(1),
  token: z.uuid().nullable(), deadlineMs: z.int().min(0), phase: MemoryTemplatePhaseSchema,
  errorCode: MemoryTemplateErrorCodeSchema.nullable(), updatedAt: z.iso.datetime({ offset: true }),
});
export type TemplateExecutor = z.infer<typeof TemplateExecutorSchema>;
export type TemplateExecutorLease = TemplateExecutor & { token: string };

export function readTemplateExecutor(db: Database, planId: string): TemplateExecutor {
  const row = db.prepare("SELECT * FROM hindsight_template_executors WHERE plan_id=:id").get({ id: planId });
  if (!row) throw new Error("MEMORY_TEMPLATE_PLAN_NOT_FOUND");
  return TemplateExecutorSchema.parse({ planId: row.plan_id, generation: row.generation, revision: row.revision,
    operationId: row.operation_id, bootId: row.boot_id, token: row.token, deadlineMs: row.deadline_ms,
    phase: row.phase, errorCode: row.error_code, updatedAt: row.updated_at });
}
export function claimTemplateExecutor(db: Database, input: {
  planId: string; operationId: string; bootId: string; now: string;
}): TemplateExecutorLease {
  let acquired: TemplateExecutorLease | undefined;
  db.transaction(() => {
    assertPlanActive(db, input.planId);
    const admission = db.prepare(`SELECT 1 FROM hindsight_template_admissions a JOIN memory_operations o
      ON o.operation_id=a.operation_id WHERE a.plan_id=:plan AND a.operation_id=:operation
      AND o.owner_boot_id=:boot AND o.state='running' AND o.terminal_at IS NULL`)
      .get({ plan: input.planId, operation: input.operationId, boot: input.bootId });
    if (!admission) lost();
    const previous = readTemplateExecutor(db, input.planId);
    const nowMs = Date.parse(input.now);
    if (previous.token && previous.bootId === input.bootId && previous.deadlineMs > nowMs) lost();
    const hold = readTemplateHold(db, input.planId);
    const next = { ...previous, generation: previous.generation + 1, revision: previous.revision + 1,
      operationId: input.operationId, bootId: input.bootId, token: randomUUID(), deadlineMs: nowMs + TEMPLATE_EXECUTOR_LEASE_MS,
      phase: hold?.state === "published" ? "rebinding" as const : "quiescing" as const, errorCode: null, updatedAt: input.now };
    writeExecutor(db, { previous, next });
    acquired = next;
  });
  if (!acquired) lost();
  return acquired;
}
export function assertTemplateExecutor(db: Database, input: { lease: TemplateExecutorLease; now: string }): void {
  assertPlanActive(db, input.lease.planId);
  const actual = readTemplateExecutor(db, input.lease.planId);
  const expected = input.lease;
  if (actual.generation !== expected.generation || actual.revision !== expected.revision || actual.operationId !== expected.operationId
    || actual.bootId !== expected.bootId || actual.token !== expected.token || actual.deadlineMs !== expected.deadlineMs
    || actual.deadlineMs <= Date.parse(input.now)) lost();
}
export function checkpointTemplateExecutor(db: Database, input: {
  lease: TemplateExecutorLease; now: string; phase?: TemplateExecutor["phase"]; errorCode?: TemplateExecutor["errorCode"]; finish?: boolean;
}): TemplateExecutorLease {
  let next: TemplateExecutorLease | undefined;
  db.transaction(() => {
    assertTemplateExecutor(db, input);
    next = { ...input.lease, revision: input.lease.revision + 1, phase: input.phase ?? input.lease.phase,
      errorCode: input.errorCode ?? null, updatedAt: input.now,
      deadlineMs: input.finish ? 0 : Date.parse(input.now) + TEMPLATE_EXECUTOR_LEASE_MS };
    writeExecutor(db, { previous: input.lease, next });
  });
  if (!next) lost();
  return next;
}
function assertPlanActive(db: Database, planId: string): void {
  const hold = readTemplateHold(db, planId);
  if (!hold || hold.state === "cancelled") lost();
  const quarantined = db.prepare(`SELECT 1 FROM hindsight_template_admissions a
    JOIN memory_transition_emergency_quarantine q ON q.operation_id=a.operation_id WHERE a.plan_id=:id LIMIT 1`).get({ id: planId });
  if (hold.state === "quarantined" || quarantined) throw new Error("MEMORY_TEMPLATE_QUARANTINED");
  const selection = readCurrentMemoryAuthorityIdentity(db);
  if (selection.mode !== "hindsight" || selection.epochId !== hold.epochId) throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
}
function writeExecutor(db: Database, input: { previous: TemplateExecutor; next: TemplateExecutor }): void {
  const next = TemplateExecutorSchema.parse(input.next); const old = input.previous;
  const changed = db.prepare(`UPDATE hindsight_template_executors SET generation=:generation,revision=:revision,
    operation_id=:operation,boot_id=:boot,token=:token,deadline_ms=:deadline,phase=:phase,error_code=:error,updated_at=:at
    WHERE plan_id=:id AND generation=:oldGeneration AND revision=:oldRevision AND operation_id=:oldOperation
      AND boot_id=:oldBoot AND token IS :oldToken AND deadline_ms=:oldDeadline`).run({
    id: next.planId, generation: next.generation, revision: next.revision, operation: next.operationId, boot: next.bootId,
    token: next.token, deadline: next.deadlineMs, phase: next.phase, error: next.errorCode, at: next.updatedAt,
    oldGeneration: old.generation, oldRevision: old.revision, oldOperation: old.operationId, oldBoot: old.bootId,
    oldToken: old.token, oldDeadline: old.deadlineMs,
  });
  if (changed.changes !== 1) lost();
}
function lost(): never { throw new Error("MEMORY_TEMPLATE_LEASE_LOST"); }
