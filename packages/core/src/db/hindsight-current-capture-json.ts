/**
 * INPUT:  complete immutable Local row dispositions and the existing typed Canonical readers
 * OUTPUT: lossless typed JSON fields restored from those exact source rows, with read-back mismatch refusal
 * POS:    core/db — D78 fidelity seam; old readers/codecs cannot silently remove legal JSON own keys
 */
import { HindsightCurrentJsonObjectSchema, HindsightCurrentCanonicalDerivedPayloadSchema,
  type HindsightCurrentCapture } from "@taki/shared";
import { canonicalJson } from "../memory/legacy-migration/legacy-identities.ts";

type CaptureBody = Pick<HindsightCurrentCapture, "banks" | "sources" | "records" | "derived" | "dispositions">;

export function restoreHindsightCurrentCaptureJson<T extends CaptureBody>(body: T): T {
  const rows = new Map(body.dispositions.map((item) => [rowKey(item.witness), parseRow(item.payloadJson)]));
  const row = (input: { kind: string; bankId: string; objectId: string; relatedId?: string }) => {
    const value = rows.get(rowKey({ ...input, relatedId: input.relatedId ?? null }));
    if (!value) throw new Error("HINDSIGHT_CURRENT_CAPTURE_INCOMPLETE");
    return value;
  };
  return { ...body,
    banks: body.banks.map((bank) => ({ ...bank,
      config: HindsightCurrentJsonObjectSchema.parse(row({ kind: "bank", bankId: bank.bankId, objectId: bank.bankId }).config_json) })),
    sources: body.sources.map((source) => ({ ...source,
      metadata: HindsightCurrentJsonObjectSchema.parse(row({ kind: "source", bankId: source.bankId, objectId: source.documentId }).metadata_json) })),
    records: body.records.map((record) => ({ ...record, unit: { ...record.unit,
      metadata: HindsightCurrentJsonObjectSchema.parse(row({ kind: "unit", bankId: record.unit.bankId, objectId: record.unit.memoryId }).metadata_json) } })),
    derived: body.derived.map((derived) => ({ ...derived, payload: HindsightCurrentCanonicalDerivedPayloadSchema.parse(row({ kind: "derived", bankId: derived.bankId,
      objectId: derived.payload.kind === "mental_model" ? derived.payload.mentalModelId : derived.payload.directiveId, relatedId: derived.payload.kind }).payload_json) })),
  };
}

export function requireHindsightCurrentCaptureJson(body: CaptureBody): void {
  if (canonicalJson(restoreHindsightCurrentCaptureJson(body)) !== canonicalJson(body)) throw new Error("HINDSIGHT_CURRENT_CAPTURE_CORRUPT");
}

function rowKey(input: { kind: string; bankId: string | null; objectId: string; relatedId: string | null }): string {
  return JSON.stringify([input.kind, input.bankId, input.objectId, input.relatedId]);
}
function parseRow(value: string): Record<string, unknown> {
  const row: unknown = JSON.parse(value);
  if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error("HINDSIGHT_CURRENT_CAPTURE_CORRUPT");
  return row as Record<string, unknown>;
}
