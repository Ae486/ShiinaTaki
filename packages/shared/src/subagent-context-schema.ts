/**
 * INPUT: private task summary checkpoints and exact self-history page selectors
 * OUTPUT: revisioned summary witnesses and bounded source-attributed history pages
 * POS: shared/protocol — private context evidence, never execution or Memory authority
 */
import { z } from "zod";

const Id = z.string().min(1).max(200);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const SubagentContextSummaryWitnessSchema = z.strictObject({
  workInputId: z.uuid(), revision: z.int().positive(), throughSeq: z.int().positive(), sourceDigest: Digest,
});
export type SubagentContextSummaryWitness = z.infer<typeof SubagentContextSummaryWitnessSchema>;
export const SubagentContextSummarySchema = SubagentContextSummaryWitnessSchema.extend({
  subagentId: z.uuid(), sourceFromSeq: z.int().nonnegative(), text: z.string().min(1).max(1_000_000),
  runId: Id, attemptId: Id, createdAt: z.iso.datetime({ offset: true }),
});
export type SubagentContextSummary = z.infer<typeof SubagentContextSummarySchema>;
export const SubagentSelfHistoryRequestSchema = z.strictObject({
  category: z.enum(["messages", "inputs", "results", "materials"]), cursor: z.string().max(2000).nullable(), limit: z.int().min(1).max(20),
});
export type SubagentSelfHistoryRequest = z.infer<typeof SubagentSelfHistoryRequestSchema>;
export const SubagentSelfHistoryResultSchema = z.strictObject({
  status: z.enum(["available", "empty", "invalid_cursor", "unavailable", "failed"]),
  subagentId: z.uuid(), category: z.enum(["messages", "inputs", "results", "materials"]),
  records: z.array(z.strictObject({ id: Id, body: z.string().max(12_000), offset: z.int().nonnegative(), complete: z.boolean() })).max(20),
  nextCursor: z.string().max(2000).nullable(), hasMore: z.boolean(), message: z.string().max(500),
});
export type SubagentSelfHistoryResult = z.infer<typeof SubagentSelfHistoryResultSchema>;
