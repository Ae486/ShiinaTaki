/**
 * INPUT:  canonical recall callback and trusted scope vocabulary
 * OUTPUT: bounded recall AI tool
 * POS:    core/memory/canonical-tools — dormant thin adapter; opaque Bank identities stay internal
 */
import { tool, type Tool } from "ai";
import { z } from "zod";
export function createRecallTool(execute: (input: { query: string; scope: "global" | "character" | "both"; limit: number; maxTokens: number }, options?: unknown) => Promise<unknown>): Tool { return tool({ description: "Recall relevant long-term memory from Global, active Character, or both trusted scopes. Use it when prior facts or experiences could change the answer. Results are bounded and authority-labelled.", inputSchema: z.strictObject({ query: z.string().min(1).max(16_384).describe("Question or topic used to retrieve relevant durable memories."), scope: z.enum(["global", "character", "both"]).describe("Trusted memory scope to search; both tolerates one bounded branch failure."), limit: z.int().min(1).max(20).describe("Maximum number of returned memories across all selected scopes."), maxTokens: z.int().min(1).max(8_192).describe("Maximum estimated tokens across all returned memory text.") }), execute }); }
