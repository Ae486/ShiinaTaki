/**
 * INPUT:  one avatar tool param's live vocabulary names (a costume's expressions or motions), possibly empty
 * OUTPUT: dynamic name enum (nonempty-string fallback) with current-name correction guidance
 * POS:    core/avatar — the 1e source-side hardening; shared by both avatar tools so the enum-or-fallback rule lives once
 */
import { z } from "zod";

// A dynamic enum makes stale names (remembered from a prior costume) structurally invalid: the AI SDK validates the
// model's argument against this schema, marks an out-of-enum call invalid, and feeds back a readable tool-error to
// correct — it never crashes the turn. An empty/unknown vocabulary cannot form an enum (z.enum([]) is invalid), so it
// degrades to any non-empty string — no regression from the pre-1e z.string().min(1).
export function vocabNameSchema(names: readonly string[]): z.ZodType<string> {
  const description = "Required name inside the argument object; choose an exact name from this tool's current vocabulary.";
  if (names.length > 0) {
    // Keep Zod's structured allowed values once; its default message repeats the whole enum in SDK errors.
    const error = `Provide the required name in an object, for example ${JSON.stringify({ name: names[0] })}. Choose the intended name from this tool's current allowed values; do not repeat empty {} arguments.`;
    return z.enum(names, { error }).describe(description);
  }
  const error = "Provide name as a non-empty string inside the argument object. No current vocabulary is known; do not invent a name or repeat empty {} arguments.";
  return z.string({ error }).min(1, { error }).describe(description);
}
