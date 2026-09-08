/**
 * INPUT:  normalized content selected for canonical migration or Pending Memory admission
 * OUTPUT: deterministic sanitized text or a closed refusal diagnostic
 * POS:    core/memory/legacy-migration — frozen refusal classifier reused by Pending Memory; no migration side effects
 */
import { legacyDiagnostic, type LegacyDiagnostic } from "./legacy-diagnostics.ts";

export const LEGACY_SANITIZER_VERSION = 1;

const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*[^\s]{8,}/i,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}\b/,
];
const HIDDEN_ENVELOPES = [/<\/?(?:system|tool|assistant)(?:\s[^>]*)?>/i, /\[\[(?:SYSTEM|TOOL)_[A-Z_]+\]\]/];

export type SanitizerResult =
  | { ok: true; text: string; version: number }
  | { ok: false; diagnostic: LegacyDiagnostic };

export function sanitizeLegacyRetainText(text: string): SanitizerResult {
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return { ok: false, diagnostic: legacyDiagnostic("SANITIZER_REFUSAL", "sanitize", "credential-class") };
  }
  if (HIDDEN_ENVELOPES.some((pattern) => pattern.test(text))) {
    return { ok: false, diagnostic: legacyDiagnostic("SANITIZER_REFUSAL", "sanitize", "hidden-envelope") };
  }
  return { ok: true, text, version: LEGACY_SANITIZER_VERSION };
}
