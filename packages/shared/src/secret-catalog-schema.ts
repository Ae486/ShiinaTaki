/**
 * INPUT:  candidate secret.set/clear/presence/list params & results (operator-role sensitive surface)
 * OUTPUT: SECRET_METHODS + write-only secret reference/catalog schemas + SecretRefusalReason
 * POS:    shared/protocol — the operator-only Host-secret-catalog contract; NO Rust serde mirror (the Shell never
 *         handles these frames), so it is tested in its own schema test, never protocol-fixtures.test.ts
 */
import { z } from "zod";

// Operator-role methods (same posture as permission.*): settings/CLI drive these; the agent has NO tool that
// reaches them — a conversational "set my key" must ride Approval, never this method family (frozen design).
export const SECRET_METHODS = {
  set: "secret.set",
  clear: "secret.clear",
  presence: "secret.presence",
  list: "secret.list",
} as const;

// The stable opaque secret reference: `<domain>.<segment>...` (e.g. `mcp.github-mcp.env.GITHUB_TOKEN`). It names a
// field, never a keyring account, filesystem path, or value; segments are dot-separated bounded runs so a ref can
// never smuggle a payload. Refs are safe to log; values are not.
export const SecretRefSchema = z.string().min(3).max(240).regex(/^[a-z][a-z0-9-]*(\.[A-Za-z0-9_][A-Za-z0-9_-]*)+$/);
export type SecretRef = z.infer<typeof SecretRefSchema>;

// Where the authoritative value currently lives. `legacy-plaintext` marks a not-yet-migrated source field.
export const SecretProvenanceSourceSchema = z.enum(["catalog", "legacy-plaintext"]);
export type SecretProvenanceSource = z.infer<typeof SecretProvenanceSourceSchema>;

const PositiveKeyVersionSchema = z.number().int().positive();
const TimestampSchema = z.iso.datetime({ offset: true });

export const SecretProvenanceSchema = z.strictObject({
  source: SecretProvenanceSourceSchema,
  keyVersion: PositiveKeyVersionSchema,
  updatedAt: TimestampSchema,
});
export type SecretProvenance = z.infer<typeof SecretProvenanceSchema>;

// Catalog health as presence reports it: `ok` = readable under the current master key; `locked` = no master key
// available (presence is then unknown and reported present:false); `unreadable` = wrong key/tamper/truncation
// (file preserved, never rewritten); `unsupported` = envelope version this build cannot open.
export const SecretCatalogHealthSchema = z.enum(["ok", "locked", "unreadable", "unsupported"]);
export type SecretCatalogHealth = z.infer<typeof SecretCatalogHealthSchema>;

// The write request necessarily carries the value (operator-authenticated loopback/VPS transport); bounded so a
// pasted file cannot become a storage bomb. Validation failures must never echo it (plain z.string() issues carry
// path/message only — verified against installed zod; never interpolate the value in refine messages).
export const SecretSetParamsSchema = z.strictObject({
  secretRef: SecretRefSchema,
  value: z.string().min(1).max(64 * 1024),
});
export type SecretSetParams = z.infer<typeof SecretSetParamsSchema>;

// Write-only by construction: the result schema has no value-carrying field and strictObject rejects any attempt
// to add one. Set returns presence + provenance + health only.
export const SecretSetResultSchema = z.strictObject({
  secretRef: SecretRefSchema,
  present: z.literal(true),
  provenance: SecretProvenanceSchema,
  health: SecretCatalogHealthSchema,
});
export type SecretSetResult = z.infer<typeof SecretSetResultSchema>;

export const SecretClearParamsSchema = z.strictObject({
  secretRef: SecretRefSchema,
});
export type SecretClearParams = z.infer<typeof SecretClearParamsSchema>;

// Clear is idempotent: clearing an absent ref is the same success as clearing a present one.
export const SecretClearResultSchema = z.strictObject({
  secretRef: SecretRefSchema,
  present: z.literal(false),
});
export type SecretClearResult = z.infer<typeof SecretClearResultSchema>;

export const SecretPresenceParamsSchema = z.strictObject({
  secretRef: SecretRefSchema,
});
export type SecretPresenceParams = z.infer<typeof SecretPresenceParamsSchema>;

// present:false + provenance:null + health:"locked" means presence is UNKNOWN (store locked), not "absent".
export const SecretPresenceResultSchema = z.strictObject({
  secretRef: SecretRefSchema,
  present: z.boolean(),
  provenance: SecretProvenanceSchema.nullable(),
  health: SecretCatalogHealthSchema,
});
export type SecretPresenceResult = z.infer<typeof SecretPresenceResultSchema>;

export const SecretListParamsSchema = z.strictObject({});
export type SecretListParams = z.infer<typeof SecretListParamsSchema>;

export const SecretListResultSchema = z.strictObject({
  health: SecretCatalogHealthSchema,
  entries: z.array(SecretPresenceResultSchema),
});
export type SecretListResult = z.infer<typeof SecretListResultSchema>;

// Storage failures surface as SECRET_REFUSED with one of these bounded reasons — sanitized by construction; the
// operator learns the category, never key material, ciphertext, or values.
export const SecretRefusalReasonSchema = z.enum(["store-locked", "store-unreadable", "store-unsupported", "store-write-failed"]);
export type SecretRefusalReason = z.infer<typeof SecretRefusalReasonSchema>;
