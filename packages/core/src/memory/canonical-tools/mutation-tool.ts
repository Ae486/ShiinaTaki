/**
 * INPUT:  model-facing canonical mutation fields
 * OUTPUT: shared strict schema leaves and mutation tool descriptions
 * POS:    core/memory/canonical-tools — schema helper only; each operation owns its tool module
 */
import { z } from "zod";

export const MutationScopeSchema = z.enum(["global", "character"])
  .describe("Trusted memory scope containing the target memory.");
export const MemoryIdSchema = z.string().min(1).max(256)
  .describe("Stable memory identity returned by recall.");
export const ExpectedRevisionSchema = z.int().min(1)
  .describe("Current revision returned by recall; stale revisions are rejected without mutation.");
export const MUTATION_DESCRIPTION = "Conditionally mutate one identified memory using its current revision. Refresh memory before retrying a stale revision. Lifecycle changes remain reversible.";
