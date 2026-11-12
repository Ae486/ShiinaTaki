/**
 * INPUT: canonical private evidence selected for a model-facing inspection page
 * OUTPUT: readable source/result evidence without persistence digests or internal action receipts
 * POS: core/agents — projection only; canonical repositories and self-scoped raw retrieval stay intact
 */
import type { SubagentEvent, SubagentResultGroup } from "@taki/shared";

function omit(record: Record<string, unknown>, names: string[]) {
  return Object.fromEntries(Object.entries(record).filter(([name]) => !names.includes(name)));
}
export function subagentResultEvidence(group: SubagentResultGroup) {
  return { completionId: group.completionId, child: omit(group.child, ["receiptId"]),
    completionState: group.completionState, completionReason: group.completionReason,
    parent: group.parent ? omit(group.parent, ["receiptId"]) : null,
    publication: group.publication ? { state: group.publication.state, reason: group.publication.reason } : null };
}
export function subagentHistoryEvidence(category: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  if (category === "inputs") return omit(row, ["requestDigest", "operationKey", "consumed", "replyAcceptance"]);
  if (category === "messages") return omit(row, ["modelInputDigest", "modelEffectId"]);
  if (category === "results") return { runId: row.runId, workInputId: row.workInputId,
    result: row.result ? subagentResultEvidence(row.result as SubagentResultGroup) : null };
  return value;
}

// These flags describe retrieval/body paging, never the lifecycle of the selected work.
export function subagentInspectionPage(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>;
  if (!("status" in row) || !("records" in row || "body" in row)) return value;
  const { status, complete, records, ...rest } = row;
  return { ...rest, readStatus: status,
    ...(typeof complete === "boolean" ? { bodyComplete: complete } : {}),
    ...(Array.isArray(records) ? { records: records.map((record: Record<string, unknown>) => {
      const { complete: bodyComplete, ...content } = record;
      // Keep serialized bodies/offsets unchanged, including cursors returned before this projection existed.
      if (row.category !== "results" || content.offset !== 0 || bodyComplete !== true || typeof content.body !== "string") return { ...content, bodyComplete };
      const result = JSON.parse(content.body).result as SubagentResultGroup | null;
      return { ...content, bodyComplete, resultStatus: result ? result.child.outcome : "not_recorded" };
    }) } : {}) };
}

export function subagentEventEvidence(event: SubagentEvent) {
  // These accepted fields are immutable. Current delivery state and action targets belong outside body pages.
  return { eventId: event.eventId, subagentId: event.subagentId, workInputId: event.workInputId,
    kind: event.kind, body: event.body, sourceContext: event.sourceContext, acceptedAt: event.acceptedAt };
}

export function subagentEvidencePage(input: { completionId: string; cursor: string | null; value: unknown }) {
  const text = JSON.stringify(input.value);
  let offset = 0;
  if (input.cursor) {
    const cursor: unknown = JSON.parse(input.cursor);
    if (!cursor || typeof cursor !== "object" || !("completionId" in cursor) || cursor.completionId !== input.completionId
      || !("offset" in cursor) || typeof cursor.offset !== "number" || !Number.isSafeInteger(cursor.offset)
      || cursor.offset < 0 || cursor.offset > text.length) throw new Error("SUBAGENT_CURSOR_MISMATCH");
    offset = cursor.offset;
  }
  let end = Math.min(text.length, offset + 3000);
  if (end < text.length && /[\uD800-\uDBFF]/u.test(text.charAt(end - 1))) end -= 1;
  return { status: "available", completionId: input.completionId, body: text.slice(offset, end), offset,
    complete: end === text.length, nextCursor: end < text.length ? JSON.stringify({ completionId: input.completionId, offset: end }) : null };
}
