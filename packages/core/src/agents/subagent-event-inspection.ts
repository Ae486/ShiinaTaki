/**
 * INPUT: trusted Character/child scope and an opaque accepted-event history cursor.
 * OUTPUT: bounded immutable event body pages with separate current state and exact child action targets.
 * POS: core/agents — explicit private inspection only; never claims, delivers, handles or wakes an inbox.
 */
import { z } from "zod";
import type { SubagentEvent, SubagentTarget } from "@taki/shared";
import type { SubagentState } from "../harness/subagent-state.ts";
import { assertSubagentCharacter, subagentEventHistory } from "../harness/subagent-queries.ts";
import { subagentEventEvidence } from "./subagent-evidence-output.ts";

const CursorSchema = z.strictObject({ child: z.uuid(), category: z.literal("events"),
  after: z.int().nonnegative(), through: z.int().nonnegative(), offset: z.int().nonnegative(), recordId: z.string().nullable() });
type Cursor = z.infer<typeof CursorSchema>;
interface EventRecord {
  id: string; body: string; offset: number; complete: boolean;
  state: SubagentEvent["state"]; eligible: boolean; suppressionReason: string | null; target: SubagentTarget;
}

export function readSubagentEventInspection(state: SubagentState, input: {
  characterId: string; subagentId: string; cursor: string | null; limit: number;
}) {
  assertSubagentCharacter(state, input.characterId, input.subagentId);
  let cursor: Cursor = { child: input.subagentId, category: "events", after: 0, offset: 0, recordId: null,
    through: input.cursor ? 0 : subagentEventHistory(state, { ...input, afterSeq: 0 }).throughSeq };
  try {
    if (input.cursor) cursor = CursorSchema.parse(JSON.parse(input.cursor));
    if (cursor.child !== input.subagentId || cursor.after > cursor.through
      || (cursor.offset > 0) !== (cursor.recordId !== null)) return invalid(input.subagentId);
  } catch { return invalid(input.subagentId); }
  const records: EventRecord[] = [];
  let remaining = 3000;
  while (records.length < Math.min(input.limit, 20) && remaining > 0) {
    const { event } = subagentEventHistory(state, { ...input, afterSeq: cursor.after, throughSeq: cursor.through });
    if (!event) { if (cursor.recordId) return invalid(input.subagentId); break; }
    if (cursor.recordId && cursor.recordId !== event.eventId) return invalid(input.subagentId);
    const text = JSON.stringify(subagentEventEvidence(event));
    if (cursor.offset > text.length) return invalid(input.subagentId);
    let end = Math.min(text.length, cursor.offset + remaining);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text.charAt(end - 1))) end -= 1;
    const child = state.deps.children.get(input.subagentId);
    const body = text.slice(cursor.offset, end);
    records.push({ id: event.eventId, body, offset: cursor.offset, complete: end === text.length,
      state: event.state, eligible: event.eligible, suppressionReason: event.suppressionReason,
      target: { subagentId: input.subagentId, workInputId: event.workInputId,
        expectedRunId: child.activeRunId, expectedControlVersion: child.controlVersion } });
    remaining -= body.length;
    cursor = end < text.length ? { ...cursor, offset: end, recordId: event.eventId }
      : { ...cursor, after: event.seq, offset: 0, recordId: null };
    if (end < text.length) break;
  }
  const hasMore = cursor.offset > 0 || Boolean(subagentEventHistory(state, { ...input,
    afterSeq: cursor.after, throughSeq: cursor.through }).event);
  return { subagentId: input.subagentId, category: "events" as const, status: records.length ? "available" : "empty",
    records, hasMore, nextCursor: hasMore ? JSON.stringify(cursor) : null,
    message: hasMore ? "Accepted event evidence continues at nextCursor."
      : "No further accepted events at this captured frontier. Inspection does not deliver or handle an inbox event." };
}

function invalid(subagentId: string) {
  const records: EventRecord[] = [];
  return { subagentId, category: "events" as const, status: "invalid_cursor", records,
    hasMore: false, nextCursor: null,
    message: "This cursor does not match the selected worker's accepted event evidence. Start with cursor=null." };
}
