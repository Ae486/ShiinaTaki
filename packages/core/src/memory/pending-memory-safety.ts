/**
 * INPUT:  canonical Pending Memory intents from an already authorized Core memory write path
 * OUTPUT: bounded, credential/hidden-envelope-refused intents without copying runtime or transport context
 * POS:    core/memory — outbox admission guard; eligibility and trusted provenance remain the caller's responsibility
 */
import { PendingMemoryIntentSchema, type PendingMemoryIntent } from "@taki/shared";
import { sanitizeLegacyRetainText } from "./legacy-migration/legacy-retain-sanitizer.ts";

const MAX_INTENT_BYTES = 512 * 1024;
const SECRET_KEY = /^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credentials?|system[_-]?prompt|raw[_-]?(?:prompt|response|payload))$/i;
const EXTRA_UNSAFE_TEXT = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|<\/?(?:turn-context|memory-recall|tool-result)(?:\s[^>]*)?>/i;

export function validatePendingMemoryIntent(raw: unknown): PendingMemoryIntent {
  try {
    const encoded = JSON.stringify(raw);
    if (typeof encoded !== "string" || new TextEncoder().encode(encoded).byteLength > MAX_INTENT_BYTES) throw new Error();
    assertSafeValue(raw);
    return PendingMemoryIntentSchema.parse(raw);
  } catch {
    // Schema issues can contain source text. Only this closed code crosses admission.
    throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSAFE");
  }
}

function assertSafeValue(value: unknown): void {
  if (typeof value === "string") {
    if (!sanitizeLegacyRetainText(value).ok || EXTRA_UNSAFE_TEXT.test(value)) throw new Error();
  } else if (Array.isArray(value)) {
    for (const item of value) assertSafeValue(item);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) throw new Error();
      assertSafeValue(item);
    }
  }
}
