/**
 * INPUT: one admitted Run's captured recall tool and its selected purposes/scopes
 * OUTPUT: one-attempt-per-Bank governed tool with bounded fenced text and retained evidence currentness
 * POS: core/memory — pure wrapper construction; only actual tool execution reads the captured provider
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { HindsightMemoryRecallEnvelopeV1Schema, RecallEnvelopeSchema, type RecallResult } from "@taki/shared";
import type { CapturedMemoryRun } from "./canonical-memory-run.ts";
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import { estimateTokens } from "./token-estimator.ts";

export interface InitiativeMemoryRecallInput { query: string; scopes: readonly ("global" | "character")[] }
export interface InitiativeMemoryRecall { readonly tools: ToolSet; isCurrent(): boolean }
const Scope = z.enum(["global", "character"]);
const ModelView = z.strictObject({ scope: Scope, status: z.enum(["confirmed", "partial", "unavailable", "allowance_used"]),
  vectorState: z.enum(["ready", "building", "degraded", "unavailable"]).nullable(), truncated: z.boolean(),
  pending: z.boolean(), records: z.array(z.strictObject({ text: z.string(), confirmed: z.boolean(),
    origin: z.string(), capturedAt: z.string() })).max(4) });
type ModelView = z.infer<typeof ModelView>;
type EvidenceState = { checks: (() => boolean)[]; attempted: Set<string> };

export function createInitiativeMemoryRecall(captured: CapturedMemoryRun, input: InitiativeMemoryRecallInput): InitiativeMemoryRecall {
  const query = z.string().trim().min(1).max(1000).parse(input.query);
  const scopes = new Set(input.scopes.map((scope) => Scope.parse(scope)));
  const state: EvidenceState = { checks: [], attempted: new Set() };
  const isCurrent = () => {
    try { return captured.isCurrent?.() === true && state.checks.every((check) => check()); }
    catch { return false; }
  };
  const original = captured.tools.recall;
  if (!original?.execute || !captured.snapshot.capabilities.recall || !captured.captureRecallEvidence || !scopes.size) {
    return Object.freeze({ tools: Object.freeze({}), isCurrent });
  }
  const execute = original.execute;
  const wrapped = tool({
    description: "Read the selected topic from one eligible memory scope. Each scope allows one attempt for this Run; missing or unavailable evidence leaves the matter unknown.",
    inputSchema: z.strictObject({ scope: Scope.describe("One selected memory scope; each can be attempted once.") }),
    execute: async (raw, options) => {
      const parsed = z.strictObject({ scope: Scope }).safeParse(raw);
      if (!parsed.success) return empty("global", "unavailable");
      const { scope } = parsed.data;
      if (!scopes.has(scope) || !isCurrent() || options.abortSignal?.aborted) return empty(scope, "unavailable");
      if (state.attempted.has(scope)) return empty(scope, "allowance_used");
      state.attempted.add(scope);
      try {
        const result = await execute({ query, scope, limit: 4, maxTokens: 512 }, options);
        if (!isCurrent() || options.abortSignal?.aborted) return empty(scope, "unavailable");
        return projectResult({ captured, state, query }, scope, result);
      } catch { return empty(scope, "unavailable"); }
    },
    toModelOutput: ({ output }: { output: unknown }) => {
      const parsed = ModelView.safeParse(output);
      return { type: "text" as const, value: modelText(isCurrent() && parsed.success ? parsed.data : empty("global", "unavailable")) };
    },
  });
  const descriptors = Object.getOwnPropertyDescriptors(original);
  for (const key of ["execute", "inputSchema", "description", "toModelOutput"]) delete descriptors[key];
  Object.defineProperties(wrapped, descriptors);
  return Object.freeze({ tools: Object.freeze({ recall: Object.freeze(wrapped) }), isCurrent });
}

function projectResult(input: { captured: CapturedMemoryRun; state: EvidenceState; query: string },
  scope: "global" | "character", raw: unknown): ModelView {
  const schema = input.captured.snapshot.providerId === "hindsight" ? HindsightMemoryRecallEnvelopeV1Schema : RecallEnvelopeSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success || !parsed.data.ok) return empty(scope, "unavailable");
  const data = parsed.data.data;
  const view: ModelView = { scope, status: data.partial ? "partial" : "confirmed", vectorState: data.vectorState,
    truncated: data.truncated, pending: (data.pending?.length ?? 0) > 0, records: [] };
  for (const hit of data.hits.slice(0, 4)) {
    const check = hit.confirmed ? input.captured.captureRecallEvidence?.(hit.record, input.query, parsed.data.requestId) : undefined;
    if (!check || !check()) { view.status = "partial"; view.truncated = true; continue; }
    const record = modelRecord(hit);
    const next = { ...view, records: [...view.records, record] };
    if (estimateTokens(modelText(next)) > 512) { view.truncated = true; continue; }
    view.records.push(record); input.state.checks.push(check);
  }
  if (data.hits.length > 4) view.truncated = true;
  // Pending intent bodies have no confirmed source lifetime. Preserve their actual presence, never expose them as facts.
  if (view.pending) view.status = "partial";
  return view;
}
function modelRecord(hit: RecallResult["hits"][number]): ModelView["records"][number] {
  return { text: hit.record.unit.text, confirmed: hit.confirmed,
    origin: hit.record.provenance.origin, capturedAt: hit.record.provenance.capturedAt };
}
function empty(scope: "global" | "character", status: "unavailable" | "allowance_used"): ModelView {
  return { scope, status, vectorState: null, truncated: false, pending: false, records: [] };
}
function modelText(view: ModelView): string {
  const content = JSON.stringify(view).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return fenceUntrusted({ source: "initiative-memory-recall", content });
}
