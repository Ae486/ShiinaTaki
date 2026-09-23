/**
 * INPUT:  the authority marker, Local binding, B3 setup, Bank prerequisites, cutover run evidence, custody counters and the relevant operation
 * OUTPUT: MEMORY_ACTIVATION_METHODS plus one strict memory.activation.status read whose actions are Core-derived
 * POS:    shared/protocol — operator-only read invalidated through memory.operations.changed; no second subscription
 */
import { z } from "zod";
import { HindsightCutoverStatusSchema } from "./hindsight-cutover-schema.ts";
import { HindsightCurrentStatusSchema } from "./hindsight-current-status-schema.ts";
import { HindsightSetupPhaseSchema } from "./hindsight-setup-schema.ts";
import { MEMORY_OPERATION_TERMINAL_STATES, MemoryOperationSchema } from "./memory-operation-schema.ts";
import { BankScopeSchema, MemoryHindsightBlockingSchema } from "./memory-hindsight-operation-schema.ts";
import { MemoryRuntimeUnavailableReasonSchema } from "./memory-authority-status-schema.ts";

const Id = z.string().min(1).max(256);
const Timestamp = z.iso.datetime({ offset: true });
export const MEMORY_ACTIVATION_METHODS = { status: "memory.activation.status" } as const;
export const MemoryActivationStatusParamsSchema = z.strictObject({});
export const MemoryActivationReceiptSchema = z.strictObject({ transactionId: Id, epochId: Id, committedAt: Timestamp });
export const MemoryActivationRunSchema = z.strictObject({
  runId: Id, phase: HindsightCutoverStatusSchema.shape.phase, status: HindsightCutoverStatusSchema.shape.status,
  lease: HindsightCutoverStatusSchema.shape.lease, currentState: HindsightCurrentStatusSchema.nullable(),
  receipt: MemoryActivationReceiptSchema.nullable(),
});
export const MemoryActivationBankSchema = z.strictObject({
  scope: BankScopeSchema, characterId: Id.nullable(), localBankId: Id, nativeBankId: Id.nullable(), verified: z.boolean(),
});
export const MemoryActivationActionsSchema = z.strictObject({
  activate: z.boolean(), resume: z.boolean(), recoverBinding: z.boolean(), cancelOperationId: z.uuid().nullable(),
});
export const MemoryActivationStatusSchema = z.strictObject({
  authority: z.strictObject({ mode: z.enum(["legacy-markdown", "canonical-local", "hindsight"]), epochId: Id.nullable() }),
  runtime: z.strictObject({ available: z.boolean(), unavailableReason: MemoryRuntimeUnavailableReasonSchema.nullable() }),
  setup: z.strictObject({ phase: HindsightSetupPhaseSchema, revision: z.int().nonnegative(), configured: z.boolean() }),
  prerequisites: z.strictObject({ banks: z.array(MemoryActivationBankSchema).max(256), blocking: z.array(MemoryHindsightBlockingSchema).max(256) }),
  run: MemoryActivationRunSchema.nullable(),
  custody: z.strictObject({ openGroups: z.int().nonnegative(), unconsumedWitnesses: z.int().nonnegative(), pendingSpans: z.int().nonnegative() }),
  operation: MemoryOperationSchema.nullable(),
  actions: MemoryActivationActionsSchema,
  observedAt: Timestamp,
}).superRefine((status, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const { actions, run, authority, operation } = status;
  const open = operation !== null && !MEMORY_OPERATION_TERMINAL_STATES.includes(operation.state);
  if (status.runtime.available !== (status.runtime.unavailableReason === null)) fail("runtime availability and reason disagree");
  if (status.setup.configured !== (status.setup.phase === "configured")) fail("setup configured flag and phase disagree");
  if (run?.receipt && run.phase !== "activated") fail("a receipt exists only for an activated run");
  if (open && (actions.activate || actions.resume || actions.recoverBinding)) fail("no activation action while an operation is open");
  if (actions.cancelOperationId !== null && (!open || actions.cancelOperationId !== operation.operationId)) fail("cancel names the open operation");
  if (actions.activate && (authority.mode !== "canonical-local" || run !== null || !status.setup.configured || status.prerequisites.blocking.length > 0)) fail("activate requires a configured Local instance without a run");
  if (actions.resume && (authority.mode !== "canonical-local" || run === null || run.receipt !== null)) fail("resume requires an uncommitted run under Local authority");
  if (actions.recoverBinding && (authority.mode !== "hindsight" || run?.receipt === null || run === null || status.runtime.available)) fail("recoverBinding requires a committed run with an unavailable runtime");
});
export type MemoryActivationStatusParams = z.infer<typeof MemoryActivationStatusParamsSchema>;
export type MemoryActivationReceipt = z.infer<typeof MemoryActivationReceiptSchema>;
export type MemoryActivationRun = z.infer<typeof MemoryActivationRunSchema>;
export type MemoryActivationBank = z.infer<typeof MemoryActivationBankSchema>;
export type MemoryActivationActions = z.infer<typeof MemoryActivationActionsSchema>;
export type MemoryActivationStatus = z.infer<typeof MemoryActivationStatusSchema>;
