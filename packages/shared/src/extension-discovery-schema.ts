/**
 * INPUT:  validated Core/Host extension identities and bounded discovery/call payloads
 * OUTPUT: strict schemas/types for one host-qualified MCP/Skill/capability discovery snapshot
 * POS:    shared/protocol — extension metadata is descriptive only and never an authority or permission grant
 */
import { z } from "zod";

export const EXTENSION_KINDS = ["skill", "mcp-tool", "capability"] as const;
export const EXTENSION_METHODS = {
  status: "extension.status",
  subscribe: "extension.subscribe",
  changed: "extension.changed",
} as const;
export const ExtensionKindSchema = z.enum(EXTENSION_KINDS);
export type ExtensionKind = z.infer<typeof ExtensionKindSchema>;

const RevisionSchema = z.string().min(1).max(240);
const GenerationSchema = z.number().int().positive();
const HostIdSchema = z.uuid();

export const ExtensionIdentitySchema = z.strictObject({
  extensionId: z.string().min(1).max(240).regex(/^[A-Za-z0-9._:-]+$/),
  kind: ExtensionKindSchema,
  ownerHostId: HostIdSchema,
  subjectId: z.string().min(1).max(240),
  subjectRevision: RevisionSchema,
  connectionGeneration: GenerationSchema,
  catalogGeneration: GenerationSchema,
});
export type ExtensionIdentity = z.infer<typeof ExtensionIdentitySchema>;

export const ExtensionCallModeSchema = z.enum(["skill-load", "skill-resource", "mcp-tool", "capability", "transfer"]);
export type ExtensionCallMode = z.infer<typeof ExtensionCallModeSchema>;

export const ExtensionDescriptorSchema = z.strictObject({
  identity: ExtensionIdentitySchema,
  displayName: z.string().min(1).max(160),
  summary: z.string().max(512),
  callMode: ExtensionCallModeSchema,
  modelKey: z.string().min(1).max(160).optional(),
  available: z.boolean(),
});
export type ExtensionDescriptor = z.infer<typeof ExtensionDescriptorSchema>;

export const ExtensionCollisionSchema = z.strictObject({
  key: z.string().min(1).max(240),
  firstExtensionId: z.string().min(1).max(240),
  secondExtensionId: z.string().min(1).max(240),
});
export type ExtensionCollision = z.infer<typeof ExtensionCollisionSchema>;

export const ExtensionHostSnapshotSchema = z.strictObject({
  hostId: HostIdSchema,
  available: z.boolean(),
  connectionGeneration: GenerationSchema,
  catalogGeneration: GenerationSchema,
  extensionCount: z.number().int().nonnegative(),
});
export type ExtensionHostSnapshot = z.infer<typeof ExtensionHostSnapshotSchema>;

export const ExtensionDiscoveryBudgetSchema = z.strictObject({
  maxEntries: z.number().int().positive().max(512),
  maxDescriptionChars: z.number().int().positive().max(4096),
  maxSearchResults: z.number().int().positive().max(128),
  maxCalls: z.number().int().positive().max(128),
});
export type ExtensionDiscoveryBudget = z.infer<typeof ExtensionDiscoveryBudgetSchema>;

export const ExtensionRunSnapshotSchema = z.strictObject({
  runId: HostIdSchema,
  primaryHostId: HostIdSchema,
  hosts: z.array(ExtensionHostSnapshotSchema).max(64),
  entries: z.array(ExtensionDescriptorSchema).max(512),
  collisions: z.array(ExtensionCollisionSchema).max(64),
  budget: ExtensionDiscoveryBudgetSchema,
});
export type ExtensionRunSnapshot = z.infer<typeof ExtensionRunSnapshotSchema>;

export const ExtensionStatusParamsSchema = z.strictObject({});
export type ExtensionStatusParams = z.infer<typeof ExtensionStatusParamsSchema>;

export const ExtensionConvergenceResultSchema = z.strictObject({
  observedAt: z.iso.datetime({ offset: true }),
  coreHostId: HostIdSchema,
  hosts: z.array(ExtensionHostSnapshotSchema).max(64),
  entries: z.array(ExtensionDescriptorSchema).max(512),
  collisions: z.array(ExtensionCollisionSchema).max(64),
});
export type ExtensionConvergenceResult = z.infer<typeof ExtensionConvergenceResultSchema>;

export const ExtensionDiscoverParamsSchema = z.strictObject({
  query: z.string().max(200).optional(),
  kind: ExtensionKindSchema.optional(),
  ownerHostId: HostIdSchema.optional(),
  limit: z.number().int().positive().max(128).optional(),
});
export type ExtensionDiscoverParams = z.infer<typeof ExtensionDiscoverParamsSchema>;

export const ExtensionDiscoverResultSchema = z.strictObject({
  runId: HostIdSchema,
  entries: z.array(ExtensionDescriptorSchema).max(128),
  truncated: z.boolean(),
});
export type ExtensionDiscoverResult = z.infer<typeof ExtensionDiscoverResultSchema>;

export const ExtensionDescribeParamsSchema = z.strictObject({ extensionId: z.string().min(1).max(240) });
export type ExtensionDescribeParams = z.infer<typeof ExtensionDescribeParamsSchema>;

export const ExtensionDescribeResultSchema = z.strictObject({
  runId: HostIdSchema,
  entry: ExtensionDescriptorSchema.nullable(),
  toolName: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
});
export type ExtensionDescribeResult = z.infer<typeof ExtensionDescribeResultSchema>;

export const ExtensionCallParamsSchema = z.strictObject({
  extensionId: z.string().min(1).max(240),
  input: z.unknown(),
});
export type ExtensionCallParams = z.infer<typeof ExtensionCallParamsSchema>;

export const EXTENSION_CALL_ERROR_CODES = [
  "EXTENSION_NOT_FOUND",
  "EXTENSION_UNAVAILABLE",
  "EXTENSION_STALE_GENERATION",
  "EXTENSION_CALL_LIMIT_EXCEEDED",
  "EXTENSION_CALL_FAILED",
  "INVALID_EXTENSION_INPUT",
] as const;
export const ExtensionCallErrorCodeSchema = z.enum(EXTENSION_CALL_ERROR_CODES);
export type ExtensionCallErrorCode = z.infer<typeof ExtensionCallErrorCodeSchema>;

export const ExtensionCallResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    owner: ExtensionIdentitySchema,
    output: z.unknown().optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.literal("EXTENSION_NOT_FOUND"),
    message: z.string().min(1).max(512),
  }),
  z.strictObject({
    ok: z.literal(false),
    owner: ExtensionIdentitySchema,
    code: ExtensionCallErrorCodeSchema.exclude(["EXTENSION_NOT_FOUND"]),
    message: z.string().min(1).max(512),
    state: z.enum(["cancelled", "outcome_unknown"]).optional(),
  }),
]);
export type ExtensionCallResult = z.infer<typeof ExtensionCallResultSchema>;

export const EXTENSION_DISCOVERY_BUDGET: ExtensionDiscoveryBudget = {
  maxEntries: 128,
  maxDescriptionChars: 1024,
  maxSearchResults: 32,
  maxCalls: 32,
};
