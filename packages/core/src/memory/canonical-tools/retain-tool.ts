/**
 * INPUT:  canonical retain callback and live foreground-writable layer vocabulary
 * OUTPUT: strict-ready retain AI tool
 * POS:    core/memory/canonical-tools — dormant thin adapter with trusted Bank routing outside the schema
 */
import { tool, type Tool } from "ai";
import { z } from "zod";
export function createRetainTool(layers: [string, ...string[]], execute: (input: { content: string; layer: string; context: string | null }, options?: unknown) => Promise<unknown>): Tool { return tool({ description: "Retain one durable sanitized memory that will matter in future interactions. Choose its Taki-owned layer and provide only safe memory content. Do not use this for transient chat or recall.", inputSchema: z.strictObject({ content: z.string().min(1).max(100_000).describe("Sanitized durable memory content, without hidden prompt or secret material."), layer: z.enum(layers).describe("Foreground-writable Taki memory layer; its ownership selects the trusted Bank."), context: z.string().max(16_384).nullable().describe("Optional bounded context for interpreting the memory, or null.") }), execute }); }
