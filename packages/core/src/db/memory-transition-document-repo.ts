/**
 * INPUT:  complete validated W3 documents and the existing single-writer transaction
 * OUTPUT: append-only byte-preserving document storage and strict identity/hash reads
 * POS:    core/db — private W3 storage primitive; callers establish lease, source and closure before insertion
 */
import type { z } from "zod";
import { parseHindsightApplicationJson } from "@taki/shared";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import type { Database } from "./sqlite.ts";

export type TransitionDocumentKind = "captures" | "native_evidence" | "surviving_evidence" | "candidates" | "baselines" | "preparations" | "delta_results" | "source_uploads" | "source_upload_attempts";
export function transitionDocumentHash(kind: TransitionDocumentKind, value: unknown): string {
  return transitionLocalHash({ domain: `taki-transition-${kind}.v1`, value });
}
export function readTransitionDocument<T>(db: Database, kind: TransitionDocumentKind,
  input: { id?: string; transitionId?: string; slot?: string; schema: z.ZodType<T> }): T | undefined {
  const row = input.id === undefined
    ? db.prepare(`SELECT * FROM memory_transition_${kind} WHERE transition_id=:transition AND slot=:slot`)
      .get({ transition: input.transitionId ?? "", slot: input.slot ?? "" })
    : db.prepare(`SELECT * FROM memory_transition_${kind} WHERE id=:id`).get({ id: input.id });
  if (!row) return undefined;
  if (!(row.body instanceof Uint8Array)) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  const raw = parseHindsightApplicationJson(new TextDecoder("utf-8", { fatal: true }).decode(row.body));
  const value = input.schema.parse(raw);
  const object = value as Record<string, unknown>;
  const idKey = documentIdKey(kind);
  if (object[idKey] !== row.id || object.transitionId !== row.transition_id
    || transitionDocumentHash(kind, Object.fromEntries(Object.entries(object).filter(([key]) => key !== idKey))) !== row.id) {
    throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
  return value;
}
export function insertTransitionDocument(db: Database, kind: TransitionDocumentKind,
  input: { id: string; transitionId: string; slot: string; value: unknown }): void {
  const bytes = Buffer.from(JSON.stringify(input.value));
  const existing = db.prepare(`SELECT id,body FROM memory_transition_${kind} WHERE transition_id=:transition AND slot=:slot`)
    .get({ transition: input.transitionId, slot: input.slot });
  if (existing) {
    if (existing.id !== input.id || !(existing.body instanceof Uint8Array)
      || !Buffer.from(existing.body).equals(bytes)) throw new Error("MEMORY_TRANSITION_CONFLICT");
    return;
  }
  db.prepare(`INSERT INTO memory_transition_${kind}(id,transition_id,slot,body) VALUES(:id,:transition,:slot,:body)`)
    .run({ id: input.id, transition: input.transitionId, slot: input.slot, body: bytes });
}
function documentIdKey(kind: TransitionDocumentKind): string {
  return ({ captures: "captureId", native_evidence: "evidenceId", surviving_evidence: "evidenceId", candidates: "candidateId", baselines: "baselineId",
    preparations: "preparationId", delta_results: "resultId", source_uploads: "uploadId", source_upload_attempts: "attemptId" })[kind];
}
