/**
 * INPUT:  one avatar tool param's live vocabulary names (a costume's expressions or motions), possibly empty
 * OUTPUT: vocabNameSchema(names) -> the tool's `name` schema: a dynamic z.enum of the names, else z.string().min(1)
 * POS:    core/avatar — the 1e source-side hardening; shared by both avatar tools so the enum-or-fallback rule lives once
 */
import { z } from "zod";

// A dynamic enum makes stale names (remembered from a prior costume) structurally invalid: the AI SDK validates the
// model's argument against this schema, marks an out-of-enum call invalid, and feeds back a readable tool-error to
// correct — it never crashes the turn. An empty/unknown vocabulary cannot form an enum (z.enum([]) is invalid), so it
// degrades to any non-empty string — no regression from the pre-1e z.string().min(1).
export function vocabNameSchema(names: readonly string[]): z.ZodType<string> {
  return names.length > 0 ? z.enum(names) : z.string().min(1);
}
