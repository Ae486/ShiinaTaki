/**
 * INPUT:  canonical reflect callback and one trusted scope
 * OUTPUT: provider-capability reflect AI tool
 * POS:    core/memory/canonical-tools — dormant thin adapter advertised only by capable providers
 */
import { tool, type Tool } from "ai";
import { z } from "zod";
export function createReflectTool(execute: (input: { query: string; scope: "global" | "character"; budget: "low" | "mid" | "high"; maxTokens: number }, signal?: AbortSignal) => Promise<unknown>): Tool { return tool({ description: "Reflect across durable memory when ordinary recall cannot provide enough synthesis. Select one trusted scope and a bounded reasoning budget. Evidence identities remain explicit.", inputSchema: z.strictObject({ query: z.string().min(1).max(16_384).describe("Bounded question that requires synthesis across durable memory."), scope: z.enum(["global", "character"]).describe("One trusted memory scope for reflection."), budget: z.enum(["low", "mid", "high"]).describe("Provider reasoning budget for this reflection."), maxTokens: z.int().min(1).max(8_192).describe("Maximum returned reflection tokens.") }), execute: (input, options) => execute(input, options.abortSignal) }); }
