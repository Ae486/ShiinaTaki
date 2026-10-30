/**
 * INPUT: an exact Timeline SQL row from a trusted primary witness reader
 * OUTPUT: optional validated source context and C3 digest with unchanged legacy-null bytes
 * POS: core/db — shared interpretation-evidence codec; never establishes primary eligibility
 */
import { createHash } from "node:crypto";
import { SourceContextSchema } from "@taki/shared";
import type { SqlRow } from "./sqlite.ts";

export function readTimelineSourceContext(row: SqlRow) {
  return row.source_context_json == null ? undefined : SourceContextSchema.parse(JSON.parse(String(row.source_context_json)));
}

export function primarySourceRowDigest(row: SqlRow): string {
  const sourceContext = readTimelineSourceContext(row);
  // The first seven properties/order are the existing exact C3 SELECT projection.
  return createHash("sha256").update(JSON.stringify({ id: row.id, seq: row.seq, character_id: row.character_id,
    role: row.role, content: row.content, parts: row.parts, created_at: row.created_at,
    ...(sourceContext ? { sourceContext } : {}) })).digest("hex");
}
