/**
 * INPUT: existing maintenance operation state and proved auxiliary call associations
 * OUTPUT: bounded operator-only background Monitor snapshots and membership protocol
 * POS: shared/protocol — independent from ordinary Run metrics and latest-primary input attribution
 */
import { z } from "zod";
import { CharacterIdSchema } from "./character-schema.ts";
import { MaintenanceKindSchema, MaintenanceOperationRefSchema } from "./maintenance-operation-ref-schema.ts";
import { MemoryTidyProgressSchema } from "./memory-tidy-outcome-schema.ts";
import { AuxiliaryUsageCursorSchema, AuxiliaryUsageResultSchema } from "./auxiliary-usage-schema.ts";

const Timestamp = z.iso.datetime({ offset: true });
export const MAINTENANCE_MONITOR_METHODS = {
  subscribe: "observability.maintenanceSubscribe",
  unsubscribe: "observability.maintenanceUnsubscribe",
  changed: "observability.maintenanceChanged",
} as const;
export const MaintenanceMonitorCursorSchema = z.strictObject({
  startedAt: Timestamp, kind: MaintenanceKindSchema, operationId: z.string().min(1).max(200),
});
export const MaintenanceMonitorParamsSchema = z.strictObject({
  characterId: CharacterIdSchema,
  cursor: MaintenanceMonitorCursorSchema.optional(),
  selected: MaintenanceOperationRefSchema.optional(),
  callCursor: AuxiliaryUsageCursorSchema.optional(),
}).refine((value) => value.selected === undefined || value.selected.characterId === value.characterId,
  "selected maintenance must belong to the requested Character")
  .refine((value) => value.callCursor === undefined || value.selected !== undefined, "call cursor requires selection");
export type MaintenanceMonitorParams = z.infer<typeof MaintenanceMonitorParamsSchema>;
export const MaintenanceMonitorSummarySchema = z.strictObject({
  ref: MaintenanceOperationRefSchema,
  startedAt: Timestamp, updatedAt: Timestamp, finishedAt: Timestamp.nullable(),
  status: z.enum(["running", "completed", "partial", "failed", "cancelled", "interrupted"]),
  progress: MemoryTidyProgressSchema.extend({ reviewed: z.int().nonnegative().nullable() }).optional(),
  attempt: z.int().positive().optional(),
  failure: z.enum(["timeout", "tool-errors", "review-stale", "unfinished", "input-too-large", "execution-failed",
    "source-changed", "summary-failed", "interrupted"]).nullable(),
});
export type MaintenanceMonitorSummary = z.infer<typeof MaintenanceMonitorSummarySchema>;
export const MaintenanceMonitorSnapshotSchema = z.strictObject({
  query: MaintenanceMonitorParamsSchema,
  status: z.enum(["ready", "unavailable", "disabled"]),
  characterId: CharacterIdSchema,
  rows: z.array(MaintenanceMonitorSummarySchema).max(25),
  nextCursor: MaintenanceMonitorCursorSchema.nullable(),
  detail: z.strictObject({ operation: MaintenanceMonitorSummarySchema, calls: AuxiliaryUsageResultSchema,
    association: z.enum(["linked", "unavailable"]) }).nullable(),
}).superRefine((value, ctx) => {
  const { query, detail } = value;
  const same = (ref: z.infer<typeof MaintenanceOperationRefSchema>) => query.selected !== undefined
    && ref.kind === query.selected.kind && ref.operationId === query.selected.operationId
    && ref.characterId === query.characterId;
  if (value.characterId !== query.characterId || value.rows.some((row) => row.ref.characterId !== query.characterId)) {
    ctx.addIssue({ code: "custom", message: "maintenance snapshot Character mismatch" });
  }
  if (value.status !== "ready" && (value.rows.length > 0 || detail !== null || value.nextCursor !== null)) {
    ctx.addIssue({ code: "custom", message: "unavailable maintenance must withdraw data" });
  }
  if (value.status === "ready" && (query.selected !== undefined) !== (detail !== null)) {
    ctx.addIssue({ code: "custom", message: "maintenance detail must match selection" });
  }
  if (detail && (!same(detail.operation.ref) || detail.calls.rows.some((call) => !call.operation || !same(call.operation)))) {
    ctx.addIssue({ code: "custom", message: "maintenance call association mismatch" });
  }
});
export type MaintenanceMonitorSnapshot = z.infer<typeof MaintenanceMonitorSnapshotSchema>;
export const MaintenanceMonitorUpdateSchema = z.strictObject({
  revision: z.int().nonnegative(), snapshot: MaintenanceMonitorSnapshotSchema,
});
export type MaintenanceMonitorUpdate = z.infer<typeof MaintenanceMonitorUpdateSchema>;
export const MaintenanceMonitorUnsubscribeParamsSchema = z.strictObject({});
export const MaintenanceMonitorUnsubscribeResultSchema = z.strictObject({ status: z.literal("ok") });
