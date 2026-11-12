/**
 * INPUT:  exact committed primary Timeline rows with verified identity/content witnesses
 * OUTPUT: provider-neutral sanitized conversation spans and stable source digests
 * POS:    core/memory — automatic ingestion source boundary; never trusts role labels as provenance
 */
import { createHash } from "node:crypto";
import { CanonicalMemorySourceSchema, type TimelineEntry } from "@taki/shared";
import { z } from "zod";
import { sanitizeLegacyRetainText } from "./legacy-migration/legacy-retain-sanitizer.ts";

/** Supplied only by the primary Chat persistence owner after the exact rows have committed. */
export interface PrimaryConversationCommit {
  characterId: string;
  entries: readonly TimelineEntry[];
  runId?: string;
}

/** The repository verifies this witness against the current durable row before returning it. */
export interface ProvenPrimaryEntry {
  kind: "primary-committed";
  entry: TimelineEntry;
  digest: string;
  committedThroughSeq: number;
}

const SourceTextSchema = CanonicalMemorySourceSchema.shape.retainedText.unwrap();
export const IngestionMessageSchema = z.strictObject({
  id: z.uuid(), seq: z.int().positive(), role: z.enum(["user", "assistant"]),
  text: SourceTextSchema, createdAt: z.iso.datetime({ offset: true }),
});
export const SanitizedCommittedSpanSchema = z.strictObject({
  schemaVersion: z.literal(1), characterId: z.string().min(1).max(256),
  fromSeq: z.int().nonnegative(), throughSeq: z.int().positive(),
  messages: z.array(IngestionMessageSchema), excludedRows: z.int().nonnegative(),
  proofs: z.array(z.strictObject({ id: z.uuid(), seq: z.int().positive(), digest: z.string().regex(/^[a-f0-9]{64}$/) })),
}).refine((value) => value.throughSeq > value.fromSeq, "invalid ingestion range");
export type SanitizedCommittedSpan = z.infer<typeof SanitizedCommittedSpanSchema>;
export type IngestionMessage = z.infer<typeof IngestionMessageSchema>;

// Remove only known injected envelopes, never rewrite eligible conversational text.
// A broken envelope is refused below rather than allowing its hidden tail through.
const HIDDEN_BLOCKS = /<(turn-context|memory-recall|conversation-summary|system-reminder|system|developer|tool-result|untrusted-observation)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HIDDEN_MARKERS = /<\/?(?:turn-context|memory-recall|conversation-summary|system-reminder|system|developer|tool-result|untrusted-observation)\b|\[\[(?:SYSTEM|TOOL)_[A-Z_]+\]\]/i;
const SECRET_TEXT = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|["']?\b(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)["']?\s*[:=]\s*["']?\S+|(?:密码|密钥|令牌)\s*[:：=]\s*\S+/i;

/** Digest includes every durable field: a later edit cannot inherit an earlier primary witness. */
export function primaryEntryDigest(entry: TimelineEntry): string {
  return digest(JSON.stringify({ id: entry.id, seq: entry.seq, characterId: entry.characterId,
    role: entry.role, content: entry.content, parts: entry.parts ?? null, createdAt: entry.createdAt }));
}

export function sanitizeCommittedPrimarySpan(input: {
  characterId: string; fromSeq: number; throughSeq: number; entries: readonly ProvenPrimaryEntry[];
}): SanitizedCommittedSpan {
  const messages: IngestionMessage[] = [];
  let excludedRows = 0;
  let previous = input.fromSeq;
  for (const proof of input.entries) {
    const entry = proof.entry;
    if (proof.kind !== "primary-committed" || proof.digest !== primaryEntryDigest(entry)
      || proof.committedThroughSeq < entry.seq || entry.characterId !== input.characterId
      || entry.seq <= previous || entry.seq > input.throughSeq) {
      throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
    }
    previous = entry.seq;
    const text = conversationText(entry);
    if (text === null) { excludedRows += 1; continue; }
    messages.push(IngestionMessageSchema.parse({ id: entry.id, seq: entry.seq, role: entry.role,
      text, createdAt: entry.createdAt }));
  }
  return SanitizedCommittedSpanSchema.parse({ schemaVersion: 1, characterId: input.characterId,
    fromSeq: input.fromSeq, throughSeq: input.throughSeq, messages, excludedRows,
    proofs: input.entries.map(({ entry, digest }) => ({ id: entry.id, seq: entry.seq, digest })) });
}

/** Used again on model-produced facts: a model cannot add credentials to an otherwise safe source. */
export function isSafeAutomaticMemoryText(text: string): boolean {
  return !SECRET_TEXT.test(text) && !HIDDEN_MARKERS.test(text) && sanitizeLegacyRetainText(text).ok;
}

export function renderIngestionSource(messages: readonly IngestionMessage[]): string {
  // Labels and dates are source framing. The eligible original wording stays byte-for-byte intact.
  return messages.map((message) => `[${message.seq} ${message.createdAt}] ${message.role}: ${message.text}`).join("\n");
}

export function retainedIngestionSource(messages: readonly IngestionMessage[]) {
  let offset = 0;
  const entries = messages.map((message, index) => {
    if (index > 0) offset += 1;
    const entry = { id: message.id, seq: message.seq, role: message.role, createdAt: message.createdAt,
      utf16Start: offset, utf16Length: message.text.length };
    offset += message.text.length;
    return entry;
  });
  // The source field contains the approved wording itself. Speaker/time and
  // exact UTF-16 slice boundaries remain reversible metadata, so prompt framing
  // cannot push an otherwise supported 100,000-character source over its limit.
  return { text: messages.map((message) => message.text).join("\n"), entries };
}

export function ingestionSourceDigest(span: SanitizedCommittedSpan): string {
  return digest(JSON.stringify(SanitizedCommittedSpanSchema.parse(span)));
}

export function ingestionContentHash(text: string): string { return digest(text); }

function conversationText(entry: TimelineEntry): string | null {
  if (entry.role !== "user" && entry.role !== "assistant") return null;
  // Multipart rows' display projection can contain tool summaries. Take only text parts;
  // tool inputs/results, image bytes/refs and hidden reasoning never enter the gate.
  const original = entry.parts === undefined ? entry.content
    : entry.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
  const text = original.replace(HIDDEN_BLOCKS, "");
  if (!text.trim() || !isSafeAutomaticMemoryText(text)) return null;
  return SourceTextSchema.parse(text);
}

function digest(text: string): string { return createHash("sha256").update(text).digest("hex"); }
