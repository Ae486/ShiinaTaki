/**
 * INPUT:  candidate permission.levelGet/levelSet/cellsGet/cellSet params & results (operator-role config surface)
 * OUTPUT: PERMISSION_METHODS + PermissionLevel/Posture/CellKey/Cell schemas (+types); secondConfirm floor-change marker
 * POS:    shared/protocol — the Permission Level contract (T2b; settings-panel UI lands with #23); serde-mirrored in Rust
 */
import { z } from "zod";

// Operator-role methods (mirror of approval.respond being operator-only): the settings panel drives these; the
// agent has NO tool that reaches them — a conversational grant rides the ordinary Approval flow (NL red line,
// spec/backend/permission-authorization.md).
export const PERMISSION_METHODS = {
  levelGet: "permission.levelGet",
  levelSet: "permission.levelSet",
  cellsGet: "permission.cellsGet",
  cellSet: "permission.cellSet",
} as const;

// The ordered preset spectrum (CONTEXT "Permission Level"): a projection over per-cell postures, never a second
// enforcement path. Extending = adding a member; every governance registry row then declares its posture for it.
export const PermissionLevelSchema = z.enum(["strict", "standard", "relaxed"]);
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

// What a projection cell resolves to: auto-run (still audited), ask the user, or refuse without a dialog.
export const PermissionPostureSchema = z.enum(["auto", "ask", "deny"]);
export type PermissionPosture = z.infer<typeof PermissionPostureSchema>;

// The unified (capability, argClass) key: `capability` (fixed-risk), `capability:class` (arg-determined —
// generalizes the Rust ShellOpenClass::key()), optional free-form third segment for per-target classes (e.g. a
// dir root). Producers are governance registry rows — members are deliberately NOT enumerated here (extensible).
export const PermissionCellKeySchema = z.string().regex(/^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*(:.+)?)?$/);
export type PermissionCellKey = z.infer<typeof PermissionCellKeySchema>;

// levelGet result, levelSet params, and levelSet result all carry the single active-level field.
export const PermissionLevelStateSchema = z.strictObject({ level: PermissionLevelSchema });
export type PermissionLevelState = z.infer<typeof PermissionLevelStateSchema>;

// One projection cell as the panel sees it. denyByDefault marks a floor cell (sensitive sub-target /
// self-escalation surface / catastrophic command): factory deny in EVERY tier, changeable only with secondConfirm.
export const PermissionCellStateSchema = z.strictObject({
  key: PermissionCellKeySchema,
  level: PermissionLevelSchema,
  posture: PermissionPostureSchema,
  denyByDefault: z.boolean(),
});
export type PermissionCellState = z.infer<typeof PermissionCellStateSchema>;

// cellsGet result: the full projection (factory + operator overrides applied), one entry per (key, level).
export const PermissionCellsStateSchema = z.strictObject({ cells: z.array(PermissionCellStateSchema) });
export type PermissionCellsState = z.infer<typeof PermissionCellsStateSchema>;

// cellSet params. secondConfirm is the wire proof the panel raised its prominent confirm — REQUIRED true when the
// target is a deny-by-default cell (a floor edit without it MUST be rejected); irrelevant for ordinary cells.
export const PermissionCellSetParamsSchema = z.strictObject({
  key: PermissionCellKeySchema,
  level: PermissionLevelSchema,
  posture: PermissionPostureSchema,
  secondConfirm: z.boolean().optional(),
});
export type PermissionCellSetParams = z.infer<typeof PermissionCellSetParamsSchema>;

// cellSet result: the cell as stored (echo), so the panel renders exactly what took effect.
export const PermissionCellSetResultSchema = z.strictObject({ cell: PermissionCellStateSchema });
export type PermissionCellSetResult = z.infer<typeof PermissionCellSetResultSchema>;
