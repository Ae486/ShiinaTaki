/**
 * INPUT:  failures discovered while reading, normalizing, staging, or activating legacy memory
 * OUTPUT: closed diagnostic codes and bounded privacy-safe details
 * POS:    core/memory/legacy-migration — durable operator diagnostics; never carries source values
 */
export const LEGACY_DIAGNOSTIC_CODES = [
  "INVALID_UTF8", "UNSUPPORTED_BOM", "INVALID_FENCE", "INVALID_FRONTMATTER_KEY",
  "DUPLICATE_FRONTMATTER_KEY", "UNSUPPORTED_YAML", "MISSING_REQUIRED_FIELD", "INVALID_LEGACY_ID",
  "UNKNOWN_LAYER", "INVALID_IMPORTANCE", "INVALID_STATUS", "INVALID_ORIGIN", "INVALID_TIMESTAMP",
  "INVALID_REINFORCEMENT", "FIELD_BOUND_EXCEEDED", "METADATA_BOUND_EXCEEDED", "PATH_OUT_OF_ROOT",
  "REPARSE_POINT", "INVALID_PLACEMENT", "OWNERSHIP_MISMATCH", "UNKNOWN_BLOCK", "BLOCK_SCOPE_MISMATCH",
  "BLOCK_FRONTMATTER", "BLOCK_CONFLICT", "SANITIZER_REFUSAL", "CANONICAL_SCHEMA_MISMATCH",
  "IMPORT_CONFLICT", "SNAPSHOT_CHANGED", "LEASE_LOST", "INTEGRITY_MISMATCH",
] as const;

export type LegacyDiagnosticCode = (typeof LEGACY_DIAGNOSTIC_CODES)[number];

export interface LegacyDiagnostic {
  code: LegacyDiagnosticCode;
  phase: "discovery" | "decode" | "parse" | "placement" | "normalize" | "sanitize" | "import" | "verify" | "activate";
  detail: string | null;
  line: number | null;
  column: number | null;
}

export function legacyDiagnostic(
  code: LegacyDiagnosticCode,
  phase: LegacyDiagnostic["phase"],
  detail: string | null = null,
): LegacyDiagnostic {
  return { code, phase, detail: detail === null ? null : detail.slice(0, 512), line: null, column: null };
}
