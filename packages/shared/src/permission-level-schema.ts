/**
 * INPUT:  candidate permission.levelGet/levelSet/cellsGet/cellSet params & results (operator-role config surface)
 * OUTPUT: PERMISSION_METHODS + Core optimistic policy schemas + isolated legacy Rust-compatible leaf schemas
 * POS:    shared/protocol — Core operator authority contract; legacy leaves exist only for cross-batch fixture parity
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

// The canonical policy cell key: `capability` (fixed-risk) or `capability:class` (classified risk family).
// Sensitive target-qualified decision scope is a separate control value and is never truncated into authority.
export const PermissionCellKeySchema = z.string().regex(/^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)?$/);
export type PermissionCellKey = z.infer<typeof PermissionCellKeySchema>;

export const PermissionDecisionKeySchema = z.string().min(1).max(512);
export type PermissionDecisionKey = z.infer<typeof PermissionDecisionKeySchema>;

// Batch 1 does not change the Rust mirror. Keep its previous leaf shapes isolated from the new Core operator
// contract so shared golden fixtures stay meaningful without weakening canonical policy-cell identity.
export const LegacyPermissionCellKeySchema = z.string().regex(/^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*(:.+)?)?$/);
export const LegacyPermissionLevelStateSchema = z.strictObject({ level: PermissionLevelSchema });
export const LegacyPermissionCellStateSchema = z.strictObject({
  key: LegacyPermissionCellKeySchema,
  level: PermissionLevelSchema,
  posture: PermissionPostureSchema,
  denyByDefault: z.boolean(),
});
export const LegacyPermissionCellSetParamsSchema = z.strictObject({
  key: LegacyPermissionCellKeySchema,
  level: PermissionLevelSchema,
  posture: PermissionPostureSchema,
  secondConfirm: z.boolean().optional(),
});
export type LegacyPermissionLevelState = z.infer<typeof LegacyPermissionLevelStateSchema>;
export type LegacyPermissionCellState = z.infer<typeof LegacyPermissionCellStateSchema>;
export type LegacyPermissionCellSetParams = z.infer<typeof LegacyPermissionCellSetParamsSchema>;

// levelGet result, levelSet params, and levelSet result all carry the single active-level field.
const PositivePolicyGenerationSchema = z.number().int().positive();
const PositiveRegistryRevisionSchema = z.number().int().positive();

export const PermissionLevelStateSchema = z.strictObject({
  level: PermissionLevelSchema,
  policyGeneration: PositivePolicyGenerationSchema,
  registryRevision: PositiveRegistryRevisionSchema,
});
export type PermissionLevelState = z.infer<typeof PermissionLevelStateSchema>;

export const PermissionLevelGetParamsSchema = z.strictObject({});
export type PermissionLevelGetParams = z.infer<typeof PermissionLevelGetParamsSchema>;

export const PermissionLevelSetParamsSchema = z.strictObject({
  level: PermissionLevelSchema,
  expectedPolicyGeneration: PositivePolicyGenerationSchema,
});
export type PermissionLevelSetParams = z.infer<typeof PermissionLevelSetParamsSchema>;

// One projection cell as the panel sees it. denyByDefault marks a floor cell (sensitive sub-target /
// self-escalation surface / catastrophic command): factory deny in EVERY tier, changeable only with secondConfirm.
export const PermissionCellStateSchema = z.strictObject({
  key: PermissionCellKeySchema,
  level: PermissionLevelSchema,
  capabilityId: z.string().min(1),
  descriptorRevision: PositiveRegistryRevisionSchema,
  factoryPosture: PermissionPostureSchema,
  overridePosture: PermissionPostureSchema.nullable(),
  effectivePosture: PermissionPostureSchema,
  approvalMemory: z.enum(["rememberable", "once-only"]),
  overrideMode: z.enum(["ordinary", "second-confirm", "immutable"]),
});
export type PermissionCellState = z.infer<typeof PermissionCellStateSchema>;

// cellsGet result: the full projection (factory + operator overrides applied), one entry per (key, level).
export const PermissionCellsGetParamsSchema = z.strictObject({});
export type PermissionCellsGetParams = z.infer<typeof PermissionCellsGetParamsSchema>;

export const PermissionCellsStateSchema = z.strictObject({
  level: PermissionLevelSchema,
  policyGeneration: PositivePolicyGenerationSchema,
  registryRevision: PositiveRegistryRevisionSchema,
  cells: z.array(PermissionCellStateSchema),
});
export type PermissionCellsState = z.infer<typeof PermissionCellsStateSchema>;

// cellSet params. secondConfirm is the wire proof the panel raised its prominent confirm — REQUIRED true when the
// target is a deny-by-default cell (a floor edit without it MUST be rejected); irrelevant for ordinary cells.
export const PermissionCellSetParamsSchema = z.strictObject({
  key: PermissionCellKeySchema,
  level: PermissionLevelSchema,
  posture: PermissionPostureSchema.nullable(),
  expectedPolicyGeneration: PositivePolicyGenerationSchema,
  secondConfirm: z.boolean().optional(),
});
export type PermissionCellSetParams = z.infer<typeof PermissionCellSetParamsSchema>;

// cellSet result: the cell as stored (echo), so the panel renders exactly what took effect.
export const PermissionCellSetResultSchema = z.strictObject({
  policyGeneration: PositivePolicyGenerationSchema,
  registryRevision: PositiveRegistryRevisionSchema,
  cell: PermissionCellStateSchema,
});
export type PermissionCellSetResult = z.infer<typeof PermissionCellSetResultSchema>;
