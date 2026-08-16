/**
 * INPUT:  candidate mcp.* param/result instances (operator-role desired-state + runtime status surface)
 * OUTPUT: MCP_METHODS + desired-server wire schemas + write params (expectedConfigRevision) + sanitized
 *         runtime status/diagnostic schemas + McpRefusalReason (operator-only surface; NO Rust mirror — the
 *         Shell never handles these frames, so it is tested in its own schema test, never protocol-fixtures)
 * POS:    shared/protocol — the Secure MCP Lifecycle contract: three state planes stay separate; desired config
 *         carries opaque `secret-ref:` markers ONLY (values never ride this family — secret.set is the value path)
 */
import { z } from "zod";

// Operator-role methods (same posture as permission.*/secret.*): the Home MCP page and the CLI drive these; the
// agent has NO tool that reaches them. Writes carry expectedConfigRevision for per-row optimistic concurrency.
export const MCP_METHODS = {
  list: "mcp.list",
  get: "mcp.get",
  add: "mcp.add",
  edit: "mcp.edit",
  enable: "mcp.enable",
  disable: "mcp.disable",
  remove: "mcp.remove",
  test: "mcp.test",
  reconnect: "mcp.reconnect",
  status: "mcp.status",
} as const;

// Stable server key. The charset is the mcp tool-key sanitizer's own fold, so the model-facing prefix
// `${serverId}_${toolName}` is collision-free by construction and `mcp.<serverId>.env.<NAME>` refs stay valid.
export const McpServerIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
export type McpServerId = z.infer<typeof McpServerIdSchema>;

// Env/header maps: values are plain non-secret strings OR opaque `secret-ref:` markers. A value is NEVER a stored
// secret (the catalog owns values); validation never interpolates a value into an issue message.
export const MCP_SECRET_REF_MARKER = "secret-ref:";
export const McpFieldValueSchema = z.string().max(64 * 1024);
export const McpEnvMapSchema = z.record(z.string().min(1).max(64), McpFieldValueSchema);
export type McpFieldValue = z.infer<typeof McpFieldValueSchema>;

const ArgsSchema = z.array(z.string()).max(256);

// stdio transport: an operator-configured child process (spawn happens inside @ai-sdk/mcp, shell:false).
export const McpStdioConfigSchema = z.strictObject({
  command: z.string().min(1).max(1024),
  args: ArgsSchema.optional(),
  env: McpEnvMapSchema.optional(),
  cwd: z.string().max(1024).optional(),
});
export type McpStdioConfig = z.infer<typeof McpStdioConfigSchema>;

// http transport: a Streamable HTTP MCP endpoint.
export const McpHttpConfigSchema = z.strictObject({
  url: z.url(),
  headers: McpEnvMapSchema.optional(),
});
export type McpHttpConfig = z.infer<typeof McpHttpConfigSchema>;

export const McpServerConfigSchema = z.union([McpStdioConfigSchema, McpHttpConfigSchema]);
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

// Selected raw tool names (empty = every discovered tool). Applied at candidate preparation, never at call time.
export const McpSelectedToolsSchema = z.array(z.string().min(1).max(128)).max(1024);

const TimestampSchema = z.iso.datetime({ offset: true });
const RevisionSchema = z.number().int().positive();

/** Plane 1 — the Core-SQLite desired row (sanitized: markers only, values live exclusively in the catalog). */
export const McpDesiredServerSchema = z.strictObject({
  serverId: McpServerIdSchema,
  ownerHostId: z.string().uuid(),
  config: McpServerConfigSchema,
  enabled: z.boolean(),
  selectedTools: McpSelectedToolsSchema,
  configRevision: RevisionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type McpDesiredServer = z.infer<typeof McpDesiredServerSchema>;

// --- writes (every mutation carries the per-row optimistic revision) ---

export const McpAddParamsSchema = z.strictObject({
  serverId: McpServerIdSchema,
  config: McpServerConfigSchema,
  enabled: z.boolean().optional(),
  selectedTools: McpSelectedToolsSchema.optional(),
});
export type McpAddParams = z.infer<typeof McpAddParamsSchema>;

export const McpEditParamsSchema = z.strictObject({
  serverId: McpServerIdSchema,
  config: McpServerConfigSchema,
  selectedTools: McpSelectedToolsSchema,
  expectedConfigRevision: RevisionSchema,
});
export type McpEditParams = z.infer<typeof McpEditParamsSchema>;

export const McpEnableParamsSchema = z.strictObject({
  serverId: McpServerIdSchema,
  expectedConfigRevision: RevisionSchema,
});
export type McpEnableParams = z.infer<typeof McpEnableParamsSchema>;

export const McpDisableParamsSchema = McpEnableParamsSchema;
export type McpDisableParams = McpEnableParams;

export const McpRemoveParamsSchema = McpEnableParamsSchema;
export type McpRemoveParams = McpEnableParams;

export const McpReconnectParamsSchema = z.strictObject({ serverId: McpServerIdSchema });
export type McpReconnectParams = z.infer<typeof McpReconnectParamsSchema>;

export const McpGetParamsSchema = z.strictObject({ serverId: McpServerIdSchema });
export type McpGetParams = z.infer<typeof McpGetParamsSchema>;

// Test drives an EPHEMERAL candidate: an existing desired server's config OR an unsaved config — exactly one.
export const McpTestParamsSchema = z.union([
  z.strictObject({ serverId: McpServerIdSchema }),
  z.strictObject({ config: McpServerConfigSchema, selectedTools: McpSelectedToolsSchema.optional() }),
]);
export type McpTestParams = z.infer<typeof McpTestParamsSchema>;

export const McpListParamsSchema = z.strictObject({});
export const McpStatusParamsSchema = z.strictObject({});
export type McpListParams = z.infer<typeof McpListParamsSchema>;
export type McpStatusParams = z.infer<typeof McpStatusParamsSchema>;

// --- sanitized runtime diagnostics (plane 3 projections; never config, values, or schema bodies) --

export const McpToolSkipCodeSchema = z.enum([
  "DEFAULT_TYPE_MISMATCH",
  "MALFORMED_REQUIRED",
  "NULL_UNSUPPORTED",
  "REQUIRED_NULLABLE_UNSUPPORTED",
  "UNION_UNSUPPORTED",
]);
export type McpToolSkipCode = z.infer<typeof McpToolSkipCodeSchema>;

export const McpToolSkipIssueSchema = z.strictObject({
  toolName: z.string().min(1).max(128),
  code: McpToolSkipCodeSchema,
  path: z.string().min(1).max(256),
});
export type McpToolSkipIssue = z.infer<typeof McpToolSkipIssueSchema>;

export const McpCandidateFailureReasonSchema = z.enum([
  "connect-failed",
  "secret-unresolvable",
  "tools-list-failed",
  "deadline-exceeded",
  "tool-key-collision",
]);
export type McpCandidateFailureReason = z.infer<typeof McpCandidateFailureReasonSchema>;

export const McpToolKeyCollisionSchema = z.strictObject({
  key: z.string().min(1).max(256),
  existingServerId: McpServerIdSchema,
  existingToolName: z.string().min(1).max(128),
  candidateToolName: z.string().min(1).max(128),
});
export type McpToolKeyCollision = z.infer<typeof McpToolKeyCollisionSchema>;

export const McpCandidateOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("published"),
    at: TimestampSchema,
    runtimeGeneration: z.number().int().positive(),
    toolNames: z.array(z.string().min(1).max(128)).max(1024),
    skipped: z.array(McpToolSkipIssueSchema).max(1024),
    pages: z.number().int().positive(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.strictObject({
    status: z.literal("failed"),
    at: TimestampSchema,
    reason: McpCandidateFailureReasonSchema,
    message: z.string().max(512),
    collisions: z.array(McpToolKeyCollisionSchema).max(64).optional(),
  }),
  z.strictObject({
    status: z.literal("tested"),
    at: TimestampSchema,
    ok: z.boolean(),
    reason: McpCandidateFailureReasonSchema.optional(),
    message: z.string().max(512).optional(),
    toolNames: z.array(z.string().min(1).max(128)).max(1024),
    skipped: z.array(McpToolSkipIssueSchema).max(1024),
    pages: z.number().int().nonnegative(), // a failure before the first listing page reports zero
    durationMs: z.number().int().nonnegative(),
  }),
]);
export type McpCandidateOutcome = z.infer<typeof McpCandidateOutcomeSchema>;

/** Plane 3 — Host-observed in-memory runtime phase. Process-local truth; never persisted, never restored. */
export const McpRuntimePhaseSchema = z.enum(["connecting", "connected", "failed", "draining", "disconnected", "disabled"]);
export type McpRuntimePhase = z.infer<typeof McpRuntimePhaseSchema>;

export const McpServerStatusSchema = z.strictObject({
  serverId: McpServerIdSchema,
  phase: McpRuntimePhaseSchema,
  runtimeGeneration: z.number().int().positive().nullable(),
  leaseCount: z.number().int().nonnegative(),
  toolCount: z.number().int().nonnegative(),
  lastOutcome: McpCandidateOutcomeSchema.nullable(),
});
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

/** Desired row + its live runtime projection in one read (the Home page's only source of truth). */
export const McpServerViewSchema = z.strictObject({
  serverId: McpServerIdSchema,
  ownerHostId: z.string().uuid(),
  config: McpServerConfigSchema,
  enabled: z.boolean(),
  selectedTools: McpSelectedToolsSchema,
  configRevision: RevisionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  status: McpServerStatusSchema,
});
export type McpServerView = z.infer<typeof McpServerViewSchema>;

// --- results ---

export const McpListResultSchema = z.strictObject({ servers: z.array(McpServerViewSchema) });
export type McpListResult = z.infer<typeof McpListResultSchema>;

export const McpGetResultSchema = z.strictObject({ server: McpServerViewSchema });
export type McpGetResult = z.infer<typeof McpGetResultSchema>;

export const McpMutationResultSchema = z.strictObject({ server: McpServerViewSchema });
export type McpMutationResult = z.infer<typeof McpMutationResultSchema>;

export const McpRemoveResultSchema = z.strictObject({ status: z.literal("removed"), serverId: McpServerIdSchema });
export type McpRemoveResult = z.infer<typeof McpRemoveResultSchema>;

export const McpStatusResultSchema = z.strictObject({ servers: z.array(McpServerStatusSchema) });
export type McpStatusResult = z.infer<typeof McpStatusResultSchema>;

export const McpTestResultSchema = z.strictObject({
  status: z.enum(["ok", "failed"]),
  reason: McpCandidateFailureReasonSchema.optional(),
  message: z.string().max(512).optional(),
  toolNames: z.array(z.string().min(1).max(128)).max(1024),
  skipped: z.array(McpToolSkipIssueSchema).max(1024),
  pages: z.number().int().nonnegative(), // zero when the candidate failed before the first listing page
  durationMs: z.number().int().nonnegative(),
});
export type McpTestResult = z.infer<typeof McpTestResultSchema>;

// Lifecycle refusals ride MCP_REFUSED beside one of these bounded machine reasons (sanitized by construction).
export const McpRefusalReasonSchema = z.enum([
  "unknown-server",
  "duplicate-server",
  "key-collision",
  "invalid-config",
]);
export type McpRefusalReason = z.infer<typeof McpRefusalReasonSchema>;
